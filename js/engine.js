// The money math. Pure functions over the saved state, so they're easy to test (see tests/engine.test.mjs).
import { addDays, diffDays, nextDate, today, monthStart, monthEnd, dayOfMonth, daysInMonth, weekday, PER_MONTH } from "./dates.js";

export const live = (arr) => (arr || []).filter((x) => x && !x.deleted);
export const round2 = (n) => Math.round(n * 100) / 100;
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Each category has a Lucide icon and its own muted ink color (shown as a tinted tile).
export const DEFAULT_CATS = [
  { id: "groceries", name: "Groceries", icon: "shopping-cart", color: "#3f7d57", limit: 150 },
  { id: "food", name: "Eating out", icon: "utensils", color: "#b4552e", limit: 120 },
  { id: "coffee", name: "Coffee & snacks", icon: "coffee", color: "#8a5a36", limit: 40 },
  { id: "transport", name: "Transport", icon: "bus", color: "#2f6690", limit: 60 },
  { id: "school", name: "School", icon: "book-open", color: "#55589c", limit: 40 },
  { id: "fun", name: "Fun & going out", icon: "ticket", color: "#94468a", limit: 80 },
  { id: "shopping", name: "Shopping", icon: "shopping-bag", color: "#ad3d5a", limit: 60 },
  { id: "personal", name: "Personal care", icon: "droplets", color: "#2c8584", limit: 30 },
  { id: "subs", name: "Subscriptions", icon: "repeat", color: "#64689a", limit: 0, fixed: true },
  { id: "bills", name: "Rent & bills", icon: "key-round", color: "#56625b", limit: 0, fixed: true },
  { id: "other", name: "Other", icon: "package", color: "#7a7f72", limit: 40 },
];

export const MOODS = [
  { id: "need", label: "Needed it", icon: "check" },
  { id: "treat", label: "Treat", icon: "gift" },
  { id: "bored", label: "Bored", icon: "meh" },
  { id: "stressed", label: "Stressed", icon: "frown" },
  { id: "social", label: "Friends", icon: "users" },
  { id: "hungry", label: "Hungry", icon: "pizza" },
  { id: "deal", label: "Saw a deal", icon: "tag" },
];

// Money in vs. out for each kind of record. Expenses can be negative (refunds).
export function effect(tx) {
  const a = Number(tx.amount) || 0;
  switch (tx.kind) {
    case "income": return a;
    case "expense": return -a;
    case "save": return -a; // moved into a goal or stretch fund
    case "unsave": return a; // released from a goal or stretch fund
    case "adjust": return a; // balance correction (signed)
    default: return 0;
  }
}

const afterAnchor = (tx, anchor) => tx.date > anchor.date || (tx.date === anchor.date && (tx.ts || 0) > anchor.ts);

// Money you can actually spend right now (not counting money set aside in goals).
export function spendable(state) {
  const anchor = state.settings.anchor || { amount: 0, date: "1970-01-01", ts: 0 };
  let total = Number(anchor.amount) || 0;
  for (const tx of live(state.tx)) if (afterAnchor(tx, anchor)) total += effect(tx);
  return round2(total);
}

export function goalSaved(state, goalId) {
  const g = live(state.goals).find((x) => x.id === goalId);
  let s = Number(g?.start) || 0;
  for (const tx of live(state.tx)) {
    if (tx.goalId !== goalId) continue;
    if (tx.kind === "save") s += Number(tx.amount) || 0;
    if (tx.kind === "unsave") s -= Number(tx.amount) || 0;
  }
  return round2(s);
}

// Flexible spending = what the daily allowance covers (everything except auto-posted bills and subscriptions).
export const isFlex = (tx) => tx.kind === "expense" && tx.source !== "bill";

export function flexOn(state, day) {
  let s = 0;
  for (const tx of live(state.tx)) if (tx.date === day && isFlex(tx)) s += Number(tx.amount) || 0;
  return round2(s);
}

// The next day new money arrives: a paycheck, allowance, or a weekly release from a stretch fund.
export function nextMoneyDay(state, t) {
  const dates = [];
  for (const inc of live(state.income)) if (inc.next && inc.freq !== "once" && inc.next > t) dates.push(inc.next);
  for (const inc of live(state.income)) if (inc.next && inc.freq === "once" && !inc.done && inc.next > t) dates.push(inc.next);
  for (const g of live(state.goals)) if (g.type === "stretch" && g.next && g.next > t && goalSaved(state, g.id) > 0.005) dates.push(g.next);
  dates.sort();
  return dates[0] || null;
}

export function periodEnd(state, t) {
  const nm = nextMoneyDay(state, t);
  if (nm) return addDays(nm, -1) < t ? t : addDays(nm, -1);
  // No money coming on a schedule: spread what's left until the last stretch fund's end date,
  // or over the next 30 days, so bills early next month are still set aside.
  let until = null;
  for (const g of live(state.goals)) if (g.type === "stretch" && g.until && g.until >= t && (!until || g.until > until)) until = g.until;
  return until || addDays(t, 29);
}

// Moves a past date forward along its schedule without posting anything (for dates already in the balance).
export function rollForward(date, freq, day, t) {
  let d = date;
  let guard = 0;
  while (d && d < t && guard++ < 500) d = nextDate(d, freq, day);
  return d;
}

// Bills due after today and on or before `end` (today's were already auto-posted).
export function billsBetween(state, t, end) {
  const list = [];
  for (const b of live(state.bills)) {
    if (b.paused || b.done || !b.next) continue;
    let d = b.next;
    let guard = 0;
    while (d && d <= end && guard++ < 400) {
      if (d > t) list.push({ bill: b, date: d, amount: Number(b.amount) || 0 });
      d = nextDate(d, b.freq, b.day);
    }
  }
  return list.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// The headline: how much is safe to spend today, spread evenly to the next money day.
export function compute(state, t = today()) {
  const end = periodEnd(state, t);
  const daysLeft = Math.max(1, diffDays(t, end) + 1);
  const cash = spendable(state);
  const upcoming = billsBetween(state, t, end);
  const upcomingTotal = round2(upcoming.reduce((s, x) => s + x.amount, 0));
  const buffer = Number(state.settings.buffer) || 0;
  const pool = round2(cash - upcomingTotal - buffer); // after today's spending
  const spentToday = flexOn(state, t);
  const dailyBase = round2((pool + spentToday) / daysLeft);
  const leftToday = round2(dailyBase - spentToday);
  const tomorrowDaily = daysLeft > 1 ? round2(pool / (daysLeft - 1)) : null;
  let status = "good";
  if (pool < 0) status = "short";
  else if (leftToday < 0) status = "over";
  else if (dailyBase > 0 && leftToday < dailyBase * 0.3) status = "tight";
  return { t, end, daysLeft, cash, upcoming, upcomingTotal, buffer, pool, spentToday, dailyBase, leftToday, tomorrowDaily, status };
}

// What a purchase would do to the numbers, for the "Can I afford it?" check.
export function impact(state, price, cat, t = today()) {
  const c = compute(state, t);
  const p = Number(price) || 0;
  const leftAfter = round2(c.leftToday - p);
  const poolAfter = round2(c.pool - p);
  const dailyAfter = c.daysLeft > 1 ? round2(Math.max(poolAfter, 0) / (c.daysLeft - 1)) : null;
  const overToday = Math.max(0, -leftAfter);
  const wage = Number(state.settings.wage) || 0;
  const hours = wage > 0 ? p / wage : null;
  let budget = null;
  if (cat) {
    const m = categoryMonth(state, t).find((x) => x.id === cat);
    if (m && m.limit > 0) budget = { name: m.name, leftBefore: round2(m.limit - m.spent), leftAfter: round2(m.limit - m.spent - p) };
  }
  let verdict = "fits";
  if (poolAfter < 0) verdict = "no";
  else if (leftAfter < 0) verdict = p > c.pool * 0.35 ? "no" : "tight";
  else if (budget && budget.leftAfter < 0) verdict = "tight";
  const goals = live(state.goals).filter((g) => g.type !== "stretch" && Number(g.target) > goalSaved(state, g.id));
  const goal = goals[0] ? { name: goals[0].name, icon: goals[0].icon, pct: Math.round((p / Number(goals[0].target)) * 100) } : null;
  return { ...c, price: p, leftAfter, poolAfter, dailyAfter, overToday, hours, budget, verdict, goal };
}

export function categories(state) {
  const cats = live(state.cats);
  return cats.length ? cats : DEFAULT_CATS;
}
export const catById = (state, id) => categories(state).find((c) => c.id === id) || { id: id || "other", name: "Other", icon: "package", color: "#7a7f72", limit: 0 };

export function categoryMonth(state, t = today()) {
  const start = monthStart(t);
  const end = monthEnd(t);
  const spent = {};
  for (const tx of live(state.tx)) {
    if (tx.kind !== "expense" || tx.date < start || tx.date > end) continue;
    spent[tx.cat || "other"] = (spent[tx.cat || "other"] || 0) + (Number(tx.amount) || 0);
  }
  const frac = dayOfMonth(t) / daysInMonth(t);
  return categories(state).map((c) => {
    const s = round2(spent[c.id] || 0);
    const limit = Number(c.limit) || 0;
    const pace = limit * frac;
    const projected = round2((s / dayOfMonth(t)) * daysInMonth(t));
    let state_ = "ok";
    if (limit > 0) {
      if (s > limit) state_ = "over";
      else if (s > pace * 1.1 && s > 5) state_ = "ahead";
    }
    return { ...c, spent: s, limit, pace: round2(pace), projected, pct: limit > 0 ? s / limit : 0, state: state_ };
  });
}

// Days in a row with zero flexible spending, counting today if nothing's been spent yet.
export function noSpendStreak(state, t = today()) {
  const start = state.settings.startDate || t;
  const spentDays = new Set(live(state.tx).filter((x) => isFlex(x) && Number(x.amount) > 0).map((x) => x.date));
  let n = 0;
  let d = spentDays.has(t) ? null : t;
  if (d) n = 1;
  d = addDays(t, -1);
  while (d >= start && !spentDays.has(d) && n < 3660) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

// Days in a row where spending stayed within that day's allowance (uses the daily log the app keeps).
export function underStreak(state, t = today()) {
  let n = 0;
  let d = addDays(t, -1);
  while (state.days?.[d] && n < 3660) {
    if (flexOn(state, d) > state.days[d].base + 0.005) break;
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export const normMerchant = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+(inc|llc|store|#?\d+)\b/g, "").replace(/\s+/g, " ").trim();

// Learned from your own history: the category you last used for a merchant.
export function guessCategory(state, merchant) {
  const m = normMerchant(merchant);
  if (!m) return null;
  const txs = live(state.tx).filter((x) => x.kind === "expense" && x.cat && x.note).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  for (const tx of txs) {
    const n = normMerchant(tx.note);
    if (n && (n === m || n.startsWith(m) || m.startsWith(n))) return tx.cat;
  }
  return keywordCategory(m);
}

const KEYWORDS = [
  ["coffee", /starbucks|dunkin|coffee|cafe|tea|boba|panera|bakery|7.?eleven|wawa|sheetz/],
  ["food", /mcdonald|chipotle|wendy|taco|pizza|domino|burger|chick.?fil|subway|doordash|uber.?eats|grubhub|kfc|popeyes|sweetgreen|cava|five guys|restaurant|grill|kitchen|sushi|wings/],
  ["groceries", /trader joe|aldi|safeway|kroger|giant|wegmans|whole foods|lidl|grocery|market|costco|publix|harris teeter|food lion|h.?e.?b/],
  ["transport", /uber|lyft|shell|exxon|bp|chevron|sunoco|gas|metro|transit|parking|amtrak|citgo/],
  ["shopping", /amazon|target|walmart|shein|temu|nike|zara|h.?m|uniqlo|best buy|apple store|ulta|sephora|etsy/],
  ["subs", /spotify|netflix|hulu|disney|apple\.com|icloud|youtube|prime video|max|chatgpt|openai|claude|adobe/],
  ["school", /book|chegg|campus|university|college|pearson|mcgraw|staples|office/],
  ["fun", /cinema|amc|regal|ticket|steam|playstation|xbox|nintendo|bar|club|bowling|concert/],
  ["personal", /cvs|walgreens|rite aid|salon|barber|pharmacy/],
];
export function keywordCategory(m) {
  for (const [cat, re] of KEYWORDS) if (re.test(m)) return cat;
  return null;
}

// Monthly cost of recurring bills and subscriptions.
export function recurringMonthly(state, filter = () => true) {
  return round2(live(state.bills).filter((b) => !b.paused && !b.done && filter(b)).reduce((s, b) => s + (Number(b.amount) || 0) * (PER_MONTH[b.freq] ?? 0), 0));
}
export function incomeMonthly(state) {
  return round2(live(state.income).filter((i) => !i.done).reduce((s, i) => s + (Number(i.amount) || 0) * (PER_MONTH[i.freq] ?? 0), 0));
}

/* ---------- Automation: post what's due since the app last ran ---------- */

const mkTx = (o) => ({ ts: Date.now(), updatedAt: Date.now(), ...o });

function upsertTx(state, tx) {
  const i = state.tx.findIndex((x) => x.id === tx.id);
  if (i >= 0) return false; // already posted (maybe by another device)
  state.tx.push(tx);
  return true;
}

// Posts bills, paydays, goal contributions, stretch-fund releases and round-ups that are due.
// Every auto record has a predictable id, so two devices doing this at once never double-post.
export function autoRun(state, t = today()) {
  const events = [];
  const now = Date.now();
  for (const b of live(state.bills)) {
    let guard = 0;
    while (!b.paused && !b.done && b.next && b.next <= t && guard++ < 120) {
      const added = upsertTx(state, mkTx({ id: `bill:${b.id}:${b.next}`, kind: "expense", amount: Number(b.amount) || 0, cat: b.cat || "bills", note: b.name, date: b.next, source: "bill", billId: b.id }));
      if (added) events.push({ type: "bill", name: b.name, amount: b.amount, date: b.next });
      const n = nextDate(b.next, b.freq, b.day);
      if (n) b.next = n;
      else b.done = true;
    }
  }
  for (const inc of live(state.income)) {
    let guard = 0;
    while (!inc.done && inc.next && inc.next <= t && guard++ < 120) {
      const d = inc.next;
      const added = upsertTx(state, mkTx({ id: `pay:${inc.id}:${d}`, kind: "income", amount: Number(inc.amount) || 0, cat: "income", note: inc.name, date: d, source: "payday", incomeId: inc.id }));
      if (added) {
        events.push({ type: "payday", name: inc.name, amount: inc.amount, date: d, txId: `pay:${inc.id}:${d}` });
        for (const g of live(state.goals)) {
          if (g.type === "stretch" || !(Number(g.perPay) > 0)) continue;
          const room = Number(g.target) > 0 ? Number(g.target) - goalSaved(state, g.id) : Infinity;
          const amt = round2(Math.min(Number(g.perPay), room));
          if (amt <= 0) continue;
          if (upsertTx(state, mkTx({ id: `gs:${g.id}:${inc.id}:${d}`, kind: "save", amount: amt, goalId: g.id, note: `Auto-save → ${g.name}`, date: d, source: "auto" })))
            events.push({ type: "save", name: g.name, amount: amt, date: d });
        }
      }
      const n = nextDate(d, inc.freq, inc.day);
      if (n) inc.next = n;
      else inc.done = true;
    }
  }
  for (const g of live(state.goals)) {
    if (g.type !== "stretch") continue;
    let guard = 0;
    while (g.next && g.next <= t && guard++ < 120) {
      const left = goalSaved(state, g.id);
      const per = Number(g.perRelease);
      if (left <= 0.005 || !(per > 0)) break;
      const amt = round2(Math.min(per, left));
      if (upsertTx(state, mkTx({ id: `sr:${g.id}:${g.next}`, kind: "unsave", amount: amt, goalId: g.id, note: `${g.name} release`, date: g.next, source: "auto" })))
        events.push({ type: "release", name: g.name, amount: amt, date: g.next });
      g.next = nextDate(g.next, g.freq || "weekly", g.day);
    }
  }
  // Round-ups: spare change from the last week's purchases goes to the chosen goal. Recomputed each run,
  // so purchases filed late (Apple Pay inbox) still get rounded up.
  const ruGoal = state.settings.roundUpGoal && live(state.goals).find((g) => g.id === state.settings.roundUpGoal);
  if (ruGoal) {
    const from = state.settings.roundUpFrom || t;
    for (let d = from > addDays(t, -7) ? from : addDays(t, -7); d < t; d = addDays(d, 1)) {
      let spare = 0;
      for (const tx of live(state.tx)) if (tx.date === d && isFlex(tx) && Number(tx.amount) > 0) spare += Math.ceil(Number(tx.amount) - 1e-9) - Number(tx.amount);
      spare = round2(spare);
      const id = `ru:${d}`;
      const cur = state.tx.find((x) => x.id === id);
      if (!cur && spare > 0) upsertTx(state, mkTx({ id, kind: "save", amount: spare, goalId: ruGoal.id, note: "Round-ups", date: d, source: "auto" }));
      else if (cur && !cur.deleted && Math.abs((Number(cur.amount) || 0) - spare) > 0.004) { cur.amount = spare; cur.updatedAt = now; }
    }
  }
  // Remember today's allowance so the calendar can show which days stayed under.
  state.days = state.days || {};
  if (!state.days[t] && state.settings.onboarded) {
    const c = compute(state, t);
    state.days[t] = { base: Math.max(0, c.dailyBase) };
  }
  return events;
}

/* ---------- Insights ---------- */

export function txIn(state, from, to, pred = () => true) {
  return live(state.tx).filter((x) => x.date >= from && x.date <= to && pred(x));
}

// Small purchases that add up: merchants you hit often.
export function leaks(state, t = today(), days = 30) {
  const from = addDays(t, -(days - 1));
  const by = {};
  for (const tx of txIn(state, from, t, isFlex)) {
    const k = normMerchant(tx.note) || tx.cat;
    if (!k) continue;
    by[k] = by[k] || { key: k, label: tx.note || tx.cat, cat: tx.cat, n: 0, total: 0 };
    by[k].n++;
    by[k].total += Number(tx.amount) || 0;
  }
  return Object.values(by)
    .filter((x) => x.n >= 3)
    .map((x) => ({ ...x, total: round2(x.total), avg: round2(x.total / x.n), yearly: Math.round((x.total / days) * 365) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
}

export function moodStats(state, t = today(), days = 90) {
  const from = addDays(t, -(days - 1));
  const by = {};
  for (const tx of txIn(state, from, t, (x) => isFlex(x) && x.mood)) {
    by[tx.mood] = by[tx.mood] || { mood: tx.mood, n: 0, total: 0, regret: 0, rated: 0 };
    const m = by[tx.mood];
    m.n++;
    m.total += Number(tx.amount) || 0;
    if (tx.worth) { m.rated++; if (tx.worth === "no") m.regret++; }
  }
  return Object.values(by).map((m) => ({ ...m, total: round2(m.total) })).sort((a, b) => b.total - a.total);
}

export function regretStats(state, t = today(), days = 90) {
  const from = addDays(t, -(days - 1));
  const rated = txIn(state, from, t, (x) => isFlex(x) && x.worth);
  const no = rated.filter((x) => x.worth === "no");
  const byCat = {};
  for (const x of rated) {
    byCat[x.cat] = byCat[x.cat] || { cat: x.cat, n: 0, no: 0, wasted: 0 };
    byCat[x.cat].n++;
    if (x.worth === "no") { byCat[x.cat].no++; byCat[x.cat].wasted += Number(x.amount) || 0; }
  }
  return {
    rated: rated.length,
    regretted: no.length,
    wasted: round2(no.reduce((s, x) => s + (Number(x.amount) || 0), 0)),
    byCat: Object.values(byCat).filter((x) => x.no > 0).sort((a, b) => b.wasted - a.wasted),
  };
}

export function weekdayStats(state, t = today(), days = 56) {
  const from = addDays(t, -(days - 1));
  const tot = [0, 0, 0, 0, 0, 0, 0];
  for (const tx of txIn(state, from, t, isFlex)) tot[weekday(tx.date)] += Number(tx.amount) || 0;
  const weeks = days / 7;
  return tot.map((v) => round2(v / weeks));
}

export function lateNight(state, t = today(), days = 30) {
  const from = addDays(t, -(days - 1));
  const late = txIn(state, from, t, (x) => isFlex(x) && x.ts && x.source !== "auto" && x.late);
  return { n: late.length, total: round2(late.reduce((s, x) => s + (Number(x.amount) || 0), 0)) };
}

export function resisted(state, from = "1970-01-01") {
  const items = live(state.wish).filter((w) => w.status === "skipped" && (w.decidedDay || "") >= from);
  return { n: items.length, total: round2(items.reduce((s, w) => s + (Number(w.price) || 0), 0)) };
}

export function weekReview(state, t = today()) {
  // The 7 days that ended yesterday.
  const end = addDays(t, -1);
  const start = addDays(end, -6);
  let spent = 0;
  let allowance = 0;
  let under = 0;
  let tracked = 0;
  let noSpend = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const s = flexOn(state, d);
    spent += s;
    if (s <= 0) noSpend++;
    if (state.days?.[d]) {
      tracked++;
      allowance += state.days[d].base;
      if (s <= state.days[d].base + 0.005) under++;
    }
  }
  const prevSpent = txIn(state, addDays(start, -7), addDays(start, -1), isFlex).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const top = {};
  for (const tx of txIn(state, start, end, isFlex)) top[tx.cat || "other"] = (top[tx.cat || "other"] || 0) + (Number(tx.amount) || 0);
  const topCat = Object.entries(top).sort((a, b) => b[1] - a[1])[0];
  return { start, end, spent: round2(spent), allowance: round2(allowance), under, tracked, noSpend, prevSpent: round2(prevSpent), topCat: topCat ? { id: topCat[0], total: round2(topCat[1]) } : null };
}

// Purchases from a day or more ago that are big or unplanned, still waiting for a "worth it?" rating.
export function needsWorthCheck(state, t = today()) {
  const big = Number(state.settings.bigPurchase) || 25;
  const from = addDays(t, -10);
  return live(state.tx)
    .filter((x) => isFlex(x) && !x.worth && !x.worthSkip && x.date >= from && x.date < t && Number(x.amount) >= big && x.mood !== "need")
    .sort((a, b) => (b.amount || 0) - (a.amount || 0))
    .slice(0, 3);
}

// The small set of numbers the widget, lock screen and badge show (pushed to the cloud with each sync).
export function snapshot(state, t = today()) {
  const c = compute(state, t);
  return {
    v: 1,
    savedAt: Date.now(),
    day: t,
    tz: -new Date().getTimezoneOffset(),
    periodEnd: c.end,
    daysLeft: c.daysLeft,
    dailyBase: c.dailyBase,
    spentToday: c.spentToday,
    pool: c.pool,
    streak: noSpendStreak(state, t),
    cur: state.settings.currency || "$",
  };
}
