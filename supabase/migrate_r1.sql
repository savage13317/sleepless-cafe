-- Sleepless Cafe - R1 schema migration (module restructure)
-- Run in the Supabase SQL console. Kept QUOTE-FREE on purpose: the Monaco
-- editor auto-closes single quotes and mangles string literals, so this file
-- avoids them entirely. Seeding VALUES (inventory_code, settings) is done
-- separately via REST PATCH (clean JSON), not here.

-- 1. purchases: stable human ID (SC0001). No CHECK here (quote-free); uniqueness
--    is enforced by the monotonic counter in the frontend.
alter table purchases add column inventory_code text;

-- 2. settings: target daily cups + monotonic ID counter (never reuses deleted numbers)
alter table settings add column target_daily_cups numeric;
alter table settings add column next_inventory_seq numeric;

-- 3. overhead: period must accept yearly|monthly|daily|cup. The live CHECK
--    (constraint name overhead_period_check, confirmed via probe HTTP 400 code 23514)
--    rejects daily/cup, so DROP it. Frontend dropdown controls the value.
--    NOTE: the console needs the ALTER TABLE keyword and DROP CONSTRAINT <name>
--    (shorthand 'alter purchases ...' and 'drop check ...' both failed live).
alter table overhead drop constraint overhead_period_check;

-- 4. NEW table: daily sales recording (module 5). jsonb with no default (quote-free);
--    the frontend always supplies lines/wastage/totals on POST.
create table daily_sales (
  id uuid default gen_random_uuid() primary key not null,
  date date default current_date,
  recorder text,
  lines jsonb,
  wastage jsonb,
  totals jsonb,
  created_at timestamptz default now()
);
