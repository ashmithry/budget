import { get, setSettings, commit, freshState, replaceState, mergeStates } from "../store.js";
import { today, addDays } from "../dates.js";
import { live, compute, round2 } from "../engine.js";
import { esc, money, toast, copy, confirmSheet, sheet, ic, tile } from "../ui.js";
import { newKey, sync, currentToken, deleteCloud, linkDevice } from "../sync.js";
import { openBalanceCheck } from "../sheets.js";
import { updateBadge } from "../badge.js";

const s = () => get();
export const ORIGIN = location.origin.includes("localhost") || location.origin.includes("127.0.0.1") ? "https://budget.ashmithyaramada.com" : location.origin;

/* ---------- Settings ---------- */
export function renderSettings() {
  const st = s().settings;
  const goals = live(s().goals).filter((g) => g.type !== "stretch");
  const num = (k, label, help, suffix = "") => `<label class="f"><span>${label}</span><input class="in num" data-set="${k}" inputmode="decimal" value="${esc(st[k] ?? "")}">${help ? `<div class="tiny faint" style="margin:4px 4px 0">${help}${suffix}</div>` : ""}</label>`;
  return `<header class="top"><div><h1>Settings</h1></div><a class="icon-btn" href="#/" aria-label="Back">${ic("chevron-left", { size: 22 })}</a></header>
  <div class="card">
    <label class="f"><span>Your name</span><input class="in" data-set="name" value="${esc(st.name)}" placeholder="Optional" maxlength="30"></label>
    <label class="f"><span>How you get paid</span><select class="in" data-set="payType">
      ${[["contract", "Contract or gig work (pay varies)"], ["hourly", "Hourly job"], ["none", "Not working right now"]].map(([k, l]) => `<option value="${k}" ${(st.payType || "none") === k ? "selected" : ""}>${l}</option>`).join("")}
    </select><div class="tiny faint" style="margin:4px 4px 0">Prices are shown as days of your budget${st.payType === "hourly" ? ", and as hours of work" : ""}. $45 is about 3 days at $15 a day.</div></label>
    ${st.payType === "hourly" ? num("wage", "Hourly pay", "Adds hours of work to every price. A $60 hoodie is 4 hours at $15/hr.") : ""}
    ${num("taxPct", "Set aside for taxes from contract pay (%)", "No tax is taken out of contract pay. 20% is a common rule of thumb for students; check with a tax pro for your situation. 0 turns it off.")}
    ${num("buffer", "Safety cushion", "Kept out of your daily number for surprises.")}
    ${num("coolHours", "Waitlist time (hours)", "How long to wait before buying something you want. 24 to 72 is a good range.")}
    ${num("bigPurchase", "Ask \"was it worth it?\" for purchases over", "The next day, you rate it. Your regrets show up in Insights.")}
    <label class="f"><span>Currency symbol</span><input class="in" data-set="currency" value="${esc(st.currency)}" maxlength="3"></label>
    <label class="f"><span>Round-ups</span><select class="in" data-set="roundUpGoal"><option value="">Off</option>${goals.map((g) => `<option value="${g.id}" ${st.roundUpGoal === g.id ? "selected" : ""}>Round up each purchase → ${esc(g.name)}</option>`).join("")}</select>
      <div class="tiny faint" style="margin:4px 4px 0">Spare change from each purchase (e.g. $4.30 → 70¢) moves into a goal every night.${goals.length ? "" : " Add a goal first."}</div></label>
    <label class="f"><span>Look</span><select class="in" data-set="theme"><option value="auto" ${st.theme === "auto" ? "selected" : ""}>Match my phone</option><option value="light" ${st.theme === "light" ? "selected" : ""}>Light</option><option value="dark" ${st.theme === "dark" ? "selected" : ""}>Dark</option></select></label>
  </div>
  <div class="list">
    <button class="item" data-act="balance">${tile("scale", "#56625b")}<div class="main"><div class="name">Match my bank balance</div><div class="meta">Fix drift from cash or anything you didn't log</div></div></button>
    <a class="item" href="#/automate" style="color:inherit;text-decoration:none">${tile("zap", "#a0660f")}<div class="main"><div class="name">Automations, widgets & sync</div><div class="meta">${s().meta.key ? "Sync is on" : "Apple Pay auto-logging, home & lock screen widgets"}</div></div></a>
    <button class="item" data-act="why">${tile("book-marked", "#55589c")}<div class="main"><div class="name">How this app fights overspending</div><div class="meta">The research behind each feature</div></div></button>
  </div>
  <div class="list">
    <button class="item" data-act="import">${tile("clipboard-paste", "#2e6a47")}<div class="main"><div class="name">Import past purchases</div><div class="meta">Paste from your bank app; Claude reads it</div></div></button>
    <button class="item" data-act="export">${tile("upload", "#2f6690")}<div class="main"><div class="name">Export backup (JSON)</div></div></button>
    <label class="item" style="cursor:pointer">${tile("download", "#2f6690")}<div class="main"><div class="name">Import backup</div><div class="meta">Merges with what's here</div></div><input type="file" accept="application/json,.json" id="import" hidden></label>
    <button class="item" data-act="reset">${tile("trash-2", "#b3312a")}<div class="main"><div class="name over">Erase everything on this device</div></div></button>
  </div>
  <p class="tiny faint" style="text-align:center">Your data stays on this device. Cloud sync is end-to-end encrypted.</p>`;
}

export function bindSettings(root) {
  root.querySelectorAll("[data-set]").forEach((i) => {
    i.onchange = () => {
      const k = i.dataset.set;
      let v = i.value;
      if (["wage", "buffer", "coolHours", "bigPurchase", "taxPct"].includes(k)) v = Math.max(0, round2(parseFloat(v) || 0));
      if (k === "taxPct") v = Math.min(60, v);
      const patch = { [k]: v };
      if (k === "roundUpGoal") patch.roundUpFrom = today();
      setSettings(patch);
      if (k === "theme") applyTheme();
      toast("Saved");
    };
  });
  const imp = root.querySelector("#import");
  if (imp) imp.onchange = async () => {
    const f = imp.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data.settings || !Array.isArray(data.tx)) throw new Error("not a backup");
      if (data.settings) data.settings.currency = String(data.settings.currency || "$").slice(0, 3);
      const merged = mergeStates(s(), data);
      merged.meta = s().meta;
      replaceState(merged);
      toast("Backup imported");
    } catch (e) {
      toast("That file isn't a backup from this app");
    }
  };
}

export function applyTheme() {
  const t = s().settings.theme;
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

export const settingsActions = {
  balance: () => openBalanceCheck(),
  export: async () => {
    const { meta, ...data } = s();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    const name = `budget-backup-${today()}.json`;
    const file = new File([blob], name, { type: "application/json" });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Budget backup" }); return; } catch {}
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
  },
  reset: async () => {
    if (await confirmSheet("Erase everything?", "All spending, bills, goals and settings on this device are deleted. If sync is on, your cloud copy stays until you delete it in Automations.", "Erase")) {
      const key = s().meta.key;
      const f = freshState();
      if (key && !(await confirmSheet("Keep sync key?", "Keep this device linked so you can pull your cloud copy back?", "Keep it", false))) f.meta.key = null;
      else f.meta.key = key;
      replaceState(f);
      location.hash = "#/";
      location.reload();
    }
  },
  why: () => openWhy(),
};

function openWhy() {
  const items = [
    ["target", "One number, not ten budgets", "Safe-to-spend spreads what you actually have (after bills and savings) evenly until your next money day. Apps like YNAB (\"In My Pocket\") and Copilot lead with a single number because it's what you can check in the 3 seconds before you buy."],
    ["layers", "Lump sums become a weekly paycheck", "MDRC's \"Aid Like A Paycheck\" trial paid financial aid every two weeks instead of in one lump. Students borrowed less in that first semester. Stretch funds copy that design for refunds and scholarships."],
    ["banknote", "Make paying feel like paying", "Research on the \"pain of paying\" (Prelec & Loewenstein) finds that cards and taps feel painless, so we spend more. Hours-of-work prices, the live \"leaves $X today\" line, and the red over-limit state bring that feeling back."],
    ["⏳", "A pause before the purchase", "Most impulse urges fade. The waitlist and \"Can I afford it?\" add a cooling-off period and show the real trade-off before you buy, when it can still change what you do."],
    ["piggy-bank", "Count what you didn't spend", "Skipping something shows up as money not spent and can go straight to a goal, so saying no feels like a win, not a loss."],
    ["meh", "Learn your triggers", "Tagging why you bought something (bored, stressed, with friends) and rating it the next day reveals your patterns: which moods, days and late-night habits lead to purchases you regret."],
    ["zap", "Automate the boring parts", "Bills, paydays, saving to goals and round-ups happen on their own, and Apple Pay taps log themselves. Less effort means you keep using it."],
    ["signpost", "If-then rules", "Specific plans you write yourself (\"no delivery on weekdays\") are shown at the moment of decision. Implementation intentions like these work better than vague goals."],
  ];
  const sh = sheet(() => `<h3>How it helps you overspend less<button data-close>Done</button></h3>${items.map(([e, t, d]) => `<div class="card"><div class="nudge"><span class="nic">${ic(e, { size: 18 })}</span><div><div class="t">${t}</div><div class="d">${d}</div></div></div></div>`).join("")}`);
  sh.bind = (el) => (el.querySelector("[data-close]").onclick = () => sh.close());
  sh.render();
}

/* ---------- Automate ---------- */
let tokenCache = null;
const isIPhoneSafari = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !(matchMedia("(display-mode: standalone)").matches || navigator.standalone === true);
const ago = (ms) => {
  if (!ms) return "never";
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hr ago` : new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
};
async function refreshLinkStatus(root) {
  const box = root.querySelector("#linkstatus");
  if (!box || !tokenCache) return;
  try {
    const r = await (await fetch(`${ORIGIN}/api/status?t=${tokenCache}`, { cache: "no-store" })).json();
    if (!r.ok) {
      box.className = "status-box bad";
      box.innerHTML = `<b>Link not connected.</b> <span class="small">Tap Sync now above, then copy the link again.</span>`;
      return;
    }
    const tested = !!r.lastTestAt;
    const tapped = !!r.lastLogAt;
    box.className = `status-box ${tapped || tested ? "ok" : "warn"}`;
    box.innerHTML = `<div class="row between"><b>${tapped ? "Working" : tested ? "Connected, waiting for your first tap" : "Set up but not tested yet"}</b><button class="btn sm ghost" data-act="link-refresh">Refresh</button></div>
      <div class="small">Last Apple Pay tap received: <b>${ago(r.lastLogAt)}</b></div>
      <div class="small">Last test run: <b>${ago(r.lastTestAt)}</b>${tested ? "" : " (do step 8)"}</div>`;
  } catch {
    box.innerHTML = `<span class="small muted">Couldn't check your link (offline?).</span>`;
  }
}
export function renderAutomate() {
  const st = s();
  const on = !!st.meta.key;
  const tok = tokenCache;
  const base = ORIGIN;
  const logUrl = tok ? `${base}/api/log?t=${tok}&format=text` : "";
  const wUrl = tok ? `${base}/api/widget?t=${tok}` : "";
  const last = st.meta.lastSync ? new Date(st.meta.lastSync).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";
  const urlBox = (u) => `<div class="code" data-copy="${esc(u)}">${esc(u)}</div><button class="btn sm ghost" style="margin-top:8px" data-act="copy" data-v="${esc(u)}">Copy link</button>`;
  return `<header class="top"><div><h1>Automate</h1><div class="sub">Less typing, more knowing</div></div><a class="icon-btn" href="#/" aria-label="Back">${ic("chevron-left", { size: 22 })}</a></header>
  <div class="card ${on ? "ok" : "accent"}">
    <div class="nudge"><span class="nic">${ic(on ? "cloud" : "key-round", { size: 18 })}</span><div class="grow">
      <div class="t">${on ? "Sync is on" : "Turn on sync"}</div>
      <div class="d">${on ? `Last synced ${last}. Your budget is encrypted on this phone before upload. The server can't read it.` : "Needed for Apple Pay auto-logging, widgets and using more than one device. Everything is end-to-end encrypted with a key only you have."}</div>
      <div class="btns">${on ? `<button class="btn sm ghost" data-act="sync-now">Sync now</button><button class="btn sm ghost" data-act="show-key">Show my key</button>` : `<button class="btn sm primary" data-act="sync-on">Turn on</button><button class="btn sm ghost" data-act="sync-link">I have a key</button>`}</div>
    </div></div>
  </div>
  ${on ? `
  ${isIPhoneSafari() ? `<div class="card nudge-card bad"><div class="nudge"><span class="nic">${ic("triangle-alert", { size: 18 })}</span><div class="grow"><div class="t">You're in Safari, not the app</div><div class="d">Safari and the Home Screen app keep separate copies of your budget. Open the app from your Home Screen icon and set this up there, or taps will log into a budget you never see.</div></div></div></div>` : ""}
  <details class="card" open><summary><span class="sum-l">${tile("credit-card", "#2e6a47")}Log every Apple Pay tap automatically</span></summary>
    <div class="status-box" id="linkstatus"><span class="muted small">Checking your link…</span></div>
    <p class="small muted">iPhone, iOS 17 or later. Works for Apple Pay / Wallet taps in stores (not online checkouts or card swipes). Takes about 2 minutes, once.</p>
    <ol class="steps">
      <li><b>Copy your link</b>:${urlBox(logUrl)}</li>
      <li>Open <b>Shortcuts</b> › <b>Automation</b> (bottom) › <b>+</b> › <b>Transaction</b>. Under Card, select all your cards. Choose <b>Run Immediately</b> and turn <b>Notify When Run</b> off. Tap <b>Next</b> › <b>Create New Shortcut</b> (or New Blank Automation).</li>
      <li>Search actions for <b>Get Contents of URL</b> and tap it. Tap <b>URL</b> and paste your link.</li>
      <li>Tap the <b>›</b> on that action. Set <b>Method</b> to <b>POST</b> and <b>Request Body</b> to <b>JSON</b>.</li>
      <li>Tap <b>Add new field › Text</b>. Key: <code>amount</code>. For the value, tap <b>Select Variable</b>, choose <b>Shortcut Input</b>, then tap the blue Shortcut Input bubble and pick <b>Amount</b>.</li>
      <li>Add another <b>Text</b> field. Key: <code>merchant</code>, value: <b>Shortcut Input</b> › <b>Merchant</b>.</li>
      <li>Optional: add <b>Show Notification</b> and put <b>Contents of URL</b> in it. After every tap you'll see what's left today.</li>
      <li><b>Test it (required):</b> tap the <b>▶</b> play button at the bottom of the editor. iOS asks to <b>Allow</b> connecting to budget.ashmithyaramada.com: tap <b>Always Allow</b>. You should see "Connected to your budget", and the status box above turns green. Skip this and iOS blocks every real tap silently.</li>
    </ol>
    <p class="tiny faint">Still nothing after a real tap? Check the status box: if "Last tap" never changes, the automation isn't firing (open Shortcuts › Automation and make sure it's on and set to Run Immediately). If it changed but the purchase isn't in the app, pull down to refresh by reopening the app.</p>
  </details>
  <details class="card"><summary><span class="sum-l">${tile("zap", "#a0660f")}One-tap "Log spending" widget</span></summary>
    <p class="small muted" style="margin-top:0">A Shortcuts widget on your home screen (also works with Siri, the Action Button and Back Tap) to log cash or card spending without opening the app.</p>
    <ol class="steps">
      <li>Shortcuts › <b>+</b> new shortcut, name it <b>Log spend</b>.</li>
      <li>Add <b>Ask for Input</b> › Type <b>Number</b>, prompt "How much?"</li>
      <li>Add <b>Ask for Input</b> › Type <b>Text</b>, prompt "Where?"</li>
      <li>Add <b>Get Contents of URL</b> with the link below. Method POST, Body JSON: <code>amount</code> › first Provided Input, <code>merchant</code> › second Provided Input.</li>
      <li>Add <b>Show Notification</b> › <b>Contents of URL</b>.</li>
      <li>Run it once from Shortcuts and tap <b>Always Allow</b> when iOS asks to connect.</li>
      <li>Long-press your home screen › Edit › Add Widget › <b>Shortcuts</b> › pick <b>Log spend</b>.</li>
    </ol>
    ${urlBox(logUrl)}
  </details>
  <details class="card"><summary><span class="sum-l">${tile("smartphone", "#2f6690")}Safe-to-spend widget for your home and lock screen</span></summary>
    <p class="small muted" style="margin-top:0">Shows today's number where you'll see it before you buy. Uses the free <b>Scriptable</b> app. Updates with every Apple Pay tap and shortcut log, even if you don't open the budget app.</p>
    <ol class="steps">
      <li>Install <b>Scriptable</b> from the App Store.</li>
      <li>Open it, tap <b>+</b>, paste the script (button below), name it <b>Budget</b>.</li>
      <li>Home screen: long-press › Edit › Add Widget › Scriptable › Small. Tap it › Script: <b>Budget</b>.</li>
      <li>Lock screen: long-press lock screen › Customize › Lock Screen › add Scriptable (rectangular or inline) › Script: <b>Budget</b>.</li>
    </ol>
    <button class="btn block primary" data-act="copy-script">Copy widget script</button>
  </details>
  <details class="card"><summary><span class="sum-l">${tile("bell", "#94468a")}Daily check-in notifications</span></summary>
    <p class="small muted" style="margin-top:0">A morning heads-up of what you can spend, and an evening reminder to log anything missed.</p>
    <ol class="steps">
      <li>Shortcuts › Automation › <b>+</b> › <b>Time of Day</b> › 9:00 AM, Daily, <b>Run Immediately</b>.</li>
      <li>Add <b>Get Contents of URL</b> with the link below, then <b>Show Notification</b> › <b>Contents of URL</b>.</li>
      <li>Repeat for 9:00 PM. Add the text "Anything to log?" before the Contents of URL.</li>
    </ol>
    ${urlBox(wUrl + "&format=text")}
  </details>
  <details class="card"><summary><span class="sum-l">${tile("smartphone", "#56625b")}Android</span></summary>
    <ol class="steps">
      <li>Long-press the app icon for quick <b>Log spending</b> and <b>Can I afford it?</b> shortcuts. Drag one to your home screen.</li>
      <li>Auto-log: in <b>MacroDroid</b> or <b>Tasker</b>, trigger on your bank or Google Wallet notification, read the amount, then make an HTTP POST to the log link with <code>amount</code> and <code>merchant</code> fields.</li>
      <li>Widget: <b>KWGT</b> or any "HTTP widget" app can show <code>left</code> and <code>text</code> from the widget link (JSON).</li>
    </ol>
    ${urlBox(logUrl)}<div style="height:8px"></div>${urlBox(wUrl)}
  </details>
  ` : ""}
  <div class="switch"><span>App icon badge<div class="tiny faint">Shows today's dollars left on the app icon. Needs notification permission. On iPhone, it works once the app is added to your Home Screen.</div></span><input type="checkbox" id="badge" ${st.settings.badge ? "checked" : ""}></div>
  ${on ? `<button class="btn block danger" data-act="cloud-delete" style="margin-top:8px">Turn off sync & delete cloud copy</button>` : ""}
  <p class="tiny faint" style="margin-top:14px">Keep the links private. They let someone log spending and see your daily number, but they can't read your budget.</p>`;
}

export async function bindAutomate(root, rerender) {
  if (s().meta.key && !tokenCache) {
    tokenCache = await currentToken();
    rerender();
    return;
  }
  refreshLinkStatus(root);
  const b = root.querySelector("#badge");
  if (b) b.onchange = async () => {
    if (b.checked && "Notification" in window && Notification.permission !== "granted") {
      try { await Notification.requestPermission(); } catch {}
    }
    setSettings({ badge: b.checked });
    updateBadge();
    if (b.checked && !("setAppBadge" in navigator)) toast("This browser doesn't support icon badges. Add the app to your Home Screen first.");
  };
}

function scriptText(token) {
  return `// Budget widget for Scriptable. Shows today's safe-to-spend number.
const API = "${ORIGIN}/api/widget?t=${token}";
let d;
try { d = await new Request(API).loadJSON(); } catch (e) { d = { ok: false, text: "Offline" }; }
const COLORS = { good: ["#2E6A47", "#1F4A32"], tight: ["#A0660F", "#7A4C08"], over: ["#B3312A", "#86221D"], short: ["#B3312A", "#86221D"], stale: ["#3F4A43", "#28302B"] };
const cur = d.cur || "$";
const fmt = (n) => (n < 0 ? "-" : "") + cur + (Math.abs(n) >= 100 ? Math.round(Math.abs(n)).toString() : Math.abs(n).toFixed(2).replace(/\.00$/, ""));
const st = d.ok ? d.status : "off";
const live_ = st === "good" || st === "tight";
const head = { good: "Safe to spend", tight: "Safe to spend", over: "Over today", short: "Short before payday", stale: "New pay period", off: "Budget" }[st] || "Budget";
const big = live_ ? fmt(d.left) : st === "over" ? fmt(-d.left) : st === "short" ? fmt(-d.pool) : "Open app";
const sub = live_ ? fmt(d.daily) + "/day, " + d.daysLeft + " days left" : st === "over" && d.tomorrow != null ? "Tomorrow " + fmt(d.tomorrow) + "/day" : d.text || "";
const w = new ListWidget();
// No w.url: on iPhone a link would open Safari, which can't see the Home Screen app's data.
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
const fam = config.widgetFamily || "small";
if (fam === "accessoryInline") {
  w.addText(live_ ? fmt(d.left) + " left today" : st === "over" ? "Over by " + fmt(-d.left) : st === "short" ? "Short " + fmt(-d.pool) : "Budget: open the app");
} else if (fam === "accessoryCircular") {
  const a = w.addText(live_ || st === "over" ? big : "!"); a.font = Font.boldSystemFont(14); a.centerAlignText(); a.minimumScaleFactor = 0.5;
  const b = w.addText(st === "over" ? "over" : "today"); b.font = Font.systemFont(10); b.centerAlignText();
} else if (fam === "accessoryRectangular") {
  const h = w.addText(head); h.font = Font.boldSystemFont(11);
  const a = w.addText(big); a.font = Font.boldRoundedSystemFont(22); a.minimumScaleFactor = 0.6;
  const c = w.addText(sub); c.font = Font.systemFont(11); c.minimumScaleFactor = 0.7;
} else {
  const g = new LinearGradient(); const c = COLORS[st] || COLORS.stale;
  g.colors = [new Color(c[0]), new Color(c[1])]; g.locations = [0, 1]; w.backgroundGradient = g;
  w.setPadding(14, 14, 14, 14);
  const h = w.addText(head); h.font = Font.semiboldSystemFont(12); h.textColor = new Color("#ffffff", 0.85);
  w.addSpacer(4);
  const a = w.addText(big); a.font = Font.heavyRoundedSystemFont(fam === "small" ? 34 : 40); a.textColor = Color.white(); a.minimumScaleFactor = 0.5; a.lineLimit = 1;
  w.addSpacer();
  const t = w.addText(sub); t.font = Font.mediumSystemFont(12); t.textColor = new Color("#ffffff", 0.9); t.minimumScaleFactor = 0.7;
  if (live_ && d.streak > 0 && fam !== "small") { const s2 = w.addText(d.streak + "-day no-spend streak"); s2.font = Font.systemFont(11); s2.textColor = new Color("#ffffff", 0.85); }
}
Script.setWidget(w);
if (config.runsInApp) await w.presentSmall();
Script.complete();
`;
}

export const automateActions = {
  "link-refresh": () => refreshLinkStatus(document),
  copy: (el) => copy(el.dataset.v),
  "copy-script": async () => copy(scriptText(tokenCache || (await currentToken()))),
  "sync-now": async () => {
    try { const r = await sync(); toast(r.added ? `Synced. ${r.added} new from Shortcuts` : "Synced"); } catch (e) { toast("Sync failed. Check your connection."); }
  },
  "sync-on": async () => {
    const key = newKey();
    s().meta.key = key;
    s().meta.rev = 0;
    commit({ sync: true });
    tokenCache = null;
    try { await sync(); } catch (e) { toast("Couldn't reach the cloud. We'll retry."); }
    showKey(key, true);
  },
  "show-key": () => showKey(s().meta.key),
  "sync-link": () => {
    const sh = sheet(() => `<h3>Link this device<button data-close>Cancel</button></h3><p class="muted small">Enter the sync key from your other device (Automate › Show my key). Both devices will merge.</p>
      <label class="f"><input class="in" id="k" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autocapitalize="characters" autocomplete="off"></label><button class="btn primary block" id="go">Link</button>`);
    sh.bind = (el) => {
      el.querySelector("[data-close]").onclick = () => sh.close();
      el.querySelector("#go").onclick = async () => {
        const btn = el.querySelector("#go");
        btn.disabled = true;
        btn.textContent = "Checking…";
        try {
          await linkDevice(el.querySelector("#k").value);
          tokenCache = null;
          sh.close();
          if (!s().settings.onboarded && s().settings.anchor) setSettings({ onboarded: true });
          toast("Linked and synced");
        } catch (e) {
          btn.disabled = false;
          btn.textContent = "Link";
          toast(e.message.startsWith("budget_") ? "Couldn't reach the cloud. Check your connection." : e.message);
        }
      };
    };
    sh.render();
  },
  "cloud-delete": async () => {
    if (!(await confirmSheet("Turn off sync?", "Deletes the encrypted cloud copy. Shortcuts and widgets stop working. Data on this device stays.", "Turn off & delete"))) return;
    try { await deleteCloud(); } catch {}
    s().meta.key = null;
    s().meta.rev = 0;
    s().meta.lastSync = 0;
    tokenCache = null;
    commit({ sync: false });
    toast("Sync off");
  },
};

function showKey(key, fresh) {
  const sh = sheet(() => `<h3>${fresh ? "Sync is on" : "Your sync key"}<button data-close>Done</button></h3>
    <p class="muted small">This key unlocks your encrypted budget. Use it to add another device. Save it in your password manager. If you lose all your devices and this key, the cloud copy can't be recovered (not even by the server).</p>
    <div class="code" style="font-size:20px;text-align:center;letter-spacing:0.05em">${esc(key)}</div>
    <button class="btn block ghost" style="margin-top:10px" data-c>Copy key</button>
    ${fresh ? `<p class="small" style="margin-top:14px">Next: set up Apple Pay auto-logging and the widget below.</p>` : ""}`);
  sh.bind = (el) => {
    el.querySelector("[data-close]").onclick = () => sh.close();
    el.querySelector("[data-c]").onclick = () => copy(key);
  };
  sh.render();
}
