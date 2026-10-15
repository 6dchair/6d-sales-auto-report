# Deploying to Vercel

The app is deployed as **two Vercel projects from the same GitHub repository**,
plus a hosted database:

```
 Browser ──► Vercel project "web"  (frontend/ folder, the React app)
                │  calls
                ▼
             Vercel project "api"  (backend/ folder, FastAPI)
                │  reads and writes
                ▼
             Hosted Postgres database (Neon, Supabase, ...)
```

**Why a hosted database?** Vercel functions have a read-only file system, so the
SQLite file used for local development cannot be used online. The backend
switches to Postgres automatically when a `DATABASE_URL` is set.

Do the steps in this order: GitHub → database → API → web → connect them.

---

## 1. Push the project to GitHub

From the project root (the folder that contains `backend/` and `frontend/`):

```bash
git status
```

If it says `not a git repository`, start one:

```bash
git init -b main
```

Check what will be uploaded **before** committing:

```bash
git add .
git status
git ls-files | grep -E "node_modules|autoreportvenv|\.venv|\.db$|\.env$" || echo "clean"
```

The last command must print `clean`. If it lists files, they should not be in
the repository (`.gitignore` normally keeps them out). Remove them from Git
with, for example, `git rm -r --cached backend/.autoreportvenv`.

Then commit and push:

```bash
git commit -m "Sales reporting system: dashboard, sales, inventory, reports"

# only if the repository has no remote yet:
git remote add origin https://github.com/YOUR-USER/YOUR-REPO.git

git push -u origin main
```

- If Git says **"Please tell me who you are"**, run
  `git config user.name "Your Name"` and `git config user.email "you@example.com"`,
  then commit again.
- If the push is **rejected** because the GitHub repository already has commits
  (for example a README created on GitHub), run
  `git pull --rebase origin main` and push again.

---

## 2. Create the database

1. Create a free Postgres database at [Neon](https://neon.tech) (or Supabase, or
   from the Vercel dashboard under **Storage**).
2. Copy the **connection string**. It looks like
   `postgresql://user:password@host/dbname?sslmode=require`.
3. Treat it like a password. Do not put it in the repository.

### Optional: load the demo data

From your computer, with the backend virtual environment active:

```bash
cd backend
pip install -r requirements.txt
DATABASE_URL="postgresql://...your connection string..." python -m app.seed
```

This creates the tables and adds 90 days of demo sales and stock. (Add
`--reset` only if you want to wipe the database first.)

If you skip this, the tables are still created automatically the first time the
API runs, and you can import sales from the Sales page.

---

## 3. Deploy the API (backend)

1. In Vercel: **Add New → Project**, and import your GitHub repository.
2. Name it something like `motometrics-api`.
3. Set **Root Directory** to `backend`.
4. Framework preset: **FastAPI** (Vercel detects it; `backend/pyproject.toml`
   already tells it where the app is: `app.main:app`).
5. Under **Environment Variables** add:
   - `DATABASE_URL` = your connection string from step 2
6. Click **Deploy**.

Check it works. Open these addresses (replace with your own):

- `https://motometrics-api.vercel.app/health` → `{"status":"ok",...}`
- `https://motometrics-api.vercel.app/docs` → the API documentation
- `https://motometrics-api.vercel.app/api/inventory` → JSON

Write down the API address. You need it next.

---

## 4. Deploy the web app (frontend)

1. **Add New → Project**, import the **same repository** again.
2. Name it something like `motometrics-web`.
3. Set **Root Directory** to `frontend`. Vercel detects **Vite** and uses
   `npm run build` and the `dist` folder automatically.
4. Under **Environment Variables** add:
   - `VITE_API_BASE_URL` = the API address from step 3, with no slash at the
     end (for example `https://motometrics-api.vercel.app`)
5. Click **Deploy**.

---

## 5. Let the web app call the API

The browser only allows the web app to call the API if the API lists the web
app's address.

1. Open the **API** project → **Settings → Environment Variables**.
2. Add `CORS_ORIGINS` = your web address (for example
   `https://motometrics-web.vercel.app`, no slash at the end).
3. *(Optional, for preview deployments)* add
   `CORS_ORIGIN_REGEX` = `https://.*\.vercel\.app`
   This allows any `*.vercel.app` address, which is fine for demo data. Leave it
   out for anything private.
4. **Redeploy** the API (Deployments → the latest one → Redeploy). Changes to
   environment variables only apply to new deployments.

Open the web address. The dashboard should load with your data.

---

## 6. After that

- **Updating:** push to `main` on GitHub and Vercel rebuilds both projects.
- **Changing `VITE_API_BASE_URL`** needs a redeploy of the **web** project,
  because the value is baked in when the site is built.
- **Custom domain:** add it under each project's **Settings → Domains**. Then
  update `CORS_ORIGINS` to the new web address and redeploy the API.

---

## Good to know

- **No login yet.** The administrator profiles and the company name in Settings
  are saved in each visitor's browser and are for display only. Anyone who knows
  the address can view and change the data. Use demo data until a sign-in is
  added.
- **First request after a quiet period can be slow** (the API starts up and
  checks the database tables).
- **CSV import size.** Vercel currently limits a request to about 4.5 MB, so
  keep import files under that.
- **Plans and limits.** Check the current Vercel and database plan terms. For
  example, Vercel's free Hobby plan is meant for personal, non-commercial use.

---

## Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| API shows `500` errors | `DATABASE_URL` is missing or wrong. Check it, redeploy, and read **Logs** in the API project. |
| Web app shows "Unable to load…" or "Failed to fetch" | `VITE_API_BASE_URL` is wrong (check it has `https://` and no slash at the end), then redeploy the web project. |
| Browser console shows a **CORS** error | The API does not list the web address. Set `CORS_ORIGINS` (step 5) and redeploy the API. |
| Import errors such as `ModuleNotFoundError` | The API project's **Root Directory** is not `backend`. |
| `/docs` works but data is empty | The database is empty. Run the seed (step 2) or import a CSV. |
| PDF or CSV download fails | Open the API **Logs**; also confirm the web app points at the API, not at itself. |
| Works locally but not online | Locally the app uses a SQLite file and `127.0.0.1:8000`. Online it needs the two variables above. |
