# Sleepless Café — staff reference

Private, staff-facing costing + inventory tool for **Sleepless Café** (Caloocan, PH).
Not a public site — it is an **unlisted** page for staff only. Never linked from the
Facebook page.

## What it does

Six pages, each a focused tool (see `PLAN.md` for the full spec):

1. **Purchases / materials** — qty, price, unit of measure → derived **₱ per base unit** and **on hand**.
2. **Recipes** — drink · size · ingredients → one-cup cost (free to create, never changes stock).
3. **Overhead** — indirect costs → **₱ per cup**.
4. **Selling price** — menu + margin per drink/size (staff reference; costs are hidden from customers).
5. **Ordering** — daily ticket; selling a cup **draws down** stock; over-sells are blocked + flagged.
6. **Stock-take** — reconcile recorded vs actual → **lost cost / unrecorded savings**.

Plus a **Dashboard** with summary cards: stock value ₱ · low-stock count · quotes this month.

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
- Tables: `purchases`, `recipes`, `overhead`, `orders`, `stocktakes`, `settings`, `pricing`.
- The Supabase URL + **publishable** (browser-safe) key live in `supabase.js`. The **secret** key is never in the repo.

### Seeding

`supabase/schema.sql` defines the tables; `supabase/seed.sql` inserts the milk + coffee example
so the math is testable. Run `schema.sql` first, then `seed.sql`, in the Supabase SQL console.

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
