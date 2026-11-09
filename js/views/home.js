import { get, put, setSettings } from "../store.js";
import { today, addDays, pretty, weekday } from "../dates.js";
import { compute, categoryMonth, catById, noSpendStreak, resisted, live, needsWorthCheck, weekReview, billsBetween, MOODS, round2 } from "../engine.js";
import { esc, money, icon, plural, sheet, toast, haptic } from "../ui.js";
import { openAdd, openAfford, skipItem } from "../sheets.js";

const s = () => get();

function ring(frac) {
  const r = 31;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, frac));
  return `<svg class="ring" viewBox="0 0 74 74" aria-hidden="true"><circle class="bg" cx="37" cy="37" r="${r}"/><circle class="fg" cx="37" cy="37" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}"/><text x="37" y="37">${Math.round(f * 100)}%</text></svg>`;
}

function greeting() {
  const h = new Date().getHours();
  const n = s().settings.name ? `, ${esc(s().settings.name)}` : "";
  return (h < 5 ? "Up late" : h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening") + n;
}

function txRow(tx) {
  const c = catById(s(), tx.cat);
  const isIn = tx.kind === "income" || tx.kind === "unsave" || (tx.kind === "expense" && tx.amount < 0) || (tx.kind === "adjust" && tx.amount > 0);
  const icon_ = tx.kind === "income" ? "💰" : tx.kind === "save" ? "🎯" : tx.kind === "unsave" ? "🔓" : tx.kind === "adjust" ? "⚖️" : c.emoji;
  const mood = tx.mood ? MOODS.find((m) => m.id === tx.mood) : null;
  const tags = [
    tx.source === "applepay" ? `<span class="tag brand">Apple Pay</span>` : tx.source === "shortcut" ? `<span class="tag brand">Shortcut</span>` : "",
    tx.source === "bill" ? `<span class="tag">auto</span>` : "",
    tx.review ? `<span class="tag warn">check</span>` : "",
    tx.worth === "no" ? `<span class="tag bad">regret</span>` : "",
  ].join("");
  const name = tx.note || (tx.kind === "expense" ? c.name : tx.kind === "income" ? "Money in" : tx.kind === "save" ? "Saved" : "Adjustment");
  const meta = tx.kind === "expense" ? `${esc(c.name)}${mood ? ` · ${mood.emoji} ${mood.label}` : ""}` : tx.kind === "save" ? "Set aside" : tx.kind === "unsave" ? "Released to spend" : tx.kind === "income" ? "Income" : "Balance fix";
  const sign = isIn ? "+" : tx.kind === "expense" || tx.kind === "save" || tx.kind === "adjust" ? "" : "";
  return `<button class="item" data-tx="${esc(tx.id)}"><div class="ic">${icon_}</div><div class="main"><div class="name">${esc(name)}${tags}</div><div class="meta">${meta}</div></div><div class="amt num ${isIn ? "pos" : ""}">${sign}${money(Math.abs(tx.amount))}</div></button>`;
}
export { txRow };

function nudges(c) {
  const out = [];
  const t = today();
  const st = s();
  // 1. auto-logged purchases to look over
  const review = live(st.tx).filter((x) => x.review);
  if (review.length) {
    const total = round2(review.reduce((a, x) => a + (x.kind === "expense" ? Number(x.amount) : 0), 0));
    out.push(`<div class="card accent"><div class="nudge"><div class="em">⚡</div><div class="grow"><div class="t">${plural(review.length, "purchase")} logged automatically</div><div class="d">${money(total)} from Apple Pay / Shortcuts. Check the categories so your budget stays right.</div><div class="btns"><button class="btn sm primary" data-act="review">Check them</button></div></div></div></div>`);
  }
  // 2. payday just landed
  const pays = live(st.tx).filter((x) => x.source === "payday" && x.date >= addDays(t, -2) && !x.seen);
  for (const p of pays) {
    const saved = live(st.tx).filter((x) => x.source === "auto" && x.kind === "save" && x.date === p.date && x.id.startsWith("gs:") && x.id.includes(`:${p.incomeId}:`));
    out.push(`<div class="card ok"><div class="nudge"><div class="em">💰</div><div class="grow"><div class="t">Payday! ${money(p.amount)} from ${esc(p.note)}</div><div class="d">Logged automatically${saved.length ? `, and ${saved.map((x) => `${money(x.amount)} went to ${esc(x.note.replace("Auto-save → ", ""))}`).join(", ")} first (pay yourself first)` : ""}. Got a different amount?</div><div class="btns"><button class="btn sm ghost" data-act="edit-pay" data-id="${esc(p.id)}">Fix amount</button><button class="btn sm good" data-act="seen" data-id="${esc(p.id)}">Looks right</button></div></div></div></div>`);
  }
  // 3. state-of-the-day coaching
  if (c.status === "short") out.push(`<div class="card bad"><div class="nudge"><div class="em">🧯</div><div class="grow"><div class="t">You're ${money(-c.pool)} short until ${pretty(addDays(c.end, 1))}</div><div class="d">Bills coming up need more than you have. Pause anything optional, and check if a bill can move. If something's off, match your bank balance.</div><div class="btns"><button class="btn sm ghost" data-act="balance">Match my bank</button></div></div></div></div>`);
  else if (c.status === "over") out.push(`<div class="card bad"><div class="nudge"><div class="em">🛑</div><div class="grow"><div class="t">Over today's limit by ${money(-c.leftToday)}</div><div class="d">No panic: it's spread out. Every day until ${pretty(c.end)} is now ${money(c.tomorrowDaily ?? 0)}. A no-spend day tomorrow gets you back on track.</div></div></div></div>`);
  // 4. waitlist items ready to decide
  const ready = live(st.wish).filter((w) => w.status === "waiting" && w.unlockAt <= Date.now());
  for (const w of ready.slice(0, 2)) out.push(`<div class="card warn"><div class="nudge"><div class="em">⏳</div><div class="grow"><div class="t">Still want ${esc(w.name)}? (${money(w.price)})</div><div class="d">Your waiting time is up. If you forgot about it, that's your answer.</div><div class="btns"><button class="btn sm good" data-act="wish-skip" data-id="${esc(w.id)}">Skip it</button><button class="btn sm ghost" data-act="wish-check" data-id="${esc(w.id)}">Check if I can</button><button class="btn sm ghost" data-act="wish-later" data-id="${esc(w.id)}">Wait longer</button></div></div></div></div>`);
  // 5. "was it worth it?"
  for (const tx of needsWorthCheck(st).slice(0, 1)) out.push(`<div class="card"><div class="nudge"><div class="em">🤔</div><div class="grow"><div class="t">Was ${esc(tx.note || catById(st, tx.cat).name)} worth ${money(tx.amount)}?</div><div class="d">${pretty(tx.date)}. Rating purchases shows you what you regret, so next time it's easier to skip.</div><div class="btns"><button class="btn sm ghost" data-act="worth" data-v="yes" data-id="${esc(tx.id)}">👍 Worth it</button><button class="btn sm ghost" data-act="worth" data-v="no" data-id="${esc(tx.id)}">👎 Regret it</button><button class="btn sm ghost" data-act="worth" data-v="skip" data-id="${esc(tx.id)}">Not sure</button></div></div></div></div>`);
  // 6. trials ending + bills in the next 3 days
  const soon = billsBetween(st, addDays(t, -1), addDays(t, 3)).filter((x) => x.date > t);
  for (const x of soon.filter((y) => y.bill.kind === "trial").slice(0, 2)) out.push(`<div class="card warn"><div class="nudge"><div class="em">⚠️</div><div class="grow"><div class="t">${esc(x.bill.name)} trial ends ${pretty(x.date).toLowerCase()}</div><div class="d">It turns into ${money(x.amount)} ${x.bill.freq === "yearly" ? "a year" : "a month"}. Cancel now if you won't really use it.</div><div class="btns"><button class="btn sm ghost" data-act="bill-cancel" data-id="${esc(x.bill.id)}">I cancelled it</button><button class="btn sm ghost" data-act="seen-bill" data-id="${esc(x.bill.id)}">Keeping it</button></div></div></div></div>`);
  const plainSoon = soon.filter((y) => y.bill.kind !== "trial");
  if (plainSoon.length) out.push(`<div class="card"><div class="nudge"><div class="em">🧾</div><div class="grow"><div class="t">Coming up: ${plainSoon.map((x) => `${esc(x.bill.name)} ${money(x.amount)} (${pretty(x.date).toLowerCase()})`).join(", ")}</div><div class="d">Already set aside. It won't come out of today's number.</div></div></div></div>`);
  // 7. Weekly review (Sun/Mon)
  const wd = weekday(t);
  const wkKey = addDays(t, -wd);
  if ((wd === 0 || wd === 1) && st.settings.reviewSeen !== wkKey && st.settings.startDate <= addDays(t, -5)) {
    const w = weekReview(st);
    const diff = w.prevSpent ? Math.round(((w.spent - w.prevSpent) / w.prevSpent) * 100) : null;
    out.push(`<div class="card accent"><div class="nudge"><div class="em">📊</div><div class="grow"><div class="t">Your week: ${money(w.spent)} spent</div><div class="d">${w.tracked ? `${w.under}/${w.tracked} days under your limit · ` : ""}${plural(w.noSpend, "no-spend day")}${diff != null ? ` · ${diff <= 0 ? `${-diff}% less` : `${diff}% more`} than last week` : ""}${w.topCat ? ` · most on ${esc(catById(st, w.topCat.id).name)} (${money(w.topCat.total)})` : ""}.</div><div class="btns"><a class="btn sm primary" href="#/insights">See insights</a><button class="btn sm ghost" data-act="review-seen" data-wk="${wkKey}">Got it</button></div></div></div></div>`);
  }
  // 8. budgets running hot
  const hot = categoryMonth(st).filter((x) => x.limit > 0 && (x.state === "over" || x.state === "ahead")).sort((a, b) => b.pct - a.pct);
  if (hot.length) {
    const h = hot[0];
    out.push(`<div class="card warn"><div class="nudge"><div class="em">${h.emoji}</div><div class="grow"><div class="t">${esc(h.name)}: ${h.state === "over" ? `${money(h.spent - h.limit)} over this month` : `${money(h.spent)} of ${money(h.limit)} already`}</div><div class="d">${h.state === "over" ? "Anything more here comes out of other plans." : `On pace for ${money(h.projected)} by month end. Easy on this one for a few days.`}</div></div></div></div>`);
  }
  // 9. setup prompts
  if (!live(st.income).length && !live(st.goals).some((g) => g.type === "stretch")) out.push(`<div class="card"><div class="nudge"><div class="em">🗓️</div><div class="grow"><div class="t">When do you get money next?</div><div class="d">Add a paycheck, allowance or a lump sum (like a financial aid refund) so the daily number spreads it out correctly.</div><div class="btns"><a class="btn sm primary" href="#/plan/income">Add income</a></div></div></div></div>`);
  if (!st.meta.key && !st.settings.hideAutoTip) out.push(`<div class="card accent"><div class="nudge"><div class="em">🤖</div><div class="grow"><div class="t">Log purchases automatically</div><div class="d">Every Apple Pay tap can log itself, and a widget can show today's number on your home and lock screen.</div><div class="btns"><a class="btn sm primary" href="#/automate">Set it up</a><button class="btn sm ghost" data-act="hide-auto">Later</button></div></div></div></div>`);
  return out.join("");
}

export function renderHome() {
  const st = s();
  const c = compute(st);
  const t = today();
  const streak = noSpendStreak(st);
  const res = resisted(st);
  const todays = live(st.tx).filter((x) => x.date === t).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const flex = categoryMonth(st).filter((x) => x.limit > 0 && !x.fixed).sort((a, b) => b.pct - a.pct).slice(0, 4);
  const big = c.status === "short" ? c.pool : c.leftToday;
  const frac = c.dailyBase > 0 ? c.leftToday / c.dailyBase : 0;
  const amt = money(Math.abs(big));
  const [cur, num] = [amt.match(/^[^\d]+/)?.[0] || "", amt.replace(/^[^\d]+/, "")];
  const waiting = live(st.wish).filter((w) => w.status === "waiting");
  const endTxt = c.daysLeft === 1 ? "today is the last day before money comes in" : `${money(c.dailyBase)}/day through ${pretty(c.end)}`;
  return `
  <header class="top">
    <div><h1>${greeting()}</h1><div class="sub">${pretty(t, { full: true })}</div></div>
    <div class="row" style="gap:8px"><a class="icon-btn" href="#/automate" aria-label="Automations and widgets">${icon("bolt")}</a><a class="icon-btn" href="#/settings" aria-label="Settings">${icon("gear")}</a></div>
  </header>
  <section class="hero ${c.status}" aria-live="polite">
    ${c.status !== "short" ? ring(frac) : ""}
    <div class="label">${c.status === "short" ? "Short until payday" : c.status === "over" ? "Over today's limit" : "Safe to spend today"}</div>
    <div class="big num">${big < 0 ? "−" : ""}<small>${esc(cur.replace("−", ""))}</small>${esc(num)}</div>
    <div class="line">${c.status === "short" ? `Bills before ${pretty(addDays(c.end, 1))} need more than you have` : c.status === "over" ? `Tomorrow: ${money(c.tomorrowDaily ?? 0)}/day` : endTxt}</div>
    <div class="chips">
      ${c.status === "short" ? "" : `<span class="chip">💵 ${money(Math.max(c.pool, 0), { cents: false })} until ${c.daysLeft > 1 ? pretty(addDays(c.end, 1)).replace(/^\w+, /, "") : "tomorrow"}</span>`}
      ${c.upcomingTotal > 0 ? `<span class="chip">🧾 ${money(c.upcomingTotal, { cents: false })} bills set aside</span>` : ""}
      ${streak >= 1 ? `<span class="chip">🔥 ${plural(streak, "no-spend day")}</span>` : ""}
    </div>
  </section>
  <div class="actions">
    <button class="btn" data-act="afford">🤔 Can I afford it?</button>
    <button class="btn primary" data-act="add">＋ Log spending</button>
  </div>
  <div class="stats">
    <a class="stat" href="#/activity"><b class="num">${money(c.spentToday)}</b><span>spent today</span></a>
    <a class="stat" href="#/wait"><b class="num">${waiting.length ? waiting.length : money(res.total, { cents: false })}</b><span>${waiting.length ? "on waitlist" : "not spent (skipped)"}</span></a>
    <a class="stat" href="#/insights"><b class="num">${streak}</b><span>day streak 🔥</span></a>
  </div>
  ${nudges(c)}
  <div class="section-title"><span>Today</span><a href="#/activity">All activity</a></div>
  ${todays.length ? `<div class="list">${todays.map(txRow).join("")}</div>` : `<div class="card empty"><div class="em">🌱</div>Nothing spent today${streak > 1 ? `. Day ${streak} of your streak!` : ". Keep it a no-spend day?"}</div>`}
  ${flex.length ? `<div class="section-title"><span>This month</span><a href="#/plan/budgets">Budgets</a></div>
  <div class="list">${flex.map((x) => `<a class="budget-row" href="#/plan/budgets" style="color:inherit;text-decoration:none"><div class="row between"><span>${x.emoji} ${esc(x.name)}</span><span class="num small ${x.state === "over" ? "over" : x.state === "ahead" ? "tight" : "muted"}">${money(x.spent, { cents: false })} / ${money(x.limit, { cents: false })}</span></div><div class="bar"><i class="${x.state}" style="width:${Math.min(100, x.pct * 100)}%"></i><b style="left:${Math.min(100, (x.pace / x.limit) * 100)}%"></b></div></a>`).join("")}</div>
  <p class="tiny faint" style="margin:-4px 6px 0">The tick shows where you'd be if you spent evenly all month.</p>` : ""}`;
}

export const homeActions = {
  add: () => openAdd(),
  afford: () => openAfford(),
  review: () => openReview(),
  "edit-pay": (el) => openAdd({ id: el.dataset.id }),
  seen: (el) => put("tx", { id: el.dataset.id, seen: true }),
  "wish-skip": (el) => { const w = live(s().wish).find((x) => x.id === el.dataset.id); if (w) skipItem({ ...w }); },
  "wish-check": (el) => { const w = live(s().wish).find((x) => x.id === el.dataset.id); if (w) openAfford({ price: w.price, name: w.name, cat: w.cat, wishId: w.id }); },
  "wish-later": (el) => { put("wish", { id: el.dataset.id, unlockAt: Date.now() + 24 * 3600000 }); toast("Okay, another day to think"); },
  worth: (el) => {
    const v = el.dataset.v;
    put("tx", v === "skip" ? { id: el.dataset.id, worthSkip: true } : { id: el.dataset.id, worth: v });
    haptic();
    if (v === "no") toast("Noted. We'll show you your regret patterns in Insights.");
  },
  "bill-cancel": (el) => { put("bills", { id: el.dataset.id, deleted: true }); toast("Nice save 🎉"); },
  "seen-bill": (el) => put("bills", { id: el.dataset.id, kind: "sub" }),
  "review-seen": (el) => setSettings({ reviewSeen: el.dataset.wk }),
  "hide-auto": () => setSettings({ hideAutoTip: true }),
  balance: () => import("../sheets.js").then((m) => m.openBalanceCheck()),
};

// Go through auto-logged purchases: one tap per category, optional "why".
export function openReview() {
  const sh = sheet(() => {
    const items = live(s().tx).filter((x) => x.review).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    if (!items.length) return `<h3>All caught up<button data-close>Done</button></h3><div class="empty"><div class="em">✅</div>Everything's filed.</div>`;
    const tx = items[0];
    const cats = s().cats.filter((c) => !c.deleted && c.id !== "bills");
    return `<h3>Check purchases <span class="tag">${items.length} left</span><button data-close>Done</button></h3>
      <div class="card" style="text-align:center"><div class="amount-display num" style="font-size:44px">${money(tx.amount)}</div>
      <div style="font-weight:650">${esc(tx.note || "Unknown merchant")}</div><div class="small muted">${pretty(tx.date)}${tx.card ? ` · ${esc(tx.card)}` : ""}</div></div>
      <div class="small muted" style="margin:0 4px 8px">Category</div>
      <div class="chips" style="margin-bottom:14px">${cats.map((c) => `<button class="chip-btn ${tx.cat === c.id ? "on" : ""}" data-cat="${c.id}">${c.emoji} ${esc(c.name)}</button>`).join("")}</div>
      <div class="small muted" style="margin:0 4px 8px">Why? (optional)</div>
      <div class="chips" style="margin-bottom:16px">${MOODS.map((m) => `<button class="chip-btn ${tx.mood === m.id ? "on" : ""}" data-mood="${m.id}">${m.emoji} ${m.label}</button>`).join("")}</div>
      <div class="two"><button class="btn danger" data-del>Not mine / dupe</button><button class="btn primary" data-ok ${tx.cat ? "" : "disabled"}>Next</button></div>`;
  });
  sh.bind = (el) => {
    el.querySelector("[data-close]").onclick = () => sh.close();
    const tx = live(s().tx).filter((x) => x.review).sort((a, b) => (a.ts || 0) - (b.ts || 0))[0];
    if (!tx) return;
    el.querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => { put("tx", { id: tx.id, cat: b.dataset.cat }); sh.render(); }));
    el.querySelectorAll("[data-mood]").forEach((b) => (b.onclick = () => { put("tx", { id: tx.id, mood: tx.mood === b.dataset.mood ? null : b.dataset.mood }); sh.render(); }));
    el.querySelector("[data-ok]").onclick = () => { put("tx", { id: tx.id, review: false }); haptic(); sh.render(); };
    el.querySelector("[data-del]").onclick = () => { put("tx", { id: tx.id, deleted: true }); sh.render(); };
  };
  sh.render();
}
