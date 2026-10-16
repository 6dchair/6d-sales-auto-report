import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { Icon } from "./Icon";
import { api } from "../services/api";
import { currency } from "../utils/format";
import type { ImportPreview, Transaction } from "../types";
import "./SalesPage.css";

interface SalesPageProps {
  transactions: Transaction[];
  totalCount: number;
  loading: boolean;
  error: string;
  searching: boolean;
  onImported: () => void;
}

const PAGE_SIZE = 25;
const MAX_ERRORS_SHOWN = 50;

const REQUIRED_COLUMNS = [
  "reference_number",
  "sale_date",
  "product_name",
  "category",
  "quantity",
  "unit_price",
  "discount",
];

// Two rows share a reference number to show that one sale can have many items.
const TEMPLATE_CSV = [
  REQUIRED_COLUMNS.join(","),
  "SALE-0001,2026-10-01,Full-face helmet,Accessories,1,3500,0",
  "SALE-0001,2026-10-01,Riding gloves,Accessories,1,1200,100",
  "SALE-0002,2026-10-02,Engine oil 1L,Parts,2,450,0",
].join("\n");

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export default function SalesPage({
  transactions,
  totalCount,
  loading,
  error,
  searching,
  onImported,
}: SalesPageProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState<"" | "previewing" | "importing">("");
  const [importError, setImportError] = useState("");
  const [success, setSuccess] = useState("");
  const [dragging, setDragging] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const resetImport = () => {
    setFile(null);
    setPreview(null);
    setImportError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = async (selected: File | undefined) => {
    if (!selected) return;

    setSuccess("");
    setImportError("");
    setPreview(null);
    setFile(selected);
    setBusy("previewing");

    try {
      setPreview(await api.previewSalesCsv(selected));
    } catch (err) {
      setImportError(messageOf(err, "Could not read that file."));
      setFile(null);
    } finally {
      setBusy("");
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleConfirm = async () => {
    if (!file) return;

    setBusy("importing");
    setImportError("");

    try {
      const result = await api.confirmSalesCsv(file);
      resetImport();
      setSuccess(
        `Imported ${result.transactions_imported} transactions (${result.rows_imported} rows).`
      );
      onImported();
    } catch (err) {
      setImportError(messageOf(err, "Import failed."));
    } finally {
      setBusy("");
    }
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    void handleFile(event.dataTransfer.files[0]);
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(
      new Blob([TEMPLATE_CSV], { type: "text/csv;charset=utf-8;" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "sales-import-template.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const visible = transactions.slice(0, visibleCount);

  return (
    <div className="dashboard-page sales-page">
      <section className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            SALES RECORDS
          </div>
          <h1>Sales</h1>
          <p className="page-subtitle">
            Browse recorded sales and import new ones from a CSV file.
          </p>
        </div>

        <div className="heading-actions">
          <button className="button-secondary" onClick={downloadTemplate}>
            Download template
          </button>
        </div>
      </section>

      <section className="panel import-panel">
        <div className="panel-heading">
          <div>
            <h2>Import sales from CSV</h2>
            <p>
              Required columns: {REQUIRED_COLUMNS.join(", ")}. Rows with the
              same reference_number become one sale with several items.
            </p>
          </div>
        </div>

        {success && (
          <div className="import-success">
            <span>{success}</span>
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => setSuccess("")}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        )}

        {importError && (
          <div className="api-error import-error-banner">{importError}</div>
        )}

        {!file && (
          <label
            className={`import-dropzone ${dragging ? "dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <strong>Choose a CSV file or drop it here</strong>
            <span>UTF-8 encoded, up to 5 MB. You can review it before importing.</span>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                void handleFile(event.target.files?.[0])
              }
            />
          </label>
        )}

        {file && (
          <div className="import-review">
            <div className="import-file-row">
              <strong>{file.name}</strong>
              <span>{(file.size / 1024).toFixed(1)} KB</span>
              <button
                className="icon-button"
                aria-label="Remove file"
                onClick={resetImport}
                disabled={busy === "importing"}
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            {busy === "previewing" && (
              <div className="import-status">
                Checking file...
              </div>
            )}

            {preview && (
              <>
                <div className="import-stats">
                  <span className="import-chip ok">
                    {preview.valid_rows} valid rows
                  </span>
                  <span
                    className={`import-chip ${
                      preview.errors.length > 0 ? "bad" : "ok"
                    }`}
                  >
                    {preview.errors.length} errors
                  </span>
                  {preview.duplicate_references.length > 0 && (
                    <span className="import-chip warn">
                      {preview.duplicate_references.length} references already
                      exist
                    </span>
                  )}
                </div>

                {preview.errors.length > 0 && (
                  <div className="import-errors table-scroll">
                    <table className="transactions-table">
                      <thead>
                        <tr>
                          <th>ROW</th>
                          <th>PROBLEM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.errors
                          .slice(0, MAX_ERRORS_SHOWN)
                          .map((item, index) => (
                            <tr key={`${item.row}-${index}`}>
                              <td>{item.row > 0 ? item.row : "File"}</td>
                              <td className="import-error-text">
                                {item.message}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {preview.errors.length > MAX_ERRORS_SHOWN && (
                      <div className="import-more">
                        Showing the first {MAX_ERRORS_SHOWN} of{" "}
                        {preview.errors.length} errors.
                      </div>
                    )}
                  </div>
                )}

                <div className="import-actions">
                  <button
                    className="button-secondary"
                    onClick={resetImport}
                    disabled={busy === "importing"}
                  >
                    Cancel
                  </button>
                  <button
                    className="button-primary"
                    onClick={handleConfirm}
                    disabled={!preview.can_import || busy === "importing"}
                  >
                    {busy === "importing"
                      ? "Importing..."
                      : `Import ${preview.valid_rows} rows`}
                  </button>
                </div>

                {!preview.can_import && (
                  <p className="import-hint">
                    Fix the errors in your file and choose it again. Nothing is
                    imported unless every row is valid.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <section className="panel transactions-panel" id="transactions-results">
        <div className="panel-heading transaction-heading">
          <div>
            <h2>All sales</h2>
            <p>Use the search bar above to filter by reference, product, category, date, status or amount</p>
          </div>
        </div>

        <div className="table-scroll">
          <table className="transactions-table">
            <thead>
              <tr>
                <th>TRANSACTION</th>
                <th>PRODUCT</th>
                <th>DATE</th>
                <th>QTY</th>
                <th>NET SALES</th>
                <th>STATUS</th>
              </tr>
            </thead>

            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="empty-state">
                    Loading transactions...
                  </td>
                </tr>
              )}

              {!loading && error && (
                <tr>
                  <td colSpan={6} className="empty-state">
                    Unable to load transactions: {error}
                  </td>
                </tr>
              )}

              {!loading &&
                !error &&
                visible.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>
                      <span className="transaction-id">
                        {transaction.referenceNumber}
                      </span>
                    </td>
                    <td>
                      <div className="product-cell">
                        <div>
                          <strong>{transaction.product}</strong>
                          <span>{transaction.category}</span>
                        </div>
                      </div>
                    </td>
                    <td className="date-cell">{transaction.date}</td>
                    <td className="quantity-cell">{transaction.quantity}</td>
                    <td className="amount-cell">
                      {currency(transaction.amount)}
                    </td>
                    <td>
                      <span className="status-pill">
                        <span />
                        {transaction.status}
                      </span>
                    </td>
                  </tr>
                ))}

              {!loading && !error && transactions.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-state">
                    {searching
                      ? "No matching transactions found."
                      : "No transactions recorded yet. Import a CSV to get started."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="table-footer">
          <span>
            Showing {Math.min(visibleCount, transactions.length)} of{" "}
            {transactions.length}
            {searching ? ` matching (${totalCount} total)` : ""} transactions
          </span>

          {visibleCount < transactions.length && (
            <button
              className="text-link"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            >
              Show more
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
