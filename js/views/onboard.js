// First-run setup: balance, income, bills, habits. About 2 minutes, every step skippable.
import { get, put, setSettings, runAutomation } from "../store.js";
import { today, addDays, diffDays, FREQS, dayOfMonth } from "../dates.js";
import { compute, uid, round2 } from "../engine.js";
import { esc, money, toast } from "../ui.js";
import { automateActions } from "./settings.js";

const s = () => get();
const o = {
  step: 0,
  balance: "",
  name: "",
  incomes: [],
  lump: null,
  bills: [],
  wage: "15",
  cool: 48,
  goal: { name: "Emergency fund", target: "500", perPay: "" },
};
const STEPS = 5;
const freqSel = (v, attr) => `<select class="in" ${attr}>${Object.entries(FREQS).filter(([k]) => k !== "once").map(([k, l]) => `<option value="${k}" ${v === k ? "selected" : ""}>${l}</option>`).join("")}</select>`;
const cur = () => esc(s().settings.currency || "$");

function dots() {
  return `<div class="dots">${Array.from({ length: STEPS }, (_, i) => `<i class="${i <= o.step - 1 ? "on" : ""}"></i>`).join("")}</div>`;
}

export function renderOnboard() {
  const st = o.step;
  if (st === 0) return `<div class="onb">
    <div style="margin-top:12vh"><div class="big-emoji">💸</div>
    <h1>Know exactly what's safe to spend. Every day.</h1>
    <p class="lead">One number that already accounts for your bills, savings and next payday. Plus a pause button for impulse buys, and automatic logging so you barely have to type.</p></div>
    <div class="foot"><button class="btn primary block" data-ob="next">Get started</button><button class="btn ghost block" data-ob="link">I already use this on another device</button></div></div>`;
  if (st === 1) return `<div class="onb">${dots()}
    <h1>What do you have to spend right now?</h1>
    <p class="lead">Checking account + cash. Leave out money in savings you don't touch. A rough number is fine. You can match it to your bank later.</p>
    <label class="f"><div class="in-money" data-cur="${cur()}"><input class="in num" id="bal" inputmode="decimal" placeholder="0" value="${esc(o.balance)}" style="font-size:28px;min-height:64px;font-weight:700"></div></label>
    <label class="f"><span>Your first name (optional)</span><input class="in" id="nm" value="${esc(o.name)}" maxlength="30"></label>
    <div class="foot"><button class="btn primary block" data-ob="next">Next</button></div></div>`;
  if (st === 2) return `<div class="onb">${dots()}
    <h1>How does money come in?</h1>
    <p class="lead">Your daily number is spread out until the next time you get money. Add what's regular, plus any lump sum you need to make last.</p>
    ${o.incomes.map((i, n) => `<div class="card"><div class="row between" style="margin-bottom:8px"><b>${esc(i.name)}</b><button class="small over" data-ob="inc-del" data-i="${n}">Remove</button></div>
      <div class="two"><div class="in-money" data-cur="${cur()}"><input class="in num" data-inc="${n}" data-k="amount" inputmode="decimal" placeholder="Amount" value="${esc(i.amount)}"></div>${freqSel(i.freq, `data-inc="${n}" data-k="freq"`)}</div>
      <label class="f" style="margin:8px 0 0"><span>Next one arrives</span><input class="in" type="date" data-inc="${n}" data-k="next" value="${i.next}"></label></div>`).join("")}
    ${o.lump ? `<div class="card"><div class="row between" style="margin-bottom:8px"><b>🪣 Lump sum to stretch</b><button class="small over" data-ob="lump-del">Remove</button></div>
      <div class="two"><div class="in-money" data-cur="${cur()}"><input class="in num" data-lump="amount" inputmode="decimal" placeholder="Amount" value="${esc(o.lump.amount)}"></div><input class="in" data-lump="name" value="${esc(o.lump.name)}"></div>
      <label class="f" style="margin:8px 0 0"><span>Make it last until</span><input class="in" type="date" data-lump="until" value="${o.lump.until}"></label>
      <label class="switch" style="margin:8px 0 0;box-shadow:none;background:var(--card2)"><span class="small">Already included in the amount on the last screen</span><input type="checkbox" data-lump="inBalance" ${o.lump.inBalance ? "checked" : ""}></label></div>` : ""}
    <div class="chips">
      <button class="chip-btn" data-ob="inc-add" data-name="Job" data-freq="biweekly">＋ Paycheck</button>
      <button class="chip-btn" data-ob="inc-add" data-name="From family" data-freq="monthly">＋ Money from family</button>
      ${o.lump ? "" : `<button class="chip-btn" data-ob="lump-add">＋ Aid refund / scholarship</button>`}
    </div>
    <div class="foot"><button class="btn primary block" data-ob="next">${o.incomes.length || o.lump ? "Next" : "Skip for now"}</button><button class="btn ghost block" data-ob="back">Back</button></div></div>`;
  if (st === 3) return `<div class="onb">${dots()}
    <h1>Bills & subscriptions</h1>
    <p class="lead">These get set aside before your daily number, and log themselves on the due date. Add all of them. Small subscriptions add up.</p>
    ${o.bills.map((b, n) => `<div class="card"><div class="row between" style="margin-bottom:8px"><input class="in" data-bill="${n}" data-k="name" value="${esc(b.name)}" placeholder="Name" style="min-height:40px"><button class="small over" data-ob="bill-del" data-i="${n}" style="margin-left:8px">✕</button></div>
      <div class="two"><div class="in-money" data-cur="${cur()}"><input class="in num" data-bill="${n}" data-k="amount" inputmode="decimal" placeholder="Amount" value="${esc(b.amount)}"></div><input class="in" type="date" data-bill="${n}" data-k="next" value="${b.next}" aria-label="Next due"></div></div>`).join("")}
    <div class="chips">${[["Rent", "bill"], ["Phone", "bill"], ["Spotify", "sub"], ["Netflix", "sub"], ["Apple Music", "sub"], ["iCloud+", "sub"], ["Amazon Prime", "sub"], ["Gym", "sub"], ["Car insurance", "bill"], ["Other", "sub"]].map(([n, k]) => `<button class="chip-btn" data-ob="bill-add" data-name="${n === "Other" ? "" : n}" data-kind="${k}">＋ ${n}</button>`).join("")}</div>
    <p class="tiny faint" style="margin:10px 4px">All monthly by default. Change how often later in Plan.</p>
    <div class="foot"><button class="btn primary block" data-ob="next">${o.bills.length ? "Next" : "No bills, skip"}</button><button class="btn ghost block" data-ob="back">Back</button></div></div>`;
  if (st === 4) return `<div class="onb">${dots()}
    <h1>Your anti-impulse settings</h1>
    <p class="lead">Small speed bumps that make spending feel real again.</p>
    <label class="f"><span>What you earn per hour (or would)</span><div class="in-money" data-cur="${cur()}"><input class="in num" id="wage" inputmode="decimal" value="${esc(o.wage)}"></div><div class="tiny faint" style="margin:4px">Prices get shown as hours of your life. $60 = ${o.wage > 0 ? Math.round((60 / o.wage) * 10) / 10 : "?"} hours.</div></label>
    <div class="small muted" style="margin:0 4px 8px;font-weight:600">Before buying things you want, wait…</div>
    <div class="chips" style="margin-bottom:16px">${[24, 48, 72].map((h) => `<button class="chip-btn ${o.cool === h ? "on" : ""}" data-ob="cool" data-h="${h}">${h} hours</button>`).join("")}</div>
    <div class="card"><b>🛟 Start a savings goal</b><p class="small muted" style="margin:4px 0 10px">Saved automatically each payday, before you can spend it.</p>
      <div class="two"><input class="in" id="gname" value="${esc(o.goal.name)}" placeholder="Goal"><div class="in-money" data-cur="${cur()}"><input class="in num" id="gtarget" inputmode="decimal" placeholder="Target" value="${esc(o.goal.target)}"></div></div>
      ${o.incomes.length ? `<label class="f" style="margin:8px 0 0"><span>Save each payday</span><div class="in-money" data-cur="${cur()}"><input class="in num" id="gper" inputmode="decimal" placeholder="e.g. 25" value="${esc(o.goal.perPay)}"></div></label>` : ""}</div>
    <div class="foot"><button class="btn primary block" data-ob="finish">Finish</button><button class="btn ghost block" data-ob="back">Back</button></div></div>`;
  const c = compute(s());
  return `<div class="onb">${dots()}
    <div style="margin-top:6vh"><div class="big-emoji">✨</div>
    <h1>You can safely spend <span class="good">${money(Math.max(0, c.leftToday))}</span> today.</h1>
    <p class="lead">That's ${money(c.dailyBase)} a day until ${c.daysLeft > 1 ? "your next money day" : "tomorrow"}${c.upcomingTotal ? `, after setting aside ${money(c.upcomingTotal)} for bills` : ""}. Spend less today and tomorrow's number goes up. Go over and it goes down.</p>
    <div class="card accent"><div class="nudge"><div class="em">🤖</div><div><div class="t">One more thing</div><div class="d">Turn on sync to log Apple Pay taps automatically and put this number on your home and lock screen.</div></div></div></div></div>
    <div class="foot"><button class="btn primary block" data-ob="auto">Set up automation</button><button class="btn ghost block" data-ob="done">Maybe later</button></div></div>`;
}

function readInputs(root) {
  const v = (sel) => root.querySelector(sel)?.value;
  if (o.step === 1) { o.balance = v("#bal") ?? o.balance; o.name = v("#nm") ?? o.name; }
  root.querySelectorAll("[data-inc]").forEach((i) => (o.incomes[i.dataset.inc][i.dataset.k] = i.value));
  root.querySelectorAll("[data-lump]").forEach((i) => (o.lump[i.dataset.lump] = i.type === "checkbox" ? i.checked : i.value));
  root.querySelectorAll("[data-bill]").forEach((i) => (o.bills[i.dataset.bill][i.dataset.k] = i.value));
  if (o.step === 4) { o.wage = v("#wage") ?? o.wage; o.goal.name = v("#gname") ?? o.goal.name; o.goal.target = v("#gtarget") ?? o.goal.target; o.goal.perPay = v("#gper") ?? o.goal.perPay; }
}

const n = (x) => round2(parseFloat(String(x).replace(/[^\d.-]/g, "")) || 0);

function finish() {
  const t = today();
  const now = Date.now();
  setSettings({ name: o.name.trim(), wage: n(o.wage), coolHours: o.cool, anchor: { amount: n(o.balance), date: t, ts: now }, startDate: s().settings.startDate || t });
  for (const i of o.incomes) if (n(i.amount) > 0) put("income", { id: uid(), name: i.name, amount: n(i.amount), freq: i.freq, next: i.next < t ? t : i.next, day: dayOfMonth(i.next) });
  if (o.lump && n(o.lump.amount) > 0) {
    const amt = n(o.lump.amount);
    const weeks = Math.max(1, Math.ceil((diffDays(t, o.lump.until) + 1) / 7));
    const id = uid();
    // If the lump sum is bigger than the balance they gave, it can't already be in it: treat it as new money.
    if (o.lump.inBalance && amt > n(o.balance)) o.lump.inBalance = false;
    if (!o.lump.inBalance) put("tx", { id: uid(), kind: "income", amount: amt, note: o.lump.name, cat: "income", date: t, ts: now + 1, source: "manual" });
    put("goals", { id, type: "stretch", name: o.lump.name || "Lump sum", emoji: "🪣", target: amt, start: 0, perRelease: round2(amt / weeks), freq: "weekly", next: t, until: o.lump.until });
    put("tx", { id: uid(), kind: "save", amount: amt, goalId: id, note: `${o.lump.name} set aside`, date: t, ts: now + 2, source: "manual" });
  }
  for (const b of o.bills) if (b.name && n(b.amount) > 0) put("bills", { id: uid(), name: b.name, amount: n(b.amount), freq: "monthly", next: b.next < t ? t : b.next, day: dayOfMonth(b.next), kind: b.kind, cat: b.kind === "bill" ? "bills" : "subs" });
  if (o.goal.name && (n(o.goal.target) > 0 || n(o.goal.perPay) > 0)) put("goals", { id: uid(), type: "goal", name: o.goal.name, emoji: "🛟", target: n(o.goal.target), perPay: n(o.goal.perPay), start: 0 });
  // Bills due today post now; today's stretch release goes out.
  runAutomation();
}

export const onboardActions = {
  next: () => { o.step++; },
  back: () => { o.step = Math.max(0, o.step - 1); },
  link: () => automateActions["sync-link"](),
  "inc-add": (el) => { o.incomes.push({ name: el.dataset.name, amount: "", freq: el.dataset.freq, next: addDays(today(), el.dataset.freq === "monthly" ? 14 : 7) }); },
  "inc-del": (el) => { o.incomes.splice(Number(el.dataset.i), 1); },
  "lump-add": () => { o.lump = { name: "Aid refund", amount: "", until: addDays(today(), 15 * 7), inBalance: true }; },
  "lump-del": () => { o.lump = null; },
  "bill-add": (el) => { o.bills.push({ name: el.dataset.name, amount: "", next: addDays(today(), 7), kind: el.dataset.kind }); },
  "bill-del": (el) => { o.bills.splice(Number(el.dataset.i), 1); },
  cool: (el) => { o.cool = Number(el.dataset.h); },
  finish: () => { finish(); o.step = 5; },
  auto: () => { setSettings({ onboarded: true }); runAutomation(); location.hash = "#/automate"; },
  done: () => { setSettings({ onboarded: true }); runAutomation(); location.hash = "#/"; toast("You're set. Log your first spend with ＋"); },
};

export function onboardBefore(root) { readInputs(root); }
export const onboardStep = () => o.step;
