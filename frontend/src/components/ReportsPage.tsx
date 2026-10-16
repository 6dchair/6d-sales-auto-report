import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { api } from "../services/api";
import type { ReportData, ReportDataset } from "../types";
import {
  currency,
  formatAxisCurrency,
  formatLocalDate,
  formatShortDate,
  saveBlob,
} from "../utils/format";
import "./ReportsPage.css";

type Preset = "7" | "30" | "90" | "month" | "custom";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "7", label: "Last 7 days" },
  { id: "30", label: "Last 30 days" },
  { id: "90", label: "Last 90 days" },
  { id: "month", label: "This month" },
];

const DATASETS: { id: ReportDataset; label: string }[] = [
  { id: "transactions", label: "Transactions (line items)" },
  { id: "daily", label: "Daily sales" },
  { id: "products", label: "Product ranking" },
  { id: "categories", label: "Sales by category" },
];

function rangeFor(preset: Exclude<Preset, "custom">) {
  const end = new Date();
  const start = new Date(end);

  if (preset === "month") {
    start.setDate(1);
  } else {
    start.setDate(start.getDate() - Number(preset) + 1);
  }

  return { start: formatLocalDate(start), end: formatLocalDate(end) };
}

export default function ReportsPage({ systemName }: { systemName?: string }) {
  const initial = rangeFor("30");

  const [preset, setPreset] = useState<Preset>("30");
  const [startDate, setStartDate] = useState(initial.start);
  const [endDate, setEndDate] = useState(initial.end);

  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [dataset, setDataset] = useState<ReportDataset>("transactions");
  const [downloading, setDownloading] = useState<"" | "pdf" | "csv">("");
  const [downloadError, setDownloadError] = useState("");

  const rangeInvalid = !startDate || !endDate || startDate > endDate;

  useEffect(() => {
    if (rangeInvalid) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    api
      .getReport(startDate, endDate)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setReport(null);
          setError(err instanceof Error ? err.message : "Could not load report.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, rangeInvalid]);

  const choosePreset = (id: Exclude<Preset, "custom">) => {
    const range = rangeFor(id);
    setPreset(id);
    setStartDate(range.start);
    setEndDate(range.end);
  };

  const download = async (kind: "pdf" | "csv") => {
    setDownloading(kind);
    setDownloadError("");

    try {
      if (kind === "pdf") {
        await saveBlob(
          await api.downloadReportPdf(startDate, endDate, systemName),
          `sales-report-${startDate}-to-${endDate}.pdf`
        );
      } else {
        await saveBlob(
          await api.downloadReportCsv(dataset, startDate, endDate),
          `sales-${dataset}-${startDate}-to-${endDate}.csv`
        );
      }
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloading("");
    }
  };

  const summary = report?.summary;
  const hasSales = (summary?.transaction_count ?? 0) > 0;
  const busy = loading || rangeInvalid;
  const chartData =
    report?.daily.map((day) => ({ date: day.date, sales: Number(day.sales) })) ?? [];

  const value = (render: () => string) => {
    if (rangeInvalid) return "—";
    if (loading) return "Loading...";
    return summary ? render() : "—";
  };

  return (
    <div className="dashboard-page reports-page">
      <section className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            REPORTS
          </div>
          <h1>Sales reports</h1>
          <p className="page-subtitle">
            Pick a period, review the numbers, then download a PDF or CSV.
          </p>
        </div>
      </section>

      <section className="panel report-toolbar">
        <div className="range-switcher report-presets">
          {PRESETS.map(({ id, label }) => (
            <button
              key={id}
              className={preset === id ? "selected" : ""}
              onClick={() => choosePreset(id as Exclude<Preset, "custom">)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="report-dates">
          <label>
            <span>From</span>
            <input
              type="date"
              value={startDate}
              max={endDate || undefined}
              onChange={(event) => {
                setPreset("custom");
                setStartDate(event.target.value);
              }}
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(event) => {
                setPreset("custom");
                setEndDate(event.target.value);
              }}
            />
          </label>
        </div>

        <div className="report-downloads">
          <select
            aria-label="CSV contents"
            value={dataset}
            onChange={(event) => setDataset(event.target.value as ReportDataset)}
          >
            {DATASETS.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>

          <button
            className="button-secondary"
            onClick={() => download("csv")}
            disabled={rangeInvalid || downloading !== ""}
          >
            {downloading === "csv" ? "Preparing..." : "Download CSV"}
          </button>

          <button
            className="button-primary"
            onClick={() => download("pdf")}
            disabled={rangeInvalid || downloading !== ""}
          >
            {downloading === "pdf" ? "Preparing..." : "Download PDF"}
          </button>
        </div>
      </section>

      {rangeInvalid && (
        <div className="api-error">
          Choose a start date that is on or before the end date.
        </div>
      )}
      {error && <div className="api-error">Unable to load report: {error}</div>}
      {downloadError && (
        <div className="api-error">Download failed: {downloadError}</div>
      )}

      <section className="metrics-grid">
        <article className="metric-card">
          <div className="metric-label">Net sales</div>
          <div className="metric-value">
            {value(() => currency(Number(summary!.net_sales)))}
          </div>
          <div className="metric-foot">
            {summary && !busy
              ? `Gross ${currency(Number(summary.gross_sales))} · Discounts ${currency(Number(summary.discounts))}`
              : "After discounts"}
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-label">Transactions</div>
          <div className="metric-value">
            {value(() => String(summary!.transaction_count))}
          </div>
          <div className="metric-foot">Completed sales</div>
        </article>

        <article className="metric-card">
          <div className="metric-label">Items sold</div>
          <div className="metric-value">
            {value(() => String(summary!.items_sold))}
          </div>
          <div className="metric-foot">Across all products</div>
        </article>

        <article className="metric-card">
          <div className="metric-label">Average transaction</div>
          <div className="metric-value">
            {value(() => currency(Number(summary!.average_transaction)))}
          </div>
          <div className="metric-foot">Net sales per transaction</div>
        </article>
      </section>

      <section className="panel report-chart-panel">
        <div className="panel-heading">
          <div>
            <h2>Daily net sales</h2>
            <p>Every day in the selected period</p>
          </div>
        </div>

        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 12, right: 8, left: -14, bottom: 0 }}
            >
              <CartesianGrid stroke="#4a55d8" strokeDasharray="4 4" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatShortDate}
                minTickGap={28}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#aab0f2", fontSize: 17 }}
                dy={10}
              />
              <YAxis
                tickFormatter={formatAxisCurrency}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#aab0f2", fontSize: 17 }}
                width={66}
              />
              <Tooltip
                cursor={{ fill: "rgba(225, 225, 225, 0.15)" }}
                labelFormatter={(label) => formatShortDate(String(label))}
                formatter={(amount) => [currency(Number(amount)), "Net sales"]}
                labelStyle={{ color: "#e1e1e1" }}
                itemStyle={{ color: "#e1e1e1" }}
                contentStyle={{
                  background: "#000fc0",
                  border: "2px solid #e1e1e1",
                  borderRadius: 0,
                  boxShadow: "4px 4px 0 #00096e",
                  color: "#e1e1e1",
                  fontSize: 18,
                }}
              />
              <Bar dataKey="sales" fill="#e1e1e1" maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>

          {!busy && !error && !hasSales && (
            <div className="chart-empty-message">
              No sales recorded in this period.
            </div>
          )}
        </div>

        <div className="osd-timeline">
          <span>Begin {startDate}</span>
          <div className="osd-timeline-bar" />
          <span>End {endDate}</span>
        </div>
      </section>

      <section className="report-split">
        <article className="panel transactions-panel">
          <div className="panel-heading transaction-heading">
            <div>
              <h2>Top products</h2>
              <p>Ranked by net sales</p>
            </div>
          </div>

          <div className="table-scroll">
            <table className="transactions-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>PRODUCT</th>
                  <th>UNITS</th>
                  <th>NET SALES</th>
                </tr>
              </thead>
              <tbody>
                {report?.top_products.map((item, index) => (
                  <tr key={item.product}>
                    <td className="quantity-cell">{index + 1}</td>
                    <td>
                      <div className="product-cell">
                        <div>
                          <strong>{item.product}</strong>
                          <span>{item.category}</span>
                        </div>
                      </div>
                    </td>
                    <td className="quantity-cell">{item.quantity}</td>
                    <td className="amount-cell">{currency(Number(item.net_sales))}</td>
                  </tr>
                ))}

                {(busy || !report || report.top_products.length === 0) && (
                  <tr>
                    <td colSpan={4} className="empty-state">
                      {busy ? "Loading..." : "No sales in this period."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Sales by category</h2>
              <p>Share of net sales</p>
            </div>
          </div>

          <div className="category-list">
            {report?.categories.map((item) => (
              <div className="category-row" key={item.category}>
                <div className="category-row-top">
                  <strong>{item.category}</strong>
                  <span>{currency(Number(item.net_sales))}</span>
                </div>
                <div className="category-bar">
                  <div
                    className="category-bar-fill"
                    style={{ width: `${Math.max(Number(item.share_percent), 1)}%` }}
                  />
                </div>
                <div className="category-row-foot">
                  {item.share_percent}% · {item.quantity} units
                </div>
              </div>
            ))}

            {(busy || !report || report.categories.length === 0) && (
              <div className="empty-state">
                {busy ? "Loading..." : "No sales in this period."}
              </div>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
