import { get, put, setSettings } from "../store.js";
import { today, addDays, pretty, prettyIn, weekday } from "../dates.js";
import { compute, weekly, isWeekly, categoryStats, categories, categoryMonth, catById, noSpendStreak, resisted, live, needsWorthCheck, weekReview, billsBetween, MOODS, round2 } from "../engine.js";
import { esc, money, icon, plural, sheet, toast, haptic, tile, catTile, catLook, chip, nudge, emptyState, ic, costFrame, hasParentsCard, walletToggle } from "../ui.js";
import { openAdd, openAfford, skipItem, formSheet } from "../sheets.js";
import { openAsk } from "./ask.js";
import { openCooldown } from "../cooldown.js";

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
    tx.wallet === "parents" ? `<span class="tag">parents' card</span>` : "",
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
  if (c.status === "short") out.push(nudge("bad", "triangle-alert", `You're ${money(-c.pool)} short ${c.scheduled ? `until ${pretty(addDays(c.end, 1))}` : `for bills before ${pretty(c.end)}`}`, "Bills coming up need more than you have. Pause anything optional and check whether a bill can move. If the number looks wrong, match your bank balance.", `<button class="btn sm ghost" data-act="balance">Match my bank</button>`));
  else if (isWeekly(st)) {
    const wk = weekly(st);
    for (const [w, label] of [["mine", "your card"], ["parents", "your parents' card"]]) if (wk[w].limit > 0 && wk[w].left < 0) out.push(nudge("bad", "trending-down", `${money(-wk[w].left)} over this week on ${label}`, `It resets ${pretty(addDays(wk.end, 1))}. Until then, anything else on ${label} makes next week start in the hole. A no-spend day or two fixes it.`));
    if (!wk.lastsToEnd) out.push(nudge("warn", "gauge", `${money(wk.mine.limit, { cents: false })}/week runs out before ${pretty(c.end)}`, `Your money supports about ${money(wk.affordableWeekly, { cents: false })}/week until then. Lower your weekly amount or pick a closer end date.`, `<button class="btn sm primary" data-act="weekly">Adjust</button>`));
  }
  else if (c.status === "over") out.push(nudge("bad", "trending-down", `Over today's limit by ${money(-c.leftToday)}`, `It's spread across the rest of the week: every day until ${pretty(c.end)} is now ${money(c.tomorrowDaily ?? 0)}. A no-spend day tomorrow gets you back on track.`));
  // 4. waitlist items ready to decide
  const ready = live(st.wish).filter((w) => w.status === "waiting" && w.unlockAt <= Date.now());
  const cooling = live(st.wish).filter((w) => w.status === "waiting" && w.short && w.unlockAt > Date.now());
  for (const w of cooling.slice(0, 2)) out.push(nudge("warn", "timer", `Cooling down: ${esc(w.name)} (${money(w.price)})`, `Unlocks at ${new Date(w.unlockAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Still want it then? Most cravings don't last that long.`, `<button class="btn sm good" data-act="wish-skip" data-id="${esc(w.id)}">Skip it</button><button class="btn sm ghost" data-act="cd-open" data-id="${esc(w.id)}">Open timer</button>`));
  for (const w of ready.filter((x) => x.short).slice(0, 2)) out.push(nudge("warn", "timer", `Time's up: still want ${esc(w.name)}? (${money(w.price)})`, "If the craving's gone, that's your answer.", `<button class="btn sm good" data-act="wish-skip" data-id="${esc(w.id)}">Skip it</button><button class="btn sm ghost" data-act="cd-open" data-id="${esc(w.id)}">Decide</button>`));
  for (const w of ready.filter((x) => !x.short).slice(0, 2)) out.push(nudge("warn", "hourglass", `Still want ${esc(w.name)}? (${money(w.price)})`, "Your waiting time is up. If you'd forgotten about it, that's your answer.", `<button class="btn sm good" data-act="wish-skip" data-id="${esc(w.id)}">Skip it</button><button class="btn sm ghost" data-act="wish-check" data-id="${esc(w.id)}">Check if I can</button><button class="btn sm ghost" data-act="wish-later" data-id="${esc(w.id)}">Wait longer</button>`));
  // Where the everyday money went (imported history counts too)
  const food = categoryStats(st, "food");
  const coffee = categoryStats(st, "coffee");
  const fc = round2(food.total + coffee.total);
  if (fc >= 20 && st.settings.hideWaste !== today()) out.push(nudge("bad", "cup-soda", `${money(fc)} on food and coffee/boba in 30 days`, `${food.n + coffee.n} purchases${costFrame(fc) ? `, ${costFrame(fc)}` : ""}.${coffee.top && coffee.top[1] > 2 ? ` ${esc(coffee.top[0])}: ${coffee.top[1]} times.` : ""}${food.top && food.top[1] > 2 ? ` ${esc(food.top[0])}: ${food.top[1]} times.` : ""} Next craving, tap Can I afford it? and let the timer run.`, `<a class="btn sm primary" href="#/insights">See the damage</a><button class="btn sm ghost" data-act="hide-waste">Hide today</button>`));
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
  if (!isWeekly(st) && !st.settings.hideWeeklyTip) out.push(nudge("info", "calendar-days", "Budget by the week instead?", "Set one weekly amount for your own card, and a separate one if you also use a parents' card. Parents' card spending never comes out of your balance.", `<button class="btn sm primary" data-act="weekly">Set weekly budget</button><button class="btn sm ghost" data-act="hide-weekly">No thanks</button>`));
    if (!c.scheduled && c.endExpired) out.push(nudge("warn", "calendar-plus", `Your end date (${pretty(st.settings.lastUntil)}) has passed`, "Until you pick a new one, your money is spread over the next 30 days. Nothing is assumed to come in.", `<a class="btn sm primary" href="#/plan/income">Pick a new end date</a>`));
  else if (!c.scheduled && !c.endSet) out.push(nudge("info", "calendar-plus", "How long does this money need to last?", `Right now it's spread over the next 30 days. If nothing steady is coming in (contract or gig pay, or no job right now), pick your own end date, like the end of the semester. Contract pay only counts once it lands.`, `<a class="btn sm primary" href="#/plan/income">Set my end date</a>`));
  else if (c.endSet && c.daysLeft <= 3) out.push(nudge("info", "calendar-plus", `Your plan ends ${prettyIn(c.end)}`, "Whatever's left is spread over the days until then. If you need this money to last longer, pick your next end date now.", `<a class="btn sm ghost" href="#/plan/income">Change end date</a>`));
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
  const daysTxt = c.scheduled ? (c.daysLeft === 1 ? "Last day before money comes in" : `${c.daysLeft} days to payday`) : `${plural(c.daysLeft, "day")} left`;
  const line =
    c.status === "short" ? `Bills before ${pretty(addDays(c.end, 1))} need more than you have.`
    : c.status === "over" ? `Every day until ${pretty(c.end)} drops to ${money(c.tomorrowDaily ?? 0)}.`
    : c.daysLeft === 1 ? (c.scheduled ? `That's everything until money comes in tomorrow.` : `Last day of your plan. Pick a new end date in Plan › Income.`)
    : `${money(c.dailyBase)} a day through ${pretty(c.end)}.`;
  return `
  <header class="top">
    <div><h1>${greeting()}</h1><div class="sub">${pretty(t, { full: true })}</div></div>
    <div class="row" style="gap:8px"><button class="icon-btn" data-act="ask" aria-label="Ask Claude about your budget">${ic("message-circle", { size: 19 })}</button><a class="icon-btn" href="#/automate" aria-label="Automations and widgets">${icon("bolt")}</a><a class="icon-btn" href="#/settings" aria-label="Settings">${icon("gear")}</a></div>
  </header>
  ${isWeekly(st) ? weeklyHero(st, c) : `  <section class="hero ${c.status}" aria-live="polite">
    <div class="hero-top"><span class="label">${c.status === "short" ? (c.scheduled ? "Short before payday" : "Short for upcoming bills") : c.status === "over" ? "Over today's limit" : "Safe to spend today"}</span><span class="days">${daysTxt}</span></div>
    <div class="big num">${big < 0 ? "−" : ""}<small>${esc(cur.replace("−", ""))}</small>${esc(num)}</div>
    <div class="gauge" role="img" aria-label="${c.status === "over" || c.status === "short" ? "Over the limit" : `${pct}% of today's money left`}"><i style="width:${pct}%"></i></div>
    <div class="line">${line}</div>
    <div class="facts">
      ${c.status === "short" ? "" : `<span><b class="num">${money(Math.max(c.pool, 0), { cents: false })}</b> ${c.scheduled ? `left until ${c.daysLeft > 1 ? pretty(addDays(c.end, 1)).replace(/^\w+, /, "") : "tomorrow"}` : `to last through ${pretty(c.end).replace(/^\w+, /, "")}`}</span>`}
      ${c.upcomingTotal > 0 ? `<span><b class="num">${money(c.upcomingTotal, { cents: false })}</b> in bills set aside</span>` : ""}
      <button class="fact-btn" data-act="limit">${c.cap ? `Your limit <b class="num">${money(c.cap)}</b>/day${c.capped ? ` (math allows ${money(c.rawDaily)})` : ""}` : "Set a daily limit"}</button>
    </div>
  </section>`}
  <div class="actions">
    <button class="btn" data-act="afford">${ic("circle-help", { size: 19 })}Can I afford it?</button>
    <button class="btn primary" data-act="add">${ic("plus", { size: 19, stroke: 2.25 })}Log spending</button>
  </div>
  <div class="stats">
    ${isWeekly(st) ? `<a class="stat" href="#/activity"><b class="num">${money(weekly(st).spent)}</b><span>spent this week</span></a>` : `<a class="stat" href="#/activity"><b class="num">${money(c.spentToday)}</b><span>spent today</span></a>`}
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
  "wish-later": (el) => { put("wish", { id: el.dataset.id, short: false, unlockAt: Date.now() + 24 * 3600000 }); toast("Okay, another day to think"); },
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
  ask: () => openAsk(),
  limit: () => openLimit(),
  weekly: () => openWeekly(),
  "hide-weekly": () => setSettings({ hideWeeklyTip: true }),
  "cd-open": (el) => openCooldown(el.dataset.id),
  "hide-waste": () => setSettings({ hideWaste: today() }),
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
      ${hasParentsCard() ? walletToggle(tx.wallet) : ""}
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
    el.querySelectorAll("[data-wallet]").forEach((b) => (b.onclick = () => { put("tx", { id: tx.id, wallet: b.dataset.wallet === "parents" ? "parents" : undefined }); sh.render(); }));
    el.querySelectorAll("[data-mood]").forEach((b) => (b.onclick = () => { put("tx", { id: tx.id, mood: tx.mood === b.dataset.mood ? null : b.dataset.mood }); sh.render(); }));
    el.querySelector("[data-ok]").onclick = () => { put("tx", { id: tx.id, review: false }); haptic(); sh.render(); };
    el.querySelector("[data-del]").onclick = () => { put("tx", { id: tx.id, deleted: true }); sh.render(); };
  };
  sh.render();
}


// Your own daily limit: lower than the math, and the difference just stays in your account.
export function openLimit() {
  const c = compute(get());
  const raw = c.rawDaily;
  const ideas = [0.5, 0.65, 0.8].map((f) => Math.max(1, Math.floor(raw * f))).filter((v, i, a) => v > 0 && a.indexOf(v) === i);
  formSheet({
    title: "Daily limit",
    note: `The math says <b>${money(raw)}</b> a day through ${pretty(c.end, { full: true })}. A lower limit means you spend less each day and the rest stays in your account. Leave it empty for no limit.`,
    value: { dailyCap: c.cap || "" },
    fields: [{ key: "dailyCap", label: "Spend at most per day", type: "money", placeholder: String(ideas[1] || "") }],
    extra: `<div class="chips" style="margin:-4px 0 12px">${ideas.map((v) => `<button type="button" class="chip-btn" data-cap="${v}"><span>${money(v)}/day: keeps ${money(Math.max(0, (raw - v) * c.daysLeft), { cents: false })}</span></button>`).join("")}</div>
      <button type="button" class="btn ghost block" data-askcap style="margin-bottom:12px">${ic("message-circle", { size: 18 })}Ask Claude what my limit should be</button>`,
    onBind: (el) => {
      el.querySelectorAll("[data-cap]").forEach((b) => (b.onclick = () => { el.querySelector('[data-f="dailyCap"]').value = b.dataset.cap; }));
      el.querySelector("[data-askcap]").onclick = () => openAsk(`What daily limit should I set so I actually save money but don't run out before ${c.end}? Look at what I really spend on.`);
    },
    saveLabel: "Save limit",
    onSave: (v) => {
      const cap = Number(v.dailyCap) || 0;
      setSettings({ dailyCap: cap > 0 ? cap : null });
      toast(cap > 0 ? `Limit set: ${money(cap)} a day.` : "No daily limit.");
    },
  });
}

// Weekly mode: what's left this week on each card, and whether your own money lasts at that pace.
function weeklyHero(st, c) {
  const wk = weekly(st);
  const big = wk.left;
  const amt = money(Math.abs(big));
  const cur = amt.match(/^[^\d]+/)?.[0] || "";
  const num = amt.replace(/^[^\d]+/, "");
  const bar = (w, label, cls) => {
    const pct = w.limit > 0 ? Math.max(0, Math.min(100, (w.left / w.limit) * 100)) : 0;
    return `<div class="wk-row ${cls}"><div class="row between"><span>${label}</span><span class="num"><b>${money(w.left)}</b> of ${money(w.limit, { cents: false })}</span></div><div class="gauge" role="img" aria-label="${label}: ${money(w.left)} left of ${money(w.limit)}"><i class="${w.left < 0 ? "over" : ""}" style="width:${w.left < 0 ? 100 : pct}%"></i></div></div>`;
  };
  const resets = pretty(addDays(wk.end, 1));
  return `<section class="hero ${wk.status}" aria-live="polite">
    <div class="hero-top"><span class="label">${wk.status === "over" ? "Over budget this week" : "Left this week"}</span><span class="days">${wk.daysLeftInWeek === 1 ? "Resets tomorrow" : `${wk.daysLeftInWeek} days left`}</span></div>
    <div class="big num">${big < 0 ? "−" : ""}<small>${esc(cur.replace("−", ""))}</small>${esc(num)}</div>
    <div class="wk-rows">${bar(wk.mine, "My card", "mine")}${wk.parents.limit > 0 ? bar(wk.parents, "Parents' card", "parents") : ""}</div>
    <div class="facts">
      <span>Resets ${resets}</span>
      ${wk.runsOut ? `<span>${wk.lastsToEnd ? `At ${money(wk.mine.limit, { cents: false })}/week your ${money(Math.max(c.pool, 0), { cents: false })} lasts past ${pretty(c.end).replace(/^\w+, /, "")}` : `<b class="over">At ${money(wk.mine.limit, { cents: false })}/week your money runs out ${pretty(wk.runsOut).replace(/^\w+, /, "")}</b>, before ${pretty(c.end).replace(/^\w+, /, "")}. Max that lasts: ${money(wk.affordableWeekly, { cents: false })}/week`}</span>` : ""}
      <button class="fact-btn" data-act="weekly">Change weekly budget</button>
    </div>
  </section>`;
}

// Set up weekly budgets: how much per week on your own card and on your parents' card.
export function openWeekly() {
  const st = get();
  const wk = weekly(st);
  const lim = st.settings.weekly || {};
  formSheet({
    title: "Weekly budget",
    note: `Spend by the week instead of the day. Your own money supports up to <b>${money(wk.affordableWeekly, { cents: false })}/week</b> through ${pretty(wk.periodEnd, { full: true })}. Parents' card spending has its own weekly limit and never comes out of your balance.`,
    value: { period: st.settings.period || "week", mine: lim.mine ?? "", parents: lim.parents ?? "", weekStartDow: String(st.settings.weekStartDow ?? 1), parentsCard: st.settings.parentsCard || "" },
    fields: [
      { key: "period", label: "Budget by", type: "select", options: [["week", "Week"], ["day", "Day"]] },
      { key: "mine", label: "My card, per week", type: "money", required: true, placeholder: "40", show: (v) => v.period === "week" },
      { key: "parents", label: "Parents' card, per week", type: "money", placeholder: "20", help: "Leave empty if you don't use a parents' card.", show: (v) => v.period === "week" },
      { key: "parentsCard", label: "Parents' card name in Apple Wallet (optional)", placeholder: "e.g. Amex, Dad", help: "Apple Pay taps on a card whose name contains this count toward the parents' card.", show: (v) => v.period === "week" },
      { key: "weekStartDow", label: "Week starts on", type: "select", options: [["1", "Monday"], ["0", "Sunday"]], show: (v) => v.period === "week" },
    ],
    saveLabel: "Save",
    onSave: (v) => {
      if (v.period === "day") { setSettings({ period: "day" }); toast("Back to a daily budget."); return; }
      const mine = Number(v.mine) || 0;
      if (!(mine > 0)) { toast("Add a weekly amount for your card"); return false; }
      setSettings({ period: "week", weekly: { mine, parents: Number(v.parents) || 0 }, weekStartDow: Number(v.weekStartDow), parentsCard: String(v.parentsCard || "").trim() });
      toast(`Weekly budget: ${money(mine)} on your card${Number(v.parents) > 0 ? ` + ${money(Number(v.parents))} on your parents'` : ""}.`);
    },
  });
}