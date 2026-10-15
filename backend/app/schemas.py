from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field, field_validator


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    category: str = Field(min_length=1, max_length=80)
    default_unit_price: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    unit_cost: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    reorder_level: int = Field(default=0, ge=0, le=1_000_000)
    track_stock: bool = True

    @field_validator("name", "category")
    @classmethod
    def strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field cannot be blank.")
        return value


class ProductRead(ProductCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime


class SaleItemCreate(BaseModel):
    product_id: int
    quantity: int = Field(gt=0, le=1_000_000)
    unit_price: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    discount: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)


class SaleCreate(BaseModel):
    reference_number: str = Field(min_length=1, max_length=80)
    sale_date: date
    items: list[SaleItemCreate] = Field(min_length=1)

    @field_validator("reference_number")
    @classmethod
    def strip_reference(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Reference number cannot be blank.")
        return value


class SaleItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: int
    quantity: int
    unit_price: Decimal
    discount: Decimal


class SaleRead(BaseModel):
    id: int
    reference_number: str
    sale_date: date
    status: str
    items: list[SaleItemRead]
    total: Decimal


class ImportErrorRow(BaseModel):
    row: int
    message: str


class ImportPreview(BaseModel):
    valid_rows: int
    duplicate_references: list[str]
    errors: list[ImportErrorRow]
    can_import: bool
