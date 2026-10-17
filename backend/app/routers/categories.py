from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Category, Product

router = APIRouter()


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Category name cannot be blank.")
        return value


class CategoryRead(BaseModel):
    id: int
    name: str
    product_count: int


def ensure_category(db: Session, name: str) -> str:
    """Return the stored spelling of a category, creating it if it is new."""
    name = name.strip()
    existing = db.query(Category).filter(func.lower(Category.name) == name.lower()).first()
    if existing:
        return existing.name
    db.add(Category(name=name))
    db.flush()
    return name


def sync_categories(db: Session) -> None:
    """Make sure every category already used by a product is in the list."""
    for (name,) in db.query(Product.category).distinct().all():
        ensure_category(db, name)
    db.commit()


def _read(db: Session, category: Category) -> CategoryRead:
    count = (
        db.query(func.count(Product.id))
        .filter(func.lower(Product.category) == category.name.lower())
        .scalar()
    )
    return CategoryRead(id=category.id, name=category.name, product_count=int(count or 0))


@router.get("/categories", response_model=list[CategoryRead])
def list_categories(db: Session = Depends(get_db)):
    return [_read(db, c) for c in db.query(Category).order_by(func.lower(Category.name)).all()]


@router.post("/categories", response_model=CategoryRead, status_code=201)
def create_category(payload: CategoryIn, db: Session = Depends(get_db)):
    if db.query(Category).filter(func.lower(Category.name) == payload.name.lower()).first():
        raise HTTPException(status_code=409, detail="This category already exists.")
    category = Category(name=payload.name)
    db.add(category)
    db.commit()
    db.refresh(category)
    return _read(db, category)


@router.put("/categories/{category_id}", response_model=CategoryRead)
def rename_category(category_id: int, payload: CategoryIn, db: Session = Depends(get_db)):
    category = db.get(Category, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found.")

    clash = (
        db.query(Category)
        .filter(func.lower(Category.name) == payload.name.lower(), Category.id != category_id)
        .first()
    )
    if clash:
        raise HTTPException(status_code=409, detail="Another category already uses this name.")

    old_name = category.name
    db.query(Product).filter(func.lower(Product.category) == old_name.lower()).update(
        {Product.category: payload.name}, synchronize_session=False
    )
    category.name = payload.name
    db.commit()
    db.refresh(category)
    return _read(db, category)


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(category_id: int, db: Session = Depends(get_db)):
    category = db.get(Category, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found.")
    if _read(db, category).product_count > 0:
        raise HTTPException(
            status_code=409,
            detail="Products still use this category. Move or edit them first.",
        )
    db.delete(category)
    db.commit()