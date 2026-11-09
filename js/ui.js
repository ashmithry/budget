// Small DOM helpers: escaping, money formatting, bottom sheets, toasts, icons.
import { get } from "./store.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function money(n, { cents = "auto", sign = false } = {}) {
  const cur = get().settings.currency || "$";
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

/* ---------- icons (inline SVG, stroke = currentColor) ---------- */
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  plan: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
};
export const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ""}</svg>`;
