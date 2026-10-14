# Sleepless Café — Costing & Inventory Site

**Final Plan** · Caloocan, PH · ₱ PHP · staff-only

Stack: **GitHub Pages** (static frontend) + **Supabase free tier** (data store).
Privacy: GitHub Pages URL stays **unlisted** (never linked from the FB page) + a **passphrase gate**. Real auth = Supabase.

---

## 1. What the site does

A staff-facing tool that turns raw purchases into a checked, auditable costing record for the café. Flow: **cost up → price down → sell → reconcile**.

| # | Module | Role |
|---|---|---|
| 0 | Gate | passphrase → session token |
| 1 | Purchases | buy stock, set ₱/base-unit, low-stock flag, restock. One row per item; newest purchase sets current ₱/OUM (latest-cost-wins) |
| 2 | Overhead | rent / depreciation / salary / utilities → **₱ per cup** (yearly/monthly/daily/per-cup normalised) |
| 3 | Recipes | drink = ingredients, S/M/L, cost auto-computed from current ₱/OUM — **free, no draw-down** |
| 4 | Selling price | sell price per drink/size, margin — **staff-only reference** |
| 5 | Daily Sales | record a day: cups sold per recipe + wastage lines in OUM → revenue/COGS/net; **draws down stock**, oversell flagged not blocked |
| 6 | Inventory | reconcile recorded vs actual → **lost cost / savings / net**; draw-down log + history |

> **Ordering page retired** — replaced by Module 5 (Daily Sales) + Module 6 (Inventory). The `orders` table is no longer read.

All modules sit behind the gate. No public menu; prices are a staff reference during client interaction.

---

## 2. Data model (Supabase — 5 tables)

### `purchases`
| field | note |
|---|---|
| name | ingredient name |
| brand | different brands have different pack sizes |
| pack_size | e.g. 250 ml/can, 350 ml/can |
| base_unit | ml, g, piece, kg — the common denominator |
| qty_packs | how many packs/cans bought |
| cost_price | what you paid (₱) |
| supplier | |
| date | date bought |
| low_at | low-stock threshold in base units |

### `recipes`
| field | note |
|---|---|
| drink_name | |
| size | S / M / L |
| ingredients | `[{purchase_id, qty_base}]` — qty in base unit, unit inherited from the purchase row |

### `overhead`
| field | note |
|---|---|
| label | rent, depreciation, salary, utilities… |
| amount | ₱ |
| period | monthly / annual |

### `daily_sales`
| field | note |
|---|---|
| date, recorder | who recorded the day |
| lines | `[{recipe_id, size, qty}]` — cups sold per recipe |
| wastage | `[{inventory_code, qty_oum, reason}]` — spilled/wasted in OUM |
| totals | revenue, cogs, gross, wastage, wastage_pct, net |

### `stocktakes`
| field | note |
|---|---|
| date, counter | who counted |
| lines | `[{purchase_id, actual_base, variance, impact}]` |
| totals | lost cost, savings, net |

### Derived (never stored)
```
price_per_base = cost_price / (qty_packs × pack_size)
on_hand_base   = Σ(qty_packs × pack_size) − Σ(sold_base)
variance       = actual_base − on_hand_base
impact         = |variance| × price_per_base   (− = lost, + = savings)
recipe_cost    = Σ(ingredient qty_base × price_per_base)
overhead_per_cup = Σ(monthly overhead) / drinks_per_month
margin         = sell_price − (recipe_cost + overhead_per_cup)
```

---

## 3. Why base unit

You buy the **same ingredient from different brands at different pack sizes** (250 ml can vs 350 ml can). The base unit is the common denominator, so everything reconciles regardless of brand.

```
on_hand (base) = cans × pack_size
```

Example — milk:
- 4 cans × 250 ml = **1,000 ml** on hand, ₱45 → **₱0.045/ml**
- 3 cans × 350 ml = **1,050 ml** on hand, ₱40 → **₱0.038/ml**
- Stock-take counts **ml**, not cans. A recipe uses **ml**. Everything reconciles on the base unit.

---

## 4. The cost-up → price-down chain

```mermaid
graph LR
    A["purchases\nbrand × pack_size"] -->|convert| H["on_hand (base unit)"]
    B["daily_sales\nsold + wastage (OUM)"] -->|decrement| H
    H --> I["inventory\nactual − recorded\n= lost / savings"]
    C["recipes\nfree, cost only"] --> D["sell price\nmargin"]
    E["overhead ÷ drinks/mo"] --> D
```

---

## 5. Page-by-page behavior

**1. Purchases** — add row: name, brand, pack size, base unit, qty packs, price paid, supplier, date. Site shows `₱/base` and a **Low** badge when `on_hand < low_at`. A **Restock** action adds qty without changing the recorded price. One row per item; the newest purchase sets the current **₱/OUM** (latest-cost-wins); purchase rows are kept as an audit record.

**2. Overhead** — list of yearly/monthly/daily/per-cup totals (rent, depreciation, staff salary, utilities). One input: **target daily cups**. Site normalises every figure to a common **₱ per cup** (1 year = 365 days = 12 months; monthly→daily uses 365/12 ≈ 30.4167 days). This feeds Module 4.

**3. Recipes** — pick a drink, set S/M/L ingredient amounts (each amount references an inventory item, so its unit is inherited). Cost per size = Σ (amount × current ₱/OUM). Card shows `Name · Size · Ingredients · Cost ₱`. **Creating a recipe is free — it never reduces stock.** It only computes the cost of one cup.

**4. Selling price** — set sell price per drink per size. `margin = sell − (recipe_cost + overhead_per_cup)`. Staff-only view shows cost + margin; prices are a reference you consult when talking to clients.

**5. Daily Sales** — record a day. Each sale line = recipe + size + cups; each wastage line = inventory item + qty in OUM + reason. On submit, **draw down stock** for every ingredient (and subtract wastage directly). Revenue = Σ cups × sell; COGS = Σ cups × recipe cost; net = revenue − COGS − wastage cost. Oversell is **flagged, never blocked** — a stock-take reconciles later. A spilled cup = ONE wastage line in OUM, never also a sale line.

**6. Inventory** — physical count reconciles record vs actual. Enter `actual_oum` per item. Site computes variance and cost impact:

| variance | meaning | impact |
|---|---|---|
| negative | record > reality — waste, spoilage, theft, unlogged use | **lost cost** = |variance| × ₱/OUM |
| positive | reality > record — stock exists, never purchased | **unrecorded gain / savings** = variance × ₱/OUM |

The reconcile **sets `remaining = actual_count`** (single source of truth). Footer summary: **Total lost ₱ · Total savings ₱ · Net ₱**. Includes a draw-down log (latest sales day) and a history list merging stock-takes + daily-sales records.

---

## 6. Confirmed decisions

- Costing = BOTH recipe costing and order quoting.
- Access = staff only, private, unlisted URL + passphrase gate.
- Stack = GitHub Pages + Supabase free tier.
- Currency = ₱ PHP. Two prices per item: cost price + selling price (margin visible).
- Theme = dark espresso/charcoal, cream text, amber accent for peso figures.
- Units = free text at purchase level; recipes inherit the unit from the purchase row (never re-typed).
- Draw-down = ONLY on sell (page 5). Recipes are free, no draw-down.
- Overhead → per-cup conversion = yes, via expected drinks/month.
- Sizes = S / M / L, ingredient amounts per size.
- Menu/prices = hidden, staff-only. No public menu page.
- Stock-take unit = BASE unit (ml/g/piece). Reason: different brands have different pack sizes per can.
- Expected drinks/month = global default + optional per-drink override for top sellers.

---

## 7. Build order

1. GitHub Pages static frontend skeleton (dark espresso theme, 6 pages, passphrase gate).
2. Supabase project + the 5 tables, free tier.
3. Wire in this order: page 1 (purchases + ₱/base) → page 6 (stock-take reconcile) → page 2 (recipe cost) → page 3 (overhead/cup) → page 4 (margin) → page 5 (orders + draw-down).
