import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../services/api";
import type {
  InventoryItem,
  InventoryResponse,
  ProductCreate,
  StockMovement,
  StockStatus,
} from "../types";
import { currency } from "../utils/format";
import Modal from "./Modal";
import "./InventoryPage.css";

interface InventoryPageProps {
  // Called after any change so the sidebar badge and alerts refresh.
  onChanged: () => void;
}

type StatusFilter = "all" | "attention" | "ok" | "low" | "out" | "untracked";

type ModalState =
  | { kind: "product"; item: InventoryItem | null }
  | { kind: "stock"; item: InventoryItem; mode: "stock_in" | "adjustment" }
  | null;

const STATUS_LABEL: Record<StockStatus, string> = {
  ok: "In stock",
  low: "Low stock",
  out: "Out of stock",
  oversold: "Oversold",
  untracked: "Not tracked",
};

const MAX_QTY = 1_000_000;

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const formatWhen = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
};

// ---------------------------------------------------------------- stock form

interface StockFormProps {
  item: InventoryItem;
  mode: "stock_in" | "adjustment";
  onClose: () => void;
  onSaved: (message: string) => void;
}

function StockForm({ item, mode, onClose, onSaved }: StockFormProps) {
  const onHand = item.on_hand ?? 0;

  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const amount = Number(quantity);
  const validAmount =
    quantity.trim() !== "" &&
    Number.isInteger(amount) &&
    amount > 0 &&
    amount <= MAX_QTY;
  const removing = mode === "adjustment" && direction === "remove";
  const signed = removing ? -amount : amount;
  const result = validAmount ? onHand + signed : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (!validAmount) {
      setError("Enter a whole number greater than zero.");
      return;
    }
    if (mode === "adjustment" && !note.trim()) {
      setError("Enter a reason for the adjustment.");
      return;
    }
    if (result !== null && result < 0) {
      setError(`This would make stock negative (currently ${onHand} on hand).`);
      return;
    }

    setSaving(true);
    setError("");

    try {
      await api.createStockMovement(item.id, {
        quantity: signed,
        reason: mode,
        note: note.trim() || null,
      });
      onSaved(
        mode === "stock_in"
          ? `Received ${amount} × ${item.name}.`
          : `Adjusted ${item.name} by ${signed > 0 ? "+" : ""}${signed}.`
      );
    } catch (err) {
      setError(messageOf(err, "Could not save the stock change."));
      setSaving(false);
    }
  };

  return (
    <form className="modal-form" onSubmit={submit}>
      <p className="modal-product">
        <strong>{item.name}</strong>
        <span>Currently {onHand} on hand</span>
      </p>

      {mode === "adjustment" && (
        <label className="field">
          <span>Change</span>
          <select
            className="text-input"
            value={direction}
            onChange={(event) => setDirection(event.target.value as "add" | "remove")}
          >
            <option value="add">Add to stock (e.g. found items)</option>
            <option value="remove">Remove from stock (e.g. damaged, lost)</option>
          </select>
        </label>
      )}

      <label className="field">
        <span>{mode === "stock_in" ? "Quantity received" : "Quantity"}</span>
        <input
          className="text-input"
          type="number"
          min={1}
          max={MAX_QTY}
          step={1}
          inputMode="numeric"
          value={quantity}
          autoFocus
          onChange={(event) => setQuantity(event.target.value)}
        />
      </label>

      <label className="field">
        <span>
          {mode === "stock_in" ? "Note (optional)" : "Reason (required)"}
        </span>
        <input
          className="text-input"
          value={note}
          maxLength={200}
          placeholder={
            mode === "stock_in" ? "e.g. Supplier delivery" : "e.g. Damaged in storage"
          }
          onChange={(event) => setNote(event.target.value)}
        />
      </label>

      {result !== null && (
        <div className={`stock-preview ${result < 0 ? "bad" : ""}`}>
          New stock on hand: <strong>{result}</strong>
        </div>
      )}

      {error && <div className="api-error modal-error">{error}</div>}

      <div className="form-actions modal-actions">
        <button type="submit" className="button-primary" disabled={saving}>
          {saving ? "Saving..." : mode === "stock_in" ? "Receive stock" : "Save adjustment"}
        </button>
        <button type="button" className="button-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// -------------------------------------------------------------- product form

interface ProductFormProps {
  item: InventoryItem | null;
  categories: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

function ProductForm({ item, categories, onClose, onSaved }: ProductFormProps) {
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [price, setPrice] = useState(item ? String(Number(item.default_unit_price)) : "");
  const [cost, setCost] = useState(
    item?.unit_cost != null ? String(Number(item.unit_cost)) : ""
  );
  const [track, setTrack] = useState(item?.track_stock ?? true);
  const [reorder, setReorder] = useState(String(item?.reorder_level ?? 0));
  const [opening, setOpening] = useState("0");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    const cleanName = name.trim();
    const cleanCategory = category.trim();
    const priceValue = Number(price);
    const costValue = cost.trim() === "" ? null : Number(cost);
    const reorderValue = Number(reorder);
    const openingValue = Number(opening);

    if (!cleanName) return setError("Enter a product name.");
    if (cleanName.length > 150) return setError("Product name must be 150 characters or fewer.");
    if (!cleanCategory) return setError("Enter a category.");
    if (cleanCategory.length > 80) return setError("Category must be 80 characters or fewer.");
    if (price.trim() === "" || !Number.isFinite(priceValue) || priceValue < 0)
      return setError("Enter a selling price of zero or more.");
    if (costValue !== null && (!Number.isFinite(costValue) || costValue < 0))
      return setError("Cost must be zero or more, or left empty.");
    if (!Number.isInteger(reorderValue) || reorderValue < 0 || reorderValue > MAX_QTY)
      return setError("Reorder level must be a whole number, zero or more.");
    if (!item && track && (!Number.isInteger(openingValue) || openingValue < 0 || openingValue > MAX_QTY))
      return setError("Opening stock must be a whole number, zero or more.");

    const payload: ProductCreate = {
      name: cleanName,
      category: cleanCategory,
      default_unit_price: priceValue,
      unit_cost: costValue,
      reorder_level: reorderValue,
      track_stock: track,
    };

    setSaving(true);
    setError("");

    try {
      if (item) {
        await api.updateProduct(item.id, payload);
        onSaved(`Saved changes to ${cleanName}.`);
        return;
      }

      const created = await api.createProduct(payload);

      if (track && openingValue > 0) {
        try {
          await api.createStockMovement(created.id, {
            quantity: openingValue,
            reason: "stock_in",
            note: "Opening stock",
          });
        } catch (err) {
          onSaved(
            `Added ${cleanName}, but its opening stock was not recorded: ${messageOf(err, "unknown error")}`
          );
          return;
        }
      }

      onSaved(`Added ${cleanName}.`);
    } catch (err) {
      setError(messageOf(err, "Could not save the product."));
      setSaving(false);
    }
  };

  return (
    <form className="modal-form" onSubmit={submit}>
      <label className="field">
        <span>Product name</span>
        <input
          className="text-input"
          value={name}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <label className="field">
        <span>Category</span>
        <input
          className="text-input"
          list="inventory-categories"
          value={category}
          placeholder="e.g. Parts"
          onChange={(event) => setCategory(event.target.value)}
        />
        <datalist id="inventory-categories">
          {categories.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      </label>

      <div className="form-grid">
        <label className="field">
          <span>Selling price (₱)</span>
          <input
            className="text-input"
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </label>

        <label className="field">
          <span>Unit cost (₱, optional)</span>
          <input
            className="text-input"
            type="number"
            min={0}
            step="0.01"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
          />
        </label>
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={track}
          onChange={(event) => setTrack(event.target.checked)}
        />
        <span>
          Track stock for this product
          <small>Turn off for services or anything you do not keep in stock.</small>
        </span>
      </label>

      {track && (
        <div className="form-grid">
          <label className="field">
            <span>Reorder level</span>
            <input
              className="text-input"
              type="number"
              min={0}
              step={1}
              value={reorder}
              onChange={(event) => setReorder(event.target.value)}
            />
            <small className="field-hint">Warn when stock falls to this number or below.</small>
          </label>

          {!item && (
            <label className="field">
              <span>Opening stock</span>
              <input
                className="text-input"
                type="number"
                min={0}
                step={1}
                value={opening}
                onChange={(event) => setOpening(event.target.value)}
              />
              <small className="field-hint">Units you have right now.</small>
            </label>
          )}
        </div>
      )}

      {error && <div className="api-error modal-error">{error}</div>}

      <div className="form-actions modal-actions">
        <button type="submit" className="button-primary" disabled={saving}>
          {saving ? "Saving..." : item ? "Save changes" : "Add product"}
        </button>
        <button type="button" className="button-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------- page

export default function InventoryPage({ onChanged }: InventoryPageProps) {
  const [data, setData] = useState<InventoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [historyProduct, setHistoryProduct] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("");

  const [modal, setModal] = useState<ModalState>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;

    api
      .getInventory()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError("");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(messageOf(err, "Could not load inventory."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    let cancelled = false;

    api
      .getStockMovements(historyProduct ? Number(historyProduct) : undefined)
      .then((result) => {
        if (!cancelled) setMovements(result);
      })
      .catch(() => {
        if (!cancelled) setMovements([]);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey, historyProduct]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const summary = data?.summary;

  const categories = useMemo(
    () => [...new Set(items.map((item) => item.category))].sort(),
    [items]
  );

  const visibleItems = items.filter((item) => {
    const text = `${item.name} ${item.category}`.toLowerCase();
    if (search.trim() && !text.includes(search.trim().toLowerCase())) return false;
    if (categoryFilter && item.category !== categoryFilter) return false;

    switch (statusFilter) {
      case "attention":
        return item.status === "low" || item.status === "out" || item.status === "oversold";
      case "out":
        return item.status === "out" || item.status === "oversold";
      case "all":
        return true;
      default:
        return item.status === statusFilter;
    }
  });

  const attentionCount = (summary?.low_count ?? 0) + (summary?.out_count ?? 0);
  const filtersActive = search.trim() !== "" || categoryFilter !== "" || statusFilter !== "all";

  const finish = (message: string) => {
    setModal(null);
    setNotice(message);
    setReloadKey((key) => key + 1);
    onChanged();
  };

  const clearFilters = () => {
    setSearch("");
    setCategoryFilter("");
    setStatusFilter("all");
  };

  return (
    <div className="dashboard-page inventory-page">
      <section className="page-heading">
        <div>
          <div className="eyebrow">STOCK</div>
          <h1>Inventory</h1>
          <p className="page-subtitle">
            Track what is in stock. Sales reduce stock automatically.
          </p>
        </div>

        <div className="heading-actions">
          <button
            className="button-primary"
            onClick={() => setModal({ kind: "product", item: null })}
          >
            Add product
          </button>
        </div>
      </section>

      {error && <div className="api-error">Unable to load inventory: {error}</div>}

      {notice && (
        <div className="inv-notice">
          <span>{notice}</span>
          <button className="text-link" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </div>
      )}

      {attentionCount > 0 && (
        <div className="stock-alert">
          <span>
            <strong>
              {attentionCount} {attentionCount === 1 ? "product needs" : "products need"} restocking
            </strong>{" "}
            · {summary?.low_count ?? 0} low, {summary?.out_count ?? 0} out of stock
          </span>
          <button className="text-link" onClick={() => setStatusFilter("attention")}>
            Show them
          </button>
        </div>
      )}

      <section className="metrics-grid">
        <article className="metric-card">
          <div className="metric-label">Products tracked</div>
          <div className="metric-value">
            {loading ? "Loading..." : summary ? summary.tracked_products : "—"}
          </div>
          <div className="metric-foot">
            {summary ? `of ${summary.total_products} products` : "Stock counted"}
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-label">Low stock</div>
          <div className="metric-value">
            {loading ? "Loading..." : summary ? summary.low_count : "—"}
          </div>
          <div className="metric-foot">At or below reorder level</div>
        </article>

        <article className="metric-card">
          <div className="metric-label">Out of stock</div>
          <div className="metric-value">
            {loading ? "Loading..." : summary ? summary.out_count : "—"}
          </div>
          <div className="metric-foot">Zero or less on hand</div>
        </article>

        <article className="metric-card">
          <div className="metric-label">Stock value</div>
          <div className="metric-value">
            {loading ? "Loading..." : summary ? currency(Number(summary.stock_value)) : "—"}
          </div>
          <div className="metric-foot">On-hand units at cost</div>
        </article>
      </section>

      <section className="panel transactions-panel">
        <div className="panel-heading transaction-heading">
          <div>
            <h2>Products</h2>
            <p>On hand = received − sold</p>
          </div>
        </div>

        <div className="filter-bar">
          <label className="field grow">
            <span>Search</span>
            <input
              className="text-input"
              value={search}
              placeholder="Product or category"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <label className="field">
            <span>Category</span>
            <select
              className="text-input"
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Status</span>
            <select
              className="text-input"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            >
              <option value="all">All</option>
              <option value="attention">Needs restocking</option>
              <option value="ok">In stock</option>
              <option value="low">Low stock</option>
              <option value="out">Out of stock</option>
              <option value="untracked">Not tracked</option>
            </select>
          </label>
        </div>

        <div className="table-scroll">
          <table className="transactions-table">
            <thead>
              <tr>
                <th>PRODUCT</th>
                <th className="num">PRICE</th>
                <th className="num">RECEIVED</th>
                <th className="num">SOLD</th>
                <th className="num">ON HAND</th>
                <th className="num">REORDER AT</th>
                <th>STATUS</th>
                <th className="num">ACTIONS</th>
              </tr>
            </thead>

            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="empty-state">
                    Loading inventory...
                  </td>
                </tr>
              )}

              {!loading &&
                visibleItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="product-cell">
                        <div>
                          <strong>{item.name}</strong>
                          <span>{item.category}</span>
                        </div>
                      </div>
                    </td>
                    <td className="num">{currency(Number(item.default_unit_price))}</td>
                    <td className="num">{item.track_stock ? item.received : "—"}</td>
                    <td className="num">{item.sold}</td>
                    <td className="num on-hand">{item.on_hand ?? "—"}</td>
                    <td className="num">{item.track_stock ? item.reorder_level : "—"}</td>
                    <td>
                      <span className={`stock-pill ${item.status}`}>
                        {STATUS_LABEL[item.status]}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        {item.track_stock && (
                          <>
                            <button
                              className="text-link"
                              onClick={() => setModal({ kind: "stock", item, mode: "stock_in" })}
                            >
                              Stock in
                            </button>
                            <button
                              className="text-link"
                              onClick={() => setModal({ kind: "stock", item, mode: "adjustment" })}
                            >
                              Adjust
                            </button>
                          </>
                        )}
                        <button
                          className="text-link"
                          onClick={() => setModal({ kind: "product", item })}
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

              {!loading && visibleItems.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-state">
                    {filtersActive
                      ? "No products match these filters."
                      : "No products yet. Use “Add product” to start."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="table-footer">
          <span>
            Showing {visibleItems.length} of {items.length} products
          </span>
          {filtersActive && (
            <button className="text-link" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      </section>

      <section className="panel history-panel">
        <div className="panel-heading">
          <div>
            <h2>Stock history</h2>
            <p>Recent stock-in and adjustments (sales are not listed here)</p>
          </div>

          <label className="field history-filter">
            <span>Product</span>
            <select
              className="text-input"
              value={historyProduct}
              onChange={(event) => setHistoryProduct(event.target.value)}
            >
              <option value="">All products</option>
              {items
                .filter((item) => item.track_stock)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <div className="table-scroll history-table">
          <table className="transactions-table">
            <thead>
              <tr>
                <th>DATE</th>
                <th>PRODUCT</th>
                <th>TYPE</th>
                <th className="num">CHANGE</th>
                <th>NOTE</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => (
                <tr key={movement.id}>
                  <td className="date-cell">{formatWhen(movement.created_at)}</td>
                  <td>{movement.product_name}</td>
                  <td>{movement.reason === "stock_in" ? "Stock in" : "Adjustment"}</td>
                  <td className={`num change ${movement.quantity > 0 ? "up" : "down"}`}>
                    {movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}
                  </td>
                  <td className="note-cell">{movement.note ?? "—"}</td>
                </tr>
              ))}

              {movements.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-state">
                    No stock movements recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modal?.kind === "product" && (
        <Modal
          title={modal.item ? `Edit ${modal.item.name}` : "Add product"}
          onClose={() => setModal(null)}
        >
          <ProductForm
            key={modal.item?.id ?? "new"}
            item={modal.item}
            categories={categories}
            onClose={() => setModal(null)}
            onSaved={finish}
          />
        </Modal>
      )}

      {modal?.kind === "stock" && (
        <Modal
          title={modal.mode === "stock_in" ? "Receive stock" : "Adjust stock"}
          onClose={() => setModal(null)}
        >
          <StockForm
            key={`${modal.item.id}-${modal.mode}`}
            item={modal.item}
            mode={modal.mode}
            onClose={() => setModal(null)}
            onSaved={finish}
          />
        </Modal>
      )}
    </div>
  );
}
