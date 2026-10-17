import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .database import Base, SessionLocal, engine
from . import models
from .migrations import ensure_columns
from .routers import categories, inventory, reports, sales

Base.metadata.create_all(bind=engine)
ensure_columns(engine)

# Make sure every category already used by a product is in the categories list.
with SessionLocal() as _db:
    categories.sync_categories(_db)

app = FastAPI(
    title="Automated Sales Reporting API",
    description="Sales data API for any business.",
    version="0.1.0",
)

# Web addresses allowed to call the API from a browser:
#  - the local Vite dev server
#  - anything listed in the CORS_ORIGINS environment variable (comma separated),
#    e.g. CORS_ORIGINS=https://my-sales-web.vercel.app
#  - optionally, any address matching CORS_ORIGIN_REGEX, which is handy for
#    Vercel preview deployments, e.g. CORS_ORIGIN_REGEX=https://.*\.vercel\.app
DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
EXTRA_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
ORIGIN_REGEX = os.getenv("CORS_ORIGIN_REGEX") or None

app.add_middleware(
    CORSMiddleware,
    allow_origins=DEFAULT_ORIGINS + EXTRA_ORIGINS,
    allow_origin_regex=ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sales.router, prefix="/api", tags=["Sales"])
app.include_router(reports.router, prefix="/api", tags=["Reports"])
app.include_router(inventory.router, prefix="/api", tags=["Inventory"])
app.include_router(categories.router, prefix="/api", tags=["Categories"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "sales-reporting-api"}


# Optional: if FRONTEND_DIST points at the built web app (the frontend's `dist`
# folder), this service serves it at "/". Not needed on Vercel, where the web
# app is its own project. Without it, "/" just describes the API.
FRONTEND_DIST = os.getenv("FRONTEND_DIST", "")

if FRONTEND_DIST and (Path(FRONTEND_DIST) / "index.html").is_file():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
else:

    @app.get("/")
    def root():
        return {"message": "Automated Sales Reporting API", "docs": "/docs", "health": "/health"}