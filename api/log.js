// POST or GET /api/log?t=TOKEN&amount=12.34&merchant=Starbucks[&card=...][&cat=coffee][&kind=income][&format=text]
// Used by the Apple Pay "Transaction" automation, the Quick Log shortcut, and Android automations.
// The spend waits in your inbox and the app files it next time it opens. Replies with what's left today.
import { rpc, validToken, params, parseAmount, widgetNumbers, money, send } from "./_lib.js";

const CATS = /^[a-z0-9_-]{1,24}$/;

// The amount field first; otherwise any currency-looking number in what the shortcut sent
// (some setups pass the whole Shortcut Input as text instead of picking Amount).
function findAmount(p) {
  const direct = parseAmount(p.amount);
  if (Number.isFinite(direct) && direct !== 0) return direct;
  for (const v of [p.amount, p.input, p.text, p.transaction]) {
    const m = String(v ?? "").match(/[-−]?\s?[$€£]\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*\.\d{2}/);
    if (m) {
      const n = parseAmount(m[0].replace("−", "-"));
      if (Number.isFinite(n) && n !== 0) return n;
    }
  }
  return NaN;
}

export default async function handler(req, res) {
  const p = params(req);
  const t = String(p.t || p.token || "");
  if (!validToken(t)) return send(res, req, 400, { ok: false, error: "missing or bad token", text: "Not logged: the link is missing your token. Copy it again from the app." });
  // A run with no amount at all (running the shortcut by hand to grant iOS's "Allow to connect" prompt)
  // is a connection test: nothing is logged.
  const anyAmount = [p.amount, p.input, p.text, p.transaction].some((x) => String(x ?? "").trim() !== "");
  if (!anyAmount) {
    try {
      const st = await rpc("budget_link_status", { p_token: t, p_mark_test: true });
      if (!st.ok) return send(res, req, 400, { ok: false, error: "unknown link", text: "Not connected: this link isn't linked to a budget. In the app, go to Automate and copy the link again." });
      return send(res, req, 200, { ok: true, test: true, text: "Connected to your budget. Apple Pay taps will now log automatically. (Test run: nothing was logged.)" });
    } catch (e) {
      return send(res, req, 502, { ok: false, error: e.message, text: "Couldn't reach your budget right now." });
    }
  }
  const raw = findAmount(p);
  if (!Number.isFinite(raw) || raw === 0 || Math.abs(raw) > 100000) return send(res, req, 400, { ok: false, error: "bad amount", text: `Not logged: couldn't read the amount "${String(p.amount ?? p.input ?? "").slice(0, 30)}". In the shortcut, the amount field should be Shortcut Input › Amount.` });
  const kind = p.kind === "income" ? "income" : "expense";
  const item = {
    amount: Math.round(Math.abs(raw) * 100) / 100,
    kind,
    refund: kind === "expense" && raw < 0 ? true : undefined,
    merchant: String(p.merchant || p.note || "").slice(0, 80) || undefined,
    card: p.card ? String(p.card).slice(0, 40) : undefined,
    cat: CATS.test(String(p.cat || "")) ? String(p.cat) : undefined,
    source: p.source === "applepay" || p.card ? "applepay" : "shortcut",
    at: Date.now(),
  };
  try {
    await rpc("budget_log", { p_token: t, p_item: item });
  } catch (e) {
    return send(res, req, e.status || 500, { ok: false, error: e.message, text: `Not logged: ${e.message}` });
  }
  // It's logged now. If reading today's numbers fails, still say so (a retry would double-count).
  const what = `${money(kind === "income" ? item.amount : raw, "$")}${item.merchant ? ` at ${item.merchant}` : ""}`;
  try {
    const w = widgetNumbers(await rpc("budget_widget", { p_token: t }));
    return send(res, req, 200, { ok: true, logged: item, widget: w, text: w.ok ? `Logged ${what}. ${w.text}` : `Logged ${what}.` });
  } catch {
    return send(res, req, 200, { ok: true, logged: item, text: `Logged ${what}.` });
  }
}
