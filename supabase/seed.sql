-- Sleepless Café — seed data (Phase 1)
-- Run AFTER schema.sql. Makes the milk + coffee example testable in P3-P8.

-- Milk: two brands, different pack sizes -> base unit reconciles both.
--   4 cans x 250 ml = 1,000 ml, ₱45 -> ₱0.045/ml
--   3 cans x 350 ml = 1,050 ml, ₱40 -> ₱0.038/ml
insert into purchases (name, brand, pack_size, base_unit, qty_packs, cost_price, supplier, low_at)
  values ('Milk', 'Brand A', 250, 'ml', 4, 45, '', 500);
insert into purchases (name, brand, pack_size, base_unit, qty_packs, cost_price, supplier, low_at)
  values ('Milk', 'Brand B', 350, 'ml', 3, 40, '', 500);

-- Coffee: 100 packs x 18 g = 1,800 g, ₱900 -> ₱0.50/g (for the 18 g recipe test)
insert into purchases (name, brand, pack_size, base_unit, qty_packs, cost_price, supplier, low_at)
  values ('Coffee', 'House', 18, 'g', 100, 900, '', 200);

-- Overhead example (monthly)
insert into overhead (label, amount, period)
  values ('Rent', 18000, 'monthly');
insert into overhead (label, amount, period)
  values ('Staff salary', 24000, 'monthly');
insert into overhead (label, amount, period)
  values ('Utilities', 3000, 'monthly');

-- settings: expected drinks/month
insert into settings (drinks_per_month) values (1200);
