import { get } from "../store.js";
import { today, addDays, pretty, monthStart, daysInMonth, weekday, monthName, dowName } from "../dates.js";
import { live, flexOn, catById, round2, isFlex } from "../engine.js";
import { esc, money, ic, emptyState } from "../ui.js";
import { txRow } from "./home.js";
import { openAdd, openBalanceCheck } from "../sheets.js";

const s = () => get();
const ui = { q: "", f: "all", limit: 60, month: null };

function calendar(month) {
  const st = s();
  const t = today();
  const first = monthStart(month);
  const n = daysInMonth(first);
  const lead = (weekday(first) + 6) % 7; // weeks start Monday
  let cells = "";
  for (let i = 0; i < 7; i++) cells += `<div class="h">${dowName((i + 1) % 7)[0]}</div>`;
  for (let i = 0; i < lead; i++) cells += `<div></div>`;
  let ns = 0;
  let under = 0;
  for (let i = 1; i <= n; i++) {
    const d = first.slice(0, 8) + String(i).padStart(2, "0");
    let cls = "";
    if (d > t) cls = "future";
    else if (d >= st.settings.startDate) {
      const f = flexOn(st, d);
      if (f <= 0) { cls = "ns"; ns++; }
      else if (st.days?.[d]) { if (f <= st.days[d].base + 0.005) { cls = "under"; under++; } else cls = "over"; }
    }
    if (d === t) cls += " today";
    cells += `<div class="d ${cls}" title="${d}">${i}</div>`;
  }
  return { html: `<div class="cal">${cells}</div>`, ns, under };
}

export function renderActivity() {
  const st = s();
  const t = today();
  const month = ui.month || t;
  const cal = calendar(month);
  const mStart = monthStart(month);
  const mEnd = mStart.slice(0, 8) + String(daysInMonth(mStart)).padStart(2, "0");
  const monthSpent = round2(live(st.tx).filter((x) => x.kind === "expense" && x.date >= mStart && x.date <= mEnd).reduce((a, x) => a + Number(x.amount), 0));
  const monthIn = round2(live(st.tx).filter((x) => x.kind === "income" && x.date >= mStart && x.date <= mEnd).reduce((a, x) => a + Number(x.amount), 0));
  const q = ui.q.trim().toLowerCase();
  let txs = live(st.tx).filter((x) => x.kind !== "adjust" || ui.f === "all");
  if (ui.f === "spend") txs = txs.filter((x) => x.kind === "expense");
  if (ui.f === "in") txs = txs.filter((x) => x.kind === "income" || x.kind === "unsave");
  if (ui.f === "saved") txs = txs.filter((x) => x.kind === "save");
  if (ui.f === "auto") txs = txs.filter((x) => x.source === "applepay" || x.source === "shortcut" || x.source === "bill");
  if (ui.f === "regret") txs = txs.filter((x) => x.worth === "no");
  if (q) txs = txs.filter((x) => (x.note || "").toLowerCase().includes(q) || catById(st, x.cat).name.toLowerCase().includes(q) || String(x.amount).includes(q));
  txs.sort((a, b) => (a.date === b.date ? (b.ts || 0) - (a.ts || 0) : a.date < b.date ? 1 : -1));
  const shown = txs.slice(0, ui.limit);
  const groups = [];
  for (const tx of shown) {
    if (!groups.length || groups[groups.length - 1].date !== tx.date) groups.push({ date: tx.date, items: [] });
    groups[groups.length - 1].items.push(tx);
  }
  const filters = [["all", "All"], ["spend", "Spending"], ["in", "Money in"], ["saved", "Saved"], ["auto", "Automatic"], ["regret", "Regrets"]];
  const prevMonth = addDays(mStart, -1);
  const nextMonth = addDays(mEnd, 1);
  return `
  <header class="top"><div><h1>Activity</h1><div class="sub">${money(monthSpent)} spent${monthIn ? `, ${money(monthIn)} came in` : ""} in ${monthName(month)}</div></div>
    <div class="row" style="gap:8px"><button class="icon-btn" data-act="import" aria-label="Import past purchases">${ic("clipboard-paste", { size: 19 })}</button><button class="icon-btn" data-act="income" aria-label="Add money in">${ic("banknote", { size: 19 })}</button></div></header>
  <div class="card">
    <div class="row between" style="margin-bottom:10px">
      <button class="btn sm ghost" data-act="month" data-m="${prevMonth}" aria-label="Previous month">${ic("chevron-left", { size: 20 })}</button>
      <div style="font-weight:700">${monthName(month)} ${month.slice(0, 4)}</div>
      <button class="btn sm ghost" data-act="month" data-m="${nextMonth}" ${nextMonth > t ? "disabled" : ""} aria-label="Next month">${ic("chevron-right", { size: 20 })}</button>
    </div>
    ${cal.html}
    <div class="row small muted" style="margin-top:10px;gap:14px;flex-wrap:wrap">
      <span><span class="tag ok" style="background:var(--green);color:#fff;margin:0">■</span> no-spend (${cal.ns})</span>
      <span><span class="tag ok" style="margin:0">■</span> under limit (${cal.under})</span>
      <span><span class="tag bad" style="margin:0">■</span> over</span>
    </div>
  </div>
  <label class="f"><input class="in" id="q" type="search" placeholder="Search merchant, category, amount" value="${esc(ui.q)}"></label>
  <div class="seg">${filters.map(([k, l]) => `<button data-act="filter" data-f="${k}" class="${ui.f === k ? "on" : ""}">${l}</button>`).join("")}</div>
  ${groups.length ? groups.map((g) => {
    const dayTotal = round2(g.items.filter(isFlex).reduce((a, x) => a + Number(x.amount), 0));
    return `<div class="day-head"><span>${pretty(g.date)}</span><span class="num">${dayTotal ? money(dayTotal) : ""}</span></div><div class="list">${g.items.map(txRow).join("")}</div>`;
  }).join("") : emptyState("receipt-text", q || ui.f !== "all" ? "Nothing matches that search." : "Nothing logged yet. Tap the plus button to log your first spend.")}
  ${txs.length > ui.limit ? `<button class="btn block ghost" data-act="more">Show more</button>` : ""}
  <button class="btn block ghost" data-act="balance" style="margin-top:14px">${ic("scale", { size: 18 })}Match my bank balance</button>`;
}

export const activityActions = {
  filter: (el) => { ui.f = el.dataset.f; ui.limit = 60; },
  more: () => { ui.limit += 100; },
  month: (el) => { ui.month = el.dataset.m; },
  income: () => openAdd({ kind: "income" }),
  balance: () => openBalanceCheck(),
};

export function bindActivity(root, rerender) {
  const q = root.querySelector("#q");
  if (q) q.oninput = () => {
    ui.q = q.value;
    const pos = q.selectionStart;
    rerender();
    const q2 = document.querySelector("#q");
    q2.focus();
    try { q2.setSelectionRange(pos, pos); } catch {}
  };
}
