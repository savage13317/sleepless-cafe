-- Sleepless Café — Supabase schema (Phase 1)
-- Paste this whole file into the Supabase SQL console (or run via psql).
-- Postgres / Supabase compatible. Types per PLAN.md §2.

-- ============ 1. purchases ============
create table if not exists purchases (
  id          uuid        default gen_random_uuid() primary key not null,
  name        text        not null,
  brand       text        default '',
  pack_size   numeric     check (pack_size > 0),          -- e.g. 250 ml/can
  base_unit   text        not null,                        -- ml, g, piece, kg (common denominator)
  qty_packs   numeric     check (qty_packs >= 0),          -- how many packs/cans bought
  cost_price  numeric     check (cost_price >= 0),         -- what you paid (₱)
  supplier    text        default '',
  date        date        default current_date,
  low_at      numeric     default 0,                       -- low-stock threshold in BASE units
  created_at  timestamptz default now()
);

-- ============ 2. recipes ============
-- One row per (drink, size). A drink with S/M/L = 3 rows.
create table if not exists recipes (
  id           uuid        default gen_random_uuid() primary key not null,
  drink_name   text        not null,
  size         text        check (size in ('S','M','L')),
  ingredients  jsonb       default '[]',   -- [{purchase_id, qty_base}]  qty in BASE unit
  created_at   timestamptz default now()
);

-- ============ 3. overhead ============
create table if not exists overhead (
  id         uuid        default gen_random_uuid() primary key not null,
  label      text        not null,
  amount     numeric     check (amount >= 0),
  period     text        check (period in ('monthly','annual')),
  created_at timestamptz default now()
);

-- ============ 4. orders ============
create table if not exists orders (
  id             uuid        default gen_random_uuid() primary key not null,
  date           date        default current_date,
  time           time        default current_time,
  lines          jsonb       default '[]',   -- [{recipe_id, size, qty}]
  running_total  numeric     default 0,       -- ₱
  created_at     timestamptz default now()
);

-- ============ 5. stocktakes ============
create table if not exists stocktakes (
  id         uuid        default gen_random_uuid() primary key not null,
  date       date        default current_date,
  counter    text        default '',           -- who counted (initials)
  lines      jsonb       default '[]',         -- [{purchase_id, actual_base, variance, impact}]
  totals     jsonb       default '{}',         -- {lost, savings, net}
  created_at timestamptz default now()
);

-- ============ expected drinks/month (single global default) ============
-- Stored as a one-row table so the frontend can read it like any other table.
create table if not exists settings (
  id                  uuid default gen_random_uuid() primary key not null,
  drinks_per_month    numeric default 1200,
  updated_at          timestamptz default now()
);

-- ============ 6. pricing (sell price per drink/size — staff reference) ============
-- One row per (drink, size). margin = sell_price - (recipe_cost + overhead_per_cup).
create table if not exists pricing (
  id          uuid        default gen_random_uuid() primary key not null,
  drink_name  text        not null,
  size        text        check (size in ('S','M','L')),
  sell_price  numeric     check (sell_price >= 0),
  created_at  timestamptz default now()
);
