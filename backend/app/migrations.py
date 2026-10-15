"""Tiny schema upgrade helper.

`Base.metadata.create_all` creates missing tables but never adds columns to
tables that already exist. This adds the inventory columns to an existing
`products` table so older databases keep working. Replace it with Alembic
migrations once the schema changes more often.
"""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def ensure_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    if "products" not in inspector.get_table_names():
        return

    existing = {column["name"] for column in inspector.get_columns("products")}
    statements = []
    if "reorder_level" not in existing:
        statements.append("ALTER TABLE products ADD COLUMN reorder_level INTEGER NOT NULL DEFAULT 0")
    if "track_stock" not in existing:
        statements.append("ALTER TABLE products ADD COLUMN track_stock BOOLEAN NOT NULL DEFAULT TRUE")

    if statements:
        with engine.begin() as connection:
            for statement in statements:
                connection.execute(text(statement))
