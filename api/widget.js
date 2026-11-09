// GET /api/widget?t=TOKEN[&format=text]
// Today's safe-to-spend for home-screen / lock-screen widgets and Shortcuts notifications.
import { rpc, validToken, widgetNumbers, send } from "./_lib.js";

export default async function handler(req, res) {
  const t = String((req.query && req.query.t) || "");
  if (!validToken(t)) return send(res, req, 400, { ok: false, error: "missing or bad token", text: "Widget isn't set up: copy your link from the app (Automate)." });
  try {
    const data = await rpc("budget_widget", { p_token: t });
    return send(res, req, 200, widgetNumbers(data));
  } catch (e) {
    return send(res, req, e.status || 500, { ok: false, error: e.message, text: "Couldn't reach your budget right now." });
  }
}
