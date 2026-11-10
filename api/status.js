// GET /api/status?t=LINK_TOKEN -> is this link connected, and when did the last tap / test run arrive?
// The Automate screen polls this so you can see your Apple Pay automation working.
import { rpc, validToken, send } from "./_lib.js";

export default async function handler(req, res) {
  const t = String((req.query && req.query.t) || "");
  if (!validToken(t)) return send(res, req, 400, { ok: false, error: "bad token" });
  try {
    return send(res, req, 200, await rpc("budget_link_status", { p_token: t, p_mark_test: false }));
  } catch (e) {
    return send(res, req, 502, { ok: false, error: e.message });
  }
}
