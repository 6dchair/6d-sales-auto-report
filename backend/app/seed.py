"""Fill the database with synthetic motorcycle-dealership sales and stock.

Run from the backend folder (the one that contains the `app` package):

    python -m app.seed                 # 90 days of data ending today
    python -m app.seed --days 180      # a longer history
    python -m app.seed --reset         # wipe products, sales and stock first

The random seed is fixed, so every run produces the same data.
Opening stock is sized so that after all the seeded sales, each product ends up
with the "remaining" quantity below (some low, one out of stock).
"""
import argparse
import random
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from . import models
from .database import Base, engine
from .migrations import ensure_columns

# (name, category, price, cost, max qty per line, reorder level, remaining stock)
# remaining=None means stock is not tracked (services).
CATALOG = [
    ("Honda Click 160", "Motorcycles", "112900", "96000", 1, 2, 4),
    ("Yamaha Mio Gear 125", "Motorcycles", "78900", "66500", 1, 2, 1),
    ("Suzuki Raider R150", "Motorcycles", "104900", "89000", 1, 2, 3),
    ("Kawasaki Rouser NS200", "Motorcycles", "149900", "127000", 1, 1, 0),
    ("Honda ADV 160", "Motorcycles", "166900", "141000", 1, 1, 2),
    ("Full-face helmet", "Accessories", "3500", "2100", 2, 10, 28),
    ("Half-face helmet", "Accessories", "1800", "1000", 2, 10, 6),
    ("Riding gloves", "Accessories", "1200", "650", 2, 10, 22),
    ("Phone holder mount", "Accessories", "650", "300", 3, 8, 40),
    ("Rain jacket set", "Accessories", "950", "520", 2, 8, 5),
    ("Engine oil 1L", "Parts", "450", "290", 4, 20, 45),
    ("Brake pads (set)", "Parts", "850", "480", 3, 10, 12),
    ("Drive belt", "Parts", "1750", "1100", 2, 8, 4),
    ("Spark plug", "Parts", "280", "140", 4, 20, 60),
    ("Tire 80/90-14", "Parts", "1650", "1050", 2, 8, 15),
    ("Oil change service", "Services", "350", "120", 1, 0, None),
    ("Tune-up service", "Services", "950", "380", 1, 0, None),
    ("Brake service", "Services", "700", "260", 1, 0, None),
]

# Products that also get a "damaged" write-off, to make the history realistic.
WRITE_OFFS = {"Full-face helmet": 1, "Riding gloves": 2}

# Relative chance that a sale line is for each category.
CATEGORY_WEIGHTS = {"Motorcycles": 1, "Accessories": 5, "Parts": 6, "Services": 4}


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the database with sample sales and stock.")
    parser.add_argument("--days", type=int, default=90, help="days of history ending today")
    parser.add_argument("--reset", action="store_true", help="delete existing sales, stock and products first")
    args = parser.parse_args()

    Base.metadata.create_all(bind=engine)
    ensure_columns(engine)
    rng = random.Random(2026)

    with Session(bind=engine) as db:
        if args.reset:
            db.query(models.StockMovement).delete()
            db.query(models.SaleItem).delete()
            db.query(models.Sale).delete()
            db.query(models.Product).delete()
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
                    reference_number=f"MM-{day:%Y%m%d}-{number:03d}",
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
