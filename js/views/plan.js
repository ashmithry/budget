import { get, put, remove, runAutomation, setSettings } from "../store.js";
import { today, addDays, diffDays, pretty, prettyIn, FREQS, PER_MONTH, dayOfMonth } from "../dates.js";
import { compute, live, categoryMonth, categories, goalSaved, recurringMonthly, incomeMonthly, round2, uid, resisted, catById } from "../engine.js";
import { esc, money, toast, plural, costFrame, ic, tile, catTile, catLook } from "../ui.js";

// Older data stored an emoji; anything without an icon gets a sensible one.
const goalIcon = (g) => g.icon || (g.type === "stretch" ? "layers" : "target");
import { formSheet, openAfford, skipItem, openAdd } from "../sheets.js";

const s = () => get();
const freqOptions = Object.entries(FREQS);
const TABS = [["budgets", "Budgets"], ["bills", "Bills & subs"], ["income", "Income"], ["goals", "Goals"], ["rules", "My rules"]];

export function renderPlan(tab = "budgets") {
  const body = { budgets, bills, income, goals, rules }[tab] || budgets;
  return `<header class="top"><div><h1>Plan</h1><div class="sub">Set it once. The app runs it for you.</div></div></header>
  <div class="seg">${TABS.map(([k, l]) => `<a href="#/plan/${k}" class="${tab === k ? "on" : ""}">${l}</a>`).join("")}<a href="#/wait">Waitlist</a></div>
  ${body()}`;
}

/* ---------- budgets ---------- */
function budgets() {
  const st = s();
  const rows = categoryMonth(st).filter((c) => !c.fixed);
  const totalLimits = round2(rows.reduce((a, c) => a + c.limit, 0));
  const inc = incomeMonthly(st);
  const bills = recurringMonthly(st);
  const goalsM = round2(live(st.goals).filter((g) => g.type !== "stretch").reduce((a, g) => a + (Number(g.perPay) || 0) * live(st.income).reduce((n, i) => n + (PER_MONTH[i.freq] || 0), 0), 0));
  const left = round2(inc - bills - goalsM - totalLimits);
  return `
  ${inc > 0 ? `<div class="card"><h2>Monthly plan</h2>
    <div class="row between"><span>Income</span><b class="num">${money(inc, { cents: false })}</b></div>
    <div class="row between muted"><span>Bills & subscriptions</span><span class="num">−${money(bills, { cents: false })}</span></div>
    <div class="row between muted"><span>Auto-saving to goals</span><span class="num">−${money(goalsM, { cents: false })}</span></div>
    <div class="row between muted"><span>Category budgets</span><span class="num">−${money(totalLimits, { cents: false })}</span></div>
    <div class="row between" style="border-top:1px solid var(--line);margin-top:8px;padding-top:8px"><b>${left >= 0 ? "Unplanned" : "Over-planned"}</b><b class="num ${left >= 0 ? "good" : "over"}">${money(left, { cents: false })}</b></div>
    <p class="tiny faint" style="margin:6px 0 0">${left < 0 ? "Your budgets add up to more than you earn. Trim a category or two." : "Unplanned money still counts toward your daily number. It's your cushion."}</p></div>` : ""}
  <div class="list">${rows.map((c) => `<button class="budget-row" data-act="cat" data-id="${c.id}">
    <div class="row between"><span class="row" style="gap:10px">${catTile(c)}${esc(c.name)}</span><span class="num small ${c.state === "over" ? "over" : c.state === "ahead" ? "tight" : "muted"}">${money(c.spent, { cents: false })}${c.limit ? ` / ${money(c.limit, { cents: false })}` : ", no limit"}</span></div>
    ${c.limit ? `<div class="bar"><i class="${c.state}" style="width:${Math.min(100, c.pct * 100)}%"></i><b style="left:${Math.min(100, (c.pace / c.limit) * 100)}%"></b></div>` : ""}
  </button>`).join("")}</div>
  <button class="btn block ghost" data-act="cat-new">${ic("plus", { size: 18 })}New category</button>
  <p class="tiny faint" style="margin:10px 6px">Tip: your daily "safe to spend" number is the main guardrail. Category budgets are early warnings for the places you tend to overspend.</p>`;
}

const CAT_ICONS = ["shopping-cart", "utensils", "coffee", "bus", "book-open", "ticket", "shopping-bag", "droplets", "package", "gamepad-2", "beer", "plane", "dog", "pill", "gift", "shirt", "scissors", "dumbbell", "car", "phone", "music", "film", "fuel", "heart"];
const CAT_COLORS = ["#3f7d57", "#b4552e", "#8a5a36", "#2f6690", "#55589c", "#94468a", "#ad3d5a", "#2c8584", "#7a7f72", "#a0660f"];
function editCat(id) {
  const c = id ? categories(s()).find((x) => x.id === id) : null;
  formSheet({
    title: c ? `Edit ${c.name}` : "New category",
    value: c ? { ...c, icon: catLook(c).icon } : { icon: "package" },
    fields: [
      { key: "name", label: "Name", required: true, max: 24 },
      { key: "icon", label: "Icon", type: "icon", options: CAT_ICONS },
      { key: "limit", label: "Monthly limit", type: "money", help: "Leave 0 for no limit" },
    ],
    onSave: (v) => { put("cats", { ...(c || {}), id: c?.id || uid(), name: v.name, icon: v.icon, color: c ? catLook(c).color : CAT_COLORS[categories(s()).length % CAT_COLORS.length], limit: Number(v.limit) || 0, order: c?.order ?? 99 }); },
    onDelete: c && !["other", "bills", "subs"].includes(c.id) ? () => remove("cats", c.id) : null,
  });
}

/* ---------- bills & subscriptions ---------- */
const QUICK_BILLS = [["Rent", "bill", "monthly"], ["Phone", "bill", "monthly"], ["Spotify", "sub", "monthly"], ["Netflix", "sub", "monthly"], ["Apple Music", "sub", "monthly"], ["iCloud+", "sub", "monthly"], ["Amazon Prime", "sub", "monthly"], ["YouTube Premium", "sub", "monthly"], ["ChatGPT", "sub", "monthly"], ["Gym", "sub", "monthly"], ["Car insurance", "bill", "monthly"], ["Free trial", "trial", "monthly"]];
function bills() {
  const st = s();
  const list = live(st.bills).filter((b) => !b.done).sort((a, b) => (a.next < b.next ? -1 : 1));
  const subs = list.filter((b) => b.kind === "sub" || b.kind === "trial");
  const subsYear = round2(subs.reduce((a, b) => a + (Number(b.amount) || 0) * (PER_MONTH[b.freq] || 0) * 12, 0));
  return `
  <div class="card"><div class="row between"><div><div class="small muted">Every month</div><b class="num" style="font-size:24px">${money(recurringMonthly(st), { cents: false })}</b></div>
  ${subs.length ? `<div style="text-align:right"><div class="small muted">Subscriptions per year</div><b class="num tight" style="font-size:24px">${money(subsYear, { cents: false })}</b>${costFrame(subsYear) ? `<div class="tiny faint">${costFrame(subsYear)}</div>` : ""}</div>` : ""}</div>
  <p class="tiny faint" style="margin:8px 0 0">Bills log themselves on their due date and are set aside ahead of time, so they never eat today's number.</p></div>
  ${list.length ? `<div class="list">${list.map((b) => `<button class="item" data-act="bill" data-id="${b.id}">${b.kind === "trial" ? tile("alarm-clock", "#a0660f") : b.kind === "sub" ? tile("repeat", "#64689a") : tile("key-round", "#56625b")}<div class="main"><div class="name">${esc(b.name)}${b.paused ? `<span class="tag">paused</span>` : ""}${b.kind === "trial" ? `<span class="tag warn">trial</span>` : ""}</div><div class="meta">${b.kind === "trial" ? "Starts charging" : "Next"} ${prettyIn(b.next)}, ${FREQS[b.freq].toLowerCase()}</div></div><div class="amt num">${money(b.amount)}</div></button>`).join("")}</div>` : `<div class="card empty"><span class="empty-ic">${ic("receipt-text", { size: 26, stroke: 1.5 })}</span><div>No bills yet. Add rent, your phone, and every subscription. Seeing them all together is half the battle.</div></div>`}
  <div class="small muted" style="margin:14px 4px 8px">Quick add</div>
  <div class="chips">${QUICK_BILLS.map(([n, k, f]) => `<button class="chip-btn" data-act="bill-new" data-name="${n === "Free trial" ? "" : n}" data-kind="${k}" data-freq="${f}">${ic("plus", { size: 16 })}<span>${n}</span></button>`).join("")}</div>
  ${subs.length >= 2 ? `<button class="btn block ghost" style="margin-top:14px" data-act="sub-audit">${ic("scissors", { size: 18 })}Subscription check-up</button>` : ""}`;
}
function editBill(id, preset = {}) {
  const b = id ? live(s().bills).find((x) => x.id === id) : null;
  formSheet({
    title: b ? `Edit ${b.name}` : preset.kind === "trial" ? "New free trial" : "New bill",
    value: b || { freq: preset.freq || "monthly", kind: preset.kind || "bill", name: preset.name || "", next: addDays(today(), 1) },
    note: (b?.kind || preset.kind) === "trial" ? "We'll warn you 3 days before it starts charging, so you can cancel in time." : null,
    fields: [
      { key: "name", label: "Name", required: true, placeholder: "Rent, Spotify…", max: 40 },
      { key: "amount", label: "Amount", type: "money", required: true },
      { key: "freq", label: "How often", type: "select", options: freqOptions },
      { key: "next", label: "Next due date", type: "date", required: true, help: "The app logs it automatically on this date." },
      { key: "kind", label: "Type", type: "select", options: [["bill", "Bill (rent, phone, insurance)"], ["sub", "Subscription"], ["trial", "Free trial (charges later)"]] },
      { key: "paused", label: "Paused", type: "toggle" },
    ],
    onSave: (v) => {
      if (v.next < today()) { toast("Pick today or a future date"); return false; }
      put("bills", { ...(b || {}), id: b?.id || uid(), name: v.name, amount: Number(v.amount) || 0, freq: v.freq, next: v.next, day: dayOfMonth(v.next), kind: v.kind, cat: v.kind === "bill" ? "bills" : "subs", paused: !!v.paused });
      runAutomation();
      toast(b ? "Saved" : `${v.name} added. It'll log itself.`);
    },
    onDelete: b ? () => remove("bills", b.id) : null,
  });
}
function subAudit() {
  const subs = live(s().bills).filter((b) => (b.kind === "sub" || b.kind === "trial") && !b.done);
  let i = 0;
  const step = () => {
    if (i >= subs.length) { toast("Subscription check-up done"); return; }
    const b = subs[i++];
    const yearly = round2((Number(b.amount) || 0) * (PER_MONTH[b.freq] || 0) * 12);
    formSheet({
      title: `${b.name}: keep it?`,
      note: `<b>${money(b.amount)}</b> ${FREQS[b.freq].toLowerCase()} = <b>${money(yearly)}/year</b>${costFrame(yearly) ? ` (${costFrame(yearly)})` : ""}. Did you use it in the last 2 weeks? Would you sign up again today at this price?`,
      fields: [],
      saveLabel: "Keep it",
      deleteLabel: "Cancel it",
      confirmDelete: false,
      onSave: () => setTimeout(step, 320),
      onDelete: () => { remove("bills", b.id); toast(`Cancelled ${b.name}: ${money(yearly)}/yr saved. Cancel it with the company too!`); setTimeout(step, 320); },
    });
  };
  step();
}

/* ---------- income ---------- */
function income() {
  const st = s();
  const list = live(st.income).filter((x) => !x.done).sort((a, b) => (a.next < b.next ? -1 : 1));
  const funds = live(st.goals).filter((g) => g.type === "stretch");
  const c = compute(st);
  const pct = Math.max(0, Math.min(60, Number(st.settings.taxPct) || 0));
  return `
  <div class="card nudge-card ${c.scheduled || st.settings.lastUntil ? "ok" : "warn"}"><div class="nudge"><span class="nic">${ic("calendar-days", { size: 18 })}</span><div class="grow">
    <div class="t">${c.scheduled ? `Next money comes ${prettyIn(addDays(c.end, 1))}` : `Your money is spread until ${pretty(c.end, { full: true })}`}</div>
    <div class="d">${c.scheduled ? "Your daily number spreads what you have until then." : st.settings.lastUntil ? "You picked this date. Nothing is assumed to come in before it, so contract pay is a bonus until it lands." : "No end date set, so it's spread over the next 30 days. Pick a real one, like the end of the semester or when your next contract pays out."}</div>
    ${c.scheduled ? "" : `<div class="btns"><button class="btn sm ${st.settings.lastUntil ? "ghost" : "primary"}" data-act="end-date">${st.settings.lastUntil ? "Change end date" : "Set my end date"}</button></div>`}
  </div></div></div>
  <div class="section-title"><span>Contract or gig pay</span></div>
  <div class="card"><p class="small muted" style="margin:0 0 12px">Pay that varies isn't counted until it lands, so a late client never breaks your budget. When you get paid, log it here${pct > 0 ? ` and ${pct}% goes into a Taxes goal (no tax is taken out of contract pay)` : ""}.</p>
    <button class="btn block primary" data-act="contract-pay">${ic("banknote", { size: 18 })}Log contract pay</button></div>
  <div class="section-title"><span>Steady income</span></div>
  ${list.length ? `<div class="list">${list.map((i) => `<button class="item" data-act="inc" data-id="${i.id}">${tile("banknote", "#2e6a47")}<div class="main"><div class="name">${esc(i.name)}</div><div class="meta">Next ${prettyIn(i.next)}, ${FREQS[i.freq].toLowerCase()}</div></div><div class="amt num pos">${money(i.amount)}</div></button>`).join("")}</div>` : `<div class="card empty"><span class="empty-ic">${ic("banknote", { size: 26, stroke: 1.5 })}</span><div>Only add money that comes on a schedule (a regular paycheck, a monthly allowance). Contract pay goes above, when it lands.</div></div>`}
  <button class="btn block ghost" data-act="inc-new">${ic("plus", { size: 18 })}Add a steady paycheck or allowance</button>
  <div class="section-title"><span>Lump sums</span></div>
  <div class="card nudge-card warn"><div class="nudge"><span class="nic">${ic("layers", { size: 18 })}</span><div class="grow"><div class="t">Got a big amount at once?</div><div class="d">Financial aid refunds, scholarships, summer job savings, birthday money. Lump sums are easy to blow early. Turn it into a weekly paycheck to yourself that lasts until the date you choose.</div><div class="btns"><button class="btn sm primary" data-act="stretch-new">Stretch a lump sum</button></div></div></div></div>
  ${funds.length ? `<div class="list">${funds.map(fundRow).join("")}</div>` : ""}`;
}
function fundRow(g) {
  const left = goalSaved(s(), g.id);
  return `<button class="item" data-act="goal" data-id="${g.id}">${tile("layers", "#a0660f")}<div class="main"><div class="name">${esc(g.name)}</div><div class="meta">${left > 0 ? `${money(g.perRelease)}/week, next ${g.next ? prettyIn(g.next) : "-"}${g.until ? `, lasts to ${pretty(g.until, { full: true })}` : ""}` : "All released"}</div></div><div class="amt num">${money(left)}<span class="sub">left</span></div></button>`;
}
function editIncome(id) {
  const i = id ? live(s().income).find((x) => x.id === id) : null;
  formSheet({
    title: i ? `Edit ${i.name}` : "Regular income",
    value: i || { freq: "biweekly", next: addDays(today(), 7) },
    fields: [
      { key: "name", label: "Name", required: true, placeholder: "Campus job, parents…", max: 40 },
      { key: "amount", label: "Usual amount (after tax)", type: "money", required: true, help: "Logged automatically each payday. If a check is different, you'll get a one-tap fix." },
      { key: "freq", label: "How often", type: "select", options: freqOptions },
      { key: "next", label: "Next payday", type: "date", required: true },
    ],
    onSave: (v) => {
      if (v.next < today()) { toast("Pick today or a future date"); return false; }
      put("income", { ...(i || {}), id: i?.id || uid(), name: v.name, amount: Number(v.amount) || 0, freq: v.freq, next: v.next, day: dayOfMonth(v.next), done: false });
      runAutomation();
      toast("Saved");
    },
    onDelete: i ? () => remove("income", i.id) : null,
  });
}
function stretchNew() {
  formSheet({
    title: "Stretch a lump sum",
    note: "We set it aside and release an equal amount every week, like a paycheck. Your daily number only counts what's been released.",
    value: { until: addDays(today(), 16 * 7), inBalance: false, name: "Aid refund" },
    fields: [
      { key: "name", label: "What is it?", required: true, max: 40 },
      { key: "amount", label: "Amount", type: "money", required: true },
      { key: "until", label: "Make it last until", type: "date", required: true, help: "End of semester, next refund, summer…" },
      { key: "inBalance", label: "It's already in my balance", type: "toggle", help: "Turn on if the money already arrived and is counted in the app's balance." },
    ],
    saveLabel: "Start weekly releases",
    onSave: (v) => {
      const weeks = Math.max(1, Math.ceil((diffDays(today(), v.until) + 1) / 7));
      const amt = Number(v.amount) || 0;
      const per = round2(amt / weeks);
      const id = uid();
      const t = today();
      if (v.inBalance && amt > compute(s()).cash + 0.005) {
        toast(`You only have ${money(compute(s()).cash)} in the app's balance. Turn off "already in my balance", or match your bank first.`);
        return false;
      }
      if (!v.inBalance) put("tx", { id: uid(), kind: "income", amount: amt, note: v.name, cat: "income", date: t, ts: Date.now(), source: "manual" });
      put("goals", { id, type: "stretch", name: v.name, icon: "layers", target: amt, start: 0, perRelease: per, freq: "weekly", next: t, until: v.until });
      put("tx", { id: uid(), kind: "save", amount: amt, goalId: id, note: `${v.name} set aside`, date: t, ts: Date.now() + 1, source: "manual" });
      runAutomation();
      toast(`${money(per)} a week for ${plural(weeks, "week")}. First one's out now.`);
    },
  });
}

/* ---------- goals ---------- */
function goals() {
  const st = s();
  const list = live(st.goals).filter((g) => g.type !== "stretch");
  const perMonthPays = live(st.income).reduce((n, i) => n + (PER_MONTH[i.freq] || 0), 0);
  return `
  ${list.length ? list.map((g) => {
    const saved = goalSaved(st, g.id);
    const tgt = Number(g.target) || 0;
    const pct = tgt ? Math.min(1, saved / tgt) : 0;
    const perMonth = (Number(g.perPay) || 0) * perMonthPays;
    const months = perMonth > 0 && tgt > saved ? Math.ceil((tgt - saved) / perMonth) : null;
    return `<button class="card" style="display:block;width:100%;text-align:left" data-act="goal" data-id="${g.id}">
      <div class="row between"><b class="row" style="gap:10px">${tile(goalIcon(g), "#55589c")}${esc(g.name)}</b><span class="num">${money(saved, { cents: false })}${tgt ? ` / ${money(tgt, { cents: false })}` : ""}</span></div>
      ${tgt ? `<div class="bar"><i style="width:${pct * 100}%"></i></div>` : ""}
      <div class="small muted" style="margin-top:8px">${pct >= 1 ? "Goal reached." : g.perPay ? `Auto-saves ${money(g.perPay)} each payday${months ? `, done in about ${plural(months, "month")}` : ""}` : "No auto-save yet. Tap to set one."}${g.due ? `, by ${pretty(g.due, { full: true })}` : ""}</div></button>`;
  }).join("") : `<div class="card empty"><span class="empty-ic">${ic("target", { size: 26, stroke: 1.5 })}</span><div>Saving works best when it happens before you can spend it. Add a goal and an amount to set aside each payday.</div></div>`}
  <button class="btn block primary" data-act="goal-new">${ic("plus", { size: 18 })}New goal</button>
  <p class="tiny faint" style="margin:10px 6px">Ideas: emergency fund ($500 covers most student surprises), spring break, a new laptop, next semester's books.</p>`;
}
function editGoal(id) {
  const g = id ? live(s().goals).find((x) => x.id === id) : null;
  if (g?.type === "stretch") return fundSheet(g);
  formSheet({
    title: g ? `Edit ${g.name}` : "New goal",
    value: g ? { ...g, icon: goalIcon(g) } : { icon: "target" },
    fields: [
      { key: "name", label: "Goal", required: true, placeholder: "Emergency fund, spring break…", max: 40 },
      { key: "icon", label: "Icon", type: "icon", options: ["target", "life-buoy", "tree-palm", "laptop", "car", "plane", "graduation-cap", "gift", "house", "guitar"] },
      { key: "target", label: "Target", type: "money" },
      { key: "perPay", label: "Auto-save each payday", type: "money", help: "Moved out of your spending money automatically every time you get paid." },
      ...(g ? [] : [{ key: "start", label: "Already saved (optional)", type: "money", help: "Money you already have for this goal (not in your spending balance)." }]),
      { key: "due", label: "Target date (optional)", type: "date" },
    ],
    onSave: (v) => {
      put("goals", { ...(g || {}), id: g?.id || uid(), type: "goal", name: v.name, icon: v.icon, target: Number(v.target) || 0, perPay: Number(v.perPay) || 0, start: g ? g.start : Number(v.start) || 0, due: v.due || null });
      toast("Saved");
    },
    // "Already saved" money was never in your spending balance, so closing a goal only returns what came from it.
    onDelete: g ? () => {
      const left = round2(goalSaved(s(), g.id) - (Number(g.start) || 0));
      if (left > 0) put("tx", { id: uid(), kind: "unsave", amount: left, goalId: g.id, note: `${g.name} closed`, date: today(), ts: Date.now(), source: "manual" });
      remove("goals", g.id);
    } : null,
    extra: g ? `<div class="two" style="margin:4px 0 12px"><button type="button" class="btn ghost" data-move="in">${ic("plus", { size: 18 })}Add money</button><button type="button" class="btn ghost" data-move="out">${ic("arrow-up-right", { size: 18 })}Take out</button></div>` : "",
    onBind: g ? (el) => el.querySelectorAll("[data-move]").forEach((b) => (b.onclick = () => moveMoney(g, b.dataset.move))) : null,
  });
}
function moveMoney(g, dir) {
  formSheet({
    title: dir === "in" ? `Add to ${g.name}` : `Take out of ${g.name}`,
    note: dir === "in" ? "Moves money from your spending balance into this goal." : `Moves money back to spending. You have ${money(goalSaved(s(), g.id))} here.`,
    fields: [{ key: "amount", label: "Amount", type: "money", required: true }],
    onSave: (v) => {
      const amt = Number(v.amount);
      if (!(amt > 0)) { toast("Enter an amount above zero"); return false; }
      if (dir === "out" && amt > goalSaved(s(), g.id) + 0.004) { toast(`There's only ${money(goalSaved(s(), g.id))} in ${g.name}`); return false; }
      if (dir === "in" && amt > compute(s()).cash + 0.004) { toast(`You only have ${money(compute(s()).cash)} to move`); return false; }
      put("tx", { id: uid(), kind: dir === "in" ? "save" : "unsave", amount: amt, goalId: g.id, note: dir === "in" ? `Saved → ${g.name}` : `From ${g.name}`, date: today(), ts: Date.now(), source: "manual" });
      toast(dir === "in" ? "Saved" : "Moved back to spending");
    },
  });
}
function fundSheet(g) {
  formSheet({
    title: g.name,
    note: `${money(goalSaved(s(), g.id))} still set aside. Releases ${money(g.perRelease)} every week${g.next ? `, next ${prettyIn(g.next)}` : ""}.`,
    value: g,
    fields: [{ key: "perRelease", label: "Weekly release", type: "money", required: true }],
    onSave: (v) => {
      if (!(Number(v.perRelease) > 0)) { toast("The weekly release has to be more than zero"); return false; }
      put("goals", { id: g.id, perRelease: Number(v.perRelease) });
    },
    onDelete: () => {
      const left = goalSaved(s(), g.id);
      if (left > 0) put("tx", { id: uid(), kind: "unsave", amount: left, goalId: g.id, note: `${g.name} released`, date: today(), ts: Date.now(), source: "manual" });
      remove("goals", g.id);
    },
  });
}

/* ---------- personal rules ---------- */
const RULE_IDEAS = ["No food delivery on weekdays", "Wait 48 hours on anything over $30", "Coffee out max twice a week", "No shopping apps after 10pm", "Cash only for going out", "Unsubscribe from store emails", "Check the safe-to-spend number before every purchase"];
function rules() {
  const list = live(s().rules);
  return `<div class="card"><p class="small muted" style="margin:0">Rules you set for yourself, written in your own words. They show up when you check a purchase in that category. Specific "if this, then that" plans are easier to stick to than general goals.</p></div>
  ${list.length ? `<div class="list">${list.map((r) => `<button class="item" data-act="rule" data-id="${r.id}">${tile("signpost", "#56625b")}<div class="main"><div class="name" style="white-space:normal">${esc(r.text)}</div><div class="meta">${r.cat ? esc(catById(s(), r.cat).name) : "All spending"}</div></div></button>`).join("")}</div>` : ""}
  <button class="btn block primary" data-act="rule-new">${ic("plus", { size: 18 })}New rule</button>
  <div class="small muted" style="margin:14px 4px 8px">Ideas</div>
  <div class="chips">${RULE_IDEAS.map((r) => `<button class="chip-btn" data-act="rule-new" data-text="${esc(r)}">${ic("plus", { size: 16 })}<span>${esc(r)}</span></button>`).join("")}</div>`;
}
function editRule(id, text = "") {
  const r = id ? live(s().rules).find((x) => x.id === id) : null;
  formSheet({
    title: r ? "Edit rule" : "New rule",
    value: r || { text, cat: "" },
    fields: [
      { key: "text", label: "Rule", required: true, max: 120 },
      { key: "cat", label: "Applies to", type: "select", options: [["", "All spending"], ...categories(s()).map((c) => [c.id, c.name])] },
    ],
    onSave: (v) => put("rules", { ...(r || {}), id: r?.id || uid(), text: v.text, cat: v.cat || null }),
    onDelete: r ? () => remove("rules", r.id) : null,
  });
}

/* ---------- waitlist ---------- */
export function renderWait() {
  const st = s();
  const waiting = live(st.wish).filter((w) => w.status === "waiting").sort((a, b) => a.unlockAt - b.unlockAt);
  const done = live(st.wish).filter((w) => w.status !== "waiting").sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 30);
  const r = resisted(st);
  const left = (w) => {
    const ms = w.unlockAt - Date.now();
    if (ms <= 0) return "Ready to decide";
    const h = Math.ceil(ms / 3600000);
    return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h to go` : `${h}h to go`;
  };
  return `<header class="top"><div><h1>Waitlist</h1><div class="sub">Want it? Wait first. Most urges pass.</div></div><a class="icon-btn" href="#/plan" aria-label="Back to plan">${ic("chevron-left", { size: 22 })}</a></header>
  <div class="card ok"><div class="row between"><div><div class="small muted">Not spent by skipping</div><b class="num" style="font-size:28px">${money(r.total)}</b></div><div style="text-align:right" class="small muted">${plural(r.n, "thing")} skipped${r.total && costFrame(r.total) ? `<br>${costFrame(r.total)} kept` : ""}</div></div></div>
  ${waiting.length ? `<div class="list">${waiting.map((w) => `<button class="item" data-act="wish" data-id="${w.id}">${tile("hourglass", "#a0660f")}<div class="main"><div class="name">${esc(w.name)}</div><div class="meta ${w.unlockAt <= Date.now() ? "good" : ""}">${left(w)}${costFrame(w.price) ? `, ${costFrame(w.price)}` : ""}</div></div><div class="amt num">${money(w.price)}</div></button>`).join("")}</div>` : `<div class="card empty"><span class="empty-ic">${ic("shopping-bag", { size: 26, stroke: 1.5 })}</span><div>Nothing waiting. Next time you want something, tap <b>Can I afford it?</b> and choose "Wait".</div></div>`}
  <button class="btn block primary" data-act="wish-new">${ic("plus", { size: 18 })}Add something I want</button>
  ${done.length ? `<div class="section-title"><span>Decided</span></div><div class="list">${done.map((w) => `<div class="item">${w.status === "skipped" ? tile("circle-check", "#2e6a47") : tile("shopping-bag", "#ad3d5a")}<div class="main"><div class="name">${esc(w.name)}</div><div class="meta">${w.status === "skipped" ? "Skipped" : "Bought"}${w.decidedDay ? `, ${prettyIn(w.decidedDay)}` : ""}</div></div><div class="amt num ${w.status === "skipped" ? "pos" : ""}">${money(w.price)}</div></div>`).join("")}</div>` : ""}`;
}

function endDateSheet() {
  const cur = s().settings.lastUntil;
  formSheet({
    title: "Make my money last until",
    note: "With no steady paycheck, your daily number is what you have divided by the days until this date. Contract pay you log later raises it.",
    value: { lastUntil: cur || addDays(today(), 30) },
    fields: [{ key: "lastUntil", label: "Last until", type: "date", required: true, help: "End of semester, next refund, or when a contract should pay out." }],
    saveLabel: "Save end date",
    onSave: (v) => {
      if (v.lastUntil <= today()) { toast("Pick a date after today"); return false; }
      setSettings({ lastUntil: v.lastUntil });
      toast(`Spread until ${pretty(v.lastUntil, { full: true })}`);
    },
    onDelete: cur ? () => setSettings({ lastUntil: null }) : null,
    deleteLabel: "Clear end date (use 30 days)",
    confirmDelete: false,
  });
}

export const planActions = {
  "end-date": () => endDateSheet(),
  "contract-pay": () => openAdd({ kind: "income", contract: true, note: "" }),
  cat: (el) => editCat(el.dataset.id),
  "cat-new": () => editCat(null),
  bill: (el) => editBill(el.dataset.id),
  "bill-new": (el) => editBill(null, { name: el.dataset.name, kind: el.dataset.kind, freq: el.dataset.freq }),
  "sub-audit": () => subAudit(),
  inc: (el) => editIncome(el.dataset.id),
  "inc-new": () => editIncome(null),
  "stretch-new": () => stretchNew(),
  goal: (el) => editGoal(el.dataset.id),
  "goal-new": () => editGoal(null),
  rule: (el) => editRule(el.dataset.id),
  "rule-new": (el) => editRule(null, el.dataset.text || ""),
  wish: (el) => {
    const w = live(s().wish).find((x) => x.id === el.dataset.id);
    if (!w) return;
    if (w.unlockAt <= Date.now()) openAfford({ price: w.price, name: w.name, cat: w.cat, wishId: w.id });
    else formSheet({
      title: w.name,
      note: `Still ${Math.ceil((w.unlockAt - Date.now()) / 3600000)} hours to wait. Changed your mind already? That's a win.`,
      fields: [],
      saveLabel: "Keep waiting",
      deleteLabel: "Skip it (counts as saved)",
      confirmDelete: false,
      onSave: () => {},
      onDelete: () => skipItem({ ...w }),
    });
  },
  "wish-new": () => formSheet({
    title: "Add to waitlist",
    fields: [{ key: "name", label: "What is it?", required: true, max: 60 }, { key: "price", label: "Price", type: "money", required: true }],
    saveLabel: `Wait ${s().settings.coolHours || 48} hours`,
    onSave: (v) => { put("wish", { id: uid(), name: v.name, price: Number(v.price), status: "waiting", added: Date.now(), unlockAt: Date.now() + (Number(s().settings.coolHours) || 48) * 3600000 }); toast("Added. We'll ask you again later."); },
  }),
};
