# 6dMetrx — Sales Reporting Automation System

A sales reporting web app for a (synthetic) motorcycle dealership: dashboard,
sales records with CSV import, inventory with low-stock warnings, and reports
you can download as PDF or CSV.

- **Frontend:** React + TypeScript + Vite, Recharts
- **Backend:** FastAPI + SQLAlchemy, ReportLab (PDF)
- **Database:** SQLite locally, PostgreSQL online

## Features

| Area | What it does |
|---|---|
| Dashboard | Net sales, transactions, items sold, daily chart for 7/30/90 days |
| Sales | Searchable sales list; CSV import with preview and error checking |
| Inventory | Stock levels, reorder warnings, stock-in and adjustments with history |
| Reports | Date-range report with PDF download and four CSV exports |
| Settings | Company name and administrator profiles (saved in the browser) |

## Project layout

```
backend/    FastAPI app (app/main.py), routers, models, PDF builder, seed script
frontend/   React app (src/), Vite config
DEPLOY.md   How to put it online with Vercel
```

## Run it locally

You need Python 3.12+ and Node 20+.

**Backend**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m app.seed                 # optional: 90 days of demo data
uvicorn app.main:app --reload      # http://127.0.0.1:8000  (API docs at /docs)
```

**Frontend** (in a second terminal)

```bash
cd frontend
npm install
npm run dev                        # http://localhost:5173
```

Run the backend commands from the `backend` folder. `python -m app.seed --reset`
replaces all existing data with fresh demo data.

## CSV import format

Columns: `reference_number, sale_date, product_name, category, quantity, unit_price, discount`.
Rows with the same `reference_number` become one sale with several items.
A template can be downloaded from the Sales page.

## Settings (environment variables)

See `backend/.env.example` and `frontend/.env.example`. Locally none are needed.

## Deploying

See [DEPLOY.md](DEPLOY.md).
