# CubingIndia Dashboard

## What This Is

A full-stack business dashboard for **CubingIndia** — a speedcubes retail/import business. Tracks inventory, sales, expenses, P&L, stock allocations, and stock adjustments across multiple consignment batches.

**Live:** https://cubingindia-dashboard.onrender.com
**GitHub:** https://github.com/SameerChawan/cubingindia-dashboard
**Auto-deploys:** Push to `main` on GitHub → Render redeploys automatically

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3.11 + Flask |
| Database | Supabase (PostgreSQL REST API) |
| Auth | Flask sessions + salted SHA-256 password hashing |
| Frontend | Vanilla JS + Bootstrap 5.3 (dark theme) |
| Charts | Chart.js 4.4 |
| PWA | manifest.json + service worker with offline caching |
| Hosting | Render.com free tier (gunicorn) |
| DB Client | urllib (no Supabase SDK — raw REST calls) |

---

## Project Structure

```
CubingIndia/
├── app.py                    # Flask app entry point, auth routes, before_request guard
├── auth.py                   # Password hashing (SHA-256 + salt), login_required decorator
├── config.py                 # Loads .env, exports SUPABASE_URL, SUPABASE_KEY
├── db.py                     # Supabase REST client: query(), insert(), update(), delete(), rpc()
├── requirements.txt          # flask, python-dotenv, requests, gunicorn
├── Procfile                  # gunicorn startup for Render
├── render.yaml               # Render auto-config (free tier, env vars)
├── DEPLOY.md                 # Deployment guide (Render + Hostinger VPS)
├── .gitignore                # Excludes .env, __pycache__/
│
├── api/
│   ├── __init__.py
│   └── routes.py             # ALL API endpoints — consignments, products, sales, expenses,
│                             #   revenue, allocations, adjustments, dashboard/analytics
│
├── templates/
│   ├── index.html            # Main SPA — tabs: Dashboard, Consignments, Inventory,
│   │                         #   Unified View, Sales, Expenses, Revenue
│   ├── login.html            # Login page
│   └── setup.html            # First-time admin account creation
│
├── static/
│   ├── css/style.css         # Custom styles, P&L hover tooltip, mobile responsive
│   ├── js/app.js             # All frontend logic — API calls, forms, tables, charts, CSV export
│   ├── manifest.json         # PWA manifest
│   ├── sw.js                 # Service worker (offline caching)
│   └── img/
│       ├── logo.jpg          # CubingIndia logo
│       ├── icon-192.png      # PWA icon
│       └── icon-512.png      # PWA icon
│
└── scripts/
    ├── create_tables.sql     # Full Supabase schema (run in SQL Editor)
    ├── migrate_v3.sql        # Migration: auth + stock allocations
    ├── migrate_v4.sql        # Migration: stock adjustments + quantity_adjusted column
    ├── seed_data.py          # Sample data seeder
    └── test_connection.py    # Supabase connection test
```

---

## Database Schema (Supabase)

All tables prefixed with `ci_`. UUIDs as PKs. RLS enabled with permissive policies.

```
ci_users                  — Auth users (username, password_hash, display_name)
ci_consignments           — Import batches (name, supplier, invoice, COGS USD, freight USD, USD/INR rate)
ci_products               — Items per consignment (product_name, brand, category, variant, qty, unit_cost_usd)
ci_stock_allocations      — Stock reserved for company/promotion/events
ci_stock_adjustments      — Damaged/lost/returned/found/correction tracking
ci_consignment_expenses   — Handling costs per consignment (customs, transport, storage — INR)
ci_sales                  — Sale transactions (date, channel, customer, discount)
ci_sale_items             — Line items per sale (frozen COGS at sale time — INR)
ci_expenses               — Operating expenses (postage, packaging, rent, marketing — INR)
ci_revenue                — Non-sale income (competition entry fees, sponsorship, prize money — INR)
```

### Key Relationships
```
ci_consignments 1──N ci_products  (consignment_id FK, CASCADE delete)
ci_products     1──N ci_stock_allocations  (product_id FK)
ci_products     1──N ci_stock_adjustments  (product_id FK)
ci_consignments 1──N ci_consignment_expenses  (consignment_id FK)
ci_sales        1──N ci_sale_items  (sale_id FK, CASCADE delete)
ci_products         ci_sale_items  (product_id FK — no cascade, preserves history)
```

### Computed Columns
- `ci_products.quantity_remaining` = `quantity_imported - quantity_sold - quantity_allocated - quantity_adjusted` (STORED)
- `ci_sale_items.line_total` = `quantity * selling_price` (STORED)
- `ci_sale_items.line_profit` = `quantity * (selling_price - unit_cogs_inr - unit_freight_inr - unit_handling_inr)` (STORED)

---

## How Landed Cost Works

**Proportional allocation** — freight & handling are distributed by product value, not equally.

```
For each product in a consignment:
  markup_factor = 1 + (freight_usd + handling_usd) / cogs_usd
  unit_landed_inr = unit_cost_usd × usd_inr_rate × markup_factor

Where:
  handling_usd = sum(consignment_expenses.amount_inr) / usd_inr_rate
```

At sale time, `unit_cogs_inr`, `unit_freight_inr`, and `unit_handling_inr` are frozen in `ci_sale_items` so P&L is historical (not affected by later rate changes).

---

## API Endpoints

All `/api/*` routes require authentication (session cookie).

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/consignments` | List all consignments with landed cost + reconciliation |
| POST | `/api/consignments` | Create consignment |
| PUT | `/api/consignments/<id>` | Update consignment |
| DELETE | `/api/consignments/<id>` | Delete consignment + its expenses |
| GET | `/api/products` | List products (filter by consignment_id, status) |
| POST | `/api/products` | Create product |
| PUT | `/api/products/<id>` | Update product |
| DELETE | `/api/products/<id>` | Delete product |
| GET | `/api/consignment-expenses` | List handling expenses |
| POST | `/api/consignment-expenses` | Add handling expense |
| DELETE | `/api/consignment-expenses/<id>` | Delete expense |
| GET | `/api/allocations` | List stock allocations |
| POST | `/api/allocations` | Allocate stock (validates sellable qty) |
| DELETE | `/api/allocations/<id>` | Delete allocation (reverses qty) |
| GET | `/api/adjustments` | List stock adjustments |
| POST | `/api/adjustments` | Create adjustment (damaged/lost/returned/found/correction) |
| DELETE | `/api/adjustments/<id>` | Delete adjustment (reverses qty) |
| GET | `/api/sales` | List sales with line items |
| POST | `/api/sales` | Create sale (auto-allocates COGS, updates product qty) |
| DELETE | `/api/sales/<id>` | Delete sale (reverses product quantities) |
| GET | `/api/expenses` | List operating expenses |
| POST | `/api/expenses` | Create expense |
| DELETE | `/api/expenses/<id>` | Delete expense |
| GET | `/api/revenue` | List other revenue |
| POST | `/api/revenue` | Create revenue |
| DELETE | `/api/revenue/<id>` | Delete revenue |
| GET | `/api/dashboard/summary` | Full dashboard: inventory, P&L, per-consignment breakdown, charts |
| GET | `/api/dashboard/inventory` | Detailed inventory with landed costs + adjustment info |

---

## Frontend Tabs

| Tab | What It Shows |
|-----|---------------|
| **Dashboard** | 5 summary cards (Net Profit, Revenue, Inventory Value, Items in Stock, Gross Margin%) + P&L hover tooltip + Revenue Composition pie chart + Inventory Status donut + CSV export buttons |
| **Consignments** | CRUD for import batches + handling expense sub-form + reconciliation (products sum vs consignment total) |
| **Inventory** | Per-product table with allocated/adjusted/sellable columns + status filter + consignment filter + allocate/adjust modals |
| **Unified View** | Aggregated inventory by product_name+brand+category across all consignments + category/brand filters |
| **Sales** | Sale form with line items (product dropdown shows only sellable stock) + sale history |
| **Expenses** | Operating expenses CRUD (postage, packaging, rent, marketing) |
| **Revenue** | Non-sale income CRUD (competition fees, sponsorship, prize money) |

---

## Environment Variables

Set in `.env` file (local) or Render dashboard (production):

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL (e.g. `https://xxx.supabase.co`) |
| `SUPABASE_KEY` | Supabase anon/public key |
| `FLASK_SECRET` | Random string for Flask session encryption |

---

## Local Development

```bash
cd CubingIndia
pip install -r requirements.txt
# Create .env with SUPABASE_URL, SUPABASE_KEY, FLASK_SECRET
python app.py
# → http://localhost:5050
# First visit: /setup to create admin account
```

---

## Deployment

### Render.com (Current — Free Tier)
- Free tier: sleeps after 15min inactivity, ~30s cold start
- Auto-deploys from GitHub `main` branch
- Upgrade to $7/mo for always-on

### Hostinger VPS (Alternative — $6/mo)
- Full guide in `DEPLOY.md`
- Gunicorn + Nginx + Certbot SSL

---

## Auth Flow

1. First visit → redirects to `/setup` (only if no users exist)
2. Create admin account (username + password, min 6 chars)
3. Login at `/login` → sets session cookie
4. All routes protected by `before_request` + `login_required` decorator
5. Passwords stored as `salt$sha256(salt+password)`

---

## Pending Features (as of June 28, 2026)

- [ ] Date range filters (MTD/QTD/YTD/custom range)
- [ ] Sales trend line chart (revenue over weeks/months)
- [ ] Reorder alerts (min stock threshold per product)
- [ ] Supplier payment tracking (paid/pending per consignment)
- [ ] Top products view (best sellers, highest margin, slow movers)
- [ ] Customer history (repeat buyers, lifetime value)
- [ ] Stock movement log (timeline per product)
- [ ] Batch cost compare (same product across consignments)
- [ ] Print/PDF reports
- [ ] Multi-user roles
- [ ] Custom domain for Render deployment
- [ ] Dashboard-as-a-Service business — brand name, template, first client

---

## Key Decisions & Constraints

1. **Never DROP tables in Supabase** — always use ALTER/migrate to preserve data
2. **NO Supabase SDK** — raw REST via urllib (keeps deps minimal)
3. **SHA-256 hashing** (not bcrypt) — sufficient for personal dashboard
4. **Proportional freight allocation** — higher-value products absorb more freight cost
5. **Frozen COGS at sale time** — `unit_cogs_inr/unit_freight_inr/unit_handling_inr` in `ci_sale_items` so historical P&L is immutable
6. **PWA over native app** — zero cost, installable from browser, works immediately
7. **Render.com over VPS** — free tier, auto-deploy, HTTPS (for now)

---

## Git Info

- **GitHub:** SameerChawan/cubingindia-dashboard
- **User:** SameerChawan / sameer.chawan5@gmail.com
- **gh CLI:** `C:\Users\samee\gh.exe`
- **Auto-deploy:** Every push to `main` on GitHub → Render redeploys