import { get } from "../store.js";
import { today, addDays, diffDays, monthStart, dayOfMonth, dowName } from "../dates.js";
import { live, categoryMonth, leaks, moodStats, regretStats, weekdayStats, lateNight, resisted, noSpendStreak, underStreak, weekReview, txIn, isFlex, catById, MOODS, round2, recurringMonthly } from "../engine.js";
import { esc, money, plural, hoursText } from "../ui.js";

const s = () => get();

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
  const wage = Number(st.settings.wage) || 0;
  const hasData = live(st.tx).some(isFlex);

  // A few specific, data-driven suggestions.
  const tips = [];
  if (lk[0] && lk[0].n >= 4) tips.push(`☕ <b>${esc(lk[0].label)}</b>: ${lk[0].n} times in 30 days (${money(lk[0].total)}). At this pace that's <b>${money(lk[0].yearly, { cents: false })}/year</b>. Cutting it in half saves ${money(lk[0].yearly / 2, { cents: false })}.`);
  const impulsive = moods.filter((m) => ["bored", "stressed", "deal"].includes(m.id ?? m.mood)).reduce((a, m) => a + m.total, 0);
  if (moodTotal > 0 && impulsive / moodTotal >= 0.2) tips.push(`🧠 <b>${Math.round((impulsive / moodTotal) * 100)}%</b> of the spending you tagged happened when you were bored, stressed or saw a deal. Next time, open the app and tap <b>Can I afford it?</b> first. The pause is the point.`);
  const history = diffDays(st.settings.startDate || t, t);
  if (history >= 21 && wd[peak] >= 10 && wd[peak] > (wd.reduce((a, b) => a + b, 0) / 7) * 1.6) tips.push(`📅 <b>${dowName(peak)}s</b> are your big spending days (avg ${money(wd[peak])}). Plan them: decide a limit in the morning, or make it a no-spend day.`);
  if (late.n >= 2) tips.push(`🌙 ${plural(late.n, "late-night purchase")} (after 10pm) this month, ${money(late.total)}. Log out of shopping and delivery apps at night so buying takes more effort.`);
  if (rg.byCat[0]) tips.push(`👎 You regretted ${rg.byCat[0].no} of ${rg.byCat[0].n} rated <b>${esc(catById(st, rg.byCat[0].cat).name)}</b> purchases. Add a rule for that category in Plan → My rules.`);
  const subsM = recurringMonthly(st, (b) => b.kind === "sub");
  if (subsM > 30) tips.push(`📺 Subscriptions cost ${money(subsM)}/month. Run the check-up in Plan → Bills & subs.`);

  return `<header class="top"><div><h1>Insights</h1><div class="sub">What your spending says about you</div></div></header>
  ${!hasData ? `<div class="card empty"><div class="em">🔍</div>Log a week of spending and your patterns show up here: leaks, triggers, regret, your risky days.</div>` : ""}
  <div class="stats">
    <div class="stat"><b class="num">${money(spentM, { cents: false })}</b><span>spent this month${spentLast ? `<br><span class="${spentM <= spentLast ? "good" : "over"}">${spentM <= spentLast ? "▼" : "▲"} ${money(Math.abs(spentM - spentLast), { cents: false })} vs last</span>` : ""}</span></div>
    <div class="stat"><b class="num">${noSpendStreak(st)}</b><span>no-spend streak<br>${underStreak(st)} days under limit</span></div>
    <div class="stat"><b class="num good">${money(res.total, { cents: false })}</b><span>not spent (skipped)${resM.total ? `<br>${money(resM.total, { cents: false })} this month` : ""}</span></div>
  </div>
  ${tips.length ? `<div class="section-title"><span>Suggestions</span></div><div class="card accent stack">${tips.map((x) => `<div>${x}</div>`).join("")}</div>` : ""}
  ${wk.tracked || wk.spent ? `<div class="section-title"><span>Last 7 days</span></div><div class="card">
    <div class="row between"><span>Spent</span><b class="num">${money(wk.spent)}</b></div>
    ${wk.tracked ? `<div class="row between muted"><span>Your daily limits added up to</span><span class="num">${money(wk.allowance)}</span></div><div class="row between muted"><span>Days under your limit</span><span>${wk.under}/${wk.tracked}</span></div>` : ""}
    <div class="row between muted"><span>No-spend days</span><span>${wk.noSpend}</span></div>
    ${wk.prevSpent ? `<div class="row between muted"><span>Week before</span><span class="num">${money(wk.prevSpent)}</span></div>` : ""}</div>` : ""}
  ${cats.length ? `<div class="section-title"><span>Where it went this month</span></div><div class="card">${cats.map((c) => `<div class="hbar"><span>${c.emoji} ${esc(c.name)}</span><div class="track"><i style="width:${(c.spent / maxCat) * 100}%"></i></div><span class="num" style="text-align:right">${money(c.spent, { cents: false })}</span></div>`).join("")}</div>` : ""}
  ${lk.length ? `<div class="section-title"><span>Small stuff that adds up</span></div><div class="list">${lk.map((l) => `<div class="item"><div class="ic">${catById(st, l.cat).emoji}</div><div class="main"><div class="name">${esc(l.label)}</div><div class="meta">${l.n}× in 30 days, avg ${money(l.avg)}</div></div><div class="amt num">${money(l.total)}<span class="sub">${money(l.yearly, { cents: false })}/yr${wage ? `, ${hoursText(l.yearly / wage)}` : ""}</span></div></div>`).join("")}</div>` : ""}
  ${moods.length ? `<div class="section-title"><span>Why you spend</span></div><div class="card">${moods.map((m) => {
    const md = MOODS.find((x) => x.id === m.mood);
    return `<div class="hbar"><span>${md?.emoji || ""} ${md?.label || m.mood}</span><div class="track"><i style="width:${(m.total / Math.max(...moods.map((x) => x.total))) * 100}%;${["bored", "stressed", "deal"].includes(m.mood) ? "background:var(--tight)" : ""}"></i></div><span class="num" style="text-align:right">${money(m.total, { cents: false })}</span></div>${m.rated ? `<div class="tiny faint" style="margin:-2px 0 6px 100px">${Math.round((m.regret / m.rated) * 100)}% regretted</div>` : ""}`;
  }).join("")}<p class="tiny faint" style="margin:8px 0 0">From the "Why?" you pick when logging. Last 90 days.</p></div>` : ""}
  ${rg.rated ? `<div class="section-title"><span>Worth it?</span></div><div class="card"><div class="row between"><span>Purchases you rated</span><b>${rg.rated}</b></div><div class="row between"><span>Regretted</span><b class="over">${rg.regretted}, ${money(rg.wasted)}</b></div>
    ${rg.byCat.length ? `<div class="small muted" style="margin-top:8px">Most regret: ${rg.byCat.slice(0, 3).map((c) => `${catById(st, c.cat).emoji} ${esc(catById(st, c.cat).name)} (${money(c.wasted, { cents: false })})`).join(", ")}</div>` : ""}</div>` : ""}
  ${hasData ? `<div class="section-title"><span>Your spending week</span></div><div class="card"><div class="wk">${wd.map((v, i) => `<div><i class="${i === peak && v > 0 ? "peak" : ""}" style="height:${(v / wdMax) * 80}%"></i>${dowName(i)[0]}</div>`).join("")}</div><p class="tiny faint" style="margin:10px 0 0">Average spending by weekday, last 8 weeks.</p></div>` : ""}`;
}
