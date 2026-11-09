import { test } from "node:test";
import assert from "node:assert/strict";
import { compute, autoRun, spendable, goalSaved, impact, noSpendStreak, guessCategory, leaks, periodEnd, snapshot } from "../js/engine.js";
import { nextDate, addDays, diffDays } from "../js/dates.js";
import { mergeStates } from "../js/store.js";
import { widgetNumbers, parseAmount } from "../api/_lib.js";

function base(t, extra = {}) {
  return {
    settings: { buffer: 0, wage: 15, anchor: { amount: 500, date: t, ts: 0 }, startDate: addDays(t, -30), currency: "$", ...extra.settings },
    tx: [], income: [], bills: [], goals: [], cats: [], wish: [], rules: [], days: {},
    ...extra,
  };
}

test("dates: monthly keeps the 31st when it can", () => {
  assert.equal(nextDate("2026-01-31", "monthly", 31), "2026-02-28");
  assert.equal(nextDate("2026-02-28", "monthly", 31), "2026-03-31");
  assert.equal(nextDate("2026-11-09", "biweekly"), "2026-11-23");
  assert.equal(nextDate("2026-11-09", "semimonthly"), "2026-11-15");
  assert.equal(nextDate("2026-11-15", "semimonthly"), "2026-12-01");
  assert.equal(diffDays("2026-11-09", "2026-11-14"), 5);
});

test("safe to spend spreads money until the day before payday, after bills", () => {
  const t = "2026-11-09";
  const s = base(t, {
    income: [{ id: "job", name: "Job", amount: 400, freq: "biweekly", next: "2026-11-19" }],
    bills: [{ id: "spot", name: "Spotify", amount: 12, freq: "monthly", next: "2026-11-12", day: 12 }],
  });
  const c = compute(s, t);
  assert.equal(c.end, "2026-11-18");
  assert.equal(c.daysLeft, 10);
  assert.equal(c.upcomingTotal, 12);
  assert.equal(c.pool, 488);
  assert.equal(c.dailyBase, 48.8);
  assert.equal(c.leftToday, 48.8);
});

test("spending today lowers today, overspending lowers tomorrow", () => {
  const t = "2026-11-09";
  const s = base(t, { income: [{ id: "j", amount: 400, freq: "biweekly", next: "2026-11-19" }] });
  s.tx.push({ id: "a", kind: "expense", amount: 20, cat: "food", date: t, ts: 1 });
  let c = compute(s, t);
  assert.equal(c.dailyBase, 50);
  assert.equal(c.leftToday, 30);
  s.tx.push({ id: "b", kind: "expense", amount: 60, cat: "shopping", date: t, ts: 2 });
  c = compute(s, t);
  assert.equal(c.status, "over");
  assert.equal(c.leftToday, -30);
  assert.equal(c.tomorrowDaily, round(420 / 9));
});
const round = (n) => Math.round(n * 100) / 100;

test("autoRun posts bills and paydays once, with goal auto-save, and never doubles", () => {
  const t = "2026-11-20";
  const s = base("2026-11-01", {
    income: [{ id: "j", name: "Job", amount: 400, freq: "biweekly", next: "2026-11-19" }],
    bills: [{ id: "r", name: "Rent", amount: 300, freq: "monthly", next: "2026-11-15", day: 15 }],
    goals: [{ id: "g", type: "goal", name: "EF", target: 1000, perPay: 50, start: 0 }],
  });
  const ev = autoRun(s, t);
  assert.deepEqual(ev.map((e) => e.type).sort(), ["bill", "payday", "save"]);
  assert.equal(s.bills[0].next, "2026-12-15");
  assert.equal(s.income[0].next, "2026-12-03");
  assert.equal(goalSaved(s, "g"), 50);
  assert.equal(spendable(s), 500 - 300 + 400 - 50);
  // a second device merging the same posts doesn't double-count
  const other = JSON.parse(JSON.stringify(base("2026-11-01", { income: [{ id: "j", name: "Job", amount: 400, freq: "biweekly", next: "2026-11-19" }], bills: [{ id: "r", name: "Rent", amount: 300, freq: "monthly", next: "2026-11-15", day: 15 }], goals: [{ id: "g", type: "goal", name: "EF", target: 1000, perPay: 50, start: 0 }] })));
  autoRun(other, t);
  const m = mergeStates(s, other);
  assert.equal(m.tx.length, 3);
  assert.equal(autoRun(s, t).length, 0);
});

test("stretch fund releases weekly and acts like a payday", () => {
  const t = "2026-11-09";
  const s = base(t, { settings: { anchor: { amount: 1600, date: t, ts: 0 } } });
  s.goals.push({ id: "aid", type: "stretch", name: "Aid", perRelease: 100, freq: "weekly", next: t });
  s.tx.push({ id: "x", kind: "save", amount: 1600, goalId: "aid", date: t, ts: 1 });
  autoRun(s, t);
  assert.equal(goalSaved(s, "aid"), 1500);
  assert.equal(spendable(s), 100);
  const c = compute(s, t);
  assert.equal(periodEnd(s, t), "2026-11-15");
  assert.equal(c.dailyBase, round(100 / 7));
});

test("afford check: verdicts, hours of work, and budget impact", () => {
  const t = "2026-11-09";
  const s = base(t, { settings: { payType: "hourly", wage: 15, anchor: { amount: 500, date: t, ts: 0 } }, income: [{ id: "j", amount: 400, freq: "biweekly", next: "2026-11-19" }], cats: [{ id: "shopping", name: "Shopping", limit: 60 }] });
  assert.equal(impact(s, 20, "shopping", t).verdict, "fits");
  const r = impact(s, 90, "shopping", t);
  assert.equal(r.verdict, "tight");
  assert.equal(r.hours, 6);
  assert.equal(r.budget.leftAfter, -30);
  assert.equal(impact(s, 600, null, t).verdict, "no");
});

test("no-spend streak counts days without flexible spending (bills don't break it)", () => {
  const t = "2026-11-09";
  const s = base(t);
  s.tx.push({ id: "1", kind: "expense", amount: 5, date: "2026-11-05", ts: 1 });
  s.tx.push({ id: "2", kind: "expense", amount: 50, date: "2026-11-07", ts: 1, source: "bill" });
  assert.equal(noSpendStreak(s, t), 4); // 6,7,8,9
});

test("merchant memory and keyword guesses", () => {
  const s = base("2026-11-09");
  s.tx.push({ id: "1", kind: "expense", amount: 5, note: "Blue Bottle", cat: "coffee", date: "2026-11-01", ts: 1 });
  assert.equal(guessCategory(s, "blue bottle"), "coffee");
  assert.equal(guessCategory(s, "CHIPOTLE 1234"), "food");
  assert.equal(guessCategory(s, "Trader Joe's #552"), "groceries");
  assert.equal(guessCategory(s, "zzz"), null);
});

test("leaks find frequent small purchases", () => {
  const t = "2026-11-09";
  const s = base(t);
  for (let i = 0; i < 6; i++) s.tx.push({ id: "c" + i, kind: "expense", amount: 6, note: "Starbucks", cat: "coffee", date: addDays(t, -i * 3), ts: i });
  const l = leaks(s, t);
  assert.equal(l[0].n, 6);
  assert.equal(l[0].total, 36);
});

test("merge keeps newest edit and honors deletes", () => {
  const a = base("2026-11-09");
  const b = base("2026-11-09");
  a.tx.push({ id: "x", kind: "expense", amount: 5, updatedAt: 1 });
  b.tx.push({ id: "x", kind: "expense", amount: 7, updatedAt: 2 });
  b.tx.push({ id: "y", deleted: true, updatedAt: 3 });
  a.tx.push({ id: "y", kind: "expense", amount: 9, updatedAt: 1 });
  const m = mergeStates(a, b);
  assert.equal(m.tx.find((x) => x.id === "x").amount, 7);
  assert.equal(m.tx.find((x) => x.id === "y").deleted, true);
});

test("widget recomputes from snapshot + pending logs, including the next day", () => {
  const t = "2026-11-09";
  const s = base(t, { income: [{ id: "j", amount: 400, freq: "biweekly", next: "2026-11-19" }] });
  const snap = snapshot(s, t);
  snap.tz = 0;
  const noon = Date.parse(t + "T12:00:00Z");
  let w = widgetNumbers({ snapshot: snap, pending: [{ amount: 10, at: noon }] }, noon);
  assert.equal(w.left, 40);
  assert.equal(w.status, "good");
  const next = Date.parse("2026-11-10T09:00:00Z");
  w = widgetNumbers({ snapshot: snap, pending: [{ amount: 10, at: noon }] }, next);
  assert.equal(w.daysLeft, 9);
  assert.equal(w.left, round(490 / 9));
  w = widgetNumbers({ snapshot: snap, pending: [] }, Date.parse("2026-11-20T09:00:00Z"));
  assert.equal(w.status, "stale");
  assert.equal(parseAmount("$1,204.50"), 1204.5);
});

test("no income: spreads over 30 days and sets aside next month's rent", () => {
  const t = "2026-11-30";
  const s = base(t, { settings: { anchor: { amount: 900, date: "2026-11-01", ts: 0 } }, bills: [{ id: "r", name: "Rent", amount: 800, freq: "monthly", next: "2026-12-01", day: 1 }] });
  const c = compute(s, t);
  assert.equal(c.daysLeft, 30);
  assert.equal(c.upcomingTotal, 800);
  assert.ok(c.leftToday < 5);
});

test("stretch fund's end date is honored after its last release", () => {
  const t = "2026-11-27";
  const s = base(t, { settings: { anchor: { amount: 100, date: t, ts: 0 } } });
  s.goals.push({ id: "aid", type: "stretch", perRelease: 100, next: null, until: "2026-12-03" });
  assert.equal(compute(s, t).end, "2026-12-03");
});

test("a weekly release of 0 releases nothing (never the whole fund)", () => {
  const t = "2026-11-09";
  const s = base(t, { settings: { anchor: { amount: 1000, date: t, ts: 0 } } });
  s.goals.push({ id: "f", type: "stretch", perRelease: 0, next: t });
  s.tx.push({ id: "x", kind: "save", amount: 1000, goalId: "f", date: t, ts: 1 });
  autoRun(s, t);
  assert.equal(goalSaved(s, "f"), 1000);
});

test("rollForward moves a past date along its schedule without posting", async () => {
  const { rollForward } = await import("../js/engine.js");
  assert.equal(rollForward("2026-11-06", "biweekly", 6, "2026-11-09"), "2026-11-20");
  assert.equal(rollForward("2026-11-01", "monthly", 1, "2026-11-09"), "2026-12-01");
  assert.equal(rollForward("2026-11-12", "monthly", 12, "2026-11-09"), "2026-11-12");
});

test("a delete always wins a merge, and automation doesn't bump updatedAt", () => {
  const a = base("2026-11-09", { bills: [{ id: "b", name: "Gym", amount: 30, freq: "monthly", next: "2026-11-01", day: 1, updatedAt: 5 }] });
  autoRun(a, "2026-11-09");
  assert.equal(a.bills[0].updatedAt, 5);
  const b = base("2026-11-09", { bills: [{ id: "b", deleted: true, updatedAt: 3 }] });
  assert.equal(mergeStates(a, b).bills[0].deleted, true);
});

test("widget: logged income raises what's left instead of counting as negative spending", () => {
  const t = "2026-11-09";
  const s = base(t, { income: [{ id: "j", amount: 400, freq: "biweekly", next: "2026-11-19" }] });
  const snap = snapshot(s, t);
  snap.tz = 0;
  const noon = Date.parse(t + "T12:00:00Z");
  const w = widgetNumbers({ snapshot: snap, pending: [{ amount: 100, kind: "income", at: noon }] }, noon);
  assert.equal(w.spentToday, 0);
  assert.equal(w.left, 60);
});

test("contract worker: no scheduled income, money lasts until the chosen date, never assumes a refill", () => {
  const t = "2026-11-09";
  const s = base(t, { settings: { buffer: 20, lastUntil: "2026-12-18", anchor: { amount: 500, date: t, ts: 0 } } });
  const c = compute(s, t);
  assert.equal(c.end, "2026-12-18");
  assert.equal(c.daysLeft, 40);
  assert.equal(c.dailyBase, 12);
  assert.equal(c.scheduled, false);
  // contract pay logged when it lands raises the daily number from then on
  s.tx.push({ id: "pay1", kind: "income", amount: 400, date: t, ts: 5 });
  assert.equal(compute(s, t).dailyBase, 22);
});

test("prices as days of budget unless paid hourly", () => {
  const t = "2026-11-09";
  const s = base(t, { settings: { wage: 15, lastUntil: "2026-11-18", buffer: 0, anchor: { amount: 500, date: t, ts: 0 } } });
  const r = impact(s, 100, null, t);
  assert.equal(r.hours, null);
  assert.equal(r.budgetDays, 2);
});
