// app.js — Sleepless Café frontend (Phase 2)
// Gate + shared nav + 6 page shells + dashboard shell.
// Pages are intentionally empty here; each later phase fills one in.

// ---- pages (order = PLAN.md build order) ----
const PAGES = [
  { id: 'purchases',  title: 'Purchases',   sub: 'Materials, price, unit of measure → ₱ per base unit' },
  { id: 'overhead',   title: 'Overhead',    sub: 'Indirect costs → ₱ per cup' },
  { id: 'recipes',    title: 'Recipes',     sub: 'Drink = ingredient combo → one-cup cost' },
  { id: 'pricing',    title: 'Selling price', sub: 'Menu + margin per drink/size (staff reference)' },
  { id: 'daily-sales', title: 'Daily Sales', sub: 'End-of-day sales + wastage → revenue, COGS, net' },
  { id: 'inventory',  title: 'Inventory',   sub: 'Remaining stock · reconcile · draw-down · history' },
];

// ---- gate ----
// We store only the SHA-256 of the passphrase, never the passphrase itself.
// Default passphrase is "sleepless" — change it by editing GATE_HASH below
// (regenerate with: echo -n "<new>" | sha256sum, or the PowerShell one-liner).
const GATE_HASH = 'd8ad80d6ea244e0a2d7686e75c276de7f7fdce8a3b5a0c1a7b1dfa25b48c4a0a';
const TOKEN_KEY = 'slc_gate_token';

async function sha256(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

function alreadyUnlocked() {
  return localStorage.getItem(TOKEN_KEY) === GATE_HASH;
}

async function unlock(pass) {
  const hash = await sha256(pass || '');
  if (hash === GATE_HASH) {
    localStorage.setItem(TOKEN_KEY, GATE_HASH);
    return true;
  }
  return false;
}

// ---- rendering ----
function renderGate() {
  const el = document.getElementById('stage');
  const gate = document.createElement('div');
  gate.className = 'gate';
  const h = document.createElement('h1');
  h.innerHTML = 'Sleepless Café <span class="mark">·</span> staff only';
  const inp = document.createElement('input');
  inp.className = 'lock'; inp.type = 'text'; inp.placeholder = 'passphrase';
  const btn = document.createElement('button');
  btn.className = 'lock-btn'; btn.textContent = 'Unlock';
  const err = document.createElement('div');
  err.className = 'err'; err.style.display = 'none';
  gate.append(h, inp, btn, err);
  el.innerHTML = '';
  el.appendChild(gate);

  btn.addEventListener('click', () => {
    const pass = inp.value;
    unlockAsync(pass, gate, err);
  });
}

async function unlockAsync(pass, gate, err) {
  if (await unlock(pass)) {
    localStorage.setItem(TOKEN_KEY, GATE_HASH);
    buildSite();
  } else {
    err.textContent = 'Wrong passphrase.';
    err.style.display = 'block';
  }
}

// ---- number formatting ----
// peso(): 2 decimals + thousands separators (₱1,234.56). Negatives keep the
// sign inside (₱-50.00), matching how callers prefix their own sign elsewhere.
function peso(n) {
  const v = Number(n);
  const s = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '₱' + s;
}
function rate(n) {
  let s = Number(n).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  const dec = (s.split('.')[1] || '').length;
  if (dec < 2) s = Number(n).toFixed(2);
  return '₱' + s;
}
// on_hand = Σ(qty_packs × pack_size) − Σ(sold_base). The sold term is 0 until
// Phase 8 (orders). Callers pass the sold base-units for that purchase row.
function onHand(r, sold = 0) { return Number(r.qty_packs) * Number(r.pack_size) - Number(sold); }
function pricePerBase(r) { return Number(r.cost_price) / (Number(r.qty_packs) * Number(r.pack_size)); }

// Total OUM consumed per INVENTORY CODE, read from daily_sales (R8/R10: the
// `orders` page is retired). Both sold lines (expanded through the recipe's
// ingredients) AND wastage lines (direct OUM) decrement stock — wastage is a
// pure cost event that consumes stock and generates no revenue. Keyed by
// inventory_code so a recipe follows the item across restocks.
async function soldByPurchase() {
  let sales = [];
  let recipes = [];
  try {
    sales = await getData('daily_sales', 'order=created_at.desc&select=*');
    recipes = await getData('recipes', 'order=created_at.desc&select=*');
  } catch (e) { return {}; }
  const recById = {};
  for (const rc of recipes) recById[String(rc.id)] = rc;
  const sold = {};
  for (const ds of sales) {
    const lines = Array.isArray(ds.lines) ? ds.lines : [];
    for (const ln of lines) {
      if (!ln) continue;
      const rc = recById[String(ln.recipe_id)];
      if (!rc) continue;
      const qty = Number(ln.qty) || 0;
      const ings = Array.isArray(rc.ingredients) ? rc.ingredients : [];
      for (const ing of ings) {
        if (!ing) continue;
        const code = String(ing.inventory_code || '').trim().toUpperCase();
        if (!code) continue;
        sold[code] = (sold[code] || 0) + Number(ing.qty_oum) * qty;
      }
    }
    const wast = Array.isArray(ds.wastage) ? ds.wastage : [];
    for (const w of wast) {
      if (!w) continue;
      const code = String(w.inventory_code || '').trim().toUpperCase();
      if (!code) continue;
      sold[code] = (sold[code] || 0) + (Number(w.qty_oum) || 0);
    }
  }
  return sold;
}

// Current ₱/OUM rate per inventory_code (latest-cost-wins), from inventoryRows().
// Shared by Recipes (R6) and Pricing (R7) so a recipe follows the item across restocks.
async function itemRateByCode() {
  const map = {};
  for (const it of await inventoryRows()) map[it.code] = it.rate;
  return map;
}

// ---- R2: inventory ID scheme (SC0001 monotonic counter) ----
// settings.next_inventory_seq is the single source of truth. NEVER scan for the
// lowest free number — deleted codes are never reused. If the counter is missing
// or null, fall back to max(existing codes) + 1 so the scheme self-heals.
async function nextInventoryCode() {
  let settings = [];
  let purchases = [];
  try {
    settings = await getData('settings', 'select=*');
    purchases = await getData('purchases', 'select=inventory_code');
  } catch (e) { /* fall through to defaults */ }
  const row = settings[0];
  let seq = row && row.next_inventory_seq != null ? Number(row.next_inventory_seq) : null;
  if (!Number.isFinite(seq) || seq < 1) {
    let max = 0;
    for (const p of purchases) {
      const m = /^SC(\d+)$/i.exec(String(p.inventory_code || '').trim());
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    seq = max + 1;
  }
  const code = 'SC' + String(seq).padStart(4, '0');
  return { code, seq, settingsId: row ? String(row.id) : null };
}

// ---- R3/R9: inventory aggregation — ONE row per inventory_code ----
// Single source of truth shared by M1 §3 and M6 §1 (never two implementations).
// Group purchase rows by inventory_code. The NEWEST purchase of an item sets the
// ₱/OUM rate and the low threshold (latest-cost-wins); remaining OUM sums EVERY
// row of that item minus sold. Rows with no inventory_code are not in the model.
async function inventoryRows() {
  let purchases = [];
  let sold = {};
  let stocktakes = [];
  try {
    purchases = await getData('purchases', 'order=created_at.asc&select=*');
    sold = await soldByPurchase();
    stocktakes = await getData('stocktakes', 'order=created_at.desc&select=*');
  } catch (e) { return []; }
  // R9: latest physical count per inventory_code (newest stocktake wins). A saved
  // reconcile SETS remaining = actual — the physical count corrects the record.
  const latestActual = {};
  for (const st of stocktakes) {
    if (!Array.isArray(st.lines)) continue;
    for (const ln of st.lines) {
      if (!ln) continue;
      const c = String(ln.inventory_code || '').trim().toUpperCase();
      if (c && latestActual[c] == null) latestActual[c] = Number(ln.actual_oum);
    }
  }
  const byCode = {};
  for (const r of purchases) {
    const code = String(r.inventory_code || '').trim().toUpperCase();
    if (!code) continue;
    const g = byCode[code] || (byCode[code] = { code, rows: [] });
    g.rows.push(r);
  }
  const items = [];
  for (const code in byCode) {
    const g = byCode[code];
    let newest = g.rows[0];
    for (const r of g.rows) {
      if (String(r.created_at || '') > String(newest.created_at || '')) newest = r;
    }
    let totalOum = 0;
    for (const r of g.rows) {
      totalOum += Number(r.qty_packs) * Number(r.pack_size);
    }
    const soldForItem = Number(sold[code] || 0); // sold map is keyed by inventory_code (R6)
    const recorded = totalOum - soldForItem;
    const actual = latestActual[code];
    const remaining = (actual != null) ? actual : recorded; // reconcile sets remaining = actual
    const rate = pricePerBase(newest); // latest purchase wins
    const lowAt = Number(newest.low_at);
    items.push({
      code, name: newest.name, base_unit: newest.base_unit,
      totalOum, recorded, actual, remaining, rate, lowAt, low: remaining < lowAt,
      newest, rowCount: g.rows.length,
    });
  }
  items.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return items;
}

// Render the aggregated inventory table (shared: M1 §3 compact + M6 §1 full).
function inventoryTable(items, title = 'Inventory') {
  const table = document.createElement('table');
  if (title) {
    const cap = document.createElement('caption');
    cap.className = 'tbl-caption';
    cap.textContent = title;
    table.appendChild(cap);
  }
  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  ['Inventory ID', 'Item', 'UOM', 'Remaining', '₱ / OUM', 'Stock value ₱', 'Low?'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; hrow.appendChild(th);
  });
  const theadEl = thead; theadEl.appendChild(hrow);
  const tbody = document.createElement('tbody');
  for (const it of items) {
    const stockVal = it.remaining * it.rate;
    const tr = document.createElement('tr');
    const cells = [it.code, it.name, it.base_unit, `${it.remaining} ${it.base_unit}`, rate(it.rate), peso(stockVal), it.low ? 'LOW' : ''];
    cells.forEach((val, i) => {
      const td = document.createElement('td');
      if (i === 4 || i === 5) td.className = 'peso';
      if (i === 6 && it.low) { td.className = 'neg'; td.textContent = 'LOW'; }
      else td.textContent = String(val);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.append(theadEl, tbody);
  return table;
}

// ---- R13: one view per module (no continuous scroll) ----
// The user wants a page/tab per module: only the selected module's section is in
// the DOM at a time. The nav bar switches views — clicking a nav link clears
// `main`, renders just that module, and marks the nav link active. Data is
// re-fetched on each switch, so views always show live Supabase state.
async function buildSite() {
  const stage = document.getElementById('stage');

  const header = document.createElement('header');
  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.innerHTML = 'Sleepless Café <span class="mark">·</span> staff reference';
  const nav = document.createElement('nav');
  const dash = document.createElement('a');
  dash.href = '#dashboard'; dash.textContent = 'Dashboard';
  nav.appendChild(dash);
  PAGES.forEach(p => {
    const a = document.createElement('a');
    a.href = `#${p.id}`; a.textContent = p.title;
    nav.appendChild(a);
  });
  header.append(brand, nav);

  const main = document.createElement('main');
  stage.innerHTML = '';
  stage.append(header, main);

  // intercept nav clicks: switch the view instead of scrolling within one page
  nav.addEventListener('click', (ev) => {
    const a = ev.target.closest('a');
    if (!a) return;
    ev.preventDefault();
    const id = a.getAttribute('href').slice(1);
    showModule(id, main, nav, a);
  });

  // R17: after an add/edit the page reloads — restore the SAME module the user
  // was on (stored in sessionStorage) instead of always returning to Dashboard.
  const startId = sessionStorage.getItem('slc_view') || 'dashboard';
  let startA = dash;
  if (startId !== 'dashboard') {
    for (const a of nav.querySelectorAll('a')) {
      if (a.getAttribute('href').slice(1) === startId) { startA = a; break; }
    }
  }
  await showModule(startId, main, nav, startA);
}

async function showModule(id, main, nav, activeA) {
  // R17: remember which module is active so a reload (after add/edit) returns
  // here instead of always snapping back to the Dashboard.
  sessionStorage.setItem('slc_view', id);
  let sec = null;
  try {
    if (id === 'dashboard') sec = await renderDashboard();
    else if (id === 'purchases') sec = await renderPurchases();
    else if (id === 'inventory') sec = await renderInventory();
    else if (id === 'recipes') sec = await renderRecipes();
    else if (id === 'overhead') sec = await renderOverhead();
    else if (id === 'pricing') sec = await renderPricing();
    else if (id === 'daily-sales') sec = await renderDailySales();
    else {
      const p = PAGES.find(x => x.id === id);
      if (p) sec = section(p.id, p.title, p.sub);
    }
  } catch (e) { /* keep the previous view if a switch fails */ }
  if (!sec) return;

  main.innerHTML = '';
  main.appendChild(sec);

  // mark the active nav link (styles.css highlights [data-active])
  for (const a of nav.querySelectorAll('a')) {
    if (a === activeA) a.setAttribute('data-active', '1');
    else a.removeAttribute('data-active');
  }

  // Phase 9: wrap every table in a horizontal-scroll container so wide tables
  // stay readable on narrow (mobile) viewports instead of squishing.
  for (const tbl of Array.from(main.querySelectorAll('table'))) {
    const parent = tbl.parentNode;
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.appendChild(tbl);
    parent.appendChild(wrap);
  }
}

function section(id, title, sub) {
  const sec = document.createElement('section');
  sec.id = id;
  const t = document.createElement('div'); t.className = 'page-title'; t.textContent = title;
  const s = document.createElement('div'); s.className = 'page-sub'; s.textContent = sub;
  const note = document.createElement('div'); note.className = 'empty-note';
  note.textContent = '(empty shell — this page is built in a later phase)';
  sec.append(t, s, note);
  return sec;
}

// ---- Phase 9: Dashboard summary cards ----
// A small print button appended to a section; triggers the browser print
// dialog (used for stock-take sheets and order tickets).
function addPrintButton(sec, label = 'Print this page') {
  const btn = document.createElement('button');
  btn.className = 'btn-print';
  btn.textContent = label;
  btn.addEventListener('click', () => window.print());
  sec.appendChild(btn);
  return btn;
}

// A small "delete by id" card appended to a page: paste an entry's id (the
// short id shown on its row/card is enough — it matches by prefix) and the
// matching row is removed from the table. Reloads so the page reflects it.
function addDeleteCard(sec, rows, table, idPlaceholder) {
  const card = document.createElement('div');
  card.className = 'card';
  const head = document.createElement('div');
  head.textContent = 'Delete an entry';
  const idInp = document.createElement('input');
  idInp.className = 'field';
  idInp.setAttribute('placeholder', idPlaceholder);
  idInp.setAttribute('aria-label', idPlaceholder);
  const delBtn = document.createElement('button');
  delBtn.className = 'btn-delete';
  delBtn.textContent = 'Delete';
  card.append(head, idInp, delBtn);
  sec.appendChild(card);

  delBtn.addEventListener('click', () => {
    const idKey = idInp.value.trim();
    if (!idKey) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'Paste the id of the entry to delete.';
      card.appendChild(w); return;
    }
    const row = rows.find(r => String(r.id) === idKey || String(r.id).startsWith(idKey));
    if (!row) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'No such entry — copy the id from one of the rows above.';
      card.appendChild(w); return;
    }
    deleteData(table, `id=eq.${encodeURIComponent(row.id)}`).then(() => location.reload());
  });
}

// stock value ₱ = Σ(on_hand × price_per_base) across purchases (draw-down
// adjusted). low-stock count = purchases where on_hand < low_at. quotes this
// month = number of orders whose date falls in the current month.
async function renderDashboard() {
  const sec = document.createElement('section');
  sec.id = 'dashboard';
  const t = document.createElement('div'); t.className = 'page-title'; t.textContent = 'Dashboard';
  const s = document.createElement('div'); s.className = 'page-sub';
  s.textContent = 'Summary cards — live stock, low-stock alerts, sales recorded this month';
  sec.append(t, s);

  let invItems = [];
  let sales = [];
  try {
    invItems = await inventoryRows();
    sales = await getData('daily_sales', 'order=created_at.desc&select=*');
  } catch (e) {
    const err = document.createElement('div'); err.className = 'empty-note';
    err.textContent = 'Could not load dashboard data: ' + e.message;
    sec.appendChild(err);
    return sec;
  }

  // stock value + low-stock count from the SHARED aggregation (single source of truth)
  let stockValue = 0;
  let lowCount = 0;
  for (const it of invItems) {
    stockValue += it.remaining * it.rate;
    if (it.low) lowCount++;
  }

  // sales recorded this month = daily_sales dated in the current YYYY-MM
  const ym = new Date().toISOString().slice(0, 7);
  let salesThisMonth = 0;
  for (const ds of sales) {
    if ((ds.date || '').slice(0, 7) === ym) salesThisMonth++;
  }

  const mkCard = (label, value, cls) => {
    const card = document.createElement('div');
    card.className = 'card';
    const head = document.createElement('div');
    head.textContent = label;
    const val = document.createElement('div');
    val.className = cls;
    val.textContent = value;
    card.append(head, val);
    return card;
  };

  sec.appendChild(mkCard('Stock value', peso(Math.round(stockValue * 100) / 100), 'peso'));
  sec.appendChild(mkCard('Low-stock items', String(lowCount), lowCount > 0 ? 'neg' : 'num'));
  sec.appendChild(mkCard('Sales recorded this month', String(salesThisMonth), 'num'));

  return sec;
}

// ---- entry ----
window.addEventListener('DOMContentLoaded', async () => {
  if (alreadyUnlocked()) await buildSite();
  else renderGate();
});

// ---- Phase 3: Purchases page ----
async function renderPurchases() {
  const sec = document.createElement('section');
  sec.id = 'purchases';
  const t = document.createElement('div'); t.className = 'page-title'; t.textContent = 'Purchases';
  const s = document.createElement('div'); s.className = 'page-sub';
  s.textContent = 'Item · unit of measure · measure/pack · packs · cost/pack → total UOM, total price, ₱ per base unit';
  sec.append(t, s);

  let rows = [];
  let sold = {};
  try {
    rows = await getData('purchases', 'order=created_at.desc&select=*');
    sold = await soldByPurchase();
  } catch (e) {
    const err = document.createElement('div'); err.className = 'empty-note';
    err.textContent = 'Could not load purchases: ' + e.message;
    sec.appendChild(err);
    return sec;
  }

  // §1 R4: stock value + low stock — computed from the AGGREGATED inventory
  // (one row per item, latest-cost-wins rate), not from raw purchase rows.
  const invItems = await inventoryRows();
  let stockValue = 0;
  const lowItems = [];
  for (const it of invItems) {
    stockValue += it.remaining * it.rate;
    if (it.low) lowItems.push(it);
  }

  const svCard = document.createElement('div');
  svCard.className = 'card';
  const svHead = document.createElement('div');
  svHead.textContent = 'Stock value';
  const svVal = document.createElement('div');
  svVal.className = 'peso';
  svVal.textContent = peso(Math.round(stockValue * 100) / 100);
  svCard.append(svHead, svVal);
  sec.appendChild(svCard);

  const lowCard = document.createElement('div');
  lowCard.className = 'card';
  const lowHead = document.createElement('div');
  lowHead.textContent = 'Low stock';
  lowCard.appendChild(lowHead);
  if (lowItems.length) {
    for (const it of lowItems) {
      const line = document.createElement('div');
      line.className = 'neg';
      const shortfall = it.lowAt - it.remaining;
      line.textContent = `${it.code} ${it.name} — short ${shortfall} ${it.base_unit}`;
      lowCard.appendChild(line);
    }
  } else {
    const none = document.createElement('div');
    none.className = 'num';
    none.textContent = '0';
    lowCard.appendChild(none);
  }
  sec.appendChild(lowCard);

  // audit table — every purchase, newest first. Title + date column; the
  // container shows ~5 recent rows and scrolls vertically for older history.
  let editingRowId = null;
  let editingRow = null; // the row the Edit button opened, for name/code re-checks
  // R20: per-row delete with a two-step confirm (first click arms the prompt,
  // second click on the SAME row's button deletes only that purchase line).
  let pendingDelRowId = null;
  let armedDelBtn = null;
  const delConfirm = document.createElement('div');
  delConfirm.className = 'del-confirm';
  const table = document.createElement('table');
  const cap = document.createElement('caption');
  cap.className = 'tbl-caption';
  cap.textContent = 'Purchase history — most recent first (scroll for older)';
  table.appendChild(cap);
  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  ['Date', 'Inv ID', 'Item / Ingredient', 'Unit', 'Total UOM', '₱ / pack', 'Total price', '₱ / base', 'On hand', 'Edit', 'Delete'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; hrow.appendChild(th);
  });
  thead.appendChild(hrow);
  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const oh = onHand(r, sold[String(r.id)] || 0);
    const low = oh < Number(r.low_at);
    const packs = Number(r.qty_packs);
    const perPack = packs > 0 ? Number(r.cost_price) / packs : Number(r.cost_price);
    const totalUom = packs * Number(r.pack_size);
    const dateStr = r.date || (r.created_at ? String(r.created_at).slice(0, 10) : '—');
    const tr = document.createElement('tr');
    const cells = [
      dateStr, r.inventory_code || '—', r.name, r.base_unit,
      `${totalUom} ${r.base_unit}`, peso(perPack), peso(r.cost_price), rate(pricePerBase(r)),
      `${oh} ${r.base_unit}`,
    ];
    cells.forEach((val, i) => {
      const td = document.createElement('td');
      if (i === 5 || i === 6 || i === 7) td.className = 'peso';
      td.textContent = String(val);
      tr.appendChild(td);
    });
    // Edit button per row: re-opens this purchase in the form so it can be
    // corrected. The original purchase date is preserved (never bumped to today).
    const editTd = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-edit';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      editingRowId = String(r.id);
      editingRow = r;
      inputs.inventory_code.value = r.inventory_code || '';
      inputs.name.value = r.name || '';
      inputs.base_unit.value = r.base_unit || '';
      inputs.pack_size.value = String(r.pack_size);
      inputs.qty_packs.value = String(r.qty_packs);
      inputs.cost_per_pack.value = String(r.qty_packs ? Number(r.cost_price) / Number(r.qty_packs) : Number(r.cost_price));
      inputs.low_at.value = String(r.low_at);
      // R19b: the box starts with this row's code, but treat it as an auto-fill so
      // the live suggestion can correct it when the name is edited.
      autoFilledCode = String(r.inventory_code || '').trim().toUpperCase();
      updateNameSuggestion();
      updateTotal();
    });
    editTd.appendChild(editBtn);
    tr.appendChild(editTd);
    // R20: per-row Delete. First click arms a confirm prompt under the table;
    // a second click on the SAME row's button deletes ONLY that purchase line
    // (id=eq.<rowId>) — other purchases of the same item are untouched.
    const delTd = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-row-del';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      const rid = String(r.id);
      if (pendingDelRowId === rid) {
        deleteData('purchases', `id=eq.${encodeURIComponent(rid)}`).then(() => location.reload());
        return;
      }
      if (armedDelBtn && armedDelBtn !== delBtn) {
        armedDelBtn.textContent = 'Delete';
        armedDelBtn.classList.remove('armed');
      }
      pendingDelRowId = rid;
      armedDelBtn = delBtn;
      delBtn.textContent = 'Confirm?';
      delBtn.classList.add('armed');
      delConfirm.textContent = `Delete this purchase — ${dateStr} · ${r.inventory_code || '—'} ${r.name || ''} · ${totalUom} ${r.base_unit}? Click "Confirm?" on the same row again to delete just this line. Clicking another row's Delete cancels.`;
    });
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  const scrollWrap = document.createElement('div');
  scrollWrap.className = 'scroll-y';
  scrollWrap.appendChild(table);
  sec.appendChild(scrollWrap);
  sec.appendChild(delConfirm);

  // §3 R3: aggregated inventory — ONE row per inventory_code (latest cost wins).
  // The table above is the audit record (every purchase); this is the merged view.
  if (invItems.length) {
    const invWrap = document.createElement('div');
    invWrap.className = 'card';
    const invHead = document.createElement('div');
    invHead.textContent = 'Inventory (one row per item — newest purchase sets ₱/OUM)';
    invWrap.appendChild(invHead);
    sec.appendChild(invWrap);
    sec.appendChild(inventoryTable(invItems));
  }

  // add-row form
  const form = document.createElement('div');
  form.className = 'card';
  const fields = [
    ['inventory_code', 'Inventory ID (auto-filled — do not type)'],
    ['name', 'Item / Ingredient'], ['base_unit', 'Unit of measure (base unit)'],
    ['pack_size', 'Measure per pack'], ['cost_per_pack', 'Cost per pack (₱)'],
    ['qty_packs', 'Number of packs'], ['low_at', 'Low threshold'],
  ];
  const UOM_CHOICES = ['ml', 'mg', 'g', 'pc', 'kg'];
  const inputs = {};
  fields.forEach(([k, label]) => {
    // R18: show the field name as a visible label; R21b: label left, input right
    // (each pair wrapped in a flex row for a cleaner two-column presentation).
    const row = document.createElement('div');
    row.className = 'field-row';
    form.appendChild(row);
    const lab = document.createElement('div');
    lab.className = 'field-label';
    lab.textContent = label;
    row.appendChild(lab);
    if (k === 'base_unit') {
      // dropdown instead of free text
      const sel = document.createElement('select');
      sel.className = 'field'; sel.dataset.key = k;
      sel.setAttribute('aria-label', label);
      UOM_CHOICES.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u; opt.textContent = u;
        sel.appendChild(opt);
      });
      inputs[k] = sel;
      row.appendChild(sel);
      return;
    }
    const inp = document.createElement('input');
    inp.className = 'field'; inp.dataset.key = k;
    inp.setAttribute('aria-label', label);
    if (k === 'pack_size' || k === 'qty_packs' || k === 'cost_per_pack' || k === 'low_at') inp.type = 'number';
    else inp.type = 'text';
    // R25: the Inventory ID box is READ-ONLY — the app auto-fills it (exact name
    // match) or leaves it blank (= auto-assign a fresh SC code). Users cannot type
    // into it, so stray numbers like "23143" / "SC00034" can no longer corrupt data.
    if (k === 'inventory_code') inp.readonly = true;
    inputs[k] = inp;
    row.appendChild(inp);
  });

  // sleeprev §2.1/§2.2 LIVE suggestions: as you type an item name, show matching
  // inventory items. Two different match rules, deliberately:
  //  * suggPartial(typed) — PARTIAL (substring) match, used ONLY to display the
  //    suggestion line. So typing "coff" surfaces "coffee (SC0003)" as a hint.
  //  * exactName(typed)  — EXACT (case-insensitive) match, used to AUTO-FILL the
  //    Inventory ID. So "coff" is NOT auto-assigned to coffee — it stays a new
  //    item until you type the full name. "milk" still matches "Milk".
  // The ID box is auto-filled ONLY once focus moves off the name box, so it never
  // fights with active typing.
  const suggBox = document.createElement('div');
  suggBox.className = 'suggestion';
  form.appendChild(suggBox);
  const idField = inputs.inventory_code;
  let autoFilledCode = '';
  // R25b: hard-lock the ID box. The readonly attribute alone is not enough (some
  // browsers / automation still push keystrokes into it), so we also intercept the
  // 'input' event: any real keystroke into the ID box is immediately reverted to
  // whatever the app last auto-filled (or blank). Setting idField.value in JS does
  // NOT fire 'input', so applyAutoId's programmatic fill is unaffected.
  idField.addEventListener('input', () => { idField.value = autoFilledCode; });
  const suggPartial = (typed) => invItems.filter(it => it.name.toLowerCase().includes(typed));
  const exactName = (typed) => invItems.filter(it => it.name.toLowerCase() === typed);
  function updateNameSuggestion() {
    const typed = String(inputs.name.value || '').trim().toLowerCase();
    if (!typed) { suggBox.textContent = ''; return; }
    // suggestion line = PARTIAL matches (so "coff" hints "coffee (SC0003)")
    const partial = suggPartial(typed);
    suggBox.textContent = partial.length
      ? 'In inventory: ' + partial.map(it => `${it.name} (${it.code})`).join(', ')
      : 'New item — no inventory match';
    // auto-ID re-resolve uses EXACT matches only, so a partial like "coff" never
    // hijacks the ID box.
    const matches = exactName(typed);
    if (autoFilledCode && !matches.some(it => it.code === autoFilledCode)) {
      // R19b edit mode: the box holds the row's original code — when the edited
      // name now matches a different inventory item, correct the box live.
      if (editingRowId && matches.length === 1) {
        idField.value = matches[0].code; autoFilledCode = matches[0].code;
      } else { idField.value = ''; autoFilledCode = ''; }
    }
  }
  function applyAutoId() {
    const typed = String(inputs.name.value || '').trim().toLowerCase();
    if (!typed) return;
    const matches = exactName(typed); // EXACT only — "coff" must not auto-fill coffee's code
    if (matches.length !== 1) return;
    const code = matches[0].code;
    const cur = idField.value.trim().toUpperCase();
    if (cur === '' || cur === autoFilledCode) { idField.value = code; autoFilledCode = code; }
  }
  // suggestion text updates live on every keystroke of the name box
  inputs.name.addEventListener('input', updateNameSuggestion);
  updateNameSuggestion();
  // the ID box is populated only when focus moves to a downstream field
  // (Measure per pack / Cost per pack / Number of packs / Low threshold)
  ['pack_size', 'cost_per_pack', 'qty_packs', 'low_at'].forEach(k => {
    inputs[k].addEventListener('focus', applyAutoId);
  });

  // live "Total cost" box — auto-computes cost/pack x packs as you type
  const totalBox = document.createElement('div');
  totalBox.className = 'total-box';
  const totalLabel = document.createElement('span');
  totalLabel.textContent = 'Total cost: ';
  const totalVal = document.createElement('span');
  totalVal.className = 'peso';
  totalBox.append(totalLabel, totalVal);
  form.appendChild(totalBox);

  function updateTotal() {
    const cp = Number(inputs.cost_per_pack.value);
    const pk = Number(inputs.qty_packs.value);
    totalVal.textContent = (cp > 0 && pk > 0) ? peso(Math.round(cp * pk * 100) / 100) : '—';
  }
  updateTotal();
  inputs.cost_per_pack.addEventListener('input', updateTotal);
  inputs.qty_packs.addEventListener('input', updateTotal);

  const addBtn = document.createElement('button');
  addBtn.className = 'btn-add'; addBtn.textContent = 'Add purchase';
  form.appendChild(addBtn);
  sec.appendChild(form);

  addBtn.addEventListener('click', async () => {
    // R18 edit mode: an Edit button was clicked, so update THAT row in place.
    // date/created_at are intentionally left out of the PATCH -> the original
    // purchase date is preserved (no new row, no date change).
    if (editingRowId) {
      const obj = {};
      for (const [k] of fields) {
        const v = inputs[k].value.trim();
        if (v === '') continue;
        obj[k] = (k === 'pack_size' || k === 'qty_packs' || k === 'cost_per_pack' || k === 'low_at') ? Number(v) : v;
      }
      // R19: an edit must NOT blindly keep the row's old Inventory ID. If the
      // item/ingredient name was changed, re-check it against inventory: a name
      // that matches an existing item moves the row to that item's code (restock),
      // a brand-new name may need a fresh code if other purchases still use the old one.
      const orig = editingRow;
      const origCode = String(orig.inventory_code || '').trim().toUpperCase();
      const typedCode = String(inputs.inventory_code.value || '').trim().toUpperCase();
      const origName = String(orig.name || '').trim();
      const newName = String(obj.name || '').trim();
      const nameChanged = newName.toLowerCase() !== origName.toLowerCase();

      let invItems = [];
      try { invItems = await inventoryRows(); } catch (e) { invItems = [];
      }
      const byCode = {};
      for (const it of invItems) byCode[it.code] = it;

      delete obj.inventory_code;
      let targetCode = origCode;
      let note = '';
      // R26: any counter bump issued below must finish before the final reload.
      let bump = Promise.resolve();

      if (typedCode && typedCode !== origCode) {
        // The user deliberately retyped the Inventory ID -> honour that choice.
        targetCode = typedCode;
        note = byCode[targetCode]
          ? `Inventory ID set to ${targetCode} (${byCode[targetCode].name}) — this purchase now belongs to that item.`
          : `No existing item uses ${targetCode} — it will be created as a new inventory code.`;
      } else if (nameChanged && newName) {
        let matches = invItems.filter(it => it.name.toLowerCase() === newName.toLowerCase());
        if (!matches.length) matches = invItems.filter(it => it.name.toLowerCase().includes(newName.toLowerCase()));
        if (matches.length > 1) {
          const w = document.createElement('div'); w.className = 'neg';
          w.textContent = `"${newName}" matches several inventory items (${matches.map(it => `${it.name} (${it.code})`).join(', ')}). Pick one of those exact names instead, then save again.`;
          form.appendChild(w);
          return;
        }
        if (matches.length === 1) {
          const ex = matches[0];
          targetCode = ex.code;
          obj.base_unit = ex.base_unit;
          note = targetCode === origCode
            ? `Renamed within ${targetCode} — ${ex.name} (${ex.base_unit}).`
            : `Matched existing item ${ex.name} — Inventory ID moved to ${targetCode} (restock). UOM set to ${ex.base_unit}.`;
        } else {
          // New item name. Keep the code only if this row is the sole purchase of
          // that item (the whole item is being renamed); otherwise the other rows
          // still need the old code, so this edited row gets a fresh one.
          const sameCode = rows.filter((r) => String(r.inventory_code || '').trim().toUpperCase() === origCode);
          if (origCode && sameCode.length <= 1) {
            targetCode = origCode;
            note = `New item name — ${origCode} renamed to ${newName} (no other purchases use ${origCode}).`;
          } else {
            const { code, seq, settingsId } = await nextInventoryCode();
            targetCode = code;
            note = origCode
              ? `New item name — ${sameCode.length} other purchases still use ${origCode}, so this row gets a new Inventory ID ${code}.`
              : `This row had no Inventory ID — assigned new Inventory ID ${code}.`;
            bump = settingsId
              ? patchData('settings', `id=eq.${settingsId}`, { next_inventory_seq: seq + 1 })
              : postData('settings', { next_inventory_seq: seq + 1 });
          }
        }
      }

      if (!targetCode) {
        const w = document.createElement('div'); w.className = 'neg';
        w.textContent = 'This row has no Inventory ID — enter an item name so one can be auto-assigned, then save.';
        form.appendChild(w);
        return;
      }

      const packs = obj.qty_packs == null ? 1 : obj.qty_packs;
      if (obj.cost_per_pack != null) {
        obj.cost_price = Math.round(obj.cost_per_pack * packs * 100) / 100;
        delete obj.cost_per_pack;
      }
      obj.inventory_code = targetCode;
      const savedDate = orig.date || (orig.created_at ? String(orig.created_at).slice(0, 10) : '—');
      const w = document.createElement('div'); w.className = 'num';
      w.textContent = `${note ? note + ' ' : ''}Saved to the same row — purchase date ${savedDate} unchanged.`;
      form.appendChild(w);
      patchData('purchases', `id=eq.${editingRowId}`, obj).then(() => bump).then(() => location.reload());
      return;
    }
    const obj = {};
    for (const [k] of fields) {
      const v = inputs[k].value.trim();
      if (v === '') continue;
      obj[k] = (k === 'pack_size' || k === 'qty_packs' || k === 'cost_per_pack' || k === 'low_at') ? Number(v) : v;
    }
    // sleeprev §2.1/§2.2: Inventory ID box. Blank -> auto-produce the next code.
    // An entered ID that matches an existing item RESTOCKS that item: it reuses
    // the code (never bumps the counter) and auto-pulls the item name + UOM from
    // inventory. A typed item name with no ID shows a suggestion of matching items.
    let enteredCode = String(obj.inventory_code || '').trim().toUpperCase();
    delete obj.inventory_code;
    let invItems = [];
    try { invItems = await inventoryRows(); } catch (e) { invItems = []; }
    const byCode = {};
    for (const it of invItems) byCode[it.code] = it;
    // sleeprev §2.1: typing an item name with a BLANK Inventory ID auto-generates the
    // ID. If the name matches an existing item, reuse that item's code (restock);
    // otherwise the next new code is produced below.
    const typedName = String(obj.name || '').trim().toLowerCase();
    if (typedName && !enteredCode) {
      // exact (case-insensitive) match only — "coff" is a new item, not "coffee".
      const matches = invItems.filter(it => it.name.toLowerCase() === typedName);
      if (matches.length) {
        const ex = matches[0];
        enteredCode = ex.code;
        obj.base_unit = ex.base_unit; // inherit UOM from the matched inventory row
        const w = document.createElement('div'); w.className = 'num';
        w.textContent = `Matched existing item ${ex.name} — auto Inventory ID ${ex.code} (restock). Not what you meant? Enter a new ID or a new item name.`;
        form.appendChild(w);
      }
    }
    if (enteredCode && !byCode[enteredCode]) {
      const w = document.createElement('div'); w.className = 'num';
      w.textContent = `No existing item uses ${enteredCode} — it will be created as a new inventory code.`;
      form.appendChild(w);
    }
    if (enteredCode && byCode[enteredCode]) {
      const ex = byCode[enteredCode];
      if (!obj.name) obj.name = ex.name;            // auto-pull item/ingredient from inventory
      obj.base_unit = ex.base_unit;                 // inherit UOM from the inventory row
      const w = document.createElement('div'); w.className = 'num';
      w.textContent = `Restocking ${enteredCode} — ${ex.name} (${ex.base_unit}). This new purchase sets the new ₱/OUM.`;
      form.appendChild(w);
    }
    if (!obj.name || obj.pack_size == null || obj.cost_per_pack == null || !obj.base_unit) {
      const w = document.createElement('div'); w.className = 'neg'; w.textContent = 'Item, pack size, base unit and cost per pack are required.';
      form.appendChild(w); return;
    }
    // store the TOTAL price (packs x cost/pack) so existing math + seed stay intact
    const packs = obj.qty_packs == null ? 1 : obj.qty_packs;
    obj.cost_price = Math.round(obj.cost_per_pack * packs * 100) / 100;
    delete obj.cost_per_pack;
    if (enteredCode) {
      // matched -> reuse the existing code (restock); unmatched -> user-defined new code.
      // Either way the monotonic counter is NOT bumped (deleted/used numbers never reused).
      obj.inventory_code = enteredCode;
      // If a user-typed NEW code would collide with a future auto code, nudge the
      // counter past it so the auto scheme never hands out a used number.
      const m = /^SC(\d+)$/.exec(enteredCode);
      const { seq, settingsId } = await nextInventoryCode();
      const bump = m && settingsId && parseInt(m[1], 10) >= seq
        ? patchData('settings', `id=eq.${settingsId}`, { next_inventory_seq: parseInt(m[1], 10) + 1 })
        : Promise.resolve();
      bump.then(() => postData('purchases', obj)).then(() => location.reload());
    } else {
      // blank -> auto-produce the next code from the counter, then bump it (R2).
      // R26: the bump MUST complete before location.reload(). Reloading right after
      // the PATCH was merely *initiated* aborted it in-flight, so the counter never
      // moved and two new items both got SC0004 (milk2/milk3 collision).
      const { code, seq, settingsId } = await nextInventoryCode();
      obj.inventory_code = code;
      const bump = settingsId
        ? patchData('settings', `id=eq.${settingsId}`, { next_inventory_seq: seq + 1 })
        : postData('settings', { next_inventory_seq: seq + 1 });
      postData('purchases', obj).then(() => bump).then(() => location.reload());
    }
  });

  return sec;
}

// ---- Phase 4: Stock-take reconcile ----
// variance = actual - on_hand; impact = |variance| x price_per_base.
// variance < 0 -> LOST cost (amber/red); variance > 0 -> SAVINGS (green).
// Saving a count appends a stocktakes row; the latest count per item
// self-corrects the record (on_hand shown = latest actual when one exists).
// ---- R9: Module 6 — Inventory (authoritative full view) ----
// §1 stock table = the SHARED inventoryTable() (single source of truth with M1 §3).
// §2 reconcile: actual OUM -> variance = actual - recorded, impact = |variance| x rate.
// §3 draw-down log: what sold/wasted on the latest recorded day.
// §4 history: past stock-takes + past daily-sales records.
async function renderInventory() {
  const sec = document.createElement('section');
  sec.id = 'inventory';
  const t = document.createElement('div'); t.className = 'page-title'; t.textContent = 'Inventory';
  const s = document.createElement('div'); s.className = 'page-sub';
  s.textContent = 'Remaining stock · reconcile record vs actual · draw-down · history';
  sec.append(t, s);

  let invItems = [];
  let stocktakes = [];
  let sales = [];
  let recipes = [];
  try {
    invItems = await inventoryRows();
    stocktakes = await getData('stocktakes', 'order=created_at.desc&select=*');
    sales = await getData('daily_sales', 'order=created_at.desc&select=*');
    recipes = await getData('recipes', 'order=created_at.desc&select=*');
  } catch (e) {
    const err = document.createElement('div'); err.className = 'empty-note';
    err.textContent = 'Could not load inventory data: ' + e.message;
    sec.appendChild(err);
    return sec;
  }
  const nameByCode = {};
  const unitByCode = {};
  const rateByCode = {};
  for (const it of invItems) { nameByCode[it.code] = it.name; unitByCode[it.code] = it.base_unit; rateByCode[it.code] = it.rate; }

  // ---- §1 stock table (shared single source of truth) ----
  const stockWrap = document.createElement('div'); stockWrap.className = 'card';
  const stockH = document.createElement('div'); stockH.textContent = 'Stock on hand (one row per item — newest purchase sets ₱/OUM)';
  stockWrap.appendChild(stockH);
  stockWrap.appendChild(inventoryTable(invItems, 'Stock on hand'));
  sec.appendChild(stockWrap);

  // ---- §2 reconcile: record vs actual ----
  const recWrap = document.createElement('div'); recWrap.className = 'card';
  const recH = document.createElement('div'); recH.textContent = 'Reconcile — enter actual count in OUM (saving sets remaining = actual)';
  recWrap.appendChild(recH);
  const rtable = document.createElement('table');
  const rhead = document.createElement('thead');
  const rhrow = document.createElement('tr');
  ['Inventory ID', 'Item', 'UOM', 'Recorded', 'Actual', 'Variance', 'Impact', 'Status'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; rhrow.appendChild(th);
  });
  rhead.appendChild(rhrow);
  const rbody = document.createElement('tbody');
  let totalLost = 0, totalSavings = 0;
  for (const it of invItems) {
    const actual = it.actual;
    const variance = (actual == null) ? 0 : actual - it.recorded;
    const impact = Math.abs(variance) * it.rate;
    if (variance < 0) totalLost += impact;
    else if (variance > 0) totalSavings += impact;
    const status = variance < 0 ? 'LOST' : variance > 0 ? 'SAVINGS' : (actual == null ? '—' : 'match');
    const tr = document.createElement('tr');
    const cells = [it.code, it.name, it.base_unit,
      `${it.recorded} ${it.base_unit}`,
      actual == null ? '—' : `${actual} ${it.base_unit}`,
      variance === 0 ? (actual == null ? '—' : '0') : (variance > 0 ? '+' : '') + variance,
      impact === 0 ? '—' : peso(Math.round(impact * 100) / 100),
      status];
    cells.forEach((val, i) => {
      const td = document.createElement('td');
      if (i === 5 && variance !== 0) {
        td.className = variance < 0 ? 'neg' : 'pos';
        td.textContent = (variance < 0 ? '-' : '+') + String(val);
      } else if (i === 6 && impact !== 0) {
        td.className = variance < 0 ? 'neg' : 'pos';
        td.textContent = (variance < 0 ? '-' : '+') + String(val);
      } else if (i === 7) {
        td.className = variance < 0 ? 'neg' : variance > 0 ? 'pos' : 'num';
        td.textContent = String(val);
      } else {
        td.textContent = String(val);
      }
      tr.appendChild(td);
    });
    rbody.appendChild(tr);
  }
  rtable.append(rhead, rbody);
  recWrap.appendChild(rtable);
  const net = totalSavings - totalLost;
  const mk = (label, val, cls) => {
    const row = document.createElement('div');
    row.className = cls;
    row.textContent = `${label} ${peso(Math.round(val * 100) / 100)}`;
    return row;
  };
  const foot = document.createElement('div'); foot.className = 'card';
  foot.appendChild(mk('Total lost', totalLost, 'neg'));
  foot.appendChild(mk('Total savings', totalSavings, 'pos'));
  foot.appendChild(mk('Net', net, net < 0 ? 'neg' : 'pos'));
  sec.appendChild(foot);

  // reconcile form: Inventory ID (SC...) + actual OUM + date + counter
  const form = document.createElement('div');
  form.className = 'card';
  const codeInp = document.createElement('input');
  codeInp.className = 'field'; codeInp.setAttribute('placeholder', 'Inventory ID (SC…)');
  codeInp.setAttribute('aria-label', 'Inventory ID');
  const actualInp = document.createElement('input');
  actualInp.className = 'field'; actualInp.type = 'number';
  actualInp.setAttribute('placeholder', 'Actual count in OUM');
  actualInp.setAttribute('aria-label', 'Actual count in OUM');
  const dateInp = document.createElement('input');
  dateInp.className = 'field'; dateInp.setAttribute('placeholder', 'Date (YYYY-MM-DD)');
  dateInp.setAttribute('aria-label', 'Date');
  const counterInp = document.createElement('input');
  counterInp.className = 'field'; counterInp.setAttribute('placeholder', 'Counter initials');
  counterInp.setAttribute('aria-label', 'Counter initials');
  const recBtn = document.createElement('button');
  recBtn.className = 'btn-record'; recBtn.textContent = 'Record reconcile';
  form.append(codeInp, actualInp, dateInp, counterInp, recBtn);
  sec.appendChild(form);

  recBtn.addEventListener('click', () => {
    const codeKey = codeInp.value.trim().toUpperCase();
    const actualRaw = actualInp.value.trim();
    if (!codeKey || actualRaw === '') {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'Pick an item and enter its actual count.';
      form.appendChild(w); return;
    }
    const it = invItems.find(x => x.code === codeKey || x.code.startsWith(codeKey));
    if (!it) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'No such inventory ID.'; form.appendChild(w); return;
    }
    const act = Number(actualRaw);
    const variance = act - it.recorded;
    const impact = Math.abs(variance) * it.rate;
    const line = { inventory_code: it.code, actual_oum: act, variance, impact };
    const lost = variance < 0 ? impact : 0;
    const savings = variance > 0 ? impact : 0;
    const body = {
      date: dateInp.value.trim() || new Date().toISOString().slice(0, 10),
      counter: counterInp.value.trim(),
      lines: [line],
      totals: { lost, savings, net: savings - lost },
    };
    postData('stocktakes', body).then(() => location.reload());
  });

  // ---- §3 draw-down log: what sold/wasted on the latest recorded day ----
  const drawWrap = document.createElement('div'); drawWrap.className = 'card';
  const drawH = document.createElement('div'); drawH.textContent = 'Draw-down log — latest recorded day';
  drawWrap.appendChild(drawH);
  if (sales.length) {
    const ds = sales[0];
    const recById = {};
    for (const rc of recipes) recById[String(rc.id)] = rc;
    const consumed = {}; // code -> {oum, sold, wasted}
    const lines = Array.isArray(ds.lines) ? ds.lines : [];
    for (const ln of lines) {
      if (!ln) continue;
      const rc = recById[String(ln.recipe_id)];
      if (!rc) continue;
      const qty = Number(ln.qty) || 0;
      const ings = Array.isArray(rc.ingredients) ? rc.ingredients : [];
      for (const ing of ings) {
        if (!ing) continue;
        const c = String(ing.inventory_code || '').trim().toUpperCase();
        if (!c) continue;
        const bucket = consumed[c] || (consumed[c] = { sold: 0, wasted: 0 });
        bucket.sold += Number(ing.qty_oum) * qty;
      }
    }
    const wast = Array.isArray(ds.wastage) ? ds.wastage : [];
    for (const w of wast) {
      if (!w) continue;
      const c = String(w.inventory_code || '').trim().toUpperCase();
      if (!c) continue;
      const bucket = consumed[c] || (consumed[c] = { sold: 0, wasted: 0 });
      bucket.wasted += Number(w.qty_oum) || 0;
    }
    const dtable = document.createElement('table');
    const dhead = document.createElement('thead');
    const dhrow = document.createElement('tr');
    ['Inventory ID', 'Item', 'UOM', 'Sold', 'Wasted', 'Total consumed'].forEach(h => {
      const th = document.createElement('th'); th.textContent = h; dhrow.appendChild(th);
    });
    dhead.appendChild(dhrow);
    const dbody = document.createElement('tbody');
    for (const c in consumed) {
      const bucket = consumed[c];
      const total = bucket.sold + bucket.wasted;
      const tr = document.createElement('tr');
      const u = unitByCode[c] || '';
      const cells = [c, nameByCode[c] || c, u, `${bucket.sold} ${u}`, `${bucket.wasted} ${u}`, `${total} ${u}`];
      cells.forEach((val, i) => {
        const td = document.createElement('td');
        if (i === 5) td.className = 'num';
        td.textContent = String(val);
        tr.appendChild(td);
      });
      dbody.appendChild(tr);
    }
    dtable.append(dhead, dbody);
    drawWrap.appendChild(dtable);
    const dsT = ds.totals || {};
    const dsNote = document.createElement('div'); dsNote.className = 'num';
    dsNote.textContent = `${ds.date || ''} — Rev ${peso(dsT.revenue || 0)} · COGS ${peso(dsT.cogs || 0)} · Wastage ${peso(dsT.wastage || 0)} · Net ${peso(dsT.net || 0)}`;
    drawWrap.appendChild(dsNote);
  } else {
    const note = document.createElement('div'); note.className = 'empty-note';
    note.textContent = 'No daily-sales records yet — nothing drawn down.';
    drawWrap.appendChild(note);
  }
  sec.appendChild(drawWrap);

  // ---- §4 history: past stock-takes + past daily-sales records ----
  const histWrap = document.createElement('div'); histWrap.className = 'card';
  const histH = document.createElement('div'); histH.textContent = 'History — stock-takes + daily-sales records';
  histWrap.appendChild(histH);
  const htable = document.createElement('table');
  const hh = document.createElement('tr');
  ['id', 'Type', 'Date', 'Who', 'Detail'].forEach(x => {
    const th = document.createElement('th'); th.textContent = x; hh.appendChild(th);
  });
  const hhead = document.createElement('thead'); hhead.appendChild(hh);
  const hbody = document.createElement('tbody');
  const rows = [];
  for (const st of stocktakes) {
    const tt = st.totals || {};
    rows.push({ id: String(st.id).slice(0, 8), type: 'stock-take', date: st.date || '', who: st.counter || '—',
      detail: `lost ${peso(tt.lost || 0)} · savings ${peso(tt.savings || 0)} · net ${peso(tt.net || 0)}` });
  }
  for (const ds of sales) {
    const tt = ds.totals || {};
    rows.push({ id: String(ds.id).slice(0, 8), type: 'daily-sales', date: ds.date || '', who: ds.recorder || '—',
      detail: `rev ${peso(tt.revenue || 0)} · cogs ${peso(tt.cogs || 0)} · net ${peso(tt.net || 0)}` });
  }
  rows.sort((a, b) => (String(b.date) < String(a.date) ? -1 : String(b.date) > String(a.date) ? 1 : 0));
  for (const rw of rows) {
    const tr = document.createElement('tr');
    const cells = [rw.id, rw.type, rw.date, rw.who, rw.detail];
    cells.forEach((val, i) => {
      const td = document.createElement('td');
      if (i === 1) td.className = 'num';
      td.textContent = String(val);
      tr.appendChild(td);
    });
    hbody.appendChild(tr);
  }
  if (rows.length) {
    htable.append(hhead, hbody);
    histWrap.appendChild(htable);
  } else {
    const note = document.createElement('div'); note.className = 'empty-note';
    note.textContent = 'No stock-takes or daily-sales recorded yet.';
    histWrap.appendChild(note);
  }
  sec.appendChild(histWrap);

  addDeleteCard(sec, stocktakes, 'stocktakes', 'Stock-take id (copy from history)');
  addPrintButton(sec, 'Print inventory sheet');
  return sec;
}

// ---- Phase 5: Recipes cost (free, NO draw-down) ----
// recipe_cost = Σ(qty_base × price_per_base) per size, computed LIVE from
// current purchases. Saving a recipe NEVER touches purchases (enforced:
// the save path only POSTs to `recipes`).
async function renderRecipes() {
  const sec = document.createElement('section');
  sec.id = 'recipes';
  const t = document.createElement('div'); t.className = 'page-title'; t.textContent = 'Recipes';
  const s = document.createElement('div'); s.className = 'page-sub';
  s.textContent = 'Drink = ingredient combo → one-cup cost';
  sec.append(t, s);

  let purchases = [];
  let recipes = [];
  try {
    purchases = await getData('purchases', 'order=created_at.desc&select=*');
    recipes = await getData('recipes', 'order=created_at.desc&select=*');
  } catch (e) {
    const err = document.createElement('div'); err.className = 'empty-note';
    err.textContent = 'Could not load recipe data: ' + e.message;
    sec.appendChild(err);
    return sec;
  }

  // R6: recipes reference inventory_code, not purchase UUID. Cost is always live
  // from the current ₱/OUM of each item (latest-cost-wins), never stored.
  const rateByCode = await itemRateByCode();
  const unitByCode = {};
  const nameByCode = {};
  const invItems = await inventoryRows();
  for (const it of invItems) { unitByCode[it.code] = it.base_unit; nameByCode[it.code] = it.name; }

  // cost of one recipe row, computed live from current ₱/OUM per inventory_code
  function recipeCost(ing) {
    if (!Array.isArray(ing)) return 0;
    let sum = 0;
    for (const ln of ing) {
      if (!ln) continue;
      const code = String(ln.inventory_code || '').trim().toUpperCase();
      if (rateByCode[code] != null) sum += Number(ln.qty_oum) * rateByCode[code];
    }
    return sum;
  }

  // R34: overhead per cup, computed FRESH here with the exact same conversion rule
  // as the Overhead page (1 year = 365 days = 12 months; days/month = 365/12;
  // 1 day = target daily cups). Loaded here (not the OVERHEAD_PER_CUP global) so
  // the cost box is correct even when landing directly on Recipes, where the
  // Overhead page may not have rendered yet.
  async function overheadPerCup() {
    let overhead = [];
    let settings = [];
    try {
      overhead = await getData('overhead', 'order=created_at.desc&select=*');
      settings = await getData('settings', 'select=*');
    } catch (e) { return 0; }
    const DAYS_PER_MONTH = 365 / 12;
    const target = settings.length ? Number(settings[0].target_daily_cups) : 0;
    const perCup = (monthly) => target > 0 ? monthly / DAYS_PER_MONTH / target : 0;
    let total = 0;
    for (const o of overhead) {
      const a = Number(o.amount);
      const p = (o.period || 'monthly').toLowerCase();
      if (p === 'yearly') total += perCup(a / 12);
      else if (p === 'daily') total += perCup(a * DAYS_PER_MONTH);
      else if (p === 'cup') total += a;
      else total += perCup(a);
    }
    return total;
  }
  const ohPerCup = await overheadPerCup();

  // R30: recipe TABLE (not cards) — one row per (drink, size), mirroring the
  // purchases / overhead table UX (R28): no id column, per-row Edit + Delete.
  // Edit re-opens the recipe in the entry form (save PATCHes the SAME row);
  // Delete uses the two-click arm/confirm pattern (first click arms, second on
  // the SAME row deletes only that recipe).
  let recipesEditingRowId = null;
  let pendingDelRowId = null;
  let armedDelBtn = null;
  const delConfirm = document.createElement('div');
  delConfirm.className = 'del-confirm';
  const ingLine = (ing) => Array.isArray(ing) ? ing.map(ln => {
    const code = String(ln.inventory_code || '').trim().toUpperCase();
    const label = nameByCode[code] || '?';
    const unit = unitByCode[code] || '';
    return `${ln.qty_oum} ${unit} ${label} (${code})`;
  }).join(' · ') : '';
  if (recipes.length) {
    const table = document.createElement('table');
    const cap = document.createElement('caption');
    cap.className = 'tbl-caption';
    cap.textContent = 'Recipes — one row per drink · size';
    table.appendChild(cap);
    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    ['Drink', 'Size', 'Ingredients', 'One-cup cost', 'Edit', 'Delete'].forEach(h => {
      const th = document.createElement('th'); th.textContent = h; hrow.appendChild(th);
    });
    thead.appendChild(hrow);
    const tbody = document.createElement('tbody');
    for (const rc of recipes) {
      const ing = Array.isArray(rc.ingredients) ? rc.ingredients : [];
      const tr = document.createElement('tr');
      // R35: one-cup cost = live recipe cost (current ₱/OUM per inventory_code)
      // + overhead per cup, matching the form's cost box. Recomputed fresh on every
      // render, so it follows inventory price edits and overhead edits on reload.
      const cells = [rc.drink_name, rc.size, ingLine(ing), peso(recipeCost(ing) + ohPerCup)];
      cells.forEach((val, i) => {
        const td = document.createElement('td');
        if (i === 3) td.className = 'peso';
        td.textContent = String(val);
        tr.appendChild(td);
      });
      // Edit button: loads this recipe into the entry form; saving PATCHes the SAME row.
      const editTd = document.createElement('td');
      const editBtn = document.createElement('button');
      editBtn.className = 'btn-edit';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        recipesEditingRowId = String(rc.id);
        nameInp.value = rc.drink_name || '';
        const sz = String(rc.size || 'S');
        sizeSel.value = sz.charAt(0).toUpperCase() + sz.slice(1);
        for (let i = 0; i < N_ING; i++) {
          const ln = ing[i];
          ingInputs[i][0].value = ln ? String(ln.inventory_code || '') : '';
          ingInputs[i][1].value = ln ? String(ln.qty_oum) : '';
        }
        // R34 fix: assigning .value programmatically does NOT fire the 'input'/'change'
        // events, so the live boxes would stay stale after pressing Edit. Refresh all
        // three (per-item cost lines, one-cup cost, and the qty unit labels) explicitly.
        updateResolve();
        updateCostTotal();
        for (const [sel, inp, lab, num] of ingInputs) updateQtyLabel(sel, inp, lab, num);
        updateReveal(); // R37: show only as many ingredient rows as the saved recipe fills
      });
      editTd.appendChild(editBtn);
      tr.appendChild(editTd);
      // Per-row Delete: first click arms a "Confirm?" prompt; second click on the
      // SAME row deletes only that recipe (id=eq.<rowId>) — other rows untouched.
      const delTd = document.createElement('td');
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-row-del';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => {
        const rid = String(rc.id);
        if (pendingDelRowId === rid) {
          deleteData('recipes', `id=eq.${encodeURIComponent(rid)}`).then(() => location.reload());
          return;
        }
        if (armedDelBtn && armedDelBtn !== delBtn) {
          armedDelBtn.textContent = 'Delete';
          armedDelBtn.classList.remove('armed');
        }
        pendingDelRowId = rid;
        armedDelBtn = delBtn;
        delBtn.textContent = 'Confirm?';
        delBtn.classList.add('armed');
        delConfirm.textContent = `Delete this recipe — ${rc.drink_name} (${rc.size}) (${peso(recipeCost(ing))} / cup)? Click "Confirm?" on the same row again to delete.`;
      });
      delTd.appendChild(delBtn);
      tr.appendChild(delTd);
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    const scrollWrap = document.createElement('div');
    scrollWrap.className = 'scroll-y';
    scrollWrap.appendChild(table);
    sec.appendChild(scrollWrap);
    sec.appendChild(delConfirm);
  } else {
    const note = document.createElement('div'); note.className = 'empty-note';
    note.textContent = 'No recipes yet — build one below.';
    sec.appendChild(note);
  }

  // §2 recipe entry form — mirror M1/M2 UX: two-column field rows (label left,
  // input right), Size dropdown, live drink-name suggestion box, live ingredient-resolve
  // box (shows each item's name + current ₱/OUM as IDs are typed), and a live one-cup cost.
  const form = document.createElement('div');
  form.className = 'card';
  const mkRow = (labelText) => {
    const row = document.createElement('div');
    row.className = 'field-row';
    const lab = document.createElement('div');
    lab.className = 'field-label';
    lab.textContent = labelText;
    row.appendChild(lab);
    form.appendChild(row);
    return row;
  };
  const nameRow = mkRow('Drink name');
  const nameInp = document.createElement('input');
  nameInp.className = 'field'; nameInp.setAttribute('placeholder', 'Drink name');
  nameInp.setAttribute('aria-label', 'Drink name');
  nameRow.appendChild(nameInp);
  const sizeRow = mkRow('Size');
  const sizeSel = document.createElement('select');
  sizeSel.className = 'field'; sizeSel.setAttribute('aria-label', 'Size S M or L');
  ['S', 'M', 'L'].forEach(sz => {
    // R27b lesson: <option> needs BOTH value AND textContent or it renders blank.
    const opt = document.createElement('option'); opt.value = sz; opt.textContent = sz;
    sizeSel.appendChild(opt);
  });
  sizeRow.appendChild(sizeSel);

  // R37: progressive disclosure — the form starts showing ONLY Ingredient 1; each
  // further ingredient reveals itself only once the previous one is FULLY filled
  // (an inventory item AND a positive qty). Cascades up to N_ING.
  const N_ING = 15;
  const ingInputs = [];
  const ingRows = []; // [idRow, qtyRow] per ingredient, so updateReveal can hide/show them
  // R31: ingredient selection is a DROPDOWN of all inventory items on hand (mirrors
  // the M1 UOM dropdown) instead of a free-typed Inventory ID. Option value = the
  // inventory code (so save/resolve logic still reads a code); textContent = "name (CODE)".
  const invOptions = invItems.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  for (let i = 0; i < N_ING; i++) {
    const idRow = mkRow(`Ingredient ${i + 1} — Inventory item`);
    const idSel = document.createElement('select');
    idSel.className = 'field'; idSel.setAttribute('aria-label', `Ingredient ${i + 1} inventory item`);
    // A <select> defaults to its FIRST option, so an untouched ingredient slot would
    // otherwise read as the first inventory item. A blank leading option makes empty
    // slots read as empty (resolve + cost boxes skip them; save skips blank+blank rows).
    const blankOpt = document.createElement('option');
    blankOpt.value = ''; blankOpt.textContent = '—';
    idSel.appendChild(blankOpt);
    for (const it of invOptions) {
      // R27b lesson: <option> needs BOTH value AND textContent or it renders blank.
      const opt = document.createElement('option');
      opt.value = it.code; opt.textContent = `${it.name} (${it.code})`;
      idSel.appendChild(opt);
    }
    idRow.appendChild(idSel);
    const qtyRow = mkRow(`Ingredient ${i + 1} — qty (OUM)`);
    const qtyInp = document.createElement('input');
    qtyInp.className = 'field'; qtyInp.type = 'number';
    qtyInp.setAttribute('placeholder', 'qty (OUM)');
    qtyInp.setAttribute('aria-label', `Ingredient ${i + 1} quantity in OUM`);
    qtyRow.appendChild(qtyInp);
    // R32: keep refs to the qty row's label element + its ingredient number so we
    // can rewrite the label to the selected item's recorded unit of measure live.
    ingInputs.push([idSel, qtyInp, qtyRow.firstChild, i + 1]);
    ingRows.push([idRow, qtyRow]); // R37: row refs for progressive reveal/hide
  }

  // live drink-name suggestion: PARTIAL match against existing recipes, so users
  // see whether a (drink, size) already exists before adding a duplicate.
  const suggBox = document.createElement('div');
  suggBox.className = 'suggestion';
  form.appendChild(suggBox);
  function updateNameSuggestion() {
    const typed = String(nameInp.value || '').trim().toLowerCase();
    if (!typed) { suggBox.textContent = ''; return; }
    const partial = recipes.filter((rc) => String(rc.drink_name || '').trim().toLowerCase().includes(typed));
    suggBox.textContent = partial.length
      ? 'Already a recipe: ' + partial.map((rc) => `${rc.drink_name} (${rc.size})`).join(', ')
      : 'New drink — no recipe yet';
  }
  nameInp.addEventListener('input', updateNameSuggestion);
  updateNameSuggestion();

  // live ingredient-resolve box: as Inventory IDs are typed, show each item's
  // name + current ₱/OUM (mirrors M1 "auto pull data from inventory").
  const resolveBox = document.createElement('div');
  resolveBox.className = 'suggestion';
  form.appendChild(resolveBox);
  // R33: show each ingredient on its own line with its LINE COST (qty x current
  // rate) so users can see how much each input contributes, and mark the single
  // most expensive ingredient. Built as child divs (one per line) because .suggestion
  // has no white-space:pre-wrap, so newlines in textContent would not render.
  function updateResolve() {
    while (resolveBox.firstChild) resolveBox.removeChild(resolveBox.firstChild);
    const lines = [];
    for (const [idInp, qtyInp] of ingInputs) {
      const code = String(idInp.value || '').trim().toUpperCase();
      if (!code) continue;
      const nm = nameByCode[code] || '?';
      const r = rateByCode[code];
      const unit = unitByCode[code] || 'OUM';
      const qtyRaw = String(qtyInp.value || '').trim();
      const qty = Number(qtyRaw);
      const lineCost = (r != null && qty > 0) ? qty * r : null;
      lines.push({ code, nm, r, unit, qtyRaw, lineCost });
    }
    // R34: no "most expensive" marker — users identify it manually; they just
    // want the cost per item input shown.
    for (const ln of lines) {
      const div = document.createElement('div');
      let txt = `${ln.code} ${ln.nm}`;
      txt += ln.r != null ? ' · ' + rate(ln.r) + '/' + ln.unit : ' · no stock rate';
      if (ln.qtyRaw) txt += ' × ' + ln.qtyRaw + ' ' + ln.unit;
      if (ln.lineCost != null) txt += ' = ' + peso(Math.round(ln.lineCost * 100) / 100);
      div.textContent = txt;
      resolveBox.appendChild(div);
    }
  }
  // R32: once an inventory item is picked from the dropdown, rewrite the qty row's
  // label + placeholder to that item's RECORDED unit of measure (its base_unit)
  // instead of the generic "OUM". Blank selection falls back to "OUM".
  function updateQtyLabel(sel, inp, lab, num) {
    const code = String(sel.value || '').trim().toUpperCase();
    const unit = code ? (unitByCode[code] || 'OUM') : 'OUM';
    if (lab) lab.textContent = `Ingredient ${num} — qty (${unit})`;
    inp.setAttribute('placeholder', `qty (${unit})`);
  }
  // R37: reveal cascade. Ingredient 1 is always shown. Ingredient k+1 becomes
  // visible only once Ingredient k is fully filled (inventory item AND qty > 0).
  // Not-yet-revealed rows are display:none so the user fills them top-down.
  function updateReveal() {
    let revealed = 1;
    for (let i = 0; i < N_ING - 1; i++) {
      const [sel, inp] = ingInputs[i];
      const code = String(sel.value || '').trim();
      const qty = Number(inp.value);
      if (code && qty > 0) revealed = i + 2; else break;
    }
    for (let i = 0; i < N_ING; i++) {
      const [idRow, qtyRow] = ingRows[i];
      const show = i < revealed;
      idRow.style.display = show ? '' : 'none';
      qtyRow.style.display = show ? '' : 'none';
    }
  }
  for (const [idInp, qtyInp, qtyLab, num] of ingInputs) {
    // idInp is now a <select> dropdown — picking an option fires 'change' (not 'input'),
    // so listen to both so the resolve + cost boxes update when an item is selected.
    idInp.addEventListener('input', updateResolve);
    idInp.addEventListener('change', updateResolve);
    qtyInp.addEventListener('input', updateResolve);
    idInp.addEventListener('input', updateCostTotal);
    idInp.addEventListener('change', updateCostTotal);
    qtyInp.addEventListener('input', updateCostTotal);
    idInp.addEventListener('input', () => updateQtyLabel(idInp, qtyInp, qtyLab, num));
    idInp.addEventListener('change', () => updateQtyLabel(idInp, qtyInp, qtyLab, num));
    // R37: as any ingredient's item/qty changes, recompute which rows are revealed.
    idInp.addEventListener('input', updateReveal);
    idInp.addEventListener('change', updateReveal);
    qtyInp.addEventListener('input', updateReveal);
    updateQtyLabel(idInp, qtyInp, qtyLab, num);
  }
  updateResolve();
  updateReveal();

  // live one-cup cost box — recomputes from the current ingredient inputs (same
  // live-cost rule as the table: qty × current ₱/OUM per inventory_code).
  const totalBox = document.createElement('div');
  totalBox.className = 'total-box';
  const totalLabel = document.createElement('span');
  totalLabel.textContent = 'One-cup cost: ';
  const totalVal = document.createElement('span');
  totalVal.className = 'peso';
  totalBox.append(totalLabel, totalVal);
  form.appendChild(totalBox);
  // R34: one-cup cost now includes the Overhead-per-cup figure (recipe cost +
  // overhead), matching the Pricing page's all-in cost.
  function updateCostTotal() {
    let sum = 0;
    for (const [idInp, qtyInp] of ingInputs) {
      const code = String(idInp.value || '').trim().toUpperCase();
      const qty = Number(qtyInp.value);
      if (code && rateByCode[code] != null && qty > 0) sum += qty * rateByCode[code];
    }
    totalVal.textContent = sum > 0 ? peso(Math.round((sum + ohPerCup) * 100) / 100) : '—';
  }
  updateCostTotal();
  const ohNote = document.createElement('div');
  ohNote.className = 'empty-note';
  ohNote.textContent = `One-cup cost = ingredients + overhead per cup (${peso(ohPerCup)}).`;
  form.appendChild(ohNote);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-save'; saveBtn.textContent = 'Save recipe';
  form.appendChild(saveBtn);
  const freeNote = document.createElement('div');
  freeNote.className = 'empty-note';
  freeNote.textContent = 'Recipes are free to create — saving never changes stock.';
  form.appendChild(freeNote);
  sec.appendChild(form);

  saveBtn.addEventListener('click', () => {
    const name = nameInp.value.trim();
    const size = sizeSel.value.trim().toUpperCase();
    if (!name || !['S', 'M', 'L'].includes(size)) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'Drink name and size (S/M/L) are required.';
      form.appendChild(w); return;
    }
    const ingredients = [];
    for (const [idInp, qtyInp] of ingInputs) {
      const codeKey = idInp.value.trim().toUpperCase();
      const qty = qtyInp.value.trim();
      if (codeKey === '' && qty === '') continue;
      if (!rateByCode[codeKey] || qty === '' || !(Number(qty) > 0)) {
        const w = document.createElement('div'); w.className = 'neg';
        w.textContent = 'Each ingredient needs an inventory item (pick it from the dropdown) and a positive qty.';
        form.appendChild(w); return;
      }
      ingredients.push({ inventory_code: codeKey, qty_oum: Number(qty) });
    }
    if (!ingredients.length) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'Add at least one ingredient.';
      form.appendChild(w); return;
    }
    // R30 edit mode: an Edit button was clicked, so update THAT row in place —
    // PATCH the same recipe (skip the duplicate drink+size check, the row IS itself).
    if (recipesEditingRowId) {
      patchData('recipes', `id=eq.${encodeURIComponent(recipesEditingRowId)}`, { drink_name: name, size, ingredients })
        .then(() => location.reload());
      return;
    }
    // block duplicate (drink, size) — same drink+size already has a recipe row.
    const dupe = recipes.find(rc => String(rc.drink_name).trim().toLowerCase() === name.toLowerCase() && String(rc.size).toUpperCase() === size);
    if (dupe) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = `A recipe already exists for "${dupe.drink_name}" (${dupe.size}) — use that row's Edit button to change it instead of adding a duplicate.`;
      form.appendChild(w); return;
    }
    // POST to `recipes` ONLY — purchases are never touched (no draw-down).
    postData('recipes', { drink_name: name, size, ingredients }).then(() => location.reload());
  });

  // R30: the id-copy delete card is gone — per-row Delete buttons above replace it,
  // and users no longer see (or need) ids on this page (same as R28 overhead).
  return sec;
}

// ---- Phase 6: Overhead → per-cup ----
// overhead_per_cup = Σ(monthly) ÷ drinks_per_month. Annual rows are folded
// to monthly (amount / 12). The figure is stashed in OVERHEAD_PER_CUP so
// Phase 7 (margin) can consume it.
let OVERHEAD_PER_CUP = 0;
async function renderOverhead() {
  const sec = document.createElement('section');
  sec.id = 'overhead';
  const t = document.createElement('div'); t.className = 'page-title'; t.textContent = 'Overhead';
  const s = document.createElement('div'); s.className = 'page-sub';
  s.textContent = 'Indirect costs → ₱ per cup';
  sec.append(t, s);

  let overhead = [];
  let settings = [];
  try {
    overhead = await getData('overhead', 'order=created_at.desc&select=*');
    settings = await getData('settings', 'select=*');
  } catch (e) {
    const err = document.createElement('div'); err.className = 'empty-note';
    err.textContent = 'Could not load overhead: ' + e.message;
    sec.appendChild(err);
    return sec;
  }

  // Conversion rule, enforced everywhere: 1 year = 365 days = 12 months.
  // days/month = 365/12 = 30.4167. 1 day = target daily cup sales.
  const DAYS_PER_MONTH = 365 / 12;
  const target = settings.length ? Number(settings[0].target_daily_cups) : 0;
  // R27: guard against an unset/zero target — per-cup figures would be Infinity.
  const perCup = (monthly) => target > 0 ? monthly / DAYS_PER_MONTH / target : 0;

  // §1 target daily cup sales card (editable) + derived drinks/month
  const tgtCard = document.createElement('div');
  tgtCard.className = 'card';
  const tgtHead = document.createElement('div');
  tgtHead.textContent = 'Target daily cup sales';
  const tgtVal = document.createElement('div');
  tgtVal.className = 'num';
  tgtVal.textContent = String(target);
  const tgtDer = document.createElement('div');
  tgtDer.textContent = target > 0
    ? `≈ ${Math.round(target * DAYS_PER_MONTH).toLocaleString('en-US')} cups / month`
    : 'Set a target daily cup sales to derive per-cup figures';
  tgtCard.append(tgtHead, tgtVal, tgtDer);
  sec.appendChild(tgtCard);

  // Convert one (amount, period) into the four figures via the rule above.
  // R27: per-cup conversions go through perCup() so a zero target yields 0, not Infinity.
  function figures(amount, period) {
    const a = Number(amount);
    if (period === 'yearly') return { perCup: perCup(a / 12), perDay: a / 365, perMonth: a / 12, perYear: a };
    if (period === 'daily') return { perCup: perCup(a * DAYS_PER_MONTH), perDay: a, perMonth: a * DAYS_PER_MONTH, perYear: a * 365 };
    if (period === 'cup') return { perCup: a, perDay: a * target, perMonth: a * DAYS_PER_MONTH * target, perYear: a * 365 * target };
    // monthly (default)
    return { perCup: perCup(a), perDay: a / DAYS_PER_MONTH, perMonth: a, perYear: a * 12 };
  }

  // §3 cost table: Expense item · per cup · per day · per month · per year
  // R28: no id column (users never copy ids here) + per-row Edit / Delete columns,
  // mirroring the purchases table UX. Edit re-opens the row in the expense form
  // (save PATCHes the SAME row); Delete uses the two-click arm/confirm pattern.
  let pendingDelRowId = null;
  let armedDelBtn = null;
  const delConfirm = document.createElement('div');
  delConfirm.className = 'del-confirm';
  let overheadEditingRowId = null;
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  ['Expense item', 'Period', 'Amount ₱', 'per cup', 'per day', 'per month', 'per year', 'Edit', 'Delete'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; hrow.appendChild(th);
  });
  thead.appendChild(hrow);
  const tbody = document.createElement('tbody');

  let perCupTotal = 0;
  for (const o of overhead) {
    const f = figures(o.amount, (o.period || 'monthly').toLowerCase());
    perCupTotal += f.perCup;
    const tr = document.createElement('tr');
    const cells = [o.label, o.period, peso(Number(o.amount)), peso(f.perCup), peso(f.perDay), peso(f.perMonth), peso(f.perYear)];
    cells.forEach((val, i) => {
      const td = document.createElement('td');
      if (i >= 2) td.className = 'peso';
      td.textContent = String(val);
      tr.appendChild(td);
    });
    // Edit button: loads this expense into the entry form; saving PATCHes the same row.
    const editTd = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-edit';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      overheadEditingRowId = String(o.id);
      labelInp.value = o.label || '';
      const p = String(o.period || 'monthly').toLowerCase();
      periodSel.value = p.charAt(0).toUpperCase() + p.slice(1);
      amtInp.value = String(Number(o.amount));
    });
    editTd.appendChild(editBtn);
    tr.appendChild(editTd);
    // R20-equivalent per-row Delete: first click arms a "Confirm?" prompt under
    // the table; a second click on the SAME row's button deletes only that expense.
    const delTd = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-row-del';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      const rid = String(o.id);
      if (pendingDelRowId === rid) {
        deleteData('overhead', `id=eq.${encodeURIComponent(rid)}`).then(() => location.reload());
        return;
      }
      if (armedDelBtn && armedDelBtn !== delBtn) {
        armedDelBtn.textContent = 'Delete';
        armedDelBtn.classList.remove('armed');
      }
      pendingDelRowId = rid;
      armedDelBtn = delBtn;
      delBtn.textContent = 'Confirm?';
      delBtn.classList.add('armed');
      delConfirm.textContent = `Delete this expense — ${o.label} (${peso(Number(o.amount))} / ${o.period})? Click "Confirm?" on the same row again to delete.`;
    });
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  sec.appendChild(table);
  sec.appendChild(delConfirm);

  // OVERHEAD_PER_CUP = Σ(per cup) — replaces old Σ(monthly) ÷ drinks_per_month.
  OVERHEAD_PER_CUP = perCupTotal;
  const sumCard = document.createElement('div');
  sumCard.className = 'card';
  const sumHead = document.createElement('div'); sumHead.textContent = 'Overhead per cup';
  const sumVal = document.createElement('div'); sumVal.className = 'peso';
  sumVal.textContent = peso(OVERHEAD_PER_CUP);
  sumCard.append(sumHead, sumVal);
  sec.appendChild(sumCard);

  // §2 expense entry form: Expense item · Period (Yearly/Monthly/Daily/Cup) · Amount ₱
  // R27: mirror the purchases-page UX — two-column field rows (label left, input
  // right) and a LIVE suggestion box: typing an expense name shows matching rows
  // already in the cost table, so users see e.g. "Rent" exists before adding a duplicate.
  const form = document.createElement('div');
  form.className = 'card';
  const mkRow = (labelText) => {
    const row = document.createElement('div');
    row.className = 'field-row';
    const lab = document.createElement('div');
    lab.className = 'field-label';
    lab.textContent = labelText;
    row.appendChild(lab);
    form.appendChild(row);
    return row;
  };
  const labelRow = mkRow('Expense item');
  const labelInp = document.createElement('input');
  labelInp.className = 'field'; labelInp.setAttribute('placeholder', 'Expense item (rent, salary…)');
  labelInp.setAttribute('aria-label', 'Expense item');
  labelRow.appendChild(labelInp);
  const periodRow = mkRow('Period measure');
  const periodSel = document.createElement('select');
  periodSel.className = 'field'; periodSel.setAttribute('aria-label', 'Period measure');
  ['Yearly', 'Monthly', 'Daily', 'Cup'].forEach(p => {
    // R27b: options need textContent, not just value — a value-only <option>
    // renders BLANK in some browsers (same pattern as the purchases UOM dropdown).
    const opt = document.createElement('option'); opt.value = p; opt.textContent = p;
    periodSel.appendChild(opt);
  });
  periodRow.appendChild(periodSel);
  const amtRow = mkRow('Amount (₱)');
  const amtInp = document.createElement('input');
  amtInp.className = 'field'; amtInp.type = 'number';
  amtInp.setAttribute('placeholder', 'Amount (₱)'); amtInp.setAttribute('aria-label', 'Amount in pesos');
  amtRow.appendChild(amtInp);
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-add'; addBtn.textContent = 'Add expense';
  form.appendChild(addBtn);
  sec.appendChild(form);

  // sleeprev Module 2 §2: "show suggestion based on entry from existing cost table".
  // PARTIAL (substring) match while typing, like the purchases suggBox — typing "re"
  // hints "Rent" already exists so the user knows a duplicate would be blocked.
  const suggBox = document.createElement('div');
  suggBox.className = 'suggestion';
  form.appendChild(suggBox);
  function updateExpenseSuggestion() {
    const typed = String(labelInp.value || '').trim().toLowerCase();
    if (!typed) { suggBox.textContent = ''; return; }
    const partial = overhead.filter((o) => String(o.label || '').trim().toLowerCase().includes(typed));
    suggBox.textContent = partial.length
      ? 'Already in cost table: ' + partial.map((o) => `${o.label} (${peso(Number(o.amount))} / ${o.period})`).join(', ')
      : 'New expense — no match in cost table';
  }
  labelInp.addEventListener('input', updateExpenseSuggestion);
  updateExpenseSuggestion();

  addBtn.addEventListener('click', () => {
    const label = labelInp.value.trim();
    const amount = Number(amtInp.value);
    const period = periodSel.value.trim().toLowerCase();
    if (!label || !(amount >= 0) || !['yearly', 'monthly', 'daily', 'cup'].includes(period)) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'Expense item, amount and period required.';
      form.appendChild(w); return;
    }
    // R28 edit mode: an Edit button was clicked, so update THAT row in place —
    // PATCH the same row (skip the duplicate-label check, the row IS its own label).
    if (overheadEditingRowId) {
      const obj = { label, amount, period };
      patchData('overhead', `id=eq.${encodeURIComponent(overheadEditingRowId)}`, obj)
        .then(() => location.reload());
      return;
    }
    // block exact duplicate labels — compare trimmed + case-insensitive, suggest existing
    const dupe = overhead.find(o => String(o.label).trim().toLowerCase() === label.toLowerCase());
    if (dupe) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = `An expense already uses the label "${dupe.label}" (${peso(Number(dupe.amount))} / ${dupe.period}) — change that row's amount instead of adding a duplicate.`;
      form.appendChild(w); return;
    }
    postData('overhead', { label, amount, period }).then(() => location.reload());
  });

  // §1 update saved target daily cup sales (PATCH the single settings row)
  // R27: same two-column field-row presentation as the expense form.
  const setForm = document.createElement('div');
  setForm.className = 'card';
  const setRow = document.createElement('div');
  setRow.className = 'field-row';
  const setLab = document.createElement('div');
  setLab.className = 'field-label';
  setLab.textContent = 'Target daily cup sales';
  setRow.appendChild(setLab);
  const tgtInp = document.createElement('input');
  tgtInp.className = 'field'; tgtInp.type = 'number';
  tgtInp.setAttribute('placeholder', 'Target daily cup sales');
  tgtInp.setAttribute('aria-label', 'Target daily cup sales');
  setRow.appendChild(tgtInp);
  setForm.appendChild(setRow);
  const setBtn = document.createElement('button');
  setBtn.className = 'btn-set'; setBtn.textContent = 'Update saved amount';
  setForm.appendChild(setBtn);
  sec.appendChild(setForm);

  setBtn.addEventListener('click', () => {
    const v = Number(tgtInp.value);
    if (!(v > 0)) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'Enter a positive target daily cup sales number.';
      setForm.appendChild(w); return;
    }
    if (settings.length) {
      patchData('settings', `id=eq.${encodeURIComponent(settings[0].id)}`, { target_daily_cups: v })
        .then(() => location.reload());
    } else {
      postData('settings', { target_daily_cups: v }).then(() => location.reload());
    }
  });

  // R28: the id-copy delete card is gone — per-row Delete buttons above replace it,
  // and users no longer see (or need) ids on this page.
  return sec;
}

// ---- Phase 7: Selling price + margin ----
// For each recipe (drink · size), the one-cup cost = recipe_cost + overhead_per_cup.
// margin = sell_price - (recipe_cost + overhead_per_cup).
//   margin >= 0 -> green (profitable); margin < 0 -> red (selling below cost).
// Staff reference only: this page never changes stock or recipes.
//
// R38 (M4): mirror the M1-M3 UX now that Recipes (M3) is built. Changes vs the
// original renderPricing():
//  - overhead per cup computed FRESH here (same as M3's R34) instead of reading the
//    OVERHEAD_PER_CUP global, which is stale/0 when landing directly on #pricing
//    (buildSite renders ONE module per render).
//  - table drops the id column, adds a caption + scroll-y wrapper, and per-row Edit
//    + Delete (two-click arm/confirm) exactly like the Recipes/Overhead/Purchases
//    tables. Edit re-opens that drink·size in the form (save PATCHes the same pricing
//    row); Delete removes only that pricing row.
//  - the sell-price form now picks an EXISTING recipe from a dropdown (drink + size)
//    instead of free-typing a name, and shows a live margin-preview box as you type
//    (mirrors M3's live resolve/cost boxes).
async function renderPricing() {
  const sec = document.createElement('section');
  sec.id = 'pricing';
  const t = document.createElement('div'); t.className = 'page-title'; t.textContent = 'Selling price';
  const s = document.createElement('div'); s.className = 'page-sub';
  s.textContent = 'Menu + margin per drink/size (staff reference)';
  sec.append(t, s);

  let recipes = [];
  let pricing = [];
  try {
    recipes = await getData('recipes', 'order=created_at.desc&select=*');
    pricing = await getData('pricing', 'order=created_at.desc&select=*');
  } catch (e) {
    const err = document.createElement('div'); err.className = 'empty-note';
    err.textContent = 'Could not load pricing data: ' + e.message;
    sec.appendChild(err);
    return sec;
  }

  // R6/R7: cost helpers keyed by inventory_code (same math as the Recipes page),
  // so a recipe follows the item across restocks (latest-cost-wins rate).
  const rateByCode = await itemRateByCode();
  function recipeCost(ing) {
    if (!Array.isArray(ing)) return 0;
    let sum = 0;
    for (const ln of ing) {
      if (!ln) continue;
      const code = String(ln.inventory_code || '').trim().toUpperCase();
      if (rateByCode[code] != null) sum += Number(ln.qty_oum) * rateByCode[code];
    }
    return sum;
  }

  // R38: overhead per cup, computed FRESH here (identical conversion rule to the
  // Overhead page + M3's R34) so the margin is correct even when landing directly
  // on #pricing, where the Overhead page may not have rendered and OVERHEAD_PER_CUP
  // would be a stale/0 global.
  async function overheadPerCup() {
    let overhead = [];
    let settings = [];
    try {
      overhead = await getData('overhead', 'order=created_at.desc&select=*');
      settings = await getData('settings', 'select=*');
    } catch (e) { return 0; }
    const DAYS_PER_MONTH = 365 / 12;
    const target = settings.length ? Number(settings[0].target_daily_cups) : 0;
    const perCup = (monthly) => target > 0 ? monthly / DAYS_PER_MONTH / target : 0;
    let total = 0;
    for (const o of overhead) {
      const a = Number(o.amount);
      const p = (o.period || 'monthly').toLowerCase();
      if (p === 'yearly') total += perCup(a / 12);
      else if (p === 'daily') total += perCup(a * DAYS_PER_MONTH);
      else if (p === 'cup') total += a;
      else total += perCup(a);
    }
    return total;
  }
  const ohPerCup = await overheadPerCup();

  // latest sell price per drink·size (pricing is newest-first)
  const sellByKey = {};
  for (const pr of pricing) {
    const key = `${pr.drink_name}||${pr.size}`;
    if (sellByKey[key] == null) sellByKey[key] = pr;
  }

  // recipe rows keyed by drink·size (newest-first, dedupe) so the form dropdown +
  // the live margin box can look up a recipe's cost by the same key the table uses.
  const recipeByKey = {};
  for (const rc of recipes) {
    const key = `${rc.drink_name}||${rc.size}`;
    if (recipeByKey[key] == null) recipeByKey[key] = rc;
  }

  // R38 edit state. NOTE: this Selling price table has NO Delete column — deleting a
  // recipe belongs to the Recipes tab, so here we only offer per-row Edit.
  let pricingEditingKey = null;   // "drink||size" being re-priced via the form
  let pricingEditingRowId = null; // existing pricing row id to PATCH (null -> POST new)

  // R38b: build the row data first, then SORT by margin highest -> lowest. Rows with
  // no sell price yet have a null margin and sort to the bottom. Deleting recipes is
  // the Recipes tab's job, so this table only offers Edit.
  const priceRows = [];
  for (const rc of recipes) {
    const ing = Array.isArray(rc.ingredients) ? rc.ingredients : [];
    const rcost = recipeCost(ing);
    const allIn = rcost + ohPerCup;
    const key = `${rc.drink_name}||${rc.size}`;
    const sellRow = sellByKey[key];
    const sell = sellRow == null ? null : Number(sellRow.sell_price);
    const margin = (sell == null) ? null : sell - allIn;
    priceRows.push({ rc, ing, rcost, allIn, key, sellRow, sell, margin });
  }
  priceRows.sort((a, b) => {
    if (a.margin == null && b.margin == null) return 0;
    if (a.margin == null) return 1;   // null margin sorts last
    if (b.margin == null) return -1;
    return b.margin - a.margin;       // highest -> lowest
  });

  // table: one row per recipe, with cost / overhead / all-in / sell / margin + Edit
  if (recipes.length) {
    const table = document.createElement('table');
    const cap = document.createElement('caption');
    cap.className = 'tbl-caption';
    cap.textContent = 'Selling price — one row per drink · size';
    table.appendChild(cap);
    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    ['Drink', 'Size', 'Recipe cost', 'Overhead / cup', 'All-in cost', 'Sell price', 'Margin', 'Edit'].forEach(h => {
      const th = document.createElement('th'); th.textContent = h; hrow.appendChild(th);
    });
    thead.appendChild(hrow);
    const tbody = document.createElement('tbody');
    for (const row of priceRows) {
      const { rc, ing, rcost, allIn, key, sellRow, sell, margin } = row;
      const tr = document.createElement('tr');
      const cells = [
        rc.drink_name, rc.size, peso(rcost), peso(ohPerCup), peso(allIn),
        sell == null ? '—' : peso(sell),
        margin == null ? '—' : peso(Math.round(margin * 100) / 100),
      ];
      cells.forEach((val, i) => {
        const td = document.createElement('td');
        if (i === 2 || i === 3 || i === 4 || i === 5) td.className = 'peso';
        if (i === 6 && margin != null) {
          td.className = margin >= 0 ? 'pos' : 'neg';
          td.textContent = (margin < 0 ? '-' : '') + peso(Math.abs(Math.round(margin * 100) / 100));
        } else {
          td.textContent = String(val);
        }
        tr.appendChild(td);
      });
      // Edit button: re-opens this drink·size in the sell-price form. If a pricing
      // row already exists for it, saving PATCHes that SAME row; otherwise it POSTs a
      // new one. Pre-fills the dropdown + price so the user just tweaks the number.
      const editTd = document.createElement('td');
      const editBtn = document.createElement('button');
      editBtn.className = 'btn-edit';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        pricingEditingKey = key;
        pricingEditingRowId = sellRow == null ? null : String(sellRow.id);
        drinkSel.value = key;
        priceInp.value = sell == null ? '' : String(sell);
        // R35 lesson: programmatic .value never fires events -> refresh the live box.
        updateMarginPreview();
      });
      editTd.appendChild(editBtn);
      tr.appendChild(editTd);
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    const scrollWrap = document.createElement('div');
    scrollWrap.className = 'scroll-y';
    scrollWrap.appendChild(table);
    sec.appendChild(scrollWrap);
  } else {
    const note = document.createElement('div'); note.className = 'empty-note';
    note.textContent = 'No recipes yet — build a recipe first, then set a sell price below.';
    sec.appendChild(note);
  }

  // summary card
  const card = document.createElement('div');
  card.className = 'card';
  const cl = document.createElement('div'); cl.className = 'peso';
  cl.textContent = `Overhead per cup ${peso(ohPerCup)} (applied to every drink)`;
  card.appendChild(cl);
  sec.appendChild(card);

  // sell-price form — mirror M3 UX: two-column field rows, a dropdown of EXISTING
  // recipes (drink + size) so a sell price always attaches to a real recipe, and a
  // live margin-preview box that recomputes as the drink/price change.
  const form = document.createElement('div');
  form.className = 'card';
  const mkRow = (labelText) => {
    const row = document.createElement('div');
    row.className = 'field-row';
    const lab = document.createElement('div');
    lab.className = 'field-label';
    lab.textContent = labelText;
    row.appendChild(lab);
    form.appendChild(row);
    return row;
  };

  const drinkRow = mkRow('Drink (pick a recipe)');
  const drinkSel = document.createElement('select');
  drinkSel.className = 'field';
  drinkSel.setAttribute('aria-label', 'Drink, pick an existing recipe');
  // A <select> defaults to its FIRST option, so prepend a blank option so an
  // untouched slot reads as empty (save skips it).
  const blankOpt = document.createElement('option');
  blankOpt.value = ''; blankOpt.textContent = '—';
  drinkSel.appendChild(blankOpt);
  // R38: options are the DISTINCT existing recipes (drink · size), newest-first, so
  // a sell price always maps to a real recipe. option value = "drink||size" (the
  // same key the table + margin box use); textContent = "Drink (Size)".
  const recipeOptions = [];
  const seenKeys = {};
  for (const rc of recipes) {
    const key = `${rc.drink_name}||${rc.size}`;
    if (seenKeys[key]) continue;
    seenKeys[key] = true;
    recipeOptions.push({ key, label: `${rc.drink_name} (${rc.size})` });
  }
  recipeOptions.sort((a, b) => a.label.localeCompare(b.label));
  for (const o of recipeOptions) {
    // R27b lesson: <option> needs BOTH value AND textContent or it renders blank.
    const opt = document.createElement('option');
    opt.value = o.key; opt.textContent = o.label;
    drinkSel.appendChild(opt);
  }
  drinkRow.appendChild(drinkSel);

  const priceRow = mkRow('Sell price (₱)');
  const priceInp = document.createElement('input');
  priceInp.className = 'field'; priceInp.type = 'number';
  priceInp.setAttribute('placeholder', 'Sell price (₱)');
  priceInp.setAttribute('aria-label', 'Sell price in pesos');
  priceRow.appendChild(priceInp);

  // live margin-preview box: as the drink + price change, show that recipe's all-in
  // cost and the resulting margin (green profitable / red below cost). Mirrors M3's
  // live resolve/cost boxes.
  const marginBox = document.createElement('div');
  marginBox.className = 'suggestion';
  form.appendChild(marginBox);
  function updateMarginPreview() {
    while (marginBox.firstChild) marginBox.removeChild(marginBox.firstChild);
    const key = String(drinkSel.value || '');
    if (!key) return;
    const rc = recipeByKey[key];
    if (!rc) return;
    const rcost = recipeCost(Array.isArray(rc.ingredients) ? rc.ingredients : []);
    const allIn = rcost + ohPerCup;
    const price = Number(priceInp.value);
    const div = document.createElement('div');
    let txt = `${rc.drink_name} (${rc.size}) · all-in ${peso(Math.round(allIn * 100) / 100)}`;
    if (price >= 0 && priceInp.value !== '') {
      const margin = price - allIn;
      txt += ` · sell ${peso(Math.round(price * 100) / 100)}`;
      txt += ` · margin ${margin >= 0 ? '' : '-'}${peso(Math.abs(Math.round(margin * 100) / 100))}`;
      txt += margin >= 0 ? ' (profitable)' : ' (below cost)';
    } else {
      txt += ' · set a sell price to see margin';
    }
    div.textContent = txt;
    marginBox.appendChild(div);
  }
  drinkSel.addEventListener('change', updateMarginPreview);
  priceInp.addEventListener('input', updateMarginPreview);
  updateMarginPreview();

  const addBtn = document.createElement('button');
  addBtn.className = 'btn-price'; addBtn.textContent = 'Set sell price';
  form.appendChild(addBtn);
  const freeNote = document.createElement('div');
  freeNote.className = 'empty-note';
  freeNote.textContent = 'Setting a sell price never changes stock or recipes — it is a staff reference.';
  form.appendChild(freeNote);
  sec.appendChild(form);

  addBtn.addEventListener('click', () => {
    const key = String(drinkSel.value || '');
    if (!key) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'Pick a recipe (drink + size) from the dropdown first.';
      form.appendChild(w); return;
    }
    const parts = key.split('||');
    const name = parts[0];
    const size = parts[1];
    const price = Number(priceInp.value);
    if (!(price >= 0)) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'Enter a non-negative sell price (₱).';
      form.appendChild(w); return;
    }
    // R38 edit mode: an Edit button was clicked, so update THAT pricing row in place.
    if (pricingEditingRowId) {
      patchData('pricing', `id=eq.${encodeURIComponent(pricingEditingRowId)}`,
        { drink_name: name, size, sell_price: price }).then(() => location.reload());
      return;
    }
    // Otherwise POST a new sell price (latest row per drink·size wins on read).
    postData('pricing', { drink_name: name, size, sell_price: price }).then(() => location.reload());
  });

  return sec;
}

// ---- Phase 8: Orders + draw-down ----
// Daily ticket: lines = drink + size + qty, running total ₱ (from pricing).
// On submit, expand each line through its recipe into ingredient base-units and
// check against current on_hand (sold term already live). If any ingredient would
// go negative -> BLOCK the order and flag "out of stock". Otherwise POST the
// order; the sold term then reduces on_hand on the Purchases/Stock-take pages.
// ---- R8: Module 5 — Daily Sales Recording (replaces Ordering) ----
// End-of-day record of sales + wastage with honest accounting. Wastage is valued
// AT COST (₱/OUM, never sell price) and decrements stock; a spilled cup is a
// wastage line ONLY, never also a sale line. Recording cannot block an over-sell
// (the day already happened) — it only flags "oversold"; stock-take reconciles.
// Accounting: Gross = Revenue − COGS; Net = Gross − Wastage; Wastage% = Wastage ÷ COGS.
async function renderDailySales() {
  const sec = document.createElement('section');
  sec.id = 'daily-sales';
  const t = document.createElement('div'); t.className = 'page-title'; t.textContent = 'Daily Sales';
  const s = document.createElement('div'); s.className = 'page-sub';
  s.textContent = 'End-of-day sales + wastage → revenue, COGS, net';
  sec.append(t, s);

  let recipes = [];
  let pricing = [];
  let sales = [];
  try {
    recipes = await getData('recipes', 'order=created_at.desc&select=*');
    pricing = await getData('pricing', 'order=created_at.desc&select=*');
    sales = await getData('daily_sales', 'order=created_at.desc&select=*');
  } catch (e) {
    const err = document.createElement('div'); err.className = 'empty-note';
    err.textContent = 'Could not load daily-sales data: ' + e.message;
    sec.appendChild(err);
    return sec;
  }

  const recById = {};
  for (const rc of recipes) recById[String(rc.id)] = rc;
  const rateByCode = await itemRateByCode();
  const invItems = await inventoryRows(); // current remaining (includes saved days)
  const remainingByCode = {};
  for (const it of invItems) remainingByCode[it.code] = it.remaining;

  // latest sell price per drink·size
  const sellByKey = {};
  for (const pr of pricing) {
    const key = `${pr.drink_name}||${pr.size}`;
    if (sellByKey[key] == null) sellByKey[key] = Number(pr.sell_price);
  }
  function recipeCost(ing) {
    if (!Array.isArray(ing)) return 0;
    let sum = 0;
    for (const ln of ing) {
      if (!ln) continue;
      const code = String(ln.inventory_code || '').trim().toUpperCase();
      if (rateByCode[code] != null) sum += Number(ln.qty_oum) * rateByCode[code];
    }
    return sum;
  }
  function sellPriceOf(rc) { return sellByKey[`${rc.drink_name}||${rc.size}`]; }

  // §6 history of past days (newest first)
  if (sales.length) {
    const hist = document.createElement('div');
    hist.className = 'card';
    const ht = document.createElement('div'); ht.textContent = 'Recorded days';
    hist.appendChild(ht);
    for (const ds of sales.slice(0, 8)) {
      const tt = ds.totals || {};
      const line = document.createElement('div');
      line.textContent = `id ${String(ds.id).slice(0, 8)} — ${ds.date || ''} — ${ds.recorder || ''} — Rev ${peso(tt.revenue)} · COGS ${peso(tt.cogs)} · Net ${peso(tt.net)}`;
      hist.appendChild(line);
    }
    sec.appendChild(hist);
  } else {
    const note = document.createElement('div'); note.className = 'empty-note';
    note.textContent = 'No days recorded yet — record one below.';
    sec.appendChild(note);
  }

  // §5 draw-down: current remaining vs this-day consumption (sold + wastage)
  const ddTable = document.createElement('table');
  const ddHead = document.createElement('thead');
  const ddRow = document.createElement('tr');
  ['Inventory ID', 'Item', 'UOM', 'Remaining', 'Consumed today', 'Projected', 'Oversold?'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; ddRow.appendChild(th);
  });
  ddHead.appendChild(ddRow);
  const ddBody = document.createElement('tbody');
  for (const it of invItems) {
    const tr = document.createElement('tr');
    const projected = it.remaining; // form not yet submitted; shows saved state
    const cells = [it.code, it.name, it.base_unit, `${it.remaining} ${it.base_unit}`, '—', `${projected} ${it.base_unit}`, projected < 0 ? 'OVERSOLD' : ''];
    cells.forEach((val, i) => {
      const td = document.createElement('td');
      if (i === 6 && projected < 0) { td.className = 'neg'; td.textContent = 'OVERSOLD'; }
      else td.textContent = String(val);
      tr.appendChild(td);
    });
    ddBody.appendChild(tr);
  }
  ddTable.append(ddHead, ddBody);
  sec.appendChild(ddTable);

  // record form: date + recorder + up to 6 sales lines + up to 6 wastage lines
  const form = document.createElement('div');
  form.className = 'card';
  const dateInp = document.createElement('input');
  dateInp.className = 'field'; dateInp.setAttribute('placeholder', 'Date (YYYY-MM-DD)');
  dateInp.setAttribute('aria-label', 'Date');
  const recInp = document.createElement('input');
  recInp.className = 'field'; recInp.setAttribute('placeholder', 'Recorder initials');
  recInp.setAttribute('aria-label', 'Recorder initials');
  form.append(dateInp, recInp);

  const N_LINES = 6;
  const saleInputs = [];
  for (let i = 0; i < N_LINES; i++) {
    const idInp = document.createElement('input');
    idInp.className = 'field'; idInp.setAttribute('placeholder', `Sale ${i + 1}: recipe id (copy from Recipes)`);
    idInp.setAttribute('aria-label', `Sale ${i + 1} recipe id`);
    const qtyInp = document.createElement('input');
    qtyInp.className = 'field'; qtyInp.type = 'number';
    qtyInp.setAttribute('placeholder', `cups ${i + 1}`);
    qtyInp.setAttribute('aria-label', `Sale ${i + 1} cups sold`);
    form.append(idInp, qtyInp);
    saleInputs.push([idInp, qtyInp]);
  }
  const N_WASTE = 6;
  const wasteInputs = [];
  for (let i = 0; i < N_WASTE; i++) {
    const codeInp = document.createElement('input');
    codeInp.className = 'field'; codeInp.setAttribute('placeholder', `Wastage ${i + 1}: Inventory ID (SC…)`);
    codeInp.setAttribute('aria-label', `Wastage ${i + 1} inventory code`);
    const qtyInp = document.createElement('input');
    qtyInp.className = 'field'; qtyInp.type = 'number';
    qtyInp.setAttribute('placeholder', `qty OUM ${i + 1}`);
    qtyInp.setAttribute('aria-label', `Wastage ${i + 1} quantity in OUM`);
    const reasonInp = document.createElement('input');
    reasonInp.className = 'field'; reasonInp.setAttribute('placeholder', `reason ${i + 1} (spoilage/spill/burnt/other)`);
    reasonInp.setAttribute('aria-label', `Wastage ${i + 1} reason`);
    form.append(codeInp, qtyInp, reasonInp);
    wasteInputs.push([codeInp, qtyInp, reasonInp]);
  }

  const recBtn = document.createElement('button');
  recBtn.className = 'btn-add'; recBtn.textContent = 'Record day';
  form.appendChild(recBtn);
  const spillNote = document.createElement('div');
  spillNote.className = 'empty-note';
  spillNote.textContent = 'A spilled cup = ONE wastage line in OUM — never also a sale line. Wastage is valued at cost and lowers stock.';
  form.appendChild(spillNote);
  sec.appendChild(form);

  recBtn.addEventListener('click', () => {
    const date = dateInp.value.trim();
    const recorder = recInp.value.trim();
    const lines = [];
    for (const [idInp, qtyInp] of saleInputs) {
      const idKey = idInp.value.trim();
      const qty = qtyInp.value.trim();
      if (idKey === '' && qty === '') continue;
      const rc = recipes.find(r => String(r.id) === idKey || String(r.id).startsWith(idKey));
      if (!rc || qty === '' || !(Number(qty) > 0)) {
        const w = document.createElement('div'); w.className = 'neg';
        w.textContent = 'Each sale line needs a valid recipe id and a positive cups count.';
        form.appendChild(w); return;
      }
      lines.push({ recipe_id: rc.id, size: rc.size, qty: Number(qty) });
    }
    const wastage = [];
    for (const [codeInp, qtyInp, reasonInp] of wasteInputs) {
      const code = codeInp.value.trim().toUpperCase();
      const qty = qtyInp.value.trim();
      const reason = reasonInp.value.trim();
      if (code === '' && qty === '') continue;
      if (!rateByCode[code] || qty === '' || !(Number(qty) > 0)) {
        const w = document.createElement('div'); w.className = 'neg';
        w.textContent = 'Each wastage line needs a valid Inventory ID (SC…) and a positive qty in OUM.';
        form.appendChild(w); return;
      }
      wastage.push({ inventory_code: code, qty_oum: Number(qty), reason });
    }
    if (!lines.length && !wastage.length) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'Add at least one sale or wastage line.';
      form.appendChild(w); return;
    }
    let revenue = 0, cogs = 0, wastageCost = 0;
    for (const ln of lines) {
      const rc = recById[String(ln.recipe_id)];
      if (!rc) continue;
      const sp = sellPriceOf(rc); const rcost = recipeCost(rc.ingredients);
      revenue += (sp == null ? 0 : sp) * ln.qty;
      cogs += rcost * ln.qty;
    }
    for (const w of wastage) {
      wastageCost += (rateByCode[w.inventory_code] || 0) * w.qty_oum;
    }
    const gross = revenue - cogs;
    const net = gross - wastageCost;
    const wastagePct = cogs > 0 ? wastageCost / cogs : 0;
    const totals = {
      revenue: Math.round(revenue * 100) / 100,
      cogs: Math.round(cogs * 100) / 100,
      gross: Math.round(gross * 100) / 100,
      wastage: Math.round(wastageCost * 100) / 100,
      wastagePct: Math.round(wastagePct * 1000) / 10,
      net: Math.round(net * 100) / 100,
    };
    // cannot block oversell — record regardless; stock-take reconciles later.
    postData('daily_sales', { date: date || null, recorder, lines, wastage, totals }).then(() => location.reload());
  });

  addDeleteCard(sec, sales, 'daily_sales', 'Daily-sales id (copy from a row)');
  addPrintButton(sec, 'Print daily-sales record');
  return sec;
}

// ---- R10: Ordering page RETIRED (replaced by Module 5 Daily Sales + Module 6 Inventory) ----
// soldByPurchase() already reads daily_sales (R8); nothing else reads the `orders` table.
