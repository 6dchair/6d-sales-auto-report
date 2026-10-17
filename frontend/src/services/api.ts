import type {
  Product,
  ProductCreate,
  Sale,
  SaleCreate,
  DashboardSummary,
  DailySale,
  ImportPreview,
  ImportResult,
  ReportData,
  ReportDataset,
  InventoryResponse,
  StockMovement,
  StockMovementCreate,
  Category,
} from "../types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

// Turns FastAPI's different error shapes into one readable message.
async function errorMessage(response: Response): Promise<string> {
  let message = `Request failed (${response.status})`;

  try {
    const error = await response.json();
    const detail = error.detail;

    if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail)) {
      message = detail
        .map((item) => item?.msg ?? JSON.stringify(item))
        .join("; ");
    } else if (detail && typeof detail === "object" && detail.message) {
      message = String(detail.message);
    }
  } catch {
    // Keep the default error message.
  }

  return message;
}

async function request<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, options);

  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }

  return response.json() as Promise<T>;
}

async function download(endpoint: string): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`);

  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }

  return response.blob();
}

function dateQuery(startDate?: string, endDate?: string, extra?: Record<string, string>) {
  const params = new URLSearchParams(extra);

  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);

  const query = params.toString();
  return query ? `?${query}` : "";
}

export const api = {
  getProducts: () => request<Product[]>("/api/products"),

  getCategories: () => request<Category[]>("/api/categories"),

  createCategory: (name: string) =>
    request<Category>("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),

  renameCategory: (id: number, name: string) =>
    request<Category>(`/api/categories/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),

  deleteCategory: async (id: number): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/api/categories/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error(await errorMessage(response));
  },

  getSales: () => request<Sale[]>("/api/sales"),

  createProduct: (product: ProductCreate) =>
    request<Product>("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(product),
    }),

  createSale: (sale: SaleCreate) =>
    request<Sale>("/api/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sale),
    }),

  previewSalesCsv: (file: File) => {
    const form = new FormData();
    form.append("file", file);

    return request<ImportPreview>("/api/sales/import/preview", {
      method: "POST",
      body: form,
    });
  },

  confirmSalesCsv: (file: File) => {
    const form = new FormData();
    form.append("file", file);

    return request<ImportResult>("/api/sales/import/confirm", {
      method: "POST",
      body: form,
    });
  },

  getDashboardSummary: (startDate?: string, endDate?: string) =>
    request<DashboardSummary>(
      `/api/dashboard/summary${dateQuery(startDate, endDate)}`
    ),

  getDailySales: (startDate?: string, endDate?: string) =>
    request<DailySale[]>(
      `/api/dashboard/daily-sales${dateQuery(startDate, endDate)}`
    ),

  updateProduct: (id: number, product: ProductCreate) =>
    request<Product>(`/api/products/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(product),
    }),

  getInventory: () => request<InventoryResponse>("/api/inventory"),

  getStockMovements: (productId?: number, limit = 30) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (productId !== undefined) params.set("product_id", String(productId));

    return request<StockMovement[]>(`/api/inventory/movements?${params}`);
  },

  createStockMovement: (productId: number, movement: StockMovementCreate) =>
    request<StockMovement>(`/api/inventory/${productId}/movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(movement),
    }),

  getReport: (startDate: string, endDate: string) =>
    request<ReportData>(`/api/reports/summary${dateQuery(startDate, endDate)}`),

  downloadReportCsv: (dataset: ReportDataset, startDate: string, endDate: string) =>
    download(`/api/reports/csv${dateQuery(startDate, endDate, { dataset })}`),

  downloadReportPdf: (startDate: string, endDate: string, systemName?: string) =>
    download(
      `/api/reports/pdf${dateQuery(
        startDate,
        endDate,
        systemName ? { system_name: systemName } : undefined
      )}`
    ),
};