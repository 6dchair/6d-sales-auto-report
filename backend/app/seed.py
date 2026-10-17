"""Fill the database with synthetic sales and stock for any business profile.

Run from the backend folder (the one that contains the `app` package):

    python -m app.seed --profile farm                  # 90 days of data ending today
    python -m app.seed --profile farm --days 180       # a longer history
    python -m app.seed --profile farm --reset          # wipe products, sales and stock first

Profiles are JSON files in app/seed_profiles/ (or give a path to your own).

The random seed is fixed, so every run produces the same data.
Opening stock is sized so that after all the seeded sales, each product ends up
with the "remaining" quantity below (some low, one out of stock).
"""
import argparse
import json
import random
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path

from sqlalchemy.orm import Session

from . import models
from .database import Base, engine
from .migrations import ensure_columns
from .routers.categories import ensure_category

PROFILE_DIR = Path(__file__).parent / "seed_profiles"


def load_profile(name_or_path: str):
    """Read a business profile (JSON) and return what the seeder needs."""
    path = Path(name_or_path)
    if not path.is_file():
        path = PROFILE_DIR / f"{name_or_path}.json"
    if not path.is_file():
        available = sorted(p.stem for p in PROFILE_DIR.glob("*.json"))
        raise SystemExit(f"Profile '{name_or_path}' not found. Available: {available}")

    data = json.loads(path.read_text(encoding="utf-8"))
    # (name, category, price, cost, max qty per line, reorder level, remaining stock)
    # remaining=None means stock is not tracked (services).
    catalog = [
        (p["name"], p["category"], str(p["price"]), str(p.get("cost", p["price"])),
         int(p.get("max_qty", 1)), int(p.get("reorder_level", 0)), p.get("remaining"))
        for p in data["products"]
    ]
    categories = list(dict.fromkeys(row[1] for row in catalog))
    weights = data.get("category_weights", {})
    category_weights = {c: weights.get(c, 1) for c in categories}  # default weight 1
    return catalog, category_weights, data.get("write_offs", {}), data.get("prefix", "TX")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the database with sample sales and stock.")
    parser.add_argument("--profile", required=True, help="profile name in seed_profiles/ or a path to a .json file")
    parser.add_argument("--days", type=int, default=90, help="days of history ending today")
    parser.add_argument("--reset", action="store_true", help="delete existing sales, stock and products first")
    args = parser.parse_args()
    CATALOG, CATEGORY_WEIGHTS, WRITE_OFFS, prefix = load_profile(args.profile)

    Base.metadata.create_all(bind=engine)
    ensure_columns(engine)
    rng = random.Random(2026)

    with Session(bind=engine) as db:
        if args.reset:
            db.query(models.StockMovement).delete()
            db.query(models.SaleItem).delete()
            db.query(models.Sale).delete()
            db.query(models.Product).delete()
            db.query(models.Category).delete()
            db.commit()
        elif db.query(models.Sale).first():
            print("Sales already exist. Use --reset to replace them.")
            return

        products = {}
        for name, category, price, cost, max_qty, reorder, remaining in CATALOG:
            product = db.query(models.Product).filter(models.Product.name == name).first()
            if not product:
                product = models.Product(name=name, category=category)
                db.add(product)
            product.default_unit_price = Decimal(price)
            product.unit_cost = Decimal(cost)
            product.reorder_level = reorder
            product.track_stock = remaining is not None
            products[name] = (product, max_qty)
        db.flush()
        for _name, category, *_rest in CATALOG:
            ensure_category(db, category)

        by_category: dict[str, list[str]] = {}
        for name, category, *_ in CATALOG:
            by_category.setdefault(category, []).append(name)
        categories = list(CATEGORY_WEIGHTS)
        weights = [CATEGORY_WEIGHTS[c] for c in categories]

        today = date.today()
        first_day = today - timedelta(days=args.days - 1)
        sold_units = {name: 0 for name in products}
        sale_count = 0

        for offset in range(args.days - 1, -1, -1):
            day = today - timedelta(days=offset)
            # Busier on weekends (Saturday=5, Sunday=6), with some random variation.
            sales_today = rng.randint(5, 9) if day.weekday() >= 5 else rng.randint(2, 6)

            for number in range(1, sales_today + 1):
                sale = models.Sale(
                    reference_number=f"{prefix}-{day:%Y%m%d}-{number:03d}",
                    sale_date=day,
                    status="completed",
                )
                chosen = set()
                for _ in range(rng.choices([1, 2, 3], weights=[6, 3, 1])[0]):
                    category = rng.choices(categories, weights=weights)[0]
                    chosen.add(rng.choice(by_category[category]))

                for name in sorted(chosen):
                    product, max_qty = products[name]
                    quantity = rng.randint(1, max_qty)
                    line_total = product.default_unit_price * quantity
                    discount = Decimal("0.00")
                    if rng.random() < 0.15:
                        discount = (line_total * Decimal(rng.randint(2, 8)) / 100).quantize(Decimal("0.01"))
                    sale.items.append(models.SaleItem(
                        product_id=product.id, quantity=quantity,
                        unit_price=product.default_unit_price, discount=discount,
                    ))
                    sold_units[name] += quantity
                db.add(sale)
                sale_count += 1

        # Opening stock = everything sold + what should remain (+ write-offs).
        opening_time = datetime.combine(first_day, time(8, 0))
        middle_time = datetime.combine(first_day + timedelta(days=args.days // 2), time(16, 30))
        movement_count = 0
        for name, _category, _price, _cost, _max, _reorder, remaining in CATALOG:
            if remaining is None:
                continue
            product, _ = products[name]
            written_off = WRITE_OFFS.get(name, 0)
            db.add(models.StockMovement(
                product_id=product.id, reason="stock_in", note="Opening stock",
                quantity=sold_units[name] + remaining + written_off,
                created_at=opening_time,
            ))
            movement_count += 1
            if written_off:
                db.add(models.StockMovement(
                    product_id=product.id, reason="adjustment", note="Damaged in storage",
                    quantity=-written_off, created_at=middle_time,
                ))
                movement_count += 1

        db.commit()
        print(
            f"Seeded {len(CATALOG)} products, {sale_count} sales over {args.days} days, "
            f"and {movement_count} stock movements."
        )


if __name__ == "__main__":
    main()