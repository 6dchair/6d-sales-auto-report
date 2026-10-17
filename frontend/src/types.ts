export interface Product {
  id: number;
  name: string;
  category: string;
  default_unit_price: string;
  unit_cost: string | null;
  reorder_level: number;
  track_stock: boolean;
  created_at: string;
}


export interface SaleItem {
  id: number;
  product_id: number;
  quantity: number;
  unit_price: string | number;
  discount: string | number;
}

export interface Sale {
  id: number;
  reference_number: string;
  sale_date: string;
  status: string;
  items: SaleItem[];
  total: string | number;
}

export interface SaleCreate {
  reference_number: string;
  sale_date: string;
  items: {
    product_id: number;
    quantity: number;
    unit_price: number;
    discount: number;
  }[];
}

export interface DashboardSummary {
  start_date: string | null;
  end_date: string | null;
  transaction_count: number;
  items_sold: number;
  gross_sales: string;
  discounts: string;
  net_sales: string;
}

export interface ApiError {
  detail: string;
}

export interface DailySale {
  date: string;
  sales: string;
}

export interface ProductCreate {
  name: string;
  category: string;
  default_unit_price: number;
  unit_cost?: number | null;
  reorder_level?: number;
  track_stock?: boolean;
}

export interface ImportErrorRow {
  row: number;
  message: string;
}

export interface ImportPreview {
  valid_rows: number;
  duplicate_references: string[];
  errors: ImportErrorRow[];
  can_import: boolean;
}

export interface ImportResult {
  message: string;
  transactions_imported: number;
  rows_imported: number;
}

// A sale joined with its product names/categories for display in tables.
export interface Transaction {
  id: number;
  referenceNumber: string;
  product: string;
  category: string;
  date: string;
  quantity: number;
  amount: number;
  status: string;
}


export type ReportDataset = "transactions" | "daily" | "products" | "categories";

export interface ReportData {
  start_date: string;
  end_date: string;
  summary: {
    transaction_count: number;
    items_sold: number;
    gross_sales: string;
    discounts: string;
    net_sales: string;
    average_transaction: string;
  };
  daily: { date: string; sales: string }[];
  top_products: {
    product: string;
    category: string;
    quantity: number;
    net_sales: string;
  }[];
  categories: {
    category: string;
    quantity: number;
    net_sales: string;
    share_percent: string;
  }[];
}


export type StockStatus = "ok" | "low" | "out" | "oversold" | "untracked";

export interface InventoryItem {
  id: number;
  name: string;
  category: string;
  default_unit_price: string;
  unit_cost: string | null;
  reorder_level: number;
  track_stock: boolean;
  received: number;
  sold: number;
  on_hand: number | null;
  status: StockStatus;
}

export interface InventorySummary {
  total_products: number;
  tracked_products: number;
  low_count: number;
  out_count: number;
  stock_value: string;
}

export interface InventoryResponse {
  summary: InventorySummary;
  items: InventoryItem[];
}

export type StockReason = "stock_in" | "adjustment";

export interface StockMovement {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  reason: StockReason;
  note: string | null;
  created_at: string;
}

export interface StockMovementCreate {
  quantity: number;
  reason: StockReason;
  note?: string | null;
}

export interface Category {
  id: number;
  name: string;
  product_count: number;
}