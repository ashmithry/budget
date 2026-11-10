import { get, commit, put } from "../store.js";
import { ai, AIError, spendingSummary } from "../ai.js";
import { openImport } from "./importer.js";
import { openAsk } from "./ask.js";
import { today, addDays, diffDays, monthStart, dayOfMonth, dowName } from "../dates.js";
import { live, categoryMonth, leaks, moodStats, regretStats, weekdayStats, lateNight, resisted, noSpendStreak, underStreak, weekReview, txIn, isFlex, catById, MOODS, round2, recurringMonthly, uid } from "../engine.js";
import { esc, money, plural, costFrame, ic, catTile, emptyState, toast, nudge } from "../ui.js";

const s = () => get();

// The numbers Claude sees for the weekly check-in: totals for the last 7 days, nothing else.
function weekFacts(st) {
  const w = weekReview(st);
  const byCategory = {};
  const byWhy = {};
  for (const tx of txIn(st, w.start, w.end, isFlex)) {
    const c = catById(st, tx.cat).name;
    byCategory[c] = round2((byCategory[c] || 0) + Number(tx.amount));
    if (tx.mood) {
      const m = MOODS.find((x) => x.id === tx.mood)?.label || tx.mood;
      byWhy[m] = round2((byWhy[m] || 0) + Number(tx.amount));
    }
  }
  return {
    currency: st.settings.currency || "$",
    week: `${w.start} to ${w.end}`,
    spent: w.spent,
    dailyLimitsAddedUp: w.allowance,
    daysUnderDailyLimit: w.tracked ? `${w.under} of ${w.tracked}` : "not tracked yet",
    noSpendDays: w.noSpend,
    previousWeekSpent: w.prevSpent,
    byCategory,
    byWhy,
    frequentRepeatPurchases30Days: leaks(st).slice(0, 3).map((l) => ({ name: l.label, times: l.n, total: l.total })),
    skippedPurchasesTotal: resisted(st, w.start).total,
    lateNightPurchases30Days: lateNight(st).n,
  };
}

function checkinCard(st) {
  if (!st.meta.key) return "";
  const wk = weekReview(st).end;
  const c = st.meta.checkin;
  if (c && c.wk === wk) return `<div class="section-title"><span>Weekly check-in</span><span class="tiny faint">from Claude</span></div>
    <div class="card checkin"><div class="t">${esc(c.headline)}</div><p>${esc(c.body)}</p><div class="try">${ic("signpost", { size: 18 })}<div><b>Try this week:</b> ${esc(c.tryThis)}</div></div></div>`;
  return nudge("info", "chart-line", "Weekly check-in from Claude", "A short read on what drove the last 7 days of spending, and one thing to try. Only your weekly totals are sent.", `<button class="btn sm primary" data-act="checkin">Get my check-in</button>`);
}

function roastCard(st) {
  const r = st.meta.roast;
  const fresh = r && r.day === today();
  const head = `<div class="section-title"><span>Reality check</span><span class="tiny faint">from Claude, last 30 days</span></div>`;
  if (fresh) return `${head}<div class="card roast"><div class="t">${esc(r.headline)}</div><ul>${r.receipts.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><div class="could"><b>Could have been:</b> ${esc(r.couldHaveBeen)}</div><div class="rule"><b>Rule that would have saved the most:</b> ${esc(r.rule)}</div>
    <div class="btns" style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn sm primary" data-act="roast-rule">Add that rule</button><button class="btn sm ghost" data-act="ask">Ask a follow-up</button></div></div>`;
  return `${head}${nudge("bad", "eye", "See exactly what you spent and wasted", "Claude goes through your last 30 days: your worst habits with exact numbers, what that money could have been, and the one rule that would have saved the most.", `<button class="btn sm primary" data-act="roast">Give me a reality check</button>`)}`;
}

export const insightsActions = {
  roast: async (el) => {
    el.disabled = true;
    el.textContent = "Going through your receipts…";
    try {
      const st = get();
      const r = await ai("roast", { summary: spendingSummary(st, 30), days: 30 });
      if (!r.ok) throw new AIError("Not enough spending logged yet. Import your last month first.");
      st.meta.roast = { day: today(), ...r.roast };
      commit({ sync: false });
    } catch (e) {
      el.disabled = false;
      el.textContent = "Give me a reality check";
      toast(e instanceof AIError ? e.message : "Claude couldn't do that right now. Try again.");
    }
  },
  "roast-rule": () => {
    const r = get().meta.roast;
    if (!r?.rule) return;
    put("rules", { id: uid(), text: r.rule.slice(0, 120), cat: null });
    toast("Added to your rules. It shows up when you check a purchase.");
  },
  import: () => openImport(),
  ask: () => openAsk(),
  checkin: async (el) => {
    el.disabled = true;
    el.textContent = "Reading your week…";
    try {
      const st = get();
      const r = await ai("checkin", { week: weekFacts(st) });
      if (!r.ok) throw new AIError("Not enough spending this week for a check-in yet.");
      st.meta.checkin = { wk: weekReview(st).end, ...r.checkin };
      commit({ sync: false });
    } catch (e) {
      el.disabled = false;
      el.textContent = "Get my check-in";
      toast(e instanceof AIError ? e.message : "Claude couldn't do that right now. Try again.");
    }
  },
};

export function renderInsights() {
  const st = s();
  const t = today();
  const mStart = monthStart(t);
  const spentM = round2(txIn(st, mStart, t, isFlex).reduce((a, x) => a + Number(x.amount), 0));
  const lastStart = monthStart(addDays(mStart, -1));
  const lastSame = addDays(lastStart, dayOfMonth(t) - 1);
  const spentLast = round2(txIn(st, lastStart, lastSame < mStart ? lastSame : addDays(mStart, -1), isFlex).reduce((a, x) => a + Number(x.amount), 0));
  const cats = categoryMonth(st).filter((c) => c.spent > 0 && !c.fixed).sort((a, b) => b.spent - a.spent);
  const maxCat = Math.max(1, ...cats.map((c) => c.spent));
  const lk = leaks(st);
  const moods = moodStats(st);
  const moodTotal = moods.reduce((a, m) => a + m.total, 0);
  const rg = regretStats(st);
  const wd = weekdayStats(st);
  const wdMax = Math.max(...wd, 1);
  const peak = wd.indexOf(Math.max(...wd));
  const late = lateNight(st);
  const res = resisted(st);
  const resM = resisted(st, mStart);
  const wk = weekReview(st);
  const hasData = live(st.tx).some(isFlex);

  // A few specific, data-driven suggestions.
  const tips = [];
  if (lk[0] && lk[0].n >= 4) tips.push(["repeat", `<b>${esc(lk[0].label)}</b>: ${lk[0].n} times in 30 days (${money(lk[0].total)}). At this pace that's <b>${money(lk[0].yearly, { cents: false })}/year</b>. Cutting it in half saves ${money(lk[0].yearly / 2, { cents: false })}.`]);
  const impulsive = moods.filter((m) => ["bored", "stressed", "deal"].includes(m.id ?? m.mood)).reduce((a, m) => a + m.total, 0);
  if (moodTotal > 0 && impulsive / moodTotal >= 0.2) tips.push(["meh", `<b>${Math.round((impulsive / moodTotal) * 100)}%</b> of the spending you tagged happened when you were bored, stressed or saw a deal. Next time, open the app and tap <b>Can I afford it?</b> first. The pause is the point.`]);
  const history = diffDays(st.settings.startDate || t, t);
  if (history >= 21 && wd[peak] >= 10 && wd[peak] > (wd.reduce((a, b) => a + b, 0) / 7) * 1.6) tips.push(["calendar-days", `<b>${dowName(peak)}s</b> are your big spending days (avg ${money(wd[peak])}). Plan them: decide a limit in the morning, or make it a no-spend day.`]);
  if (late.n >= 2) tips.push(["clock", `${plural(late.n, "late-night purchase")} (after 10pm) this month, ${money(late.total)}. Log out of shopping and delivery apps at night so buying takes more effort.`]);
  if (rg.byCat[0]) tips.push(["thumbs-down", `You regretted ${rg.byCat[0].no} of ${rg.byCat[0].n} rated <b>${esc(catById(st, rg.byCat[0].cat).name)}</b> purchases. Add a rule for that category in Plan › My rules.`]);
  const subsM = recurringMonthly(st, (b) => b.kind === "sub");
  if (subsM > 30) tips.push(["tv", `Subscriptions cost ${money(subsM)}/month. Run the check-up in Plan › Bills & subs.`]);

  return `<header class="top"><div><h1>Insights</h1><div class="sub">What your spending says about you</div></div></header>
  ${!hasData ? emptyState("chart-line", "Log a week of spending and your patterns show up here: small leaks, triggers, regret and your riskiest days.") : ""}
  <div class="stats">
    <div class="stat"><b class="num">${money(spentM, { cents: false })}</b><span>spent this month</span>${spentLast ? `<span class="tiny ${spentM <= spentLast ? "good" : "over"}" style="display:block">${money(Math.abs(spentM - spentLast), { cents: false })} ${spentM <= spentLast ? "less" : "more"} than last</span>` : ""}</div>
    <div class="stat"><b class="num">${plural(noSpendStreak(st), "day")}</b><span>no-spend streak</span><span class="tiny faint" style="display:block">${plural(underStreak(st), "day")} under limit</span></div>
    <div class="stat"><b class="num good">${money(res.total, { cents: false })}</b><span>not spent by skipping</span></div>
  </div>
  <div class="actions" style="margin-top:4px"><button class="btn" data-act="import">${ic("clipboard-paste", { size: 18 })}Import history</button><button class="btn" data-act="ask">${ic("message-circle", { size: 18 })}Ask Claude</button></div>
  ${hasData ? roastCard(st) : ""}
  ${hasData ? checkinCard(st) : ""}
  ${tips.length ? `<div class="section-title"><span>Suggestions</span></div><div class="card tips">${tips.map(([n, x]) => `<div class="tip">${ic(n, { size: 18 })}<div>${x}</div></div>`).join("")}</div>` : ""}
  ${wk.tracked || wk.spent ? `<div class="section-title"><span>Last 7 days</span></div><div class="card">
    <div class="row between"><span>Spent</span><b class="num">${money(wk.spent)}</b></div>
    ${wk.tracked ? `<div class="row between muted"><span>Your daily limits added up to</span><span class="num">${money(wk.allowance)}</span></div><div class="row between muted"><span>Days under your limit</span><span>${wk.under}/${wk.tracked}</span></div>` : ""}
    <div class="row between muted"><span>No-spend days</span><span>${wk.noSpend}</span></div>
    ${wk.prevSpent ? `<div class="row between muted"><span>Week before</span><span class="num">${money(wk.prevSpent)}</span></div>` : ""}</div>` : ""}
  ${cats.length ? `<div class="section-title"><span>Where it went this month</span></div><div class="card">${cats.map((c) => `<div class="hbar"><span class="hb-l">${catTile(c)}${esc(c.name)}</span><div class="track"><i style="width:${(c.spent / maxCat) * 100}%"></i></div><span class="num" style="text-align:right">${money(c.spent, { cents: false })}</span></div>`).join("")}</div>` : ""}
  ${lk.length ? `<div class="section-title"><span>Small stuff that adds up</span></div><div class="list">${lk.map((l) => `<div class="item">${catTile(catById(st, l.cat))}<div class="main"><div class="name">${esc(l.label)}</div><div class="meta">${l.n}× in 30 days, avg ${money(l.avg)}</div></div><div class="amt num">${money(l.total)}<span class="sub">${money(l.yearly, { cents: false })}/yr${costFrame(l.yearly) ? `, ${costFrame(l.yearly)}` : ""}</span></div></div>`).join("")}</div>` : ""}
  ${moods.length ? `<div class="section-title"><span>Why you spend</span></div><div class="card">${moods.map((m) => {
    const md = MOODS.find((x) => x.id === m.mood);
    return `<div class="hbar"><span class="hb-l"><span class="tile">${ic(md?.icon || "tag", { size: 17 })}</span>${md?.label || m.mood}</span><div class="track"><i style="width:${(m.total / Math.max(...moods.map((x) => x.total))) * 100}%;${["bored", "stressed", "deal"].includes(m.mood) ? "background:var(--bronze)" : ""}"></i></div><span class="num" style="text-align:right">${money(m.total, { cents: false })}</span></div>${m.rated ? `<div class="tiny faint" style="margin:-2px 0 6px 100px">${Math.round((m.regret / m.rated) * 100)}% regretted</div>` : ""}`;
  }).join("")}<p class="tiny faint" style="margin:8px 0 0">From the "Why?" you pick when logging. Last 90 days.</p></div>` : ""}
  ${rg.rated ? `<div class="section-title"><span>Worth it?</span></div><div class="card"><div class="row between"><span>Purchases you rated</span><b>${rg.rated}</b></div><div class="row between"><span>Regretted</span><b class="over">${rg.regretted}, ${money(rg.wasted)}</b></div>
    ${rg.byCat.length ? `<div class="small muted" style="margin-top:8px">Most regret: ${rg.byCat.slice(0, 3).map((c) => `${esc(catById(st, c.cat).name)} (${money(c.wasted, { cents: false })})`).join(", ")}</div>` : ""}</div>` : ""}
  ${hasData ? `<div class="section-title"><span>Your spending week</span></div><div class="card"><div class="wk">${wd.map((v, i) => `<div><i class="${i === peak && v > 0 ? "peak" : ""}" style="height:${(v / wdMax) * 80}%"></i>${dowName(i)[0]}</div>`).join("")}</div><p class="tiny faint" style="margin:10px 0 0">Average spending by weekday, last 8 weeks.</p></div>` : ""}`;
}
