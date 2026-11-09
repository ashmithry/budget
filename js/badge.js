// App-icon badge = whole dollars left to spend today (iOS 16.4+ Home Screen apps, Chrome/Edge installed apps).
import { get } from "./store.js";
import { compute } from "./engine.js";

export async function updateBadge() {
  if (!("setAppBadge" in navigator)) return;
  try {
    if (!get().settings.badge || !get().settings.onboarded) return await navigator.clearAppBadge();
    const n = Math.floor(compute(get()).leftToday);
    if (n > 0) await navigator.setAppBadge(Math.min(n, 9999));
    else await navigator.clearAppBadge();
  } catch {}
}
