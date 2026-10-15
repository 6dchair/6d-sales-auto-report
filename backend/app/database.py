import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import NullPool

# Where the data lives.
#  - Local development: a SQLite file (the default below).
#  - Online (Vercel): set DATABASE_URL to a hosted Postgres database, e.g. from
#    Neon or Supabase. Vercel functions cannot keep a SQLite file.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./sales.db")

# Hosts often give "postgres://..." or "postgresql://..."; SQLAlchemy needs the driver name.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)

is_sqlite = DATABASE_URL.startswith("sqlite")

engine_options = {"pool_pre_ping": True}
if is_sqlite:
    engine_options = {"connect_args": {"check_same_thread": False}}
elif os.getenv("VERCEL"):
    # Serverless functions start and stop all the time, so do not keep idle
    # connections open between requests.
    engine_options = {"poolclass": NullPool}

engine = create_engine(DATABASE_URL, **engine_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
