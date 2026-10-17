import csv
import io
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload
from ..database import get_db
from .categories import ensure_category
from ..models import Product, Sale, SaleItem
from ..schemas import (
    ImportErrorRow, ImportPreview, ProductCreate, ProductRead,
    SaleCreate, SaleRead,
)

router = APIRouter()


def sale_total(sale: Sale) -> Decimal:
    return sum(
        (item.unit_price * item.quantity - item.discount for item in sale.items),
        Decimal("0.00"),
    )


def sale_to_read(sale: Sale) -> dict:
    return {
        "id": sale.id,
        "reference_number": sale.reference_number,
        "sale_date": sale.sale_date,
        "status": sale.status,
        "items": sale.items,
        "total": sale_total(sale),
    }


@router.get("/products", response_model=list[ProductRead])
def list_products(db: Session = Depends(get_db)):
    return db.query(Product).order_by(Product.name).all()


@router.post("/products", response_model=ProductRead, status_code=201)
def create_product(payload: ProductCreate, db: Session = Depends(get_db)):
    existing = db.query(Product).filter(func.lower(Product.name) == payload.name.lower()).first()
    if existing:
        raise HTTPException(status_code=409, detail="A product with this name already exists.")
    data = payload.model_dump()
    data["category"] = ensure_category(db, payload.category)
    product = Product(**data)
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.get("/sales", response_model=list[SaleRead])
def list_sales(
    start_date: date | None = None,
    end_date: date | None = None,
    db: Session = Depends(get_db),
):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=422, detail="start_date must be on or before end_date.")
    query = db.query(Sale).options(selectinload(Sale.items)).order_by(Sale.sale_date.desc(), Sale.id.desc())
    if start_date:
        query = query.filter(Sale.sale_date >= start_date)
    if end_date:
        query = query.filter(Sale.sale_date <= end_date)
    return [sale_to_read(sale) for sale in query.all()]


@router.post("/sales", response_model=SaleRead, status_code=201)
def create_sale(payload: SaleCreate, db: Session = Depends(get_db)):
    if db.query(Sale).filter(Sale.reference_number == payload.reference_number).first():
        raise HTTPException(status_code=409, detail="This reference number already exists.")

    product_ids = {item.product_id for item in payload.items}
    products = db.query(Product).filter(Product.id.in_(product_ids)).all()
    found_ids = {product.id for product in products}
    missing_ids = sorted(product_ids - found_ids)
    if missing_ids:
        raise HTTPException(status_code=422, detail=f"Unknown product IDs: {missing_ids}")

    for item in payload.items:
        if item.discount > item.unit_price * item.quantity:
            raise HTTPException(status_code=422, detail="A line-item discount cannot exceed its line total.")

    sale = Sale(reference_number=payload.reference_number, sale_date=payload.sale_date, status="completed")
    sale.items = [SaleItem(**item.model_dump()) for item in payload.items]
    db.add(sale)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(sale)
    sale = db.query(Sale).options(selectinload(Sale.items)).filter(Sale.id == sale.id).one()
    return sale_to_read(sale)


@router.get("/dashboard/summary")
def dashboard_summary(
    start_date: date | None = None,
    end_date: date | None = None,
    db: Session = Depends(get_db),
):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=422, detail="start_date must be on or before end_date.")
    query = db.query(Sale).options(selectinload(Sale.items)).filter(Sale.status == "completed")
    if start_date:
        query = query.filter(Sale.sale_date >= start_date)
    if end_date:
        query = query.filter(Sale.sale_date <= end_date)
    sales = query.all()
    revenue = sum((sale_total(sale) for sale in sales), Decimal("0.00"))
    quantity_sold = sum(item.quantity for sale in sales for item in sale.items)
    return {
        "start_date": start_date,
        "end_date": end_date,
        "transaction_count": len(sales),
        "items_sold": quantity_sold,
        "gross_sales": str(sum(
            (item.unit_price * item.quantity for sale in sales for item in sale.items),
            Decimal("0.00"),
        )),
        "discounts": str(sum(
            (item.discount for sale in sales for item in sale.items),
            Decimal("0.00"),
        )),
        "net_sales": str(revenue),
    }



@router.get("/dashboard/daily-sales")
def dashboard_daily_sales(
    start_date: date | None = None,
    end_date: date | None = None,
    db: Session = Depends(get_db),
):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(
            status_code=422,
            detail="start_date must be on or before end_date.",
        )

    query = (
        db.query(Sale)
        .options(selectinload(Sale.items))
        .filter(Sale.status == "completed")
        .order_by(Sale.sale_date.asc())
    )

    if start_date:
        query = query.filter(Sale.sale_date >= start_date)

    if end_date:
        query = query.filter(Sale.sale_date <= end_date)

    sales = query.all()
    daily_totals = defaultdict(Decimal)

    for sale in sales:
        daily_totals[sale.sale_date] += sale_total(sale)

    # With a full date range, return every day (zero for quiet days) so the
    # chart shows a continuous timeline instead of skipping days without sales.
    if start_date and end_date:
        day_count = (end_date - start_date).days + 1
        return [
            {
                "date": (start_date + timedelta(days=offset)).isoformat(),
                "sales": str(daily_totals.get(start_date + timedelta(days=offset), Decimal("0.00"))),
            }
            for offset in range(day_count)
        ]

    return [
        {
            "date": sale_date.isoformat(),
            "sales": str(total),
        }
        for sale_date, total in sorted(daily_totals.items())
    ]


REQUIRED_COLUMNS = {
    "reference_number", "sale_date", "product_name", "category",
    "quantity", "unit_price", "discount",
}


async def read_and_validate_csv(file: UploadFile, db: Session):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Upload a .csv file.")
    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="CSV file must be 5 MB or smaller.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="CSV must be UTF-8 encoded.")
    reader = csv.DictReader(io.StringIO(text))
    headers = {header.strip() for header in (reader.fieldnames or []) if header}
    missing = sorted(REQUIRED_COLUMNS - headers)
    if missing:
        raise HTTPException(status_code=422, detail=f"Missing required CSV columns: {missing}")

    errors = []
    rows = []
    references_in_file = set()
    duplicate_references = set()
    existing_references = {
        value for (value,) in db.query(Sale.reference_number).all()
    }

    existing_categories = {
        name.lower(): category
        for name, category in db.query(Product.name, Product.category).all()
    }
    categories_in_file: dict[str, str] = {}

    for row_number, original in enumerate(reader, start=2):
        row = {(key.strip() if key else key): (value.strip() if value else "") for key, value in original.items()}
        try:
            reference = row["reference_number"]
            if not reference:
                raise ValueError("reference_number is required")
            if reference in existing_references:
                duplicate_references.add(reference)
                raise ValueError(f"reference_number already exists in the database: {reference}")
            sale_date = date.fromisoformat(row["sale_date"])
            product_name = row["product_name"]
            category = row["category"]
            if not product_name or not category:
                raise ValueError("product_name and category are required")
            product_key = product_name.lower()
            known_category = existing_categories.get(product_key)
            if known_category is not None and known_category.lower() != category.lower():
                raise ValueError(
                    f"category mismatch for existing product '{product_name}' "
                    f"(database has '{known_category}', file has '{category}')"
                )
            file_category = categories_in_file.setdefault(product_key, category)
            if file_category.lower() != category.lower():
                raise ValueError(
                    f"product '{product_name}' appears with different categories "
                    f"('{file_category}' and '{category}')"
                )
            quantity = int(row["quantity"])
            if quantity <= 0:
                raise ValueError("quantity must be a positive whole number")
            unit_price = Decimal(row["unit_price"])
            discount = Decimal(row["discount"] or "0")
            if not unit_price.is_finite() or unit_price < 0:
                raise ValueError("unit_price must be a non-negative amount")
            if not discount.is_finite() or discount < 0 or discount > unit_price * quantity:
                raise ValueError("discount must be between zero and the line total")
            # Repeated references within one file are allowed: each row may be a line item
            # belonging to the same transaction. A later consistency check verifies dates.
            references_in_file.add(reference)
            rows.append({
                "reference_number": reference, "sale_date": sale_date,
                "product_name": product_name, "category": category,
                "quantity": quantity, "unit_price": unit_price, "discount": discount,
            })
        except (ValueError, KeyError, InvalidOperation) as exc:
            errors.append(ImportErrorRow(row=row_number, message=str(exc)))

    dates_by_reference = defaultdict(set)
    for row in rows:
        dates_by_reference[row["reference_number"]].add(row["sale_date"])
    for reference, dates in dates_by_reference.items():
        if len(dates) > 1:
            errors.append(ImportErrorRow(
                row=0,
                message=f"Reference {reference} has multiple sale dates: {sorted(str(d) for d in dates)}",
            ))

    return rows, errors, sorted(duplicate_references)


@router.post("/sales/import/preview", response_model=ImportPreview)
async def preview_sales_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    rows, errors, duplicates = await read_and_validate_csv(file, db)
    return ImportPreview(
        valid_rows=len(rows),
        duplicate_references=duplicates,
        errors=errors,
        can_import=bool(rows) and not errors,
    )


@router.post("/sales/import/confirm")
async def confirm_sales_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    rows, errors, duplicates = await read_and_validate_csv(file, db)
    if errors or not rows:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Import cancelled. Fix all CSV errors and preview the file again.",
                "valid_rows": len(rows),
                "duplicate_references": duplicates,
                "errors": [error.model_dump() for error in errors],
            },
        )

    # Group rows by transaction reference; each reference becomes one sale with one or more items.
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["reference_number"]].append(row)

    try:
        for reference, items in grouped.items():
            sale_dates = {item["sale_date"] for item in items}
            if len(sale_dates) != 1:
                raise HTTPException(status_code=422, detail=f"Reference {reference} has multiple sale dates.")
            sale = Sale(reference_number=reference, sale_date=items[0]["sale_date"], status="completed")
            for item in items:
                product = db.query(Product).filter(
                    func.lower(Product.name) == item["product_name"].lower()
                ).first()
                if not product:
                    product = Product(
                        name=item["product_name"],
                        category=ensure_category(db, item["category"]),
                        default_unit_price=item["unit_price"],
                    )
                    db.add(product)
                    db.flush()
                elif product.category.lower() != item["category"].lower():
                    raise HTTPException(
                        status_code=422,
                        detail=f"Category mismatch for existing product: {item['product_name']}",
                    )
                sale.items.append(SaleItem(
                    product_id=product.id,
                    quantity=item["quantity"],
                    unit_price=item["unit_price"],
                    discount=item["discount"],
                ))
            db.add(sale)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {"message": "CSV import completed.", "transactions_imported": len(grouped), "rows_imported": len(rows)}