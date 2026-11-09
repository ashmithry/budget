// POST or GET /api/log?t=TOKEN&amount=12.34&merchant=Starbucks[&card=...][&cat=coffee][&kind=income][&format=text]
// Used by the Apple Pay "Transaction" automation, the Quick Log shortcut, and Android automations.
// The spend waits in your inbox and the app files it next time it opens. Replies with what's left today.
import { rpc, validToken, params, parseAmount, widgetNumbers, money, send } from "./_lib.js";

const CATS = /^[a-z0-9_-]{1,24}$/;

export default async function handler(req, res) {
  const p = params(req);
  const t = String(p.t || p.token || "");
  if (!validToken(t)) return send(res, req, 400, { ok: false, error: "missing or bad token", text: "Not logged: the link is missing your token. Copy it again from the app." });
  const raw = parseAmount(p.amount);
  if (!Number.isFinite(raw) || raw === 0 || Math.abs(raw) > 100000) return send(res, req, 400, { ok: false, error: "bad amount", text: `Not logged: couldn't read the amount "${String(p.amount ?? "").slice(0, 20)}".` });
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
