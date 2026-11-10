// Calls /api/ai (Claude). Uses the link token, so it needs sync turned on.
// Sends only what each feature needs: store names, one typed sentence, or a week's totals.
import { get } from "./store.js";
import { categories } from "./engine.js";
import { currentToken } from "./sync.js";

const MESSAGES = {
  sync_off: "Turn on sync in Automate to use Claude features.",
  offline: "You're offline. Try again when you're connected.",
  no_key: "Claude isn't connected yet. Add ANTHROPIC_API_KEY to the budget project in Vercel.",
  bad_key: "The Anthropic API key on Vercel isn't valid. Check ANTHROPIC_API_KEY.",
  limit: "You've hit today's Claude limit. It resets tomorrow.",
  busy: "Claude is busy right now. Try again in a minute.",
  declined: "Claude couldn't help with that one.",
};

export class AIError extends Error {}

export async function ai(task, payload = {}) {
  const t = await currentToken();
  if (!t) throw new AIError(MESSAGES.sync_off);
  if (!navigator.onLine) throw new AIError(MESSAGES.offline);
  let r;
  try {
    r = await fetch("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t, task, cats: categories(get()).map((c) => ({ id: c.id, name: c.name })), ...payload }),
    });
  } catch {
    throw new AIError(MESSAGES.offline);
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new AIError(MESSAGES[d.error] || "Claude couldn't do that right now. Try again.");
  return d;
}

/* ---------- what Claude sees ---------- */
import { compute, live as liveOf, categoryMonth, catById, leaks, moodStats, regretStats, isFlex, goalSaved, txIn, resisted, MOODS } from "./engine.js";
import { today as todayStr, addDays } from "./dates.js";

const r2 = (n) => Math.round(n * 100) / 100;

// A compact picture of the budget for the chat: today's numbers, plans, and recent purchases.
export function budgetContext(st = get()) {
  const t = todayStr();
  const c = compute(st, t);
  const recent = txIn(st, addDays(t, -45), t, (x) => x.kind === "expense" || x.kind === "income")
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 150)
    .map((x) => ({ d: x.date, what: x.note || catById(st, x.cat).name, amt: x.amount, kind: x.kind === "income" ? "in" : undefined, cat: catById(st, x.cat).name, why: x.mood ? MOODS.find((m) => m.id === x.mood)?.label : undefined, worth: x.worth, late: x.late || undefined }));
  return {
    today: t,
    currency: st.settings.currency || "$",
    payType: st.settings.payType || "unknown",
    safeToSpendToday: c.leftToday,
    dailyNumber: c.dailyBase,
    dailyNumberWithoutLimit: c.rawDaily,
    ownDailyLimit: c.cap || null,
    spentToday: c.spentToday,
    moneyLeftForPeriod: c.pool,
    periodEnds: c.end,
    daysLeft: c.daysLeft,
    nextMoneyIsScheduled: c.scheduled,
    billsSetAside: c.upcoming.map((u) => ({ name: u.bill.name, amount: u.amount, date: u.date })),
    goals: liveOf(st.goals).map((g) => ({ name: g.name, saved: goalSaved(st, g.id), target: g.target || null })),
    thisMonthByCategory: categoryMonth(st, t).filter((x) => x.spent > 0).map((x) => ({ cat: x.name, spent: x.spent, limit: x.limit || null })),
    repeatPurchases30Days: leaks(st, t).map((l) => ({ name: l.label, times: l.n, total: l.total, perYear: l.yearly })),
    whyTheySpend90Days: moodStats(st, t).map((m) => ({ why: MOODS.find((x) => x.id === m.mood)?.label, total: m.total, times: m.n })),
    regret90Days: regretStats(st, t),
    skippedPurchasesTotal: resisted(st).total,
    waitlist: liveOf(st.wish).filter((w) => w.status === "waiting").map((w) => ({ name: w.name, price: w.price })),
    ownRules: liveOf(st.rules).map((r) => r.text),
    recentTransactions: recent,
  };
}

// The last N days, summarized by category and merchant, for the reality check.
export function spendingSummary(st = get(), days = 30) {
  const t = todayStr();
  const from = addDays(t, -(days - 1));
  const txs = txIn(st, from, t, (x) => isFlex(x) && Number(x.amount) > 0);
  const byCat = {};
  const byMerchant = {};
  let late = 0;
  for (const x of txs) {
    const c = catById(st, x.cat).name;
    byCat[c] = r2((byCat[c] || 0) + Number(x.amount));
    const m = x.note || c;
    byMerchant[m] = byMerchant[m] || { times: 0, total: 0 };
    byMerchant[m].times++;
    byMerchant[m].total = r2(byMerchant[m].total + Number(x.amount));
    if (x.late) late += Number(x.amount);
  }
  const c = compute(st, t);
  return {
    currency: st.settings.currency || "$",
    days,
    totalSpent: r2(txs.reduce((a, x) => a + Number(x.amount), 0)),
    purchases: txs.length,
    byCategory: byCat,
    topMerchants: Object.entries(byMerchant).sort((a, b) => b[1].total - a[1].total).slice(0, 12).map(([name, v]) => ({ name, ...v })),
    lateNightTotal: r2(late),
    regret: regretStats(st, t, days),
    dailyBudgetNow: c.dailyBase,
    moneyLeftUntil: { amount: c.pool, date: c.end },
  };
}
