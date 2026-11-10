// Shared by /api/log and /api/widget. No dependencies: they just call the Supabase budget_* functions.
const SUPABASE = (process.env.SUPABASE_URL || "https://uwpyztvtwubbteftflbu.supabase.co") + "/rest/v1/rpc/";
const SB_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_m3wgNay9L6q8QllOggLDuA_UMzzki49";

export async function rpc(fn, body) {
  const r = await fetch(SUPABASE + fn, {
    method: "POST",
    headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!r.ok) {
    const err = new Error(data.message || `error ${r.status}`);
    err.status = r.status >= 500 ? 502 : 400;
    throw err;
  }
  return data;
}

export const validToken = (t) => /^[a-f0-9]{32,64}$/.test(String(t || ""));

// Request params from the query string, a JSON body or a form body (Shortcuts can send any of these).
export function params(req) {
  let body;
  try { body = req.body; } catch { body = undefined; }
  const ctype = String((req.headers && req.headers["content-type"]) || "");
  if (body && (Buffer.isBuffer(body) || typeof body === "string") && ctype.includes("multipart/form-data")) {
    const out = {};
    const re = /name="([^"]+)"\r?\n(?:[^\r\n]+\r?\n)*\r?\n([\s\S]*?)\r?\n--/g;
    let m;
    while ((m = re.exec(String(body)))) out[m[1]] = m[2];
    body = out;
  } else if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch {
      body = Object.fromEntries(new URLSearchParams(body));
    }
  }
  return { ...(req.query || {}), ...(body && typeof body === "object" ? body : {}) };
}

// "$1,234.56", "1.234,56 €", "-$4.00", "12" -> number
export function parseAmount(v) {
  if (typeof v === "number") return v;
  let s = String(v ?? "").trim();
  if (!s) return NaN;
  const neg = /^\(.*\)$/.test(s) || /^-|^[^\d]*-/.test(s);
  s = s.replace(/[^\d.,]/g, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastComma > lastDot && s.length - lastComma <= 3) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = parseFloat(s);
  return neg ? -n : n;
}

const dayAt = (ms, tz) => new Date(ms + tz * 60000).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function money(n, cur = "$") {
  const v = Math.abs(n);
  const s = v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2).replace(/\.00$/, "");
  return (n < 0 ? "-" : "") + cur + s;
}

// Recompute today's numbers from the app's last snapshot plus anything logged since.
export function widgetNumbers(data, now = Date.now()) {
  const snap = data && data.snapshot;
  if (!snap || !snap.day) return { ok: false, setup: true, text: "Open the budget app once to set up this widget." };
  const tz = Number(snap.tz) || 0;
  const t = dayAt(now, tz);
  // Money logged since the app last synced. Income raises what's left; it isn't "negative spending".
  let pendAll = 0;
  let pendToday = 0;
  let incomeAll = 0;
  for (const p of data.pending || []) {
    let a = Math.abs(parseAmount(p.amount)) || 0;
    if (p.kind === "income") { incomeAll += a; continue; }
    if (p.refund) a = -a;
    pendAll += a;
    if (dayAt(Number(p.at) || now, tz) === t) pendToday += a;
  }
  const cur = snap.cur || "$";
  let { dailyBase: base, spentToday: spent, daysLeft, pool } = snap;
  pool = pool - pendAll + incomeAll;
  let stale = false;
  if (t <= snap.day) {
    spent = snap.spentToday + pendToday;
    base = snap.dailyBase + incomeAll / Math.max(1, daysLeft);
  } else if (t <= snap.periodEnd) {
    daysLeft = diffDays(t, snap.periodEnd) + 1;
    spent = pendToday;
    base = (pool + spent) / daysLeft;
  } else {
    stale = true;
    daysLeft = 0;
    spent = pendToday;
    base = 0;
  }
  const cap = Number(snap.cap) || 0;
  if (cap > 0) base = Math.min(base, cap);
  const left = Math.round((base - spent) * 100) / 100;
  const r2 = (n) => Math.round(n * 100) / 100;
  let status = "good";
  if (stale) status = "stale";
  else if (pool < 0) status = "short";
  else if (left < 0) status = "over";
  else if (base > 0 && left < base * 0.3) status = "tight";
  const endDow = DOW[new Date(snap.periodEnd + "T12:00:00Z").getUTCDay()];
  const tomorrow = daysLeft > 1 ? r2(Math.min(Math.max(pool, 0) / (daysLeft - 1), cap > 0 ? cap : Infinity)) : null;
  let text;
  if (stale) text = "New pay period. Open the app to refresh.";
  else if (status === "short") text = `You're ${money(-pool, cur)} short until payday. Hold off on extras.`;
  else if (status === "over") text = `Over by ${money(-left, cur)} today.${tomorrow != null ? ` Tomorrow: ${money(tomorrow, cur)}/day.` : ""}`;
  else text = `${money(left, cur)} left today. ${money(base, cur)} a day through ${endDow}.`;
  return {
    ok: true,
    status,
    left,
    daily: r2(base),
    spentToday: r2(spent),
    pool: r2(pool),
    daysLeft,
    periodEnd: snap.periodEnd,
    tomorrow,
    streak: pendToday > 0 && t === snap.day ? 0 : snap.streak || 0,
    pending: (data.pending || []).length,
    cur,
    updated: snap.savedAt,
    text,
  };
}

export function send(res, req, status, obj) {
  const fmt = String((req.query && req.query.format) || "").toLowerCase();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (fmt === "text") {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(status).send(obj.text || obj.error || "");
  }
  return res.status(status).json(obj);
}
