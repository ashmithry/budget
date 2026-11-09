import { get, setSettings, commit, freshState, replaceState, mergeStates } from "../store.js";
import { today, addDays } from "../dates.js";
import { live, compute, round2 } from "../engine.js";
import { esc, money, toast, copy, confirmSheet, sheet } from "../ui.js";
import { newKey, validKey, cleanKey, sync, currentToken, deleteCloud } from "../sync.js";
import { openBalanceCheck } from "../sheets.js";
import { updateBadge } from "../badge.js";

const s = () => get();
export const ORIGIN = location.origin.includes("localhost") || location.origin.includes("127.0.0.1") ? "https://budget.ashmithyaramada.com" : location.origin;

/* ---------- Settings ---------- */
export function renderSettings() {
  const st = s().settings;
  const goals = live(s().goals).filter((g) => g.type !== "stretch");
  const num = (k, label, help, suffix = "") => `<label class="f"><span>${label}</span><input class="in num" data-set="${k}" inputmode="decimal" value="${esc(st[k] ?? "")}">${help ? `<div class="tiny faint" style="margin:4px 4px 0">${help}${suffix}</div>` : ""}</label>`;
  return `<header class="top"><div><h1>Settings</h1></div><a class="icon-btn" href="#/" aria-label="Back">‹</a></header>
  <div class="card">
    <label class="f"><span>Your name</span><input class="in" data-set="name" value="${esc(st.name)}" placeholder="Optional" maxlength="30"></label>
    ${num("wage", "What you earn per hour", "Prices get shown as hours of work. A $60 hoodie is 4 hours at $15/hr.")}
    ${num("buffer", "Safety cushion", "Kept out of your daily number for surprises.")}
    ${num("coolHours", "Waitlist time (hours)", "How long to wait before buying something you want. 24 to 72 is a good range.")}
    ${num("bigPurchase", "Ask \"was it worth it?\" for purchases over", "The next day, you rate it. Your regrets show up in Insights.")}
    <label class="f"><span>Currency symbol</span><input class="in" data-set="currency" value="${esc(st.currency)}" maxlength="3"></label>
    <label class="f"><span>Round-ups</span><select class="in" data-set="roundUpGoal"><option value="">Off</option>${goals.map((g) => `<option value="${g.id}" ${st.roundUpGoal === g.id ? "selected" : ""}>Round up each purchase → ${esc(g.name)}</option>`).join("")}</select>
      <div class="tiny faint" style="margin:4px 4px 0">Spare change from each purchase (e.g. $4.30 → 70¢) moves into a goal every night.${goals.length ? "" : " Add a goal first."}</div></label>
    <label class="f"><span>Look</span><select class="in" data-set="theme"><option value="auto" ${st.theme === "auto" ? "selected" : ""}>Match my phone</option><option value="light" ${st.theme === "light" ? "selected" : ""}>Light</option><option value="dark" ${st.theme === "dark" ? "selected" : ""}>Dark</option></select></label>
  </div>
  <div class="list">
    <button class="item" data-act="balance"><div class="ic">⚖️</div><div class="main"><div class="name">Match my bank balance</div><div class="meta">Fix drift from cash or anything you didn't log</div></div></button>
    <a class="item" href="#/automate" style="color:inherit;text-decoration:none"><div class="ic">⚡</div><div class="main"><div class="name">Automations, widgets & sync</div><div class="meta">${s().meta.key ? "Sync is on" : "Apple Pay auto-logging, home & lock screen widgets"}</div></div></a>
    <button class="item" data-act="why"><div class="ic">🧠</div><div class="main"><div class="name">How this app fights overspending</div><div class="meta">The research behind each feature</div></div></button>
  </div>
  <div class="list">
    <button class="item" data-act="export"><div class="ic">📤</div><div class="main"><div class="name">Export backup (JSON)</div></div></button>
    <label class="item" style="cursor:pointer"><div class="ic">📥</div><div class="main"><div class="name">Import backup</div><div class="meta">Merges with what's here</div></div><input type="file" accept="application/json,.json" id="import" hidden></label>
    <button class="item" data-act="onboard"><div class="ic">🔁</div><div class="main"><div class="name">Run setup again</div></div></button>
    <button class="item" data-act="reset"><div class="ic">🗑️</div><div class="main"><div class="name over">Erase everything on this device</div></div></button>
  </div>
  <p class="tiny faint" style="text-align:center">Your data stays on this device. Cloud sync is end-to-end encrypted.</p>`;
}

export function bindSettings(root) {
  root.querySelectorAll("[data-set]").forEach((i) => {
    i.onchange = () => {
      const k = i.dataset.set;
      let v = i.value;
      if (["wage", "buffer", "coolHours", "bigPurchase"].includes(k)) v = Math.max(0, round2(parseFloat(v) || 0));
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
  onboard: () => { setSettings({ onboarded: false }); location.hash = "#/"; },
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
    ["🎯", "One number, not ten budgets", "Safe-to-spend spreads what you actually have (after bills and savings) evenly until your next money day. Apps like YNAB (\"In My Pocket\") and Copilot lead with a single number because it's what you can check in the 3 seconds before you buy."],
    ["🪣", "Lump sums become a weekly paycheck", "MDRC's \"Aid Like A Paycheck\" trial paid financial aid every two weeks instead of in one lump. Students borrowed less in that first semester. Stretch funds copy that design for refunds and scholarships."],
    ["💸", "Make paying feel like paying", "Research on the \"pain of paying\" (Prelec & Loewenstein) finds that cards and taps feel painless, so we spend more. Hours-of-work prices, the live \"leaves $X today\" line, and the red over-limit state bring that feeling back."],
    ["⏳", "A pause before the purchase", "Most impulse urges fade. The waitlist and \"Can I afford it?\" add a cooling-off period and show the real trade-off before you buy, when it can still change what you do."],
    ["💪", "Count what you didn't spend", "Skipping something shows up as money not spent and can go straight to a goal, so saying no feels like a win, not a loss."],
    ["🧠", "Learn your triggers", "Tagging why you bought something (bored, stressed, with friends) and rating it the next day reveals your patterns: which moods, days and late-night habits lead to purchases you regret."],
    ["🤖", "Automate the boring parts", "Bills, paydays, saving to goals and round-ups happen on their own, and Apple Pay taps log themselves. Less effort means you keep using it."],
    ["📏", "If-then rules", "Specific plans you write yourself (\"no delivery on weekdays\") are shown at the moment of decision. Implementation intentions like these work better than vague goals."],
  ];
  const sh = sheet(() => `<h3>How it helps you overspend less<button data-close>Done</button></h3>${items.map(([e, t, d]) => `<div class="card"><div class="nudge"><div class="em">${e}</div><div><div class="t">${t}</div><div class="d">${d}</div></div></div></div>`).join("")}`);
  sh.bind = (el) => (el.querySelector("[data-close]").onclick = () => sh.close());
  sh.render();
}

/* ---------- Automate ---------- */
let tokenCache = null;
export function renderAutomate() {
  const st = s();
  const on = !!st.meta.key;
  const tok = tokenCache;
  const base = ORIGIN;
  const logUrl = tok ? `${base}/api/log?t=${tok}&format=text` : "";
  const wUrl = tok ? `${base}/api/widget?t=${tok}` : "";
  const last = st.meta.lastSync ? new Date(st.meta.lastSync).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";
  const urlBox = (u) => `<div class="code" data-copy="${esc(u)}">${esc(u)}</div><button class="btn sm ghost" style="margin-top:8px" data-act="copy" data-v="${esc(u)}">Copy link</button>`;
  return `<header class="top"><div><h1>Automate</h1><div class="sub">Less typing, more knowing</div></div><a class="icon-btn" href="#/" aria-label="Back">‹</a></header>
  <div class="card ${on ? "ok" : "accent"}">
    <div class="nudge"><div class="em">${on ? "☁️" : "🔐"}</div><div class="grow">
      <div class="t">${on ? "Sync is on" : "Turn on sync"}</div>
      <div class="d">${on ? `Last synced ${last}. Your budget is encrypted on this phone before upload. The server can't read it.` : "Needed for Apple Pay auto-logging, widgets and using more than one device. Everything is end-to-end encrypted with a key only you have."}</div>
      <div class="btns">${on ? `<button class="btn sm ghost" data-act="sync-now">Sync now</button><button class="btn sm ghost" data-act="show-key">Show my key</button>` : `<button class="btn sm primary" data-act="sync-on">Turn on</button><button class="btn sm ghost" data-act="sync-link">I have a key</button>`}</div>
    </div></div>
  </div>
  ${on ? `
  <details class="card" open><summary>💳 Log every Apple Pay tap automatically</summary>
    <p class="small muted" style="margin-top:0">iPhone with iOS 17 or later. Each time you tap to pay, the amount and store are sent here. Next time you open the app they're filed under the right category (it learns from you).</p>
    <ol class="steps">
      <li>Open <b>Shortcuts</b> → <b>Automation</b> tab → <b>＋</b> → <b>Transaction</b>.</li>
      <li>Pick your cards, choose <b>Run Immediately</b>, turn off <b>Notify When Run</b>, tap <b>Next</b> → <b>New Blank Automation</b>.</li>
      <li>Add the action <b>Get Contents of URL</b> and paste this link:</li>
    </ol>
    ${urlBox(logUrl)}
    <ol class="steps" start="4">
      <li>Tap the arrow on that action: Method <b>POST</b>, Request Body <b>JSON</b>. Add 3 Text fields:<br><code>amount</code> → tap and pick <b>Shortcut Input › Amount</b><br><code>merchant</code> → <b>Merchant</b><br><code>card</code> → <b>Card</b> (or Name)</li>
      <li>Optional but powerful: add <b>Show Notification</b> with <b>Contents of URL</b>. After every tap you'll see what's left today.</li>
    </ol>
    <p class="tiny faint">Only covers Apple Pay / Wallet taps. Card swipes and online checkouts still need a 3-second manual log, or use the widget below.</p>
  </details>
  <details class="card"><summary>⚡ One-tap "Log spending" widget</summary>
    <p class="small muted" style="margin-top:0">A Shortcuts widget on your home screen (also works with Siri, the Action Button and Back Tap) to log cash or card spending without opening the app.</p>
    <ol class="steps">
      <li>Shortcuts → <b>＋</b> new shortcut, name it <b>Log spend</b>.</li>
      <li>Add <b>Ask for Input</b> → Type <b>Number</b>, prompt "How much?"</li>
      <li>Add <b>Ask for Input</b> → Type <b>Text</b>, prompt "Where?"</li>
      <li>Add <b>Get Contents of URL</b> with the link below. Method POST, Body JSON: <code>amount</code> → first Provided Input, <code>merchant</code> → second Provided Input.</li>
      <li>Add <b>Show Notification</b> → <b>Contents of URL</b>.</li>
      <li>Long-press your home screen → Edit → Add Widget → <b>Shortcuts</b> → pick <b>Log spend</b>.</li>
    </ol>
    ${urlBox(logUrl)}
  </details>
  <details class="card"><summary>📱 Safe-to-spend widget (home + lock screen)</summary>
    <p class="small muted" style="margin-top:0">Shows today's number where you'll see it before you buy. Uses the free <b>Scriptable</b> app. Updates with every Apple Pay tap and shortcut log, even if you don't open the budget app.</p>
    <ol class="steps">
      <li>Install <b>Scriptable</b> from the App Store.</li>
      <li>Open it, tap <b>＋</b>, paste the script (button below), name it <b>Budget</b>.</li>
      <li>Home screen: long-press → Edit → Add Widget → Scriptable → Small. Tap it → Script: <b>Budget</b>.</li>
      <li>Lock screen: long-press lock screen → Customize → Lock Screen → add Scriptable (rectangular or inline) → Script: <b>Budget</b>.</li>
    </ol>
    <button class="btn block primary" data-act="copy-script">Copy widget script</button>
  </details>
  <details class="card"><summary>🔔 Daily check-in notifications</summary>
    <p class="small muted" style="margin-top:0">A morning heads-up of what you can spend, and an evening reminder to log anything missed.</p>
    <ol class="steps">
      <li>Shortcuts → Automation → <b>＋</b> → <b>Time of Day</b> → 9:00 AM, Daily, <b>Run Immediately</b>.</li>
      <li>Add <b>Get Contents of URL</b> with the link below, then <b>Show Notification</b> → <b>Contents of URL</b>.</li>
      <li>Repeat for 9:00 PM. Add the text "Anything to log?" before the Contents of URL.</li>
    </ol>
    ${urlBox(wUrl + "&format=text")}
  </details>
  <details class="card"><summary>🤖 Android</summary>
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
const COLORS = { good: ["#0f9a63", "#0b6e4a"], tight: ["#d98a07", "#a45f00"], over: ["#e5484d", "#a8262b"], short: ["#e5484d", "#a8262b"], stale: ["#4a4d57", "#2c2e35"] };
const cur = d.cur || "$";
const fmt = (n) => (n < 0 ? "-" : "") + cur + (Math.abs(n) >= 100 ? Math.round(Math.abs(n)).toString() : Math.abs(n).toFixed(2).replace(/\\.00$/, ""));
const w = new ListWidget();
w.url = "${ORIGIN}/";
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
const fam = config.widgetFamily || "small";
if (fam === "accessoryInline") {
  w.addText(d.ok ? (d.left >= 0 ? fmt(d.left) + " left today" : "Over by " + fmt(-d.left)) : "Budget: open app");
} else if (fam === "accessoryCircular") {
  const a = w.addText(d.ok ? fmt(d.left) : "?"); a.font = Font.boldSystemFont(14); a.centerAlignText(); a.minimumScaleFactor = 0.5;
  const b = w.addText("today"); b.font = Font.systemFont(10); b.centerAlignText();
} else if (fam === "accessoryRectangular") {
  const h = w.addText(d.ok ? (d.left >= 0 ? "SAFE TODAY" : "OVER TODAY") : "BUDGET"); h.font = Font.boldSystemFont(11);
  const a = w.addText(d.ok ? fmt(Math.abs(d.left)) : "Open app"); a.font = Font.boldRoundedSystemFont(22);
  if (d.ok) { const c = w.addText(fmt(d.daily) + "/day · " + d.daysLeft + "d left"); c.font = Font.systemFont(11); }
} else {
  const g = new LinearGradient(); const c = COLORS[d.status] || COLORS.stale;
  g.colors = [new Color(c[0]), new Color(c[1])]; g.locations = [0, 1]; w.backgroundGradient = g;
  w.setPadding(14, 14, 14, 14);
  const h = w.addText(d.ok ? (d.left >= 0 ? "SAFE TO SPEND" : "OVER TODAY") : "BUDGET"); h.font = Font.boldSystemFont(11); h.textColor = new Color("#ffffff", 0.85);
  w.addSpacer(4);
  const a = w.addText(d.ok ? fmt(Math.abs(d.left)) : "Open app"); a.font = Font.heavyRoundedSystemFont(fam === "small" ? 34 : 40); a.textColor = Color.white(); a.minimumScaleFactor = 0.5; a.lineLimit = 1;
  w.addSpacer();
  const t = w.addText(d.ok ? (d.status === "over" && d.tomorrow != null ? "Tomorrow " + fmt(d.tomorrow) + "/day" : fmt(d.daily) + "/day · " + d.daysLeft + " days left") : d.text || ""); t.font = Font.mediumSystemFont(12); t.textColor = new Color("#ffffff", 0.9); t.minimumScaleFactor = 0.7;
  if (d.ok && d.streak > 0 && fam !== "small") { const s = w.addText("🔥 " + d.streak + " no-spend days"); s.font = Font.systemFont(11); s.textColor = new Color("#ffffff", 0.85); }
}
Script.setWidget(w);
if (config.runsInApp) await w.presentSmall();
Script.complete();
`;
}

export const automateActions = {
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
    const sh = sheet(() => `<h3>Link this device<button data-close>Cancel</button></h3><p class="muted small">Enter the sync key from your other device (Automate → Show my key). Both devices will merge.</p>
      <label class="f"><input class="in" id="k" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autocapitalize="characters" autocomplete="off"></label><button class="btn primary block" id="go">Link</button>`);
    sh.bind = (el) => {
      el.querySelector("[data-close]").onclick = () => sh.close();
      el.querySelector("#go").onclick = async () => {
        const k = el.querySelector("#k").value;
        if (!validKey(k)) return toast("That key looks too short");
        s().meta.key = cleanKey(k).match(/.{1,5}/g).join("-");
        s().meta.rev = 0;
        commit({ sync: false });
        tokenCache = null;
        sh.close();
        try { await sync(); toast("Linked and synced ☁️"); } catch (e) { toast("Linked. Sync will retry when online."); }
        if (s().settings.onboarded === false && live(s().tx).length) setSettings({ onboarded: true });
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
  const sh = sheet(() => `<h3>${fresh ? "Sync is on ☁️" : "Your sync key"}<button data-close>Done</button></h3>
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
