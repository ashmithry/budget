// Bottom sheets: log spending, edit, "Can I afford it?", and the generic edit form used by Plan.
import { get, put, remove, commit, setSettings } from "./store.js";
import { today, addDays, pretty } from "./dates.js";
import { compute, impact, categories, catById, guessCategory, goalSaved, MOODS, live, round2, normMerchant, uid } from "./engine.js";
import { sheet, esc, money, hoursText, costFrame, toast, haptic, confirmSheet, ic, chip, catLook, topSheet } from "./ui.js";
import { ai, AIError } from "./ai.js";

const s = () => get();

const taxPct = () => Math.max(0, Math.min(60, Number(s().settings.taxPct) || 0));
// The goal tax set-asides go into, created the first time it's needed.
function taxGoal() {
  const g = live(s().goals).find((x) => x.taxes);
  if (g) return g;
  // A fixed id so two devices that both create it end up with one goal after sync
  // (unless an old one was deleted: deletes always win a merge, so then use a new id).
  const id = s().goals.some((x) => x.id === "taxes") ? uid() : "taxes";
  return put("goals", { id, type: "goal", taxes: true, name: "Taxes", icon: "receipt-text", target: 0, perPay: 0, start: 0 });
}
// The tax set-aside that came from an income record, if any. Its id is tied to the income's id.
const taxFor = (txId) => live(s().tx).find((x) => x.id === `tax:${txId}`);
function forgetTax(txId) {
  if (taxFor(txId)) remove("tx", `tax:${txId}`);
}

/* ---------- amount keypad ---------- */
function keypadHTML() {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];
  return `<div class="keypad">${keys.map((k) => `<button type="button" data-k="${k}" aria-label="${k === "⌫" ? "Delete" : k}">${k === "⌫" ? ic("delete", { size: 24 }) : k}</button>`).join("")}</div>`;
}
function pressKey(str, k) {
  if (k === "⌫") return str.slice(0, -1);
  if (k === ".") return str.includes(".") ? str : (str || "0") + ".";
  if (str.includes(".") && str.split(".")[1].length >= 2) return str;
  if (str === "0") return k;
  if (str.replace(".", "").length >= 7) return str;
  return str + k;
}
const amountHTML = (str) => `<span class="cur">${esc(s().settings.currency || "$")}</span>${esc(str || "0")}`;

function recentMerchants() {
  const seen = new Map();
  for (const tx of [...live(s().tx)].sort((a, b) => (b.ts || 0) - (a.ts || 0))) {
    if (tx.kind !== "expense" || !tx.note || tx.source === "bill") continue;
    const k = normMerchant(tx.note);
    if (!seen.has(k)) seen.set(k, tx);
    if (seen.size >= 30) break;
  }
  return [...seen.values()];
}

function catOrder() {
  const counts = {};
  const from = addDays(today(), -60);
  for (const tx of live(s().tx)) if (tx.kind === "expense" && tx.date >= from) counts[tx.cat] = (counts[tx.cat] || 0) + 1;
  return categories(s())
    .filter((c) => c.id !== "bills")
    .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || (a.order ?? 0) - (b.order ?? 0));
}

/* ---------- log / edit a transaction ---------- */
export function openAdd(prefill = {}) {
  const editing = prefill.id ? live(s().tx).find((x) => x.id === prefill.id) : null;
  const st = {
    kind: editing?.kind || prefill.kind || "expense",
    // Contract pay usually has no tax taken out: offer to set some aside.
    tax: !!prefill.contract, // on by default only from "Log contract pay", not for money from family etc.
    amt: editing ? String(Math.abs(editing.amount)) : prefill.amount ? String(prefill.amount) : "",
    note: editing?.note || prefill.note || "",
    cat: editing?.cat || prefill.cat || null,
    mood: editing?.mood || null,
    date: editing?.date || today(),
    refund: editing ? editing.amount < 0 : false,
    catTouched: !!(editing?.cat || prefill.cat),
  };
  const merchants = recentMerchants();
  const sh = sheet(() => {
    const cats = catOrder();
    return `
      <h3>${editing ? "Edit" : st.kind === "income" ? "Money in" : "Log spending"}<button data-close>Cancel</button></h3>
      <div class="kind-toggle" role="tablist">
        <button data-kind="expense" class="${st.kind === "expense" && !st.refund ? "on" : ""}">Spent</button>
        <button data-kind="refund" class="${st.refund ? "on" : ""}">Refund</button>
        <button data-kind="income" class="${st.kind === "income" ? "on" : ""}">Got money</button>
      </div>
      ${editing || !get().meta.key ? "" : `<div class="type-it"><input class="in" id="nl" placeholder="Or type it: 23 on pizza with friends" value="${esc(st.nl || "")}" autocomplete="off" enterkeyhint="go"><button type="button" class="btn sm primary" id="nlgo" aria-label="Fill in with Claude">${ic("pencil", { size: 16 })}Fill in</button></div>`}
      <div class="amount-display num" id="amt">${amountHTML(st.amt)}</div>
      <div class="amount-hint" id="hint"></div>
      <label class="f"><input class="in" id="note" list="merchants" placeholder="${st.kind === "income" ? "From? (job, parents, Venmo…)" : "Where? (Chipotle, Target…)"}" value="${esc(st.note)}" autocomplete="off" enterkeyhint="done">
        <datalist id="merchants">${merchants.map((m) => `<option value="${esc(m.note)}">`).join("")}</datalist></label>
      ${st.kind === "expense" ? `
      <div class="chips scroll" id="cats">${cats.map((c) => chip(catLook(c).icon, c.name, st.cat === c.id, `data-cat="${c.id}"`, catLook(c).color)).join("")}</div>
      ${st.refund ? "" : `<div class="small muted" style="margin:12px 4px 6px">Why? <span class="faint">(optional, helps spot your triggers)</span></div>
      <div class="chips scroll" id="moods">${MOODS.map((m) => chip(m.icon, m.label, st.mood === m.id, `data-mood="${m.id}"`)).join("")}</div>`}` : ""}
      ${st.kind === "income" && !editing && taxPct() > 0 ? `<label class="switch" style="margin-top:4px"><span>Contract pay: set aside ${taxPct()}% for taxes<div class="tiny faint">No tax is taken out of contract pay, so it goes into a Taxes goal and doesn't count as spending money.</div></span><input type="checkbox" id="tax" ${st.tax ? "checked" : ""}></label>` : ""}
      ${keypadHTML()}
      <div class="row" style="margin-bottom:10px">
        <label class="grow small muted" style="display:flex;align-items:center;gap:8px">${ic("calendar", { size: 18 })}<input type="date" class="in" id="date" value="${st.date}" max="${addDays(today(), 400)}" style="min-height:40px;padding:6px 10px"></label>
      </div>
      <button class="btn primary block" id="save">${editing ? "Save" : "Log it"}</button>
      ${editing ? `<button class="btn danger block" id="del" style="margin-top:10px">Delete</button>` : ""}`;
  });

  function hint() {
    const el = sh.el.querySelector("#hint");
    const a = parseFloat(st.amt) || 0;
    if (!a || st.kind !== "expense" || st.refund) { el.innerHTML = ""; return; }
    const c = compute(s());
    const cf = costFrame(a);
    const hrs = cf ? `, ${cf}` : "";
    const base = editing && editing.date === today() ? c.leftToday + Number(editing.amount) : c.leftToday;
    const after = round2(base - a);
    if (st.date !== today()) el.innerHTML = `<span class="muted">${hrs.slice(2).replace(/^./, (m) => m.toUpperCase())}</span>`;
    else if (after >= 0) el.innerHTML = `<span class="good">Leaves ${money(after)} for today</span><span class="muted">${hrs}</span>`;
    else {
      const tmr = c.daysLeft > 1 ? round2(Math.max(0, c.pool - a + (editing ? Number(editing.amount) : 0)) / (c.daysLeft - 1)) : null;
      el.innerHTML = `<span class="over">${money(-after)} over today${tmr != null ? ` → ${money(tmr)}/day after` : ""}</span><span class="muted">${hrs}</span>`;
    }
  }

  sh.bind = (el) => {
    el.querySelector("[data-close]").onclick = () => sh.close();
    el.querySelectorAll("[data-kind]").forEach((b) => (b.onclick = () => {
      st.refund = b.dataset.kind === "refund";
      st.kind = b.dataset.kind === "income" ? "income" : "expense";
      sh.render();
    }));
    el.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => {
      st.amt = pressKey(st.amt, b.dataset.k);
      el.querySelector("#amt").innerHTML = amountHTML(st.amt);
      haptic(5);
      hint();
    }));
    const note = el.querySelector("#note");
    note.oninput = () => {
      st.note = note.value;
      if (!st.catTouched && st.kind === "expense") {
        const g = guessCategory(s(), st.note);
        if (g && g !== st.cat) {
          st.cat = g;
          el.querySelectorAll("[data-cat]").forEach((x) => x.classList.toggle("on", x.dataset.cat === g));
        }
      }
    };
    note.onkeydown = (e) => { if (e.key === "Enter") note.blur(); };
    el.querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => {
      st.cat = st.cat === b.dataset.cat ? null : b.dataset.cat;
      st.catTouched = true;
      el.querySelectorAll("[data-cat]").forEach((x) => x.classList.toggle("on", x.dataset.cat === st.cat));
    }));
    el.querySelectorAll("[data-mood]").forEach((b) => (b.onclick = () => {
      st.mood = st.mood === b.dataset.mood ? null : b.dataset.mood;
      el.querySelectorAll("[data-mood]").forEach((x) => x.classList.toggle("on", x.dataset.mood === st.mood));
    }));
    el.querySelector("#date").onchange = (e) => { st.date = e.target.value || today(); hint(); };
    el.querySelector("#tax")?.addEventListener("change", (e) => (st.tax = e.target.checked));
    const nl = el.querySelector("#nl");
    const nlgo = el.querySelector("#nlgo");
    if (nl && nlgo) {
      nl.oninput = () => (st.nl = nl.value);
      nl.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); nlgo.click(); } };
      nlgo.onclick = async () => {
        const text = nl.value.trim();
        if (!text) return toast("Type what you spent, like: 12 at Chipotle");
        nlgo.disabled = true;
        nlgo.lastChild.textContent = "Reading…";
        try {
          const r = await ai("parse", { text, today: today() });
          if (!r.ok || !r.entry) throw new AIError("Couldn't find an amount in that. Try: 12 at Chipotle");
          const e = r.entry;
          Object.assign(st, { kind: e.kind === "income" ? "income" : "expense", refund: e.kind === "refund", amt: String(e.amount), note: e.merchant, cat: e.cat, catTouched: true, mood: e.mood || null, date: e.date || today(), nl: "" });
          sh.render();
          toast("Filled in. Check it, then tap Log it.");
        } catch (err) {
          nlgo.disabled = false;
          nlgo.lastChild.textContent = "Fill in";
          toast(err instanceof AIError ? err.message : "Claude couldn't read that. Try again.");
        }
      };
    }
    el.querySelector("#save").onclick = save;
    el.querySelector("#del")?.addEventListener("click", async () => {
      if (await confirmSheet("Delete this?", `${money(editing.amount)} ${editing.note || ""}`)) {
        remove("tx", editing.id);
        forgetTax(editing.id);
        sh.close();
        toast("Deleted");
      }
    });
    hint();
  };
  sh.render();

  // typing on a keyboard works too (desktop / iPad)
  const onKey = (e) => {
    if (e.target.matches("input, textarea, select, button") || topSheet() !== sh) return;
    const k = e.key === "Backspace" ? "⌫" : e.key;
    if (/^[0-9.]$/.test(k) || k === "⌫") {
      st.amt = pressKey(st.amt, k);
      sh.el.querySelector("#amt").innerHTML = amountHTML(st.amt);
      hint();
    } else if (e.key === "Enter") { e.preventDefault(); save(); }
  };
  document.addEventListener("keydown", onKey);
  const origClose = sh.close;
  sh.close = () => { document.removeEventListener("keydown", onKey); origClose(); };

  let saved = false;
  function save() {
    if (saved) return;
    const a = round2(parseFloat(st.amt) || 0);
    if (!a) { toast("Enter an amount"); return; }
    const before = compute(s());
    const now = new Date();
    const h = now.getHours();
    const tx = {
      ...(editing || {}),
      id: editing?.id || uid(),
      kind: st.kind,
      amount: st.refund ? -a : a,
      note: st.note.trim(),
      cat: st.kind === "income" ? "income" : st.cat || guessCategory(s(), st.note) || "other",
      mood: st.kind === "expense" && !st.refund ? st.mood : null,
      date: st.date,
      source: editing?.source || "manual",
      review: false,
    };
    if (!editing) { tx.ts = Date.now(); tx.late = st.date === today() && (h >= 22 || h < 4); }
    saved = true;
    put("tx", tx);
    // Editing contract pay keeps its tax set-aside in step (or drops it if it's no longer income).
    if (editing && taxFor(tx.id)) {
      const t = taxFor(tx.id);
      if (tx.kind !== "income") forgetTax(tx.id);
      else put("tx", { id: t.id, amount: round2((a * (Number(t.taxPct) || taxPct())) / 100), date: tx.date });
    }
    haptic(12);
    sh.close();
    if (!editing && st.kind === "expense" && !st.refund) {
      const after = compute(s());
      const msg = after.leftToday >= 0 ? `Logged. ${money(after.leftToday)} left today` : `Logged. ${money(-after.leftToday)} over today`;
      toast(msg, { label: "Undo", run: () => remove("tx", tx.id) });
      prefill.onDone?.(tx, before, after);
    } else if (!editing && st.kind === "income" && st.tax && taxPct() > 0) {
      const aside = round2((a * taxPct()) / 100);
      put("tx", { id: `tax:${tx.id}`, kind: "save", amount: aside, goalId: taxGoal().id, taxFor: tx.id, taxPct: taxPct(), note: `Tax set-aside from ${tx.note || "contract pay"}`, date: st.date, ts: Date.now() + 1, source: "manual" });
      toast(`Logged ${money(a)}. ${money(aside)} set aside for taxes, ${money(a - aside)} is yours to spend.`, { label: "Undo", run: () => { remove("tx", tx.id); forgetTax(tx.id); } });
    } else toast(editing ? "Saved" : "Logged");
  }
  return sh;
}

/* ---------- Can I afford it? ---------- */
export function openAfford(prefill = {}) {
  const st = { amt: prefill.price ? String(prefill.price) : "", name: prefill.name || "", cat: prefill.cat || null, step: prefill.price ? "verdict" : "ask" };
  const sh = sheet(() => (st.step === "ask" ? askHTML() : verdictHTML()));

  function askHTML() {
    return `<h3>Thinking of buying something?<button data-close>Cancel</button></h3>
      <p class="muted" style="margin:-6px 0 6px">Check before you tap. See what it really costs you.</p>
      <div class="amount-display num" id="amt">${amountHTML(st.amt)}</div>
      <label class="f"><input class="in" id="what" placeholder="What is it? (optional)" value="${esc(st.name)}" autocomplete="off"></label>
      <div class="chips scroll" id="cats">${catOrder().map((c) => chip(catLook(c).icon, c.name, st.cat === c.id, `data-cat="${c.id}"`, catLook(c).color)).join("")}</div>
      ${keypadHTML()}
      <button class="btn primary block" id="check">Check it</button>`;
  }

  function verdictHTML() {
    const r = impact(s(), parseFloat(st.amt) || 0, st.cat);
    const rules = live(s().rules).filter((x) => !x.cat || x.cat === st.cat);
    const head = { fits: "It fits", tight: "It's tight", no: "Not right now" }[r.verdict];
    const headIc = { fits: "circle-check", tight: "triangle-alert", no: "ban" }[r.verdict];
    const lines = [];
    if (r.pool < 0) lines.push(["triangle-alert", `You're already <b>${money(-r.pool)}</b> short for bills before ${r.scheduled ? "payday" : pretty(r.end)}. This would make it ${money(-r.poolAfter)}.`]);
    else if (r.leftAfter >= 0) lines.push(["wallet", `Leaves <b>${money(r.leftAfter)}</b> of today's ${money(r.dailyBase)}`]);
    else lines.push(["trending-down", `Puts you <b>${money(r.overToday)}</b> over today. ${r.dailyAfter != null ? `Every day until ${pretty(r.end)} drops to <b>${money(r.dailyAfter)}</b> (from ${money(r.tomorrowDaily ?? r.dailyBase)})` : (r.scheduled ? "That's the end of your money until next payday" : "That's the end of your money until your end date")}`]);
    if (r.hours != null) lines.push(["clock", `That's <b>${hoursText(r.hours)}</b> at ${money(s().settings.wage)}/hr`]);
    else if (r.budgetDays != null && r.budgetDays >= 0.25) lines.push(["calendar-days", `That's <b>${costFrame(r.price)}</b>`]);
    if (r.budget) lines.push(["receipt-text", r.budget.leftAfter >= 0 ? `${esc(r.budget.name)}: ${money(r.budget.leftAfter)} left this month after` : `${esc(r.budget.name)}: <b>${money(-r.budget.leftAfter)} over</b> this month's budget`]);
    if (r.goal && r.goal.pct >= 2) lines.push(["target", `Same as <b>${r.goal.pct}%</b> of your ${esc(r.goal.name)} goal`]);
    if (r.poolAfter < 0 && r.pool >= 0) lines.push(["ban", `You'd be <b>${money(-r.poolAfter)}</b> short for bills before ${r.scheduled ? "payday" : pretty(r.end)}`]);
    const cool = Number(s().settings.coolHours) || 48;
    return `<h3>${st.name ? esc(st.name) : "This purchase"}, ${money(r.price)}<button data-close>Close</button></h3>
      <div class="verdict ${r.verdict}"><div class="head">${ic(headIc, { size: 26, stroke: 2 })}<span>${head}</span></div><ul>${lines.map(([n, t]) => `<li>${ic(n, { size: 18 })}<span>${t}</span></li>`).join("")}</ul></div>
      ${rules.length ? `<div class="card warn"><div class="small" style="font-weight:700;margin-bottom:4px">Your rules</div>${rules.map((x) => `<div>“${esc(x.text)}”</div>`).join("")}</div>` : ""}
      <div class="stack">
        <button class="btn ${r.verdict === "fits" ? "ghost" : "primary"} block" id="wait">${ic("hourglass", { size: 18 })}Wait ${cool} hours first</button>
        <button class="btn ghost block" id="skip">Skip it, count it as saved</button>
        <button class="btn ${r.verdict === "fits" ? "primary" : "ghost"} block" id="buy">I'm buying it, log it</button>
      </div>
      <p class="tiny faint" style="text-align:center;margin-top:12px">Most urges fade within a day or two. Waiting is free.</p>`;
  }

  sh.bind = (el) => {
    el.querySelector("[data-close]").onclick = () => sh.close();
    if (st.step === "ask") {
      el.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { st.amt = pressKey(st.amt, b.dataset.k); el.querySelector("#amt").innerHTML = amountHTML(st.amt); haptic(5); }));
      el.querySelector("#what").oninput = (e) => {
        st.name = e.target.value;
        const g = guessCategory(s(), st.name);
        if (g && !st.catPicked) { st.cat = g; el.querySelectorAll("[data-cat]").forEach((x) => x.classList.toggle("on", x.dataset.cat === g)); }
      };
      el.querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => { st.cat = st.cat === b.dataset.cat ? null : b.dataset.cat; st.catPicked = true; el.querySelectorAll("[data-cat]").forEach((x) => x.classList.toggle("on", x.dataset.cat === st.cat)); }));
      el.querySelector("#check").onclick = () => { if (!(parseFloat(st.amt) > 0)) return toast("Enter a price"); st.step = "verdict"; sh.render(); };
    } else {
      const price = round2(parseFloat(st.amt));
      el.querySelector("#wait").onclick = () => {
        const hrs = Number(s().settings.coolHours) || 48;
        put("wish", { id: prefill.wishId || uid(), name: st.name || "Something", price, cat: st.cat, status: "waiting", added: Date.now(), unlockAt: Date.now() + hrs * 3600000 });
        sh.close();
        toast(`On your waitlist. Check back ${hrs >= 24 ? `in ${Math.round(hrs / 24)} day${hrs >= 48 ? "s" : ""}` : `in ${hrs} hours`}.`);
      };
      el.querySelector("#skip").onclick = () => { skipItem({ id: prefill.wishId, name: st.name, price, cat: st.cat }); sh.close(); };
      el.querySelector("#buy").onclick = () => {
        if (prefill.wishId) put("wish", { id: prefill.wishId, status: "bought", decidedDay: today() });
        sh.close();
        put("tx", { id: uid(), kind: "expense", amount: price, note: st.name, cat: st.cat || guessCategory(s(), st.name) || "other", date: today(), ts: Date.now(), source: "manual", mood: "treat" });
        const c = compute(s());
        toast(c.leftToday >= 0 ? `Logged. ${money(c.leftToday)} left today` : `Logged. ${money(-c.leftToday)} over today`);
      };
    }
  };
  sh.render();
  return sh;
}

// "Skip it": counts toward money you've resisted, and offers to move it into a goal.
export function skipItem({ id, name, price, cat }) {
  put("wish", { id: id || uid(), name: name || "Impulse buy", price, cat, status: "skipped", decidedDay: today(), added: Date.now() });
  const goal = live(s().goals).find((g) => g.type !== "stretch" && !g.taxes);
  haptic(20);
  if (goal) toast(`Nice. ${money(price)} not spent.`, { label: `Save to ${goal.name}`, run: () => { put("tx", { id: uid(), kind: "save", amount: price, goalId: goal.id, note: `Skipped ${name || "a buy"}`, date: today(), ts: Date.now(), source: "manual" }); toast(`${money(price)} moved to ${goal.name}`); } });
  else toast(`Nice. ${money(price)} not spent.`);
}

/* ---------- generic form sheet (Plan uses this for bills, income, goals, budgets, rules) ---------- */
export function formSheet({ title, fields, value = {}, onSave, onDelete, saveLabel = "Save", note, deleteLabel = "Delete", confirmDelete = true, extra = "", onBind }) {
  const v = { ...value };
  const cur = esc(s().settings.currency || "$");
  const fieldHTML = (f) => {
    const val = v[f.key] ?? f.default ?? "";
    if (f.show && !f.show(v)) return "";
    const lab = `<span>${esc(f.label)}</span>`;
    if (f.type === "money") return `<label class="f">${lab}<div class="in-money" data-cur="${cur}"><input class="in num" data-f="${f.key}" type="text" inputmode="decimal" value="${val === "" ? "" : esc(val)}" placeholder="${esc(f.placeholder || "0")}"></div>${f.help ? `<div class="tiny faint" style="margin:4px 4px 0">${f.help}</div>` : ""}</label>`;
    if (f.type === "select") return `<label class="f">${lab}<select class="in" data-f="${f.key}">${f.options.map(([k, l]) => `<option value="${esc(k)}" ${String(val) === String(k) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
    if (f.type === "date") return `<label class="f">${lab}<input class="in" data-f="${f.key}" type="date" value="${esc(val)}">${f.help ? `<div class="tiny faint" style="margin:4px 4px 0">${f.help}</div>` : ""}</label>`;
    if (f.type === "number") return `<label class="f">${lab}<input class="in num" data-f="${f.key}" type="text" inputmode="decimal" value="${esc(val)}" placeholder="${esc(f.placeholder || "")}">${f.help ? `<div class="tiny faint" style="margin:4px 4px 0">${f.help}</div>` : ""}</label>`;
    if (f.type === "toggle") return `<label class="switch"><span>${esc(f.label)}${f.help ? `<div class="tiny faint">${f.help}</div>` : ""}</span><input type="checkbox" data-f="${f.key}" ${val ? "checked" : ""}></label>`;
    if (f.type === "icon") return `<label class="f">${lab}<div class="chips">${f.options.map((e) => `<button type="button" class="chip-btn icon-only ${val === e ? "on" : ""}" data-iconpick="${f.key}" data-v="${e}" aria-label="${e.replace(/-/g, " ")}" aria-pressed="${val === e}">${ic(e, { size: 20 })}</button>`).join("")}</div></label>`;
    return `<label class="f">${lab}<input class="in" data-f="${f.key}" type="text" value="${esc(val)}" placeholder="${esc(f.placeholder || "")}" ${f.max ? `maxlength="${f.max}"` : ""}></label>`;
  };
  const sh = sheet(() => `<h3>${esc(title)}<button data-close>Cancel</button></h3>
    ${note ? `<p class="muted small" style="margin:-6px 4px 14px">${note}</p>` : ""}
    ${fields.map(fieldHTML).join("")}
    ${extra}
    <button class="btn primary block" id="save">${esc(saveLabel)}</button>
    ${onDelete ? `<button class="btn danger block" id="del" style="margin-top:10px">${esc(deleteLabel)}</button>` : ""}`);
  const read = () => {
    sh.el.querySelectorAll("[data-f]").forEach((i) => {
      const f = fields.find((x) => x.key === i.dataset.f);
      if (!f) return;
      if (f.type === "toggle") v[f.key] = i.checked;
      else if (f.type === "money" || f.type === "number") v[f.key] = i.value.trim() === "" ? "" : round2(parseFloat(i.value.replace(/[^\d.-]/g, "")) || 0);
      else v[f.key] = i.value;
    });
  };
  sh.bind = (el) => {
    el.querySelector("[data-close]").onclick = () => sh.close();
    el.querySelectorAll("[data-iconpick]").forEach((b) => (b.onclick = () => { read(); v[b.dataset.iconpick] = b.dataset.v; sh.render(); }));
    el.querySelectorAll("select[data-f], input[type=checkbox][data-f]").forEach((i) => (i.onchange = () => { read(); if (fields.some((f) => f.show)) sh.render(); }));
    el.querySelector("#save").onclick = () => {
      read();
      for (const f of fields) if (f.required && (!f.show || f.show(v)) && (v[f.key] === "" || v[f.key] == null)) { toast(`Add ${f.label.toLowerCase()}`); return; }
      if (onSave(v) !== false) sh.close();
    };
    el.querySelector("#del")?.addEventListener("click", async () => {
      if (!confirmDelete || (await confirmSheet(`Delete ${title.replace(/^(Edit|New) /, "")}?`, "This can't be undone."))) { onDelete(); sh.close(); }
    });
    onBind?.(el);
  };
  sh.render();
  return sh;
}

/* ---------- reconcile with the bank ---------- */
export function openBalanceCheck() {
  const c = compute(s());
  // Stretch-fund money always sits in checking; only regular goals can live in a separate savings account.
  const inStretch = round2(live(s().goals).filter((g) => g.type === "stretch").reduce((t, g) => t + goalSaved(s(), g.id), 0));
  const inRegular = round2(live(s().goals).filter((g) => g.type !== "stretch").reduce((t, g) => t + goalSaved(s(), g.id), 0));
  const inGoals = round2(inStretch + inRegular);
  formSheet({
    title: "Match my bank",
    note: `The app thinks you have <b>${money(c.cash + inStretch + (s().settings.goalsSeparate ? 0 : inRegular))}</b>${inGoals > 0 ? ` (including ${money(inStretch + (s().settings.goalsSeparate ? 0 : inRegular))} set aside for goals and stretch funds)` : ""}. What do your checking account and cash add up to right now? We'll fix the difference.`,
    fields: [
      { key: "amount", label: "Checking + cash right now", type: "money", required: true },
      ...(inGoals > 0 ? [{ key: "goalsSeparate", label: "My goal money is in a separate savings account", type: "toggle", default: !!s().settings.goalsSeparate }] : []),
    ],
    saveLabel: "Update balance",
    onSave: (v) => {
      if (v.goalsSeparate !== undefined && v.goalsSeparate !== !!s().settings.goalsSeparate) setSettings({ goalsSeparate: v.goalsSeparate });
      const target = v.amount - inStretch - (s().settings.goalsSeparate ? 0 : inRegular);
      const diff = round2(target - compute(s()).cash);
      if (Math.abs(diff) < 0.005) { toast("Already matches your bank"); return; }
      put("tx", { id: uid(), kind: "adjust", amount: diff, note: "Balance check", cat: "adjust", date: today(), ts: Date.now(), source: "manual" });
      toast(diff < 0 ? `Adjusted by ${money(diff)}. Untracked spending?` : `Adjusted by ${money(diff, { sign: true })}`);
    },
  });
}

export { catById };
export const markAll = () => commit();
