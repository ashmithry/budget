// Small DOM helpers: escaping, money formatting, bottom sheets, toasts, icons.
import { get } from "./store.js";
import { ic } from "./icons.js";
import { DEFAULT_CATS } from "./engine.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function money(n, { cents = "auto", sign = false } = {}) {
  const cur = esc(String(get().settings.currency || "$").slice(0, 3));
  const v = Math.abs(Number(n) || 0);
  let s;
  if (cents === false || (cents === "auto" && v >= 1000)) s = Math.round(v).toLocaleString("en-US");
  else s = v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (cents === "auto" && v < 1000) s = s.replace(/\.00$/, "");
  const neg = Number(n) < 0;
  return `${neg ? "−" : sign ? "+" : ""}${cur}${s}`;
}

export const plural = (n, word, many = word + "s") => `${n} ${n === 1 ? word : many}`;

export function hoursText(h) {
  if (h == null) return "";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min of work`;
  if (h < 10) return `${(Math.round(h * 10) / 10).toString()} hrs of work`;
  return `${Math.round(h)} hrs of work`;
}

export function haptic(ms = 8) {
  try { navigator.vibrate?.(ms); } catch {}
}

/* ---------- toast ---------- */
let toastEl;
let toastTimer;
export function toast(msg, action) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    toastEl.setAttribute("role", "status");
    document.body.appendChild(toastEl);
  }
  toastEl.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ""}`;
  if (action) toastEl.querySelector("button").onclick = () => { action.run(); toastEl.classList.remove("show"); };
  requestAnimationFrame(() => toastEl.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), action ? 5000 : 2600);
}

/* ---------- bottom sheets ---------- */
const openSheets = [];
export function sheet(render, { onClose } = {}) {
  const bd = document.createElement("div");
  bd.className = "backdrop";
  const el = document.createElement("div");
  el.className = "sheet";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  document.body.append(bd, el);
  let closed = false;
  const api = {
    el,
    close() {
      if (closed) return;
      closed = true;
      el.classList.remove("show");
      bd.classList.remove("show");
      setTimeout(() => { el.remove(); bd.remove(); }, 280);
      const i = openSheets.indexOf(api);
      if (i >= 0) openSheets.splice(i, 1);
      onClose?.();
    },
    render() {
      el.innerHTML = `<div class="grab"></div>` + render(api);
      api.bind?.(el);
    },
    bind: null,
  };
  bd.onclick = () => api.close();
  openSheets.push(api);
  api.render();
  requestAnimationFrame(() => { bd.classList.add("show"); el.classList.add("show"); });
  // swipe down on the grab handle / header to close
  let y0 = null;
  el.addEventListener("touchstart", (e) => { if (el.scrollTop <= 0 && e.target.closest(".grab, h3")) y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener("touchmove", (e) => { if (y0 != null && e.touches[0].clientY - y0 > 70) { y0 = null; api.close(); } }, { passive: true });
  return api;
}
export const closeAllSheets = () => [...openSheets].forEach((s) => s.close());
export const topSheet = () => openSheets[openSheets.length - 1];
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openSheets.length) openSheets[openSheets.length - 1].close(); });

export function confirmSheet(title, body, okLabel = "Delete", danger = true) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet(() => `<h3>${esc(title)}</h3><p class="muted">${esc(body)}</p>
      <div class="two"><button class="btn ghost" data-no>Cancel</button><button class="btn ${danger ? "danger" : "primary"}" data-yes>${esc(okLabel)}</button></div>`, { onClose: () => !done && resolve(false) });
    s.el.querySelector("[data-no]").onclick = () => s.close();
    s.el.querySelector("[data-yes]").onclick = () => { done = true; resolve(true); s.close(); };
  });
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    toast("Long-press the text to copy it");
  }
}

/* ---------- icons ---------- */
// Old short names used around the app, mapped to Lucide.
const ALIAS = { home: "house", list: "receipt-text", chart: "chart-no-axes-column", plan: "calendar-days", gear: "settings", back: "chevron-left", bolt: "zap", close: "x" };
export const icon = (name, opts) => ic(ALIAS[name] || name, opts);
export { ic };

const CAT_DEFAULTS = Object.fromEntries(DEFAULT_CATS.map((c) => [c.id, c]));
export function catLook(c) {
  const d = CAT_DEFAULTS[c?.id];
  return { icon: c?.icon || d?.icon || "tag", color: c?.color || d?.color || "#7a7f72" };
}
// A tinted square with a colored stroke icon: the visual identity of a category, goal, bill…
export const tile = (name, color = "#56625b", size = 19) => `<span class="tile" style="--c:${color}">${ic(name, { size })}</span>`;
export const catTile = (c) => {
  const l = catLook(c);
  return tile(l.icon, l.color);
};
// Inline icon sitting in a line of text.
export const inl = (name, size = 16) => ic(name, { size, cls: "inl" });

// A selectable pill with an icon. `attrs` is a preformatted attribute string like 'data-cat="food"'.
export const chip = (name, label, on, attrs, color) =>
  `<button type="button" class="chip-btn ${on ? "on" : ""}" ${attrs}${color ? ` style="--c:${color}"` : ""}>${ic(name, { size: 16 })}<span>${esc(label)}</span></button>`;

// Nudge card. kind: info | ok | warn | bad. The colored rule + icon tell you the kind at a glance.
export function nudge(kind, name, title, desc, buttons = "") {
  return `<div class="card nudge-card ${kind}"><div class="nudge"><span class="nic">${ic(name, { size: 18 })}</span><div class="grow"><div class="t">${title}</div>${desc ? `<div class="d">${desc}</div>` : ""}${buttons ? `<div class="btns">${buttons}</div>` : ""}</div></div></div>`;
}

export const emptyState = (name, html) => `<div class="card empty"><span class="empty-ic">${ic(name, { size: 26, stroke: 1.5 })}</span><div>${html}</div></div>`;
