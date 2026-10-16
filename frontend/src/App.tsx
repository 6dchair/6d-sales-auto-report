
import { useEffect, useRef, useState } from "react";
import { api } from "./services/api";
import type {
  DashboardSummary,
  InventoryItem,
  Sale,
  Product,
  Transaction,
} from "./types";
import { Icon, LogoMark } from "./components/Icon";
import SettingsPage from "./components/SettingsPage";
import UserMenu from "./components/UserMenu";
import OsdClock from "./components/OsdClock";
import InventoryPage from "./components/InventoryPage";
import { initialsOf, useProfiles } from "./hooks/useProfiles";
import { useSystemName } from "./hooks/useSystemName";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import SalesPage from "./components/SalesPage";
import ReportsPage from "./components/ReportsPage";
import { matchesSearch } from "./utils/search";
import { currency, formatAxisCurrency, formatLocalDate, formatShortDate } from "./utils/format";
import "@fontsource/vt323";
import "./App.css";

const navigation = ["Dashboard", "Sales", "Inventory", "Reports"];

function App() {
  const [activePage, setActivePage] = useState("Dashboard");
  const { systemName, setSystemName } = useSystemName();
  const {
    profiles,
    activeProfile,
    addProfile,
    updateProfile,
    removeProfile,
    selectProfile,
  } = useProfiles();
  const [dateRange, setDateRange] = useState("7 days");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // The search box only filters the Dashboard and Sales tables.
  const searchable = activePage === "Dashboard" || activePage === "Sales";

  // The transactions table sits lower on the page; bring it into view.
  const scrollToResults = () =>
    document
      .getElementById("transactions-results")
      ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  // Bump to refetch dashboard + sales data (e.g. after a CSV import).
  const [refreshKey, setRefreshKey] = useState(0);
  // Bump after stock changes so the low-stock alerts refresh.
  const [inventoryKey, setInventoryKey] = useState(0);
  const [stockAlerts, setStockAlerts] = useState<InventoryItem[]>([]);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState("");

  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [salesLoading, setSalesLoading] = useState(true);
  const [salesError, setSalesError] = useState("");
  
  const [dailySales, setDailySales] = useState<
    { date: string; sales: number }[]
  >([]);

  
  // Press "/" anywhere (outside a field) to jump to the search box.
  useEffect(() => {
    if (!searchable) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing) return;

      event.preventDefault();
      searchRef.current?.focus();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchable]);

  // Products that are low, out of stock or oversold (shown in the sidebar and notifications).
  useEffect(() => {
    let cancelled = false;

    api
      .getInventory()
      .then((data) => {
        if (!cancelled) {
          setStockAlerts(
            data.items.filter(
              (item) =>
                item.status === "low" ||
                item.status === "out" ||
                item.status === "oversold"
            )
          );
        }
      })
      .catch(() => {
        if (!cancelled) setStockAlerts([]);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey, inventoryKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        const days = Number.parseInt(dateRange, 10);
        const end = new Date();
        const start = new Date(end);
        start.setDate(start.getDate() - days + 1);

        const startDate = formatLocalDate(start);
        const endDate = formatLocalDate(end);

        setSummaryLoading(true);
        setSummaryError("");

        const [summaryData, dailySalesData] = await Promise.all([
          api.getDashboardSummary(startDate, endDate),
          api.getDailySales(startDate, endDate),
        ]);

        if (!cancelled) {
          setSummary(summaryData);
          setDailySales(
            dailySalesData.map((item) => ({
              date: item.date,
              sales: Number(item.sales),
            }))
          );
        }
      } catch (error) {
        if (!cancelled) {
          setSummaryError(
            error instanceof Error
              ? error.message
              : "Could not load dashboard data."
          );
        }
      } finally {
        if (!cancelled) {
          setSummaryLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      cancelled = true;
    };
  }, [dateRange, refreshKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadTransactions() {
      try {
        const [salesData, productsData] = await Promise.all([
          api.getSales(),
          api.getProducts(),
        ]);

        if (!cancelled) {
          setSales(salesData);
          setProducts(productsData);
          setSalesError("");
        }
      } catch (error) {
        if (!cancelled) {
          setSalesError(
            error instanceof Error
              ? error.message
              : "Could not load transactions."
          );
        }
      } finally {
        if (!cancelled) {
          setSalesLoading(false);
        }
      }
    }

    loadTransactions();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // Combine sales records with their corresponding product information.
  const transactions: Transaction[] = sales.map((sale) => {
    const items = sale.items ?? [];

    const productNames = items.map((item) => {
      const product = products.find((p) => p.id === item.product_id);
      return product?.name ?? `Product #${item.product_id}`;
    });

    const categories = items.map((item) => {
      const product = products.find((p) => p.id === item.product_id);
      return product?.category ?? "Uncategorized";
    });

    return {
      id: sale.id,
      referenceNumber: sale.reference_number,
      product: [...new Set(productNames)].join(", "),
      category: [...new Set(categories)].join(", "),
      date: sale.sale_date,
      quantity: items.reduce((sum, item) => sum + item.quantity, 0),
      amount: Number(sale.total),
      status: sale.status,
    };
  });

  const filteredTransactions = transactions.filter((transaction) =>
    matchesSearch(transaction, search)
  );

  // Days are zero-filled by the API, so only consider days that had sales.
  const activeSalesDays = dailySales.filter((day) => day.sales > 0);
  const hasSalesInRange = activeSalesDays.length > 0;

  const highestSalesDay = hasSalesInRange
    ? activeSalesDays.reduce((highest, day) =>
        day.sales > highest.sales ? day : highest
      )
    : null;

  const highestDailySales = highestSalesDay?.sales ?? 0;

  const averageTransaction =
    summary && summary.transaction_count > 0
      ? Number(summary.net_sales) / summary.transaction_count
      : 0;

  const exportTransactions = () => {
    const headers = [
      "Reference Number",
      "Product",
      "Category",
      "Date",
      "Quantity",
      "Net Sales",
      "Status",
    ];

    const rows = filteredTransactions.map((transaction) => [
      transaction.referenceNumber,
      transaction.product,
      transaction.category,
      transaction.date,
      transaction.quantity,
      transaction.amount,
      transaction.status,
    ]);

    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");

    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" })
    );

    const link = document.createElement("a");
    link.href = url;
    link.download = "sales-transactions.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  };

  return (
    <div className="app-shell">
      {mobileMenuOpen && (
        <button
          className="mobile-overlay"
          aria-label="Close navigation"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <aside className={`sidebar ${mobileMenuOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <LogoMark size={26} />
          </div>

          <div>
            <div className="brand-name" title={systemName}>
              {systemName}
            </div>
            <div className="brand-caption">SALES INTELLIGENCE</div>
          </div>

          <button
            className="mobile-close"
            aria-label="Close navigation"
            onClick={() => setMobileMenuOpen(false)}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="sidebar-label">WORKSPACE</div>

        <nav className="nav-list">
          {navigation.map((label) => (
            <button
              key={label}
              className={`nav-item ${
                activePage === label ? "active" : ""
              }`}
              onClick={() => {
                setActivePage(label);
                setMobileMenuOpen(false);
              }}
            >
              <span>{label}</span>
              {label === "Inventory" && stockAlerts.length > 0 && (
                <span className="nav-count">{stockAlerts.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-label tools-label">PREFERENCES</div>

        <button
          className={`nav-item ${
            activePage === "Settings" ? "active" : ""
          }`}
          onClick={() => {
            setActivePage("Settings");
            setMobileMenuOpen(false);
          }}
        >
          <span>Settings</span>
        </button>

        <div className="sidebar-bottom">
          <div className="sidebar-profile">
            <div className="avatar">{initialsOf(activeProfile.name)}</div>
            <div className="profile-copy">
              <div className="profile-name">{activeProfile.name}</div>
              <div className="profile-role">{activeProfile.role}</div>
            </div>
            <button
              className="icon-button profile-menu"
              aria-label="Open profile settings"
              onClick={() => setActivePage("Settings")}
            >
              <Icon name="chevron" size={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu-button"
              aria-label="Open navigation"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Icon name="menu" size={22} />
            </button>

            <div className="breadcrumb">
              <span>Workspace</span>
              <span className="breadcrumb-divider">/</span>
              <strong>{activePage}</strong>
            </div>
          </div>

          <div className="topbar-actions">
            <OsdClock />
            {searchable && (
              <div className="search-box">
                <Icon name="search" size={16} />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setSearch("");
                      event.currentTarget.blur();
                    } else if (event.key === "Enter" && search.trim() !== "") {
                      event.preventDefault();
                      scrollToResults();
                      // On phones, put the keyboard away so the results are visible.
                      if (window.matchMedia?.("(pointer: coarse)").matches) {
                        event.currentTarget.blur();
                      }
                    }
                  }}
                  placeholder="Search ref, product, date"
                  aria-label="Search sales"
                />
                <span className="search-shortcut">/</span>
              </div>
            )}

            <div className="notification-wrap">
              <button
                className="text-button"
                onClick={() => setNotificationsOpen(!notificationsOpen)}
              >
                Notifications
                {stockAlerts.length > 0 ? ` (${stockAlerts.length})` : ""}
              </button>

              {notificationsOpen && (
                <div className="notification-popover">
                  <strong>Notifications</strong>
                  {stockAlerts.length > 0 ? (
                    <>
                      <p>
                        {stockAlerts.length}{" "}
                        {stockAlerts.length === 1 ? "product needs" : "products need"}{" "}
                        restocking:
                      </p>
                      <ul className="notification-list">
                        {stockAlerts.slice(0, 5).map((alert) => (
                          <li key={alert.id}>
                            {alert.name}
                            <span>{alert.on_hand}</span>
                          </li>
                        ))}
                      </ul>
                      <button
                        onClick={() => {
                          setActivePage("Inventory");
                          setNotificationsOpen(false);
                        }}
                      >
                        View inventory
                      </button>
                    </>
                  ) : (
                    <p>No new notifications.</p>
                  )}
                  <button onClick={() => setNotificationsOpen(false)}>
                    Dismiss
                  </button>
                </div>
              )}
            </div>

            <div className="topbar-divider" />

            <UserMenu
              profiles={profiles}
              activeProfile={activeProfile}
              onSelect={selectProfile}
              onOpenSettings={() => setActivePage("Settings")}
            />
          </div>
        </header>

        {searchable && search.trim() !== "" && !salesLoading && (
          <div className="search-notice" role="status">
            <span>
              {filteredTransactions.length === 0 ? (
                <>
                  No transactions match <strong>“{search.trim()}”</strong>.
                </>
              ) : (
                <>
                  <strong>{filteredTransactions.length}</strong> of{" "}
                  {transactions.length} transactions match{" "}
                  <strong>“{search.trim()}”</strong>.
                </>
              )}
            </span>
            <span className="search-notice-actions">
              {filteredTransactions.length > 0 && (
                <button
                  className="text-link"
                  onClick={scrollToResults}
                >
                  Show results
                </button>
              )}
              <button className="text-link" onClick={() => setSearch("")}>
                Clear search
              </button>
            </span>
          </div>
        )}

        {activePage === "Dashboard" ? (
          <div className="dashboard-page">
            {summaryError && (
              <div className="api-error">
                Unable to load sales summary: {summaryError}
              </div>
            )}

            {salesError && (
              <div className="api-error">
                Unable to load transactions: {salesError}
              </div>
            )}

            <section className="page-heading">
              <div>
                <div className="eyebrow">
                  <span className="eyebrow-dot" />
                  BUSINESS OVERVIEW
                </div>
                <h1>Sales dashboard</h1>
                <p className="page-subtitle">
                  Showing your store’s performance for the last {dateRange}.
                </p>
              </div>

              <div className="heading-actions">
                <button
                  className="button-secondary"
                  onClick={exportTransactions}
                >
                  Export CSV
                </button>

                <button
                  className="button-primary"
                  onClick={() => setActivePage("Sales")}
                >
                  View sales
                </button>
              </div>
            </section>

            <section className="metrics-grid">
              <article className="metric-card">

                <div className="metric-label">Net sales</div>

                <div className="metric-value">
                  {summaryLoading
                    ? "Loading..."
                    : summary
                      ? currency(Number(summary.net_sales))
                      : "—"}
                </div>

                <div className="metric-foot">After discounts</div>
              </article>

              <article className="metric-card">

                <div className="metric-label">Transactions</div>

                <div className="metric-value">
                  {summaryLoading
                    ? "Loading..."
                    : summary
                      ? summary.transaction_count
                      : "—"}
                </div>

                <div className="metric-foot">Recorded sales</div>
              </article>

              <article className="metric-card">

                <div className="metric-label">Items sold</div>

                <div className="metric-value">
                  {summaryLoading
                    ? "Loading..."
                    : summary
                      ? summary.items_sold
                      : "—"}
                </div>

                <div className="metric-foot">Across all products</div>
              </article>

              <article className="metric-card">

                <div className="metric-label">Average transaction</div>

                <div className="metric-value">
                  {summaryLoading
                    ? "Loading..."
                    : summary
                      ? currency(averageTransaction)
                      : "—"}
                </div>

                <div className="metric-foot">Net sales per transaction</div>
              </article>
            </section>

            <section className="analytics-grid">
              <article className="panel sales-chart-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Sales performance</h2>
                    <p>Track your sales over time</p>
                  </div>

                  <div className="range-switcher">
                    {["7 days", "30 days", "90 days"].map((range) => (
                      <button
                        key={range}
                        className={dateRange === range ? "selected" : ""}
                        onClick={() => setDateRange(range)}
                      >
                        {range}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="chart-summary">
                  <span className="chart-total">
                    {summaryLoading
                      ? "Loading..."
                      : summary
                        ? currency(Number(summary.net_sales))
                        : "—"}
                  </span>
                  <span className="chart-summary-label">Total net sales</span>
                </div>

                <div className="chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={dailySales}
                      margin={{
                        top: 12,
                        right: 8,
                        left: -14,
                        bottom: 0,
                      }}
                    >
                      <defs>
                        <linearGradient
                          id="salesGradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#e1e1e1"
                            stopOpacity={0.35}
                          />
                          <stop
                            offset="100%"
                            stopColor="#e1e1e1"
                            stopOpacity={0.02}
                          />
                        </linearGradient>
                      </defs>

                      <CartesianGrid
                        stroke="#4a55d8"
                        strokeDasharray="4 4"
                        vertical={false}
                      />

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
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#aab0f2", fontSize: 17 }}
                        tickFormatter={formatAxisCurrency}
                        width={66}
                      />

                      <Tooltip
                        formatter={(value) => [
                          currency(Number(value)),
                          "Net sales",
                        ]}
                        cursor={{ stroke: "#e1e1e1", strokeDasharray: "4 4" }}
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

                      <Area
                        type="linear"
                        dataKey="sales"
                        stroke="#e1e1e1"
                        strokeWidth={2.5}
                        fill="url(#salesGradient)"
                        activeDot={{
                          r: 5,
                          fill: "#e1e1e1",
                          stroke: "#000fc0",
                          strokeWidth: 2,
                        }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>

                  {!summaryLoading && !summaryError && !hasSalesInRange && (
                    <div className="chart-empty-message">
                      No sales recorded in the last {dateRange}.
                    </div>
                  )}
                </div>

                <div className="chart-note">
                  <span>
                    Showing {dateRange.toLowerCase()} · Daily sales breakdown
                  </span>
                </div>
              </article>

              <article className="panel quick-insights-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Sales insights</h2>
                    <p>A quick look at your numbers</p>
                  </div>

                  <button
                    className="text-link"
                    onClick={() => setActivePage("Reports")}
                  >
                    Reports
                  </button>
                </div>

                <div className="insight-highlight">
                  <div className="insight-highlight-top">
                    <span className="insight-dot" />
                    SALES SNAPSHOT
                  </div>

                  <div className="insight-main">
                    <div>
                      <div className="insight-number">
                        {summaryLoading
                          ? "Loading..."
                          : highestSalesDay
                            ? currency(highestDailySales)
                            : "—"}
                      </div>
                      <div className="insight-description">
                        Highest daily sales
                      </div>
                    </div>

                    <div className="insight-badge">
                      {highestSalesDay ? formatShortDate(highestSalesDay.date) : "—"}
                    </div>
                  </div>
                </div>

                <div className="insight-row">

                  <div className="insight-row-copy">
                    <strong>
                      {summaryLoading
                        ? "Loading..."
                        : summary
                          ? `${summary.transaction_count} transactions`
                          : "—"}
                    </strong>
                    <span>Recorded sales</span>
                  </div>
                </div>

                <div className="insight-row">

                  <div className="insight-row-copy">
                    <strong>
                      {summaryLoading
                        ? "Loading..."
                        : summary
                          ? `${summary.items_sold} items sold`
                          : "—"}
                    </strong>
                    <span>Across all products</span>
                  </div>
                </div>

                <div className="insight-row">

                  <div className="insight-row-copy">
                    <strong>
                      {summaryLoading
                        ? "Loading..."
                        : summary
                          ? `${currency(Number(summary.discounts))} discounts`
                          : "—"}
                    </strong>
                    <span>Applied to transactions</span>
                  </div>
                </div>

                <button
                  className="text-link"
                  onClick={() => setActivePage("Reports")}
                >
                  View detailed reports
                </button>
              </article>
            </section>

            <section className="panel transactions-panel" id="transactions-results">
              <div className="panel-heading transaction-heading">
                <div>
                  <h2>Recent transactions</h2>
                  <p>Your latest recorded sales activity</p>
                </div>

                <button
                  className="button-secondary compact-button"
                  onClick={() => setActivePage("Sales")}
                >
                  View all
                </button>
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
                    {salesLoading && (
                      <tr>
                        <td colSpan={6} className="empty-state">
                          Loading transactions...
                        </td>
                      </tr>
                    )}

                    {!salesLoading && salesError && (
                      <tr>
                        <td colSpan={6} className="empty-state">
                          Unable to load transactions.
                        </td>
                      </tr>
                    )}

                    {!salesLoading &&
                      !salesError &&
                      filteredTransactions.map((transaction) => (
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

                          <td className="quantity-cell">
                            {transaction.quantity}
                          </td>

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

                    {!salesLoading &&
                      !salesError &&
                      filteredTransactions.length === 0 && (
                        <tr>
                          <td colSpan={6} className="empty-state">
                            {search.trim()
                              ? "No matching transactions found."
                              : "No transactions recorded yet."}
                          </td>
                        </tr>
                      )}
                  </tbody>
                </table>
              </div>

              <div className="table-footer">
                <span>
                  Showing {filteredTransactions.length} of{" "}
                  {transactions.length} transactions
                </span>

                <button
                  className="text-link"
                  onClick={() => setSearch("")}
                >
                  Clear search
                </button>
              </div>
            </section>

            <footer className="dashboard-footer">
              <span>© 2026 {systemName}</span>
              <span>
                <span className="footer-status-dot" />
                Sales reporting workspace
              </span>
            </footer>
          </div>
        ) : activePage === "Sales" ? (
          <SalesPage
            transactions={filteredTransactions}
            totalCount={transactions.length}
            loading={salesLoading}
            error={salesError}
            searching={search.trim() !== ""}
            onImported={() => setRefreshKey((key) => key + 1)}
          />
        ) : activePage === "Inventory" ? (
          <InventoryPage onChanged={() => setInventoryKey((key) => key + 1)} />
        ) : activePage === "Settings" ? (
          <SettingsPage
            systemName={systemName}
            onSystemNameChange={setSystemName}
            profiles={profiles}
            activeId={activeProfile.id}
            onAdd={addProfile}
            onUpdate={updateProfile}
            onRemove={removeProfile}
            onSelect={selectProfile}
          />
        ) : activePage === "Reports" ? (
          <ReportsPage systemName={systemName} />
        ) : (
          <section className="placeholder-page">
            <div className="eyebrow">
              <span className="eyebrow-dot" />
              WORKSPACE
            </div>

            <h1>{activePage}</h1>

            <p>
              This section is ready for its next step. We’ll connect it to your
              backend and build its features next.
            </p>

            <button
              className="button-primary"
              onClick={() => setActivePage("Dashboard")}
            >
              Back to dashboard
            </button>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;