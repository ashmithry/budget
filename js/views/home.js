import { get, put, setSettings } from "../store.js";
import { today, addDays, pretty, prettyIn, weekday } from "../dates.js";
import { compute, categories, categoryMonth, catById, noSpendStreak, resisted, live, needsWorthCheck, weekReview, billsBetween, MOODS, round2 } from "../engine.js";
import { esc, money, icon, plural, sheet, toast, haptic, tile, catTile, catLook, chip, nudge, emptyState, ic } from "../ui.js";
import { openAdd, openAfford, skipItem } from "../sheets.js";

const s = () => get();


function greeting() {
  const h = new Date().getHours();
  const n = s().settings.name ? `, ${esc(s().settings.name)}` : "";
  return (h < 5 ? "Up late" : h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening") + n;
}

function txRow(tx) {
  const c = catById(s(), tx.cat);
  const isIn = tx.kind === "income" || tx.kind === "unsave" || (tx.kind === "expense" && tx.amount < 0) || (tx.kind === "adjust" && tx.amount > 0);
  const tileHTML = tx.kind === "income" ? tile("banknote", "#2e6a47") : tx.kind === "save" ? tile("piggy-bank", "#55589c") : tx.kind === "unsave" ? tile("lock-open", "#2e6a47") : tx.kind === "adjust" ? tile("scale", "#56625b") : catTile(c);
  const mood = tx.mood ? MOODS.find((m) => m.id === tx.mood) : null;
  const tags = [
    tx.source === "applepay" ? `<span class="tag brand">Apple Pay</span>` : tx.source === "shortcut" ? `<span class="tag brand">Shortcut</span>` : "",
    tx.source === "bill" ? `<span class="tag">auto</span>` : "",
    tx.review ? `<span class="tag warn">check</span>` : "",
    tx.aiCat ? `<span class="tag">sorted by Claude</span>` : "",
    tx.worth === "no" ? `<span class="tag bad">regret</span>` : "",
  ].join("");
  const name = tx.note || (tx.kind === "expense" ? c.name : tx.kind === "income" ? "Money in" : tx.kind === "save" ? "Saved" : "Adjustment");
  const meta = tx.kind === "expense" ? `${esc(c.name)}${mood ? `, ${mood.label.toLowerCase()}` : ""}` : tx.kind === "save" ? "Set aside" : tx.kind === "unsave" ? "Released to spend" : tx.kind === "income" ? "Income" : "Balance fix";
  const sign = isIn ? "+" : tx.kind === "expense" || tx.kind === "save" || tx.kind === "adjust" ? "" : "";
  return `<button class="item" data-tx="${esc(tx.id)}">${tileHTML}<div class="main"><div class="name">${esc(name)}${tags}</div><div class="meta">${meta}</div></div><div class="amt num ${isIn ? "pos" : ""}">${sign}${money(Math.abs(tx.amount))}</div></button>`;
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
    out.push(nudge("info", "zap", `${plural(review.length, "purchase")} logged automatically`, `${money(total)} from Apple Pay and Shortcuts. Check the categories so your budget stays right.`, `<button class="btn sm primary" data-act="review">Check them</button>`));
  }
  // 2. payday just landed
  const pays = live(st.tx).filter((x) => x.source === "payday" && x.date >= addDays(t, -2) && !x.seen);
  for (const p of pays) {
    const saved = live(st.tx).filter((x) => x.source === "auto" && x.kind === "save" && x.date === p.date && x.id.startsWith("gs:") && x.id.includes(`:${p.incomeId}:`));
    out.push(nudge("ok", "banknote", `Payday: ${money(p.amount)} from ${esc(p.note)}`, `Logged automatically${saved.length ? `, and ${saved.map((x) => `${money(x.amount)} went to ${esc(x.note.replace("Auto-save → ", ""))}`).join(", ")} first` : ""}. Got a different amount?`, `<button class="btn sm ghost" data-act="edit-pay" data-id="${esc(p.id)}">Fix amount</button><button class="btn sm good" data-act="seen" data-id="${esc(p.id)}">Looks right</button>`));
  }
  // 3. state-of-the-day coaching
  if (c.status === "short") out.push(nudge("bad", "triangle-alert", `You're ${money(-c.pool)} short until ${pretty(addDays(c.end, 1))}`, "Bills coming up need more than you have. Pause anything optional and check whether a bill can move. If the number looks wrong, match your bank balance.", `<button class="btn sm ghost" data-act="balance">Match my bank</button>`));
  else if (c.status === "over") out.push(nudge("bad", "trending-down", `Over today's limit by ${money(-c.leftToday)}`, `It's spread across the rest of the week: every day until ${pretty(c.end)} is now ${money(c.tomorrowDaily ?? 0)}. A no-spend day tomorrow gets you back on track.`));
  // 4. waitlist items ready to decide
  const ready = live(st.wish).filter((w) => w.status === "waiting" && w.unlockAt <= Date.now());
  for (const w of ready.slice(0, 2)) out.push(nudge("warn", "hourglass", `Still want ${esc(w.name)}? (${money(w.price)})`, "Your waiting time is up. If you'd forgotten about it, that's your answer.", `<button class="btn sm good" data-act="wish-skip" data-id="${esc(w.id)}">Skip it</button><button class="btn sm ghost" data-act="wish-check" data-id="${esc(w.id)}">Check if I can</button><button class="btn sm ghost" data-act="wish-later" data-id="${esc(w.id)}">Wait longer</button>`));
  // 5. "was it worth it?"
  for (const tx of needsWorthCheck(st).slice(0, 1)) out.push(nudge("info", "circle-help", `Was ${esc(tx.note || catById(st, tx.cat).name)} worth ${money(tx.amount)}?`, `${pretty(tx.date)}. Rating purchases shows you what you regret, so next time it's easier to skip.`, `<button class="btn sm ghost" data-act="worth" data-v="yes" data-id="${esc(tx.id)}">${ic("thumbs-up", { size: 16 })}Worth it</button><button class="btn sm ghost" data-act="worth" data-v="no" data-id="${esc(tx.id)}">${ic("thumbs-down", { size: 16 })}Regret it</button><button class="btn sm ghost" data-act="worth" data-v="skip" data-id="${esc(tx.id)}">Not sure</button>`));
  // 6. trials ending + bills in the next 3 days
  const soon = billsBetween(st, addDays(t, -1), addDays(t, 3)).filter((x) => x.date > t);
  for (const x of soon.filter((y) => y.bill.kind === "trial").slice(0, 2)) out.push(nudge("warn", "alarm-clock", `${esc(x.bill.name)} trial ends ${prettyIn(x.date)}`, `It turns into ${money(x.amount)} ${x.bill.freq === "yearly" ? "a year" : "a month"}. Cancel now if you won't really use it.`, `<button class="btn sm ghost" data-act="bill-cancel" data-id="${esc(x.bill.id)}">I cancelled it</button><button class="btn sm ghost" data-act="seen-bill" data-id="${esc(x.bill.id)}">Keeping it</button>`));
  const plainSoon = soon.filter((y) => y.bill.kind !== "trial");
  if (plainSoon.length) out.push(nudge("info", "calendar-clock", `Coming up: ${plainSoon.map((x) => `${esc(x.bill.name)} ${money(x.amount)} (${prettyIn(x.date)})`).join(", ")}`, "Already set aside, so it won't come out of today's number."));
  // 7. Weekly review (Sun/Mon)
  const wd = weekday(t);
  const wkKey = addDays(t, -wd);
  if ((wd === 0 || wd === 1) && st.settings.reviewSeen !== wkKey && st.settings.startDate <= addDays(t, -5)) {
    const w = weekReview(st);
    const diff = w.prevSpent ? Math.round(((w.spent - w.prevSpent) / w.prevSpent) * 100) : null;
    out.push(nudge("info", "chart-line", `Your week: ${money(w.spent)} spent`, `${[w.tracked ? `${w.under} of ${w.tracked} days under your limit` : "", plural(w.noSpend, "no-spend day"), diff != null ? `${diff <= 0 ? `${-diff}% less` : `${diff}% more`} than the week before` : "", w.topCat ? `most on ${esc(catById(st, w.topCat.id).name.toLowerCase())} (${money(w.topCat.total)})` : ""].filter(Boolean).join(", ").replace(/^./, (m) => m.toUpperCase())}.`, `<a class="btn sm primary" href="#/insights">See insights</a><button class="btn sm ghost" data-act="review-seen" data-wk="${wkKey}">Got it</button>`));
  }
  // 8. budgets running hot
  const hot = categoryMonth(st).filter((x) => x.limit > 0 && (x.state === "over" || x.state === "ahead")).sort((a, b) => b.pct - a.pct);
  if (hot.length) {
    const h = hot[0];
    out.push(nudge("warn", catLook(h).icon, `${esc(h.name)}: ${h.state === "over" ? `${money(h.spent - h.limit)} over this month` : `${money(h.spent)} of ${money(h.limit)} already`}`, h.state === "over" ? "Anything more here comes out of your other plans." : `On pace for ${money(h.projected)} by month end. Go easy on this one for a few days.`));
  }
  // 9. setup prompts
  if (!live(st.income).length && !live(st.goals).some((g) => g.type === "stretch")) out.push(nudge("info", "calendar-plus", "When do you get money next?", "Add a paycheck, allowance or a lump sum (like a financial aid refund) so the daily number spreads it out correctly.", `<a class="btn sm primary" href="#/plan/income">Add income</a>`));
  if (!st.meta.key && !st.settings.hideAutoTip) out.push(nudge("info", "credit-card", "Log purchases automatically", "Every Apple Pay tap can log itself, and a widget can show today's number on your home and lock screen.", `<a class="btn sm primary" href="#/automate">Set it up</a><button class="btn sm ghost" data-act="hide-auto">Later</button>`));
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
  const pct = c.status === "over" || c.status === "short" ? 100 : Math.round(Math.max(0, Math.min(1, frac)) * 100);
  const daysTxt = c.daysLeft === 1 ? "Last day before money comes in" : `${c.daysLeft} days to payday`;
  const line =
    c.status === "short" ? `Bills before ${pretty(addDays(c.end, 1))} need more than you have.`
    : c.status === "over" ? `Every day until ${pretty(c.end)} drops to ${money(c.tomorrowDaily ?? 0)}.`
    : c.daysLeft === 1 ? `That's everything until money comes in tomorrow.`
    : `${money(c.dailyBase)} a day through ${pretty(c.end)}.`;
  return `
  <header class="top">
    <div><h1>${greeting()}</h1><div class="sub">${pretty(t, { full: true })}</div></div>
    <div class="row" style="gap:8px"><a class="icon-btn" href="#/automate" aria-label="Automations and widgets">${icon("bolt")}</a><a class="icon-btn" href="#/settings" aria-label="Settings">${icon("gear")}</a></div>
  </header>
  <section class="hero ${c.status}" aria-live="polite">
    <div class="hero-top"><span class="label">${c.status === "short" ? "Short before payday" : c.status === "over" ? "Over today's limit" : "Safe to spend today"}</span><span class="days">${daysTxt}</span></div>
    <div class="big num">${big < 0 ? "−" : ""}<small>${esc(cur.replace("−", ""))}</small>${esc(num)}</div>
    <div class="gauge" role="img" aria-label="${c.status === "over" || c.status === "short" ? "Over the limit" : `${pct}% of today's money left`}"><i style="width:${pct}%"></i></div>
    <div class="line">${line}</div>
    <div class="facts">
      ${c.status === "short" ? "" : `<span><b class="num">${money(Math.max(c.pool, 0), { cents: false })}</b> left until ${c.daysLeft > 1 ? pretty(addDays(c.end, 1)).replace(/^\w+, /, "") : "tomorrow"}</span>`}
      ${c.upcomingTotal > 0 ? `<span><b class="num">${money(c.upcomingTotal, { cents: false })}</b> in bills set aside</span>` : ""}
    </div>
  </section>
  <div class="actions">
    <button class="btn" data-act="afford">${ic("circle-help", { size: 19 })}Can I afford it?</button>
    <button class="btn primary" data-act="add">${ic("plus", { size: 19, stroke: 2.25 })}Log spending</button>
  </div>
  <div class="stats">
    <a class="stat" href="#/activity"><b class="num">${money(c.spentToday)}</b><span>spent today</span></a>
    <a class="stat" href="#/wait"><b class="num">${waiting.length ? waiting.length : money(res.total, { cents: false })}</b><span>${waiting.length ? "on your waitlist" : "not spent by skipping"}</span></a>
    <a class="stat" href="#/insights"><b class="num">${plural(streak, "day")}</b><span>no-spend streak</span></a>
  </div>
  ${nudges(c)}
  <div class="section-title"><span>Today</span><a href="#/activity">All activity</a></div>
  ${todays.length ? `<div class="list">${todays.map(txRow).join("")}</div>` : emptyState("sprout", `Nothing spent today${streak > 1 ? `. That's day ${streak} of your no-spend streak.` : ". Keep it a no-spend day?"}`)}
  ${flex.length ? `<div class="section-title"><span>This month</span><a href="#/plan/budgets">Budgets</a></div>
  <div class="list">${flex.map((x) => `<a class="budget-row" href="#/plan/budgets" style="color:inherit;text-decoration:none"><div class="row between"><span class="row" style="gap:10px">${catTile(x)}${esc(x.name)}</span><span class="num small ${x.state === "over" ? "over" : x.state === "ahead" ? "tight" : "muted"}">${money(x.spent, { cents: false })} / ${money(x.limit, { cents: false })}</span></div><div class="bar"><i class="${x.state}" style="width:${Math.min(100, x.pct * 100)}%"></i><b style="left:${Math.min(100, (x.pace / x.limit) * 100)}%"></b></div></a>`).join("")}</div>
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
  "bill-cancel": (el) => { put("bills", { id: el.dataset.id, deleted: true }); toast("Cancelled. That's money back every month."); },
  "seen-bill": (el) => put("bills", { id: el.dataset.id, kind: "sub" }),
  "review-seen": (el) => setSettings({ reviewSeen: el.dataset.wk }),
  "hide-auto": () => setSettings({ hideAutoTip: true }),
  balance: () => import("../sheets.js").then((m) => m.openBalanceCheck()),
};

// Go through auto-logged purchases: one tap per category, optional "why".
export function openReview() {
  const sh = sheet(() => {
    const items = live(s().tx).filter((x) => x.review).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    if (!items.length) return `<h3>All caught up<button data-close>Done</button></h3>${emptyState("circle-check", "Everything's filed.")}`;
    const tx = items[0];
    const cats = categories(s()).filter((c) => c.id !== "bills");
    return `<h3>Check purchases <span class="tag">${items.length} left</span><button data-close>Done</button></h3>
      <div class="card" style="text-align:center"><div class="amount-display num" style="font-size:44px">${money(tx.amount)}</div>
      <div style="font-weight:650">${esc(tx.note || "Unknown merchant")}</div><div class="small muted">${pretty(tx.date)}${tx.card ? `, ${esc(tx.card)}` : ""}</div></div>
      <div class="small muted" style="margin:0 4px 8px">Category</div>
      <div class="chips" style="margin-bottom:14px">${cats.map((c) => chip(catLook(c).icon, c.name, tx.cat === c.id, `data-cat="${c.id}"`, catLook(c).color)).join("")}</div>
      <div class="small muted" style="margin:0 4px 8px">Why? (optional)</div>
      <div class="chips" style="margin-bottom:16px">${MOODS.map((m) => chip(m.icon, m.label, tx.mood === m.id, `data-mood="${m.id}"`)).join("")}</div>
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
