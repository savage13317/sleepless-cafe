# Sleepless Café — staff reference

Private, staff-facing costing + inventory tool for **Sleepless Café** (Caloocan, PH).
Not a public site — it is an **unlisted** page for staff only. Never linked from the
Facebook page.

## Two pages (R53)

- **`index.html` — the site root.** The SOP manual / staff portal: overview, roles, checklists,
  recipes, maintenance and cash handling, with its own print/export styles. This is the landing page.
- **`staff.html`** — the costing + inventory tool described below (the six modules). Reached from the
  manual's nav bar through the **Staff Reference · Costing Portal** button; every module screen has a
  **← Landing page** button back to the manual.

The passphrase gate belongs to the tool. Unlocking once covers both pages — the token is stored in
`localStorage`, which is origin-wide, so opening the manual first and clicking through needs no
second passphrase. The manual pulls Tailwind, Font Awesome and Google Fonts from CDNs; offline or
CDN-blocked it degrades to unstyled text, while the tool has no such dependency.

## What it does

Six modules, each a focused tool (see `PLAN.md` for the full spec). Modules are separate
pages; sections stack inside each page and the nav bar moves back-and-forth between them:

1. **Purchases** — item/ingredient · unit of measure · measure per pack · packs · cost per pack → derived **total UOM**, **total price**, and **₱ per base unit** + **on hand**. One row per item; the newest purchase sets the current **₱/OUM** (latest-cost-wins). Purchase rows are kept as an audit record.
2. **Overhead** — indirect costs → **₱ per cup** (yearly/monthly/daily/per-cup inputs normalised to a common per-cup figure).
3. **Recipes** — drink · size · ingredients → one-cup cost, computed live from each item's current **₱/OUM** (free to create, never changes stock).
4. **Selling price** — menu + margin per drink/size (staff reference; costs are hidden from customers). Margin = sell − (recipe cost + overhead/cup).
5. **Daily Sales** — record a day: cups sold per recipe + wastage lines in OUM → revenue, COGS, wastage %, net. Selling a cup **draws down** stock; over-sells are flagged, never blocked (a stock-take reconciles later).
6. **Inventory** — take stock: type the shelf count against each item (one record per stock-take date, editable and deletable) → reconcile record vs latest count → **lost cost / unrecorded savings** and net; draw-down log + stock-take history.

> The old **Ordering** page is retired — it is replaced by Module 5 (Daily Sales) + Module 6 (Inventory). The `orders` table is no longer read by any page.

Plus a **Dashboard** with summary cards: stock value ₱ · low-stock count · sales recorded this month.

## Current build status

Latest code commit (2026-10-18): **9fb502a** (R53 — site restructured to two pages: `index.html` is now
the SOP manual landing page and the costing tool shell moved to `staff.html`; the manual gained a portal
button into `staff.html`, the tool gained a `home-btn` back to the manual, and the manual's stray LaTeX
fragments were cleaned). Earlier checkpoints: **433c59a** (R52 — Recipes
sorted A–Z then S/M/L; Daily Sales Year/Month filters, five-row scroll window, period summary card,
Revenue / Net Income headers), **8592e0e** (R46–R50 — Inventory stock-take ledger), **67e6ebe** (R45
— selling-price table sorted A-Z then S/M/L) and **a3962d4** (R38b, best-verified UX). Modules 1–5 (Purchases,
Overhead, Recipes, Selling price, Daily Sales)
are complete and verified to a consistent UX bar — two-column forms, live suggestion/preview boxes,
dropdowns of existing data, per-row Edit, fresh overhead-per-cup math, no stale globals. Module 6
(Inventory) code is committed and QA-gated, but has not yet been walked through in a browser —
verify it before treating it as shipped. See `REV_PLAN.md` for the full revision log (R0–R53).

## Running it locally

Open the folder and serve it:

```
python -m http.server 8731 --directory "c:\Users\USER\Desktop\Sleepless Cafe"
```

Then open <http://localhost:8731/> in a browser — that is the SOP manual (landing page). The costing
tool sits at <http://localhost:8731/staff.html>; the manual's nav bar links straight to it. Enter the
passphrase once to unlock.

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
