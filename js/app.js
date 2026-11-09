// Boot, routing, and the loops that keep things automatic (bills, paydays, sync, badge).
import { get, subscribe, runAutomation, commit } from "./store.js";
import { today } from "./dates.js";
import { guessCategory, live } from "./engine.js";
import { $, icon, toast, money, closeAllSheets, inl, nudge, plural } from "./ui.js";
import { openAdd, openAfford } from "./sheets.js";
import { sync, pushSnapshotSoon } from "./sync.js";
import { updateBadge } from "./badge.js";
import { renderHome, homeActions } from "./views/home.js";
import { renderActivity, activityActions, bindActivity } from "./views/activity.js";
import { renderPlan, renderWait, planActions } from "./views/plan.js";
import { renderInsights } from "./views/insights.js";
import { renderSettings, bindSettings, renderAutomate, bindAutomate, settingsActions, automateActions, applyTheme } from "./views/settings.js";
import { renderOnboard, onboardActions, onboardBefore } from "./views/onboard.js";

const root = $("#app");
const tabsEl = $("#tabs");
const ACTIONS = { ...homeActions, ...activityActions, ...planActions, ...settingsActions, ...automateActions };

function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, query] = h.split("?");
  const parts = path.split("/").filter(Boolean);
  return { name: parts[0] || "home", arg: parts[1], query: new URLSearchParams(query || "") };
}

const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function installBanner() {
  if (isStandalone() || get().settings.hideInstall) return "";
  const how = isIOS() ? `Tap <b>Share</b> ${inl("share")} then <b>Add to Home Screen</b>.` : "Use your browser menu → <b>Install app</b> / <b>Add to Home screen</b>.";
  return nudge("info", "smartphone", "Put this on your home screen", `${how} It opens full-screen like a real app, works offline, and can show a badge.`, `<button class="btn sm ghost" data-act="hide-install">Got it</button>`);
}
ACTIONS["hide-install"] = () => { get().settings.hideInstall = true; commit({ sync: false }); };

function tabs(active) {
  const t = (name, href, ic, label) => `<a class="tab ${active === name ? "on" : ""}" href="${href}" ${active === name ? 'aria-current="page"' : ""}>${icon(ic)}<span>${label}</span></a>`;
  return `<nav aria-label="Main">${t("home", "#/", "home", "Today")}${t("activity", "#/activity", "list", "Activity")}<button class="fab" data-act="add" aria-label="Log spending">${icon("plus")}</button>${t("insights", "#/insights", "chart", "Insights")}${t("plan", "#/plan", "plan", "Plan")}</nav>`;
}

let lastRoute = "";
function render() {
  const r = route();
  const st = get();
  const key = location.hash;
  const keepScroll = key === lastRoute;
  const y = window.scrollY;
  if (!st.settings.onboarded && r.name !== "automate") {
    root.innerHTML = renderOnboard();
    tabsEl.classList.add("hidden");
    lastRoute = key;
    return;
  }
  tabsEl.classList.remove("hidden");
  let html = "";
  let bind = null;
  switch (r.name) {
    case "activity": html = renderActivity(); bind = (el) => bindActivity(el, render); break;
    case "plan": html = renderPlan(r.arg); break;
    case "wait": html = renderWait(); break;
    case "insights": html = renderInsights(); break;
    case "settings": html = renderSettings(); bind = bindSettings; break;
    case "automate": html = renderAutomate(); bind = (el) => bindAutomate(el, render); break;
    default: html = installBanner() + renderHome();
  }
  root.innerHTML = html;
  tabsEl.innerHTML = tabs(["activity", "plan", "insights"].includes(r.name) ? r.name : r.name === "wait" ? "plan" : r.name === "home" || r.name === "add" || r.name === "afford" ? "home" : "");
  bind?.(root);
  if (keepScroll) window.scrollTo(0, y);
  else window.scrollTo(0, 0);
  lastRoute = key;
}

let raf = 0;
const scheduleRender = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); };

/* ---------- events ---------- */
document.addEventListener("click", (e) => {
  const ob = e.target.closest("[data-ob]");
  if (ob) {
    onboardBefore(root);
    onboardActions[ob.dataset.ob]?.(ob);
    render();
    window.scrollTo(0, 0);
    return;
  }
  const a = e.target.closest("[data-act]");
  if (a && ACTIONS[a.dataset.act]) {
    e.preventDefault();
    const res = ACTIONS[a.dataset.act](a);
    if (res?.then) res.then(scheduleRender);
    else scheduleRender();
    return;
  }
  const tx = e.target.closest("[data-tx]");
  if (tx) openAdd({ id: tx.dataset.tx });
});

window.addEventListener("hashchange", () => {
  const r = route();
  if (r.name === "add" || r.name === "afford") {
    history.replaceState(null, "", "#/");
    render();
    if (r.name === "add") openAdd({ amount: r.query.get("amount") || "", note: r.query.get("merchant") || "" });
    else openAfford({ price: r.query.get("price") || "" });
    return;
  }
  closeAllSheets();
  render();
});

subscribe(() => {
  scheduleRender();
  updateBadge();
  if (get().meta.key) pushSnapshotSoon();
});

/* ---------- automation loop ---------- */
let lastDay = today();
function tick() {
  const events = runAutomation();
  const pays = events.filter((e) => e.type === "payday");
  if (pays.length) toast(`Payday logged: ${money(pays.reduce((a, p) => a + Number(p.amount), 0))}`);
  else if (events.some((e) => e.type === "bill")) toast(`${plural(events.filter((e) => e.type === "bill").length, "bill")} logged automatically`);
  lastDay = today();
  scheduleRender();
  updateBadge();
}

async function doSync() {
  if (!get().meta.key || !navigator.onLine) return;
  try {
    const r = await sync({
      onInbox: (txs) => {
        for (const tx of txs) {
          if (tx.kind !== "expense") { tx.review = false; continue; }
          if (!tx.cat) tx.cat = guessCategory(get(), tx.note);
          // Merchants you've categorized before are filed silently. New ones wait in "Check these".
          const known = live(get().tx).some((x) => x !== tx && x.kind === "expense" && !x.review && x.note && x.note.toLowerCase() === (tx.note || "").toLowerCase());
          tx.review = !known || !tx.cat;
          if (!tx.cat) tx.cat = "other";
        }
      },
    });
    if (r?.added) toast(`${r.added} purchase${r.added > 1 ? "s" : ""} logged automatically`);
    runAutomation();
    scheduleRender();
  } catch (e) {
    console.warn("sync failed", e);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    tick();
    doSync();
  }
});
window.addEventListener("online", doSync);
setInterval(() => { if (today() !== lastDay) tick(); }, 60000);
setInterval(() => { if (document.visibilityState === "visible") doSync(); }, 5 * 60000);

/* ---------- boot ---------- */
applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);
tick();
render();
// shortcuts from the home-screen icon (Android long-press) or links like #/add?amount=4.50
if (["add", "afford"].includes(route().name)) window.dispatchEvent(new HashChangeEvent("hashchange"));
doSync();

if ("serviceWorker" in navigator && !location.hostname.match(/^(localhost|127\.)/)) {
  navigator.serviceWorker.register("/sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => {
        if (w.state === "activated" && navigator.serviceWorker.controller) toast("Updated to the latest version", { label: "Reload", run: () => location.reload() });
      });
    });
  }).catch(() => {});
}
