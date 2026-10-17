from datetime import datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Product, Sale, SaleItem, StockMovement
from ..schemas import ProductCreate, ProductRead
from .categories import ensure_category

router = APIRouter()

CENT = Decimal("0.01")
StockStatus = Literal["ok", "low", "out", "oversold", "untracked"]


# ---------- response / request models ----------

class InventoryItem(BaseModel):
    id: int
    name: str
    category: str
    default_unit_price: Decimal
    unit_cost: Decimal | None
    reorder_level: int
    track_stock: bool
    received: int          # stock in + adjustments
    sold: int              # completed sales
    on_hand: int | None    # None when stock is not tracked
    status: StockStatus


class InventorySummary(BaseModel):
    total_products: int
    tracked_products: int
    low_count: int
    out_count: int         # out of stock or oversold
    stock_value: Decimal   # on-hand units at cost


class InventoryRead(BaseModel):
    summary: InventorySummary
    items: list[InventoryItem]


class MovementCreate(BaseModel):
    quantity: int = Field(ge=-1_000_000, le=1_000_000)
    reason: Literal["stock_in", "adjustment"]
    note: str | None = Field(default=None, max_length=200)

    @field_validator("note")
    @classmethod
    def clean_note(cls, value: str | None) -> str | None:
        value = (value or "").strip()
        return value or None

    @model_validator(mode="after")
    def check_quantity(self):
        if self.quantity == 0:
            raise ValueError("Quantity cannot be zero.")
        if self.reason == "stock_in" and self.quantity < 0:
            raise ValueError("Stock in must be a positive quantity.")
        return self


class MovementRead(BaseModel):
    id: int
    product_id: int
    product_name: str
    quantity: int
    reason: str
    note: str | None
    created_at: datetime


# ---------- helpers ----------

def stock_status(on_hand: int | None, reorder_level: int) -> StockStatus:
    if on_hand is None:
        return "untracked"
    if on_hand < 0:
        return "oversold"
    if on_hand == 0:
        return "out"
    if reorder_level > 0 and on_hand <= reorder_level:
        return "low"
    return "ok"


def stock_figures(db: Session, product_id: int) -> tuple[int, int]:
    received = (
        db.query(func.coalesce(func.sum(StockMovement.quantity), 0))
        .filter(StockMovement.product_id == product_id)
        .scalar()
    )
    sold = (
        db.query(func.coalesce(func.sum(SaleItem.quantity), 0))
        .join(Sale, Sale.id == SaleItem.sale_id)
        .filter(SaleItem.product_id == product_id, Sale.status == "completed")
        .scalar()
    )
    return int(received or 0), int(sold or 0)


def movement_to_read(movement: StockMovement, product_name: str) -> MovementRead:
    return MovementRead(
        id=movement.id,
        product_id=movement.product_id,
        product_name=product_name,
        quantity=movement.quantity,
        reason=movement.reason,
        note=movement.note,
        created_at=movement.created_at,
    )


# ---------- endpoints ----------

@router.get("/inventory", response_model=InventoryRead)
def list_inventory(db: Session = Depends(get_db)):
    moved = (
        db.query(
            StockMovement.product_id.label("pid"),
            func.sum(StockMovement.quantity).label("received"),
        )
        .group_by(StockMovement.product_id)
        .subquery()
    )
    sold = (
        db.query(
            SaleItem.product_id.label("pid"),
            func.sum(SaleItem.quantity).label("sold"),
        )
        .join(Sale, Sale.id == SaleItem.sale_id)
        .filter(Sale.status == "completed")
        .group_by(SaleItem.product_id)
        .subquery()
    )
    rows = (
        db.query(Product, moved.c.received, sold.c.sold)
        .outerjoin(moved, moved.c.pid == Product.id)
        .outerjoin(sold, sold.c.pid == Product.id)
        .order_by(Product.name)
        .all()
    )

    items: list[InventoryItem] = []
    stock_value = Decimal("0.00")
    low = out = tracked = 0

    for product, received, sold_qty in rows:
        received = int(received or 0)
        sold_qty = int(sold_qty or 0)
        on_hand = received - sold_qty if product.track_stock else None
        status = stock_status(on_hand, product.reorder_level)

        if product.track_stock:
            tracked += 1
            if status == "low":
                low += 1
            elif status in ("out", "oversold"):
                out += 1
            if on_hand and on_hand > 0 and product.unit_cost is not None:
                stock_value += Decimal(product.unit_cost) * on_hand

        items.append(InventoryItem(
            id=product.id, name=product.name, category=product.category,
            default_unit_price=product.default_unit_price, unit_cost=product.unit_cost,
            reorder_level=product.reorder_level, track_stock=product.track_stock,
            received=received, sold=sold_qty, on_hand=on_hand, status=status,
        ))

    return InventoryRead(
        summary=InventorySummary(
            total_products=len(items), tracked_products=tracked,
            low_count=low, out_count=out, stock_value=stock_value.quantize(CENT),
        ),
        items=items,
    )


@router.put("/products/{product_id}", response_model=ProductRead)
def update_product(product_id: int, payload: ProductCreate, db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found.")

    duplicate = (
        db.query(Product)
        .filter(func.lower(Product.name) == payload.name.lower(), Product.id != product_id)
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="A product with this name already exists.")

    data = payload.model_dump()
    data["category"] = ensure_category(db, data["category"])
    for field, value in data.items():
        setattr(product, field, value)
    db.commit()
    db.refresh(product)
    return product


@router.get("/inventory/movements", response_model=list[MovementRead])
def list_movements(
    product_id: int | None = None,
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    query = db.query(StockMovement, Product.name).join(Product, Product.id == StockMovement.product_id)
    if product_id is not None:
        query = query.filter(StockMovement.product_id == product_id)
    rows = query.order_by(StockMovement.created_at.desc(), StockMovement.id.desc()).limit(limit).all()
    return [movement_to_read(movement, name) for movement, name in rows]


@router.post("/inventory/{product_id}/movements", response_model=MovementRead, status_code=201)
def record_movement(product_id: int, payload: MovementCreate, db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found.")
    if not product.track_stock:
        raise HTTPException(status_code=422, detail="Stock is not tracked for this product.")

    received, sold = stock_figures(db, product_id)
    on_hand = received - sold
    if payload.quantity < 0 and on_hand + payload.quantity < 0:
        raise HTTPException(
            status_code=422,
            detail=f"This would make stock negative (currently {on_hand} on hand).",
        )

    movement = StockMovement(
        product_id=product_id, quantity=payload.quantity,
        reason=payload.reason, note=payload.note,
    )
    db.add(movement)
    db.commit()
    db.refresh(movement)
    return movement_to_read(movement, product.name)