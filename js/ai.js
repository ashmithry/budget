// Calls /api/ai (Claude). Uses the link token, so it needs sync turned on.
// Sends only what each feature needs: store names, one typed sentence, or a week's totals.
import { get } from "./store.js";
import { categories } from "./engine.js";
import { currentToken } from "./sync.js";

const MESSAGES = {
  sync_off: "Turn on sync in Automate to use Claude features.",
  offline: "You're offline. Try again when you're connected.",
  no_key: "Claude isn't connected yet. Add ANTHROPIC_API_KEY to the budget project in Vercel.",
  bad_key: "The Anthropic API key on Vercel isn't valid. Check ANTHROPIC_API_KEY.",
  limit: "You've hit today's Claude limit. It resets tomorrow.",
  busy: "Claude is busy right now. Try again in a minute.",
  declined: "Claude couldn't help with that one.",
};

export class AIError extends Error {}

export async function ai(task, payload = {}) {
  const t = await currentToken();
  if (!t) throw new AIError(MESSAGES.sync_off);
  if (!navigator.onLine) throw new AIError(MESSAGES.offline);
  let r;
  try {
    r = await fetch("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t, task, cats: categories(get()).map((c) => ({ id: c.id, name: c.name })), ...payload }),
    });
  } catch {
    throw new AIError(MESSAGES.offline);
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new AIError(MESSAGES[d.error] || "Claude couldn't do that right now. Try again.");
  return d;
}
