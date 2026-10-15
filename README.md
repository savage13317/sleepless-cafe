# Sleepless Café — staff reference

Private, staff-facing costing + inventory tool for **Sleepless Café** (Caloocan, PH).
Not a public site — it is an **unlisted** page for staff only. Never linked from the
Facebook page.

## What it does

Six modules, each a focused tool (see `PLAN.md` for the full spec). Modules are separate
pages; sections stack inside each page and the nav bar moves back-and-forth between them:

1. **Purchases** — item/ingredient · unit of measure · measure per pack · packs · cost per pack → derived **total UOM**, **total price**, and **₱ per base unit** + **on hand**. One row per item; the newest purchase sets the current **₱/OUM** (latest-cost-wins). Purchase rows are kept as an audit record.
2. **Overhead** — indirect costs → **₱ per cup** (yearly/monthly/daily/per-cup inputs normalised to a common per-cup figure).
3. **Recipes** — drink · size · ingredients → one-cup cost, computed live from each item's current **₱/OUM** (free to create, never changes stock).
4. **Selling price** — menu + margin per drink/size (staff reference; costs are hidden from customers). Margin = sell − (recipe cost + overhead/cup).
5. **Daily Sales** — record a day: cups sold per recipe + wastage lines in OUM → revenue, COGS, wastage %, net. Selling a cup **draws down** stock; over-sells are flagged, never blocked (a stock-take reconciles later).
6. **Inventory** — reconcile recorded vs actual → **lost cost / unrecorded savings**; draw-down log + history.

> The old **Ordering** page is retired — it is replaced by Module 5 (Daily Sales) + Module 6 (Inventory). The `orders` table is no longer read by any page.

Plus a **Dashboard** with summary cards: stock value ₱ · low-stock count · sales recorded this month.

## Current build status

Best-version checkpoint (2026-10-15): `origin/main` = **a3962d4**. Modules 1–4 (Purchases, Overhead,
Recipes, Selling price) are complete and verified to a consistent UX bar — two-column forms, live
suggestion/preview boxes, dropdowns of existing data, per-row Edit, fresh overhead-per-cup math,
no stale globals. Modules 5–6 (Daily Sales, Inventory) remain at their plan-phase skeletons.
See `REV_PLAN.md` for the full revision log (R0–R38b).

## Running it locally

Open the folder and serve it:

```
python -m http.server 8731 --directory "c:\Users\USER\Desktop\Sleepless Cafe"
```

Then open <http://localhost:8731/> in a browser. Enter the passphrase to unlock.

## Passphrase gate

- The gate stores only the **SHA-256 hash** of the passphrase, never the passphrase itself.
- Default passphrase: `sleepless`.
- To change it: compute the SHA-256 of the new passphrase and paste it into `GATE_HASH` in `app.js`.
  - PowerShell: `"'sleepless' | sha256sum"` equivalent — or `echo -n "<new>" | sha256sum` on a POSIX shell.
- Once unlocked, a session token is stored in `localStorage` (`slc_gate_token`) so a reload skips the gate.

## Where the data lives

All data is stored in **Supabase** (free tier), read over the REST API from the browser.

- Project ref: `jilhkgicxpewdsqgxfbm` (region Asia-Pacific).
- Endpoint: `https://jilhkgicxpewdsqgxfbm.supabase.co/rest/v1/<table>`.
- Tables: `purchases`, `recipes`, `overhead`, `daily_sales`, `stocktakes`, `settings`, `pricing`. (`orders` still exists in the schema but is unused — the Ordering page is retired.)
- The Supabase URL + **publishable** (browser-safe) key live in `supabase.js`. The **secret** key is never in the repo.

### Seeding

`supabase/schema.sql` defines the tables; `supabase/seed.sql` inserts the milk + coffee example
so the math is testable. Run `schema.sql` first, then `seed.sql`, in the Supabase SQL console.

### Costing caveat — latest-cost-wins re-prices history

₱/OUM is **derived** from the newest purchase of each item, never stored per event. That means a
stock-take's *lost cost* (or a recipe cost) is valued at the **current** rate: if a later purchase of
that item had a different cost, the historical lost-cost figure shifts. If that ever matters, store
₱/OUM at time-of-record instead of deriving it.

## Security caveat (read this)

This is a **privacy model, not true authentication**:

- The Supabase **publishable key sits in static JS** and is visible to anyone who opens the page.
  Scope the Supabase read rules so the public key is **read-only**; writes go through the gated flow.
- The passphrase gate is a soft gate (client-side hash compare + `localStorage` token). It stops
  casual visitors but is not a substitute for real server-side auth.
- **Unlisted URL = the privacy model.** The page carries `noindex, nofollow` so search engines
  won't list it, and it is never linked from the FB page. Anyone with the URL can reach it.
- For real staff-only enforcement, add Supabase **RLS** (real per-user auth) — deferred here on
  the free tier by design.

## Deploying (GitHub Pages)

1. Create a GitHub repo and push this folder's contents to the `main` branch. On the free
   plan, GitHub Pages only serves from a **public** repo, so the repo is public — but the
   Pages URL is still effectively unlisted (see below).
2. Enable **GitHub Pages** from that branch. The site is served at
   `https://<user>.github.io/<repo>/`. Keep that URL unlisted: it is the only thing that
   makes the site private, so never link it from the FB page and rely on the gate + `noindex`.
3. Keep the URL unlisted: never link it from the FB page, and rely on the gate + `noindex`.

> Note: pushing requires credentials typed by the user — the assistant never handles passwords.
