// app.js — Sleepless Café frontend (Phase 2)
// Gate + shared nav + 6 page shells + dashboard shell.
// Pages are intentionally empty here; each later phase fills one in.

// ---- pages (order = PLAN.md build order) ----
const PAGES = [
  { id: 'purchases',  title: 'Purchases',   sub: 'Materials, price, unit of measure → ₱ per base unit' },
  { id: 'recipes',    title: 'Recipes',     sub: 'Drink = ingredient combo → one-cup cost' },
  { id: 'overhead',   title: 'Overhead',    sub: 'Indirect costs → ₱ per cup' },
  { id: 'pricing',    title: 'Selling price', sub: 'Menu + margin per drink/size (staff reference)' },
  { id: 'ordering',   title: 'Ordering',    sub: 'Daily sells → draw down stock' },
  { id: 'stocktake',  title: 'Stock-take',  sub: 'Reconcile record vs actual → lost cost / savings' },
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

// Total sold base-units per purchase_id, expanded from every order line through
// its recipe's ingredients. Shared by Purchases, Stock-take and Ordering so all
// three pages show the same draw-down-adjusted on_hand.
async function soldByPurchase() {
  let orders = [];
  let recipes = [];
  try {
    orders = await getData('orders', 'order=created_at.desc&select=*');
    recipes = await getData('recipes', 'order=created_at.desc&select=*');
  } catch (e) { return {}; }
  const recById = {};
  for (const rc of recipes) recById[String(rc.id)] = rc;
  const sold = {};
  for (const o of orders) {
    const lines = Array.isArray(o.lines) ? o.lines : [];
    for (const ln of lines) {
      if (!ln) continue;
      const rc = recById[String(ln.recipe_id)];
      if (!rc) continue;
      const qty = Number(ln.qty) || 0;
      const ings = Array.isArray(rc.ingredients) ? rc.ingredients : [];
      for (const ing of ings) {
        if (!ing) continue;
        const pid = String(ing.purchase_id);
        sold[pid] = (sold[pid] || 0) + Number(ing.qty_base) * qty;
      }
    }
  }
  return sold;
}

async function buildSite() {
  const stage = document.getElementById('stage');

  const header = document.createElement('header');
  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.innerHTML = 'Sleepless Café <span class="mark">·</span> staff reference';
  const nav = document.createElement('nav');
  const dash = document.createElement('a');
  dash.href = '#dashboard'; dash.textContent = 'Dashboard'; dash.setAttribute('data-active', '1');
  nav.appendChild(dash);
  PAGES.forEach(p => {
    const a = document.createElement('a');
    a.href = `#${p.id}`; a.textContent = p.title;
    nav.appendChild(a);
  });
  header.append(brand, nav);

  const main = document.createElement('main');
  main.appendChild(await renderDashboard());
  for (const p of PAGES) {
    if (p.id === 'purchases') main.appendChild(await renderPurchases());
    else if (p.id === 'stocktake') main.appendChild(await renderStocktake());
    else if (p.id === 'recipes') main.appendChild(await renderRecipes());
    else if (p.id === 'overhead') main.appendChild(await renderOverhead());
    else if (p.id === 'pricing') main.appendChild(await renderPricing());
    else if (p.id === 'ordering') main.appendChild(await renderOrdering());
    else main.appendChild(section(p.id, p.title, p.sub));
  }

  stage.innerHTML = '';
  stage.append(header, main);

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

// stock value ₱ = Σ(on_hand × price_per_base) across purchases (draw-down
// adjusted). low-stock count = purchases where on_hand < low_at. quotes this
// month = number of orders whose date falls in the current month.
async function renderDashboard() {
  const sec = document.createElement('section');
  sec.id = 'dashboard';
  const t = document.createElement('div'); t.className = 'page-title'; t.textContent = 'Dashboard';
  const s = document.createElement('div'); s.className = 'page-sub';
  s.textContent = 'Summary cards — live stock, low-stock alerts, quotes this month';
  sec.append(t, s);

  let purchases = [];
  let orders = [];
  let sold = {};
  try {
    purchases = await getData('purchases', 'order=created_at.desc&select=*');
    sold = await soldByPurchase();
    orders = await getData('orders', 'order=created_at.desc&select=*');
  } catch (e) {
    const err = document.createElement('div'); err.className = 'empty-note';
    err.textContent = 'Could not load dashboard data: ' + e.message;
    sec.appendChild(err);
    return sec;
  }

  let stockValue = 0;
  let lowCount = 0;
  for (const r of purchases) {
    const oh = onHand(r, sold[String(r.id)] || 0);
    stockValue += oh * pricePerBase(r);
    if (oh < Number(r.low_at)) lowCount++;
  }

  // quotes this month = orders dated in the current YYYY-MM
  const ym = new Date().toISOString().slice(0, 7);
  let quotesThisMonth = 0;
  for (const o of orders) {
    if ((o.date || '').slice(0, 7) === ym) quotesThisMonth++;
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
  sec.appendChild(mkCard('Quotes this month', String(quotesThisMonth), 'num'));

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
  s.textContent = 'Materials, price, unit of measure → ₱ per base unit';
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

  // table
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  ['id', 'Name', 'Brand', 'Pack size', 'Unit', 'Qty packs', 'Cost', '₱ / base', 'On hand', 'Low?'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; hrow.appendChild(th);
  });
  thead.appendChild(hrow);
  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const oh = onHand(r, sold[String(r.id)] || 0);
    const low = oh < Number(r.low_at);
    const tr = document.createElement('tr');
    const cells = [
      String(r.id).slice(0, 8), r.name, r.brand || '—', `${Number(r.pack_size)} ${r.base_unit}`, r.base_unit,
      Number(r.qty_packs), peso(r.cost_price), rate(pricePerBase(r)),
      `${oh} ${r.base_unit}`, low ? 'LOW' : '',
    ];
    cells.forEach((val, i) => {
      const td = document.createElement('td');
      if (i === 6 || i === 7) td.className = 'peso';
      if (i === 9 && low) { td.className = 'neg'; td.textContent = 'LOW'; }
      else td.textContent = String(val);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  sec.appendChild(table);

  // add-row form
  const form = document.createElement('div');
  form.className = 'card';
  const fields = [
    ['name', 'Name'], ['brand', 'Brand'], ['pack_size', 'Pack size'],
    ['base_unit', 'Base unit'], ['qty_packs', 'Qty packs'], ['cost_price', 'Cost (₱)'],
    ['supplier', 'Supplier'], ['low_at', 'Low threshold'],
  ];
  const inputs = {};
  fields.forEach(([k, label]) => {
    const inp = document.createElement('input');
    inp.className = 'field'; inp.dataset.key = k;
    inp.setAttribute('placeholder', label);
    inp.setAttribute('aria-label', label);
    if (k === 'pack_size' || k === 'qty_packs' || k === 'cost_price' || k === 'low_at') inp.type = 'number';
    else inp.type = 'text';
    inputs[k] = inp;
    form.appendChild(inp);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-add'; addBtn.textContent = 'Add purchase';
  form.appendChild(addBtn);
  sec.appendChild(form);

  addBtn.addEventListener('click', () => {
    const obj = {};
    for (const [k] of fields) {
      const v = inputs[k].value.trim();
      if (v === '') continue;
      obj[k] = (k === 'pack_size' || k === 'qty_packs' || k === 'cost_price' || k === 'low_at') ? Number(v) : v;
    }
    if (!obj.name || obj.pack_size == null || obj.cost_price == null || !obj.base_unit) {
      const w = document.createElement('div'); w.className = 'neg'; w.textContent = 'Name, pack size, base unit and cost are required.';
      form.appendChild(w); return;
    }
    postData('purchases', obj).then(() => location.reload());
  });

  // restock action: add qty to an existing row, keep its recorded price
  const restock = document.createElement('div');
  restock.className = 'card';
  const idInp = document.createElement('input');
  idInp.className = 'field'; idInp.setAttribute('placeholder', 'Purchase id (copy from a row)');
  idInp.setAttribute('aria-label', 'Purchase id');
  const qtyInp = document.createElement('input');
  qtyInp.className = 'field'; qtyInp.type = 'number'; qtyInp.setAttribute('placeholder', 'Add packs');
  qtyInp.setAttribute('aria-label', 'Add packs');
  const restockBtn = document.createElement('button');
  restockBtn.className = 'btn-restock'; restockBtn.textContent = 'Restock';
  restock.append(idInp, qtyInp, restockBtn);
  sec.appendChild(restock);

  restockBtn.addEventListener('click', () => {
    const id = idInp.value.trim();
    const add = Number(qtyInp.value);
    if (!id || !(add > 0)) {
      const w = document.createElement('div'); w.className = 'neg'; w.textContent = 'Pick a row and a positive pack count.';
      restock.appendChild(w); return;
    }
    const row = rows.find(r => String(r.id) === id || String(r.id).startsWith(id));
    if (!row) {
      const w = document.createElement('div'); w.className = 'neg'; w.textContent = 'No such row.';
      restock.appendChild(w); return;
    }
    patchData('purchases', `id=eq.${encodeURIComponent(row.id)}`, { qty_packs: Number(row.qty_packs) + add })
      .then(() => location.reload());
  });

  return sec;
}

// ---- Phase 4: Stock-take reconcile ----
// variance = actual - on_hand; impact = |variance| x price_per_base.
// variance < 0 -> LOST cost (amber/red); variance > 0 -> SAVINGS (green).
// Saving a count appends a stocktakes row; the latest count per item
// self-corrects the record (on_hand shown = latest actual when one exists).
async function renderStocktake() {
  const sec = document.createElement('section');
  sec.id = 'stocktake';
  const t = document.createElement('div'); t.className = 'page-title'; t.textContent = 'Stock-take';
  const s = document.createElement('div'); s.className = 'page-sub';
  s.textContent = 'Reconcile record vs actual → lost cost / savings';
  sec.append(t, s);

  let purchases = [];
  let history = [];
  let sold = {};
  try {
    purchases = await getData('purchases', 'order=created_at.desc&select=*');
    history = await getData('stocktakes', 'order=created_at.desc&select=*');
    sold = await soldByPurchase();
  } catch (e) {
    const err = document.createElement('div'); err.className = 'empty-note';
    err.textContent = 'Could not load stock data: ' + e.message;
    sec.appendChild(err);
    return sec;
  }

  // latest recorded actual per purchase_id (history is newest-first)
  const latestActual = {};
  for (const st of history) {
    if (!Array.isArray(st.lines)) continue;
    for (const ln of st.lines) {
      if (ln && ln.purchase_id && latestActual[ln.purchase_id] == null) {
        latestActual[ln.purchase_id] = Number(ln.actual_base);
      }
    }
  }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  ['Name', 'Unit', 'Record on hand', 'Actual (latest)', 'Variance', 'Impact', 'Status'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; hrow.appendChild(th);
  });
  thead.appendChild(hrow);
  const tbody = document.createElement('tbody');

  let totalLost = 0, totalSavings = 0;
  for (const r of purchases) {
    const oh = onHand(r, sold[String(r.id)] || 0);
    const ppb = pricePerBase(r);
    const actual = latestActual[r.id];
    const variance = (actual == null) ? 0 : actual - oh;
    const impact = Math.abs(variance) * ppb;
    if (variance < 0) totalLost += impact;
    else if (variance > 0) totalSavings += impact;

    const status = variance < 0 ? 'LOST' : variance > 0 ? 'SAVINGS' : 'match';
    const tr = document.createElement('tr');
    const cells = [
      r.name, r.base_unit, `${oh} ${r.base_unit}`,
      actual == null ? '—' : `${actual} ${r.base_unit}`,
      variance === 0 ? '0' : (variance > 0 ? '+' : '') + variance,
      impact === 0 ? '—' : peso(Math.round(impact * 100) / 100),
      status,
    ];
    cells.forEach((val, i) => {
      const td = document.createElement('td');
      if (i === 5 && impact !== 0) {
        td.className = variance < 0 ? 'neg' : 'pos';
        td.textContent = (variance < 0 ? '-' : '+') + String(val);
      } else if (i === 6) {
        td.className = variance < 0 ? 'neg' : variance > 0 ? 'pos' : 'num';
        td.textContent = String(val);
      } else if (i === 4 && variance !== 0) {
        td.className = variance < 0 ? 'neg' : 'pos';
        td.textContent = String(val);
      } else {
        td.textContent = String(val);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  sec.appendChild(table);

  const foot = document.createElement('div');
  foot.className = 'card';
  const net = totalSavings - totalLost;
  const mk = (label, val, cls) => {
    const row = document.createElement('div');
    row.className = cls;
    row.textContent = `${label} ${peso(Math.round(val * 100) / 100)}`;
    return row;
  };
  foot.appendChild(mk('Total lost', totalLost, 'neg'));
  foot.appendChild(mk('Total savings', totalSavings, 'pos'));
  foot.appendChild(mk('Net', net, net < 0 ? 'neg' : 'pos'));
  sec.appendChild(foot);

  const form = document.createElement('div');
  form.className = 'card';
  const itemInp = document.createElement('input');
  itemInp.className = 'field'; itemInp.setAttribute('placeholder', 'Item id (copy from a row)');
  itemInp.setAttribute('aria-label', 'Item id');
  const actualInp = document.createElement('input');
  actualInp.className = 'field'; actualInp.type = 'number';
  actualInp.setAttribute('placeholder', 'Actual count (base unit)');
  actualInp.setAttribute('aria-label', 'Actual count in base unit');
  const dateInp = document.createElement('input');
  dateInp.className = 'field'; dateInp.setAttribute('placeholder', 'Date (YYYY-MM-DD)');
  dateInp.setAttribute('aria-label', 'Date');
  const counterInp = document.createElement('input');
  counterInp.className = 'field'; counterInp.setAttribute('placeholder', 'Counter initials');
  counterInp.setAttribute('aria-label', 'Counter initials');
  const recBtn = document.createElement('button');
  recBtn.className = 'btn-record'; recBtn.textContent = 'Record stock-take';
  form.append(itemInp, actualInp, dateInp, counterInp, recBtn);
  sec.appendChild(form);

  recBtn.addEventListener('click', () => {
    const idKey = itemInp.value.trim();
    const actual = actualInp.value.trim();
    if (!idKey || actual === '') {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'Pick an item and enter its actual count.';
      form.appendChild(w); return;
    }
    const row = purchases.find(r => String(r.id) === idKey || String(r.id).startsWith(idKey));
    if (!row) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'No such item.'; form.appendChild(w); return;
    }
    const oh = onHand(row, sold[String(row.id)] || 0);
    const ppb = pricePerBase(row);
    const act = Number(actual);
    const variance = act - oh;
    const impact = Math.abs(variance) * ppb;
    const line = { purchase_id: row.id, actual_base: act, variance, impact };
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

  if (history.length) {
    const hist = document.createElement('div');
    hist.className = 'card';
    const ht = document.createElement('div'); ht.textContent = 'Past stock-takes';
    hist.appendChild(ht);
    const htable = document.createElement('table');
    const hh = document.createElement('tr');
    ['Date', 'Counter', 'Items', 'Lost', 'Savings', 'Net'].forEach(x => {
      const th = document.createElement('th'); th.textContent = x; hh.appendChild(th);
    });
    const hhead = document.createElement('thead'); hhead.appendChild(hh);
    const hbody = document.createElement('tbody');
    for (const st of history) {
      const tt = st.totals || {};
      const tr = document.createElement('tr');
      const nLines = Array.isArray(st.lines) ? st.lines.length : 0;
      const cells = [st.date || '', st.counter || '—', String(nLines),
        peso(tt.lost || 0), peso(tt.savings || 0), peso(tt.net || 0)];
      cells.forEach((val, i) => {
        const td = document.createElement('td');
        if (i >= 3) td.className = 'peso';
        td.textContent = String(val);
        tr.appendChild(td);
      });
      hbody.appendChild(tr);
    }
    htable.append(hhead, hbody);
    hist.appendChild(htable);
    sec.appendChild(hist);
  } else {
    const note = document.createElement('div'); note.className = 'empty-note';
    note.textContent = 'No stock-takes recorded yet.';
    sec.appendChild(note);
  }

  addPrintButton(sec, 'Print stock-take sheet');
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

  // lookup helpers keyed by purchase id
  const byId = {};
  for (const p of purchases) byId[String(p.id)] = p;

  // cost of one recipe row, computed live from current ₱/base
  function recipeCost(ing) {
    if (!Array.isArray(ing)) return 0;
    let sum = 0;
    for (const ln of ing) {
      const p = ln && byId[String(ln.purchase_id)];
      if (p) sum += Number(ln.qty_base) * pricePerBase(p);
    }
    return sum;
  }

  // existing recipe cards
  if (recipes.length) {
    for (const rc of recipes) {
      const card = document.createElement('div');
      card.className = 'card';
      const head = document.createElement('div');
      head.textContent = `${rc.drink_name} · ${rc.size}`;
      card.appendChild(head);
      const ing = Array.isArray(rc.ingredients) ? rc.ingredients : [];
      if (ing.length) {
        const ul = document.createElement('div');
        ul.textContent = ing.map(ln => {
          const p = byId[String(ln.purchase_id)];
          const label = p ? `${p.name}${p.brand ? ' ' + p.brand : ''}` : '?';
          const unit = p ? p.base_unit : '';
          return `${ln.qty_base} ${unit} ${label}`;
        }).join(' · ');
        card.appendChild(ul);
      }
      const cost = document.createElement('div');
      cost.className = 'peso';
      cost.textContent = peso(recipeCost(ing));
      card.appendChild(cost);
      sec.appendChild(card);
    }
  } else {
    const note = document.createElement('div'); note.className = 'empty-note';
    note.textContent = 'No recipes yet — build one below.';
    sec.appendChild(note);
  }

  // recipe editor form: name + size + up to 6 ingredient (id, qty) pairs
  const form = document.createElement('div');
  form.className = 'card';
  const nameInp = document.createElement('input');
  nameInp.className = 'field'; nameInp.setAttribute('placeholder', 'Drink name');
  nameInp.setAttribute('aria-label', 'Drink name');
  const sizeInp = document.createElement('input');
  sizeInp.className = 'field'; sizeInp.setAttribute('placeholder', 'Size (S / M / L)');
  sizeInp.setAttribute('aria-label', 'Size S M or L');
  form.append(nameInp, sizeInp);

  const N_ING = 6;
  const ingInputs = [];
  for (let i = 0; i < N_ING; i++) {
    const idInp = document.createElement('input');
    idInp.className = 'field'; idInp.setAttribute('placeholder', `Ingredient ${i + 1}: purchase id`);
    idInp.setAttribute('aria-label', `Ingredient ${i + 1} purchase id`);
    const qtyInp = document.createElement('input');
    qtyInp.className = 'field'; qtyInp.type = 'number';
    qtyInp.setAttribute('placeholder', `qty ${i + 1} (base unit)`);
    qtyInp.setAttribute('aria-label', `Ingredient ${i + 1} quantity in base unit`);
    form.append(idInp, qtyInp);
    ingInputs.push([idInp, qtyInp]);
  }

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
    const size = sizeInp.value.trim().toUpperCase();
    if (!name || !['S', 'M', 'L'].includes(size)) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'Drink name and size (S/M/L) are required.';
      form.appendChild(w); return;
    }
    const ingredients = [];
    for (const [idInp, qtyInp] of ingInputs) {
      const idKey = idInp.value.trim();
      const qty = qtyInp.value.trim();
      if (idKey === '' && qty === '') continue;
      const p = purchases.find(r => String(r.id) === idKey || String(r.id).startsWith(idKey));
      if (!p || qty === '' || !(Number(qty) > 0)) {
        const w = document.createElement('div'); w.className = 'neg';
        w.textContent = 'Each ingredient needs a valid purchase id and a positive qty.';
        form.appendChild(w); return;
      }
      ingredients.push({ purchase_id: p.id, qty_base: Number(qty) });
    }
    if (!ingredients.length) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'Add at least one ingredient.';
      form.appendChild(w); return;
    }
    // POST to `recipes` ONLY — purchases are never touched (no draw-down).
    postData('recipes', { drink_name: name, size, ingredients }).then(() => location.reload());
  });

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

  const drinksPerMonth = settings.length ? Number(settings[0].drinks_per_month) : 0;

  // table of overhead rows
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  ['Label', 'Amount', 'Period', 'Monthly ₱'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; hrow.appendChild(th);
  });
  thead.appendChild(hrow);
  const tbody = document.createElement('tbody');

  let monthlyTotal = 0;
  for (const o of overhead) {
    const amt = Number(o.amount);
    const monthly = (o.period === 'annual') ? amt / 12 : amt;
    monthlyTotal += monthly;
    const tr = document.createElement('tr');
    const cells = [o.label, peso(amt), o.period, peso(monthly)];
    cells.forEach((val, i) => {
      const td = document.createElement('td');
      if (i === 1 || i === 3) td.className = 'peso';
      td.textContent = String(val);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  sec.appendChild(table);

  // per-cup figure
  OVERHEAD_PER_CUP = drinksPerMonth > 0 ? monthlyTotal / drinksPerMonth : 0;
  const card = document.createElement('div');
  card.className = 'card';
  const l1 = document.createElement('div'); l1.textContent = `Total monthly overhead ${peso(monthlyTotal)}`;
  const l2 = document.createElement('div'); l2.textContent = `Expected drinks / month ${drinksPerMonth}`;
  const l3 = document.createElement('div'); l3.className = 'peso';
  l3.textContent = `Overhead per cup ${peso(OVERHEAD_PER_CUP)}`;
  card.append(l1, l2, l3);
  sec.appendChild(card);

  // add-overhead form
  const form = document.createElement('div');
  form.className = 'card';
  const labelInp = document.createElement('input');
  labelInp.className = 'field'; labelInp.setAttribute('placeholder', 'Label (rent, salary…)');
  labelInp.setAttribute('aria-label', 'Label');
  const amtInp = document.createElement('input');
  amtInp.className = 'field'; amtInp.type = 'number';
  amtInp.setAttribute('placeholder', 'Amount (₱)'); amtInp.setAttribute('aria-label', 'Amount in pesos');
  const periodInp = document.createElement('input');
  periodInp.className = 'field'; periodInp.setAttribute('placeholder', 'Period (monthly / annual)');
  periodInp.setAttribute('aria-label', 'Period monthly or annual');
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-add'; addBtn.textContent = 'Add overhead';
  form.append(labelInp, amtInp, periodInp, addBtn);
  sec.appendChild(form);

  addBtn.addEventListener('click', () => {
    const label = labelInp.value.trim();
    const amount = Number(amtInp.value);
    const period = periodInp.value.trim().toLowerCase();
    if (!label || !(amount >= 0) || !['monthly', 'annual'].includes(period)) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'Label, amount and period (monthly/annual) required.';
      form.appendChild(w); return;
    }
    postData('overhead', { label, amount, period }).then(() => location.reload());
  });

  // set drinks/month form (updates the single settings row)
  const setForm = document.createElement('div');
  setForm.className = 'card';
  const drinksInp = document.createElement('input');
  drinksInp.className = 'field'; drinksInp.type = 'number';
  drinksInp.setAttribute('placeholder', 'Expected drinks / month');
  drinksInp.setAttribute('aria-label', 'Expected drinks per month');
  const setBtn = document.createElement('button');
  setBtn.className = 'btn-set'; setBtn.textContent = 'Set drinks / month';
  setForm.append(drinksInp, setBtn);
  sec.appendChild(setForm);

  setBtn.addEventListener('click', () => {
    const v = Number(drinksInp.value);
    if (!(v > 0)) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'Enter a positive drinks/month number.';
      setForm.appendChild(w); return;
    }
    if (settings.length) {
      patchData('settings', `id=eq.${encodeURIComponent(settings[0].id)}`, { drinks_per_month: v })
        .then(() => location.reload());
    } else {
      postData('settings', { drinks_per_month: v }).then(() => location.reload());
    }
  });

  return sec;
}

// ---- Phase 7: Selling price + margin ----
// For each recipe (drink · size), the one-cup cost = recipe_cost + overhead_per_cup.
// margin = sell_price - (recipe_cost + overhead_per_cup).
//   margin >= 0 -> green (profitable); margin < 0 -> red (selling below cost).
// Staff reference only: this page never changes stock or recipes.
async function renderPricing() {
  const sec = document.createElement('section');
  sec.id = 'pricing';
  const t = document.createElement('div'); t.className = 'page-title'; t.textContent = 'Selling price';
  const s = document.createElement('div'); s.className = 'page-sub';
  s.textContent = 'Menu + margin per drink/size (staff reference)';
  sec.append(t, s);

  let purchases = [];
  let recipes = [];
  let pricing = [];
  try {
    purchases = await getData('purchases', 'order=created_at.desc&select=*');
    recipes = await getData('recipes', 'order=created_at.desc&select=*');
    pricing = await getData('pricing', 'order=created_at.desc&select=*');
  } catch (e) {
    const err = document.createElement('div'); err.className = 'empty-note';
    err.textContent = 'Could not load pricing data: ' + e.message;
    sec.appendChild(err);
    return sec;
  }

  // cost helpers keyed by purchase id (same math as the Recipes page)
  const byId = {};
  for (const p of purchases) byId[String(p.id)] = p;
  function recipeCost(ing) {
    if (!Array.isArray(ing)) return 0;
    let sum = 0;
    for (const ln of ing) {
      const p = ln && byId[String(ln.purchase_id)];
      if (p) sum += Number(ln.qty_base) * pricePerBase(p);
    }
    return sum;
  }

  // latest sell price per drink·size (pricing is newest-first)
  const sellByKey = {};
  for (const pr of pricing) {
    const key = `${pr.drink_name}||${pr.size}`;
    if (sellByKey[key] == null) sellByKey[key] = Number(pr.sell_price);
  }

  // table: one row per recipe, with cost / overhead / sell / margin
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  ['Drink', 'Size', 'Recipe cost', 'Overhead / cup', 'All-in cost', 'Sell price', 'Margin'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; hrow.appendChild(th);
  });
  thead.appendChild(hrow);
  const tbody = document.createElement('tbody');

  if (recipes.length) {
    for (const rc of recipes) {
      const ing = Array.isArray(rc.ingredients) ? rc.ingredients : [];
      const rcost = recipeCost(ing);
      const allIn = rcost + OVERHEAD_PER_CUP;
      const sell = sellByKey[`${rc.drink_name}||${rc.size}`];
      const margin = (sell == null) ? null : sell - allIn;
      const tr = document.createElement('tr');
      const cells = [
        rc.drink_name, rc.size, peso(rcost), peso(OVERHEAD_PER_CUP), peso(allIn),
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
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    sec.appendChild(table);
  } else {
    const note = document.createElement('div'); note.className = 'empty-note';
    note.textContent = 'No recipes yet — build a recipe first, then set a sell price below.';
    sec.appendChild(note);
  }

  // summary card
  const card = document.createElement('div');
  card.className = 'card';
  const cl = document.createElement('div'); cl.className = 'peso';
  cl.textContent = `Overhead per cup ${peso(OVERHEAD_PER_CUP)} (applied to every drink)`;
  card.appendChild(cl);
  sec.appendChild(card);

  // add sell-price form
  const form = document.createElement('div');
  form.className = 'card';
  const nameInp = document.createElement('input');
  nameInp.className = 'field'; nameInp.setAttribute('placeholder', 'Drink name (match a recipe)');
  nameInp.setAttribute('aria-label', 'Drink name');
  const sizeInp = document.createElement('input');
  sizeInp.className = 'field'; sizeInp.setAttribute('placeholder', 'Size (S / M / L)');
  sizeInp.setAttribute('aria-label', 'Size S M or L');
  const priceInp = document.createElement('input');
  priceInp.className = 'field'; priceInp.type = 'number';
  priceInp.setAttribute('placeholder', 'Sell price (₱)');
  priceInp.setAttribute('aria-label', 'Sell price in pesos');
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-price'; addBtn.textContent = 'Set sell price';
  form.append(nameInp, sizeInp, priceInp, addBtn);
  sec.appendChild(form);

  addBtn.addEventListener('click', () => {
    const name = nameInp.value.trim();
    const size = sizeInp.value.trim().toUpperCase();
    const price = Number(priceInp.value);
    if (!name || !['S', 'M', 'L'].includes(size) || !(price >= 0)) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'Drink name, size (S/M/L) and a non-negative price required.';
      form.appendChild(w); return;
    }
    // newest row wins (latest sell price per drink·size), so a POST is enough.
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
async function renderOrdering() {
  const sec = document.createElement('section');
  sec.id = 'ordering';
  const t = document.createElement('div'); t.className = 'page-title'; t.textContent = 'Ordering';
  const s = document.createElement('div'); s.className = 'page-sub';
  s.textContent = 'Daily sells → draw down stock';
  sec.append(t, s);

  let purchases = [];
  let recipes = [];
  let pricing = [];
  let orders = [];
  try {
    purchases = await getData('purchases', 'order=created_at.desc&select=*');
    recipes = await getData('recipes', 'order=created_at.desc&select=*');
    pricing = await getData('pricing', 'order=created_at.desc&select=*');
    orders = await getData('orders', 'order=created_at.desc&select=*');
  } catch (e) {
    const err = document.createElement('div'); err.className = 'empty-note';
    err.textContent = 'Could not load ordering data: ' + e.message;
    sec.appendChild(err);
    return sec;
  }

  // current sold per purchase (so on_hand shown here matches the other pages)
  const recById = {};
  for (const rc of recipes) recById[String(rc.id)] = rc;
  const byId = {};
  for (const p of purchases) byId[String(p.id)] = p;

  function expandSold(lines) {
    const sold = {};
    for (const ln of lines) {
      if (!ln) continue;
      const rc = recById[String(ln.recipe_id)];
      if (!rc) continue;
      const qty = Number(ln.qty) || 0;
      const ings = Array.isArray(rc.ingredients) ? rc.ingredients : [];
      for (const ing of ings) {
        if (!ing) continue;
        const pid = String(ing.purchase_id);
        sold[pid] = (sold[pid] || 0) + Number(ing.qty_base) * qty;
      }
    }
    return sold;
  }
  function currentSold() {
    const sold = {};
    for (const o of orders) {
      const part = expandSold(Array.isArray(o.lines) ? o.lines : []);
      for (const k in part) sold[k] = (sold[k] || 0) + part[k];
    }
    return sold;
  }
  const soldNow = currentSold();

  // latest sell price per drink·size (for running total)
  const sellByKey = {};
  for (const pr of pricing) {
    const key = `${pr.drink_name}||${pr.size}`;
    if (sellByKey[key] == null) sellByKey[key] = Number(pr.sell_price);
  }
  function sellPriceOf(rc) {
    const key = `${rc.drink_name}||${rc.size}`;
    return sellByKey[key];
  }

  // on_hand table (draw-down adjusted) so staff can see stock before ordering
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  ['Name', 'Unit', 'On hand', 'Sold', 'Low?'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; hrow.appendChild(th);
  });
  thead.appendChild(hrow);
  const tbody = document.createElement('tbody');
  for (const r of purchases) {
    const sold = soldNow[String(r.id)] || 0;
    const oh = onHand(r, sold);
    const low = oh < Number(r.low_at);
    const tr = document.createElement('tr');
    const cells = [r.name, r.base_unit, `${oh} ${r.base_unit}`, `${sold} ${r.base_unit}`, low ? 'LOW' : ''];
    cells.forEach((val, i) => {
      const td = document.createElement('td');
      if (i === 4 && low) { td.className = 'neg'; td.textContent = 'LOW'; }
      else td.textContent = String(val);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  sec.appendChild(table);

  // order history (recent tickets)
  if (orders.length) {
    const hist = document.createElement('div');
    hist.className = 'card';
    const ht = document.createElement('div'); ht.textContent = 'Recent orders';
    hist.appendChild(ht);
    for (const o of orders.slice(0, 8)) {
      const line = document.createElement('div');
      const ls = Array.isArray(o.lines) ? o.lines : [];
      const desc = ls.map(ln => {
        const rc = recById[String(ln.recipe_id)];
        const label = rc ? `${rc.drink_name} · ${rc.size}` : '?';
        return `${label} × ${Number(ln.qty)}`;
      }).join(' · ');
      line.textContent = `${o.date || ''} — ${desc || '(no lines)'} — ${peso(o.running_total)}`;
      hist.appendChild(line);
    }
    sec.appendChild(hist);
  } else {
    const note = document.createElement('div'); note.className = 'empty-note';
    note.textContent = 'No orders yet — build a ticket below.';
    sec.appendChild(note);
  }

  // ticket builder: up to 6 (recipe-id + qty) lines
  const form = document.createElement('div');
  form.className = 'card';
  const N_LINES = 6;
  const lineInputs = [];
  for (let i = 0; i < N_LINES; i++) {
    const idInp = document.createElement('input');
    idInp.className = 'field'; idInp.setAttribute('placeholder', `Line ${i + 1}: recipe id (copy from Recipes)`);
    idInp.setAttribute('aria-label', `Line ${i + 1} recipe id`);
    const qtyInp = document.createElement('input');
    qtyInp.className = 'field'; qtyInp.type = 'number';
    qtyInp.setAttribute('placeholder', `qty ${i + 1}`);
    qtyInp.setAttribute('aria-label', `Line ${i + 1} quantity`);
    form.append(idInp, qtyInp);
    lineInputs.push([idInp, qtyInp]);
  }
  const submitBtn = document.createElement('button');
  submitBtn.className = 'btn-submit'; submitBtn.textContent = 'Submit order';
  form.appendChild(submitBtn);
  sec.appendChild(form);

  submitBtn.addEventListener('click', () => {
    // gather lines
    const lines = [];
    for (const [idInp, qtyInp] of lineInputs) {
      const idKey = idInp.value.trim();
      const qtyStr = qtyInp.value.trim();
      if (idKey === '' && qtyStr === '') continue;
      const rc = recipes.find(r => String(r.id) === idKey || String(r.id).startsWith(idKey));
      if (!rc || qtyStr === '' || !(Number(qtyStr) > 0)) {
        const w = document.createElement('div'); w.className = 'neg';
        w.textContent = 'Each line needs a valid recipe id and a positive qty.';
        form.appendChild(w); return;
      }
      lines.push({ recipe_id: rc.id, size: rc.size, qty: Number(qtyStr) });
    }
    if (!lines.length) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'Add at least one line.';
      form.appendChild(w); return;
    }

    // running total from pricing (missing sell price -> 0 contribution)
    let runningTotal = 0;
    for (const ln of lines) {
      const rc = recById[String(ln.recipe_id)];
      const sp = rc ? sellPriceOf(rc) : null;
      if (sp != null) runningTotal += sp * ln.qty;
    }

    // draw-down check: expand this ticket's lines into ingredient base-units
    const need = expandSold(lines);
    const shortages = [];
    for (const pid in need) {
      const p = byId[pid];
      if (!p) continue;
      const oh = onHand(p, soldNow[pid] || 0);
      if (need[pid] > oh) {
        shortages.push(`${p.name}${p.brand ? ' ' + p.brand : ''}: need ${need[pid]} ${p.base_unit}, only ${oh} ${p.base_unit} on hand`);
      }
    }
    if (shortages.length) {
      const w = document.createElement('div'); w.className = 'neg';
      w.textContent = 'OUT OF STOCK — order blocked: ' + shortages.join('; ');
      form.appendChild(w); return;
    }

    const body = {
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toTimeString().slice(0, 8),
      lines,
      running_total: Math.round(runningTotal * 100) / 100,
    };
    postData('orders', body).then(() => location.reload());
  });

  addPrintButton(sec, 'Print order ticket');
  return sec;
}
