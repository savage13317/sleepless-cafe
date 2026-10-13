// supabase.js — thin REST helper (Phase 2)
// Publishable key is browser-safe by design; real enforcement is RLS rules (Phase 10).
const SUPABASE_URL = 'https://jilhkgicxpewdsqgxfbm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hJlD_oYfYCgwYf1C-dj7vA_GDnabmJs';

async function getData(table, query = 'select=*') {
  const url = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?${query}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${table}: HTTP ${res.status}`);
  return res.json();
}

// Write helpers. RLS is currently OFF, so the publishable key can write;
// Phase 10 adds rules so only the gated flow may write (see security note).
// Supabase returns 200/201/204 with an EMPTY body for writes, so never
// blindly call res.json() — read text first and parse only if non-empty.
async function postData(table, obj) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  });
  if (!res.ok) throw new Error(`Supabase POST ${table}: HTTP ${res.status}`);
  const text = await res.text();
  return text === '' ? null : JSON.parse(text);
}

async function patchData(table, query, obj) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?${query}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${table}: HTTP ${res.status}`);
  const text = await res.text();
  return text === '' ? null : JSON.parse(text);
}

// Delete rows matching a query (e.g. `id=eq.<uuid>`). Supabase returns 204
// with an empty body on success, so never blindly parse the response.
async function deleteData(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?${query}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase DELETE ${table}: HTTP ${res.status}`);
  const text = await res.text();
  return text === '' ? null : JSON.parse(text);
}
