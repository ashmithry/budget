// Paste past transactions (copied from your bank app or a statement) and Claude turns them into history.
// Imported purchases fill Insights and the cool-down screens but never change your balance:
// that money is already gone and reflected in what you told the app you have.
import { get, commit } from "../store.js";
import { today } from "../dates.js";
import { live, catById, round2 } from "../engine.js";
import { sheet, esc, money, ic, toast, plural } from "../ui.js";
import { ai, AIError } from "../ai.js";

// Split long pastes into chunks Claude can read in one go, on line boundaries.
function chunks(text, max = 3500) {
  const out = [];
  let cur = "";
  for (const line of text.split(/\r?\n/)) {
    if ((cur + line).length > max && cur) { out.push(cur); cur = ""; }
    cur += line + "\n";
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// Bank text is noisy ("SQ *BOBA GUYS 0423" vs "Boba Guys"), so compare merchants loosely.
const normMerchant = (s) => String(s || "").toLowerCase().replace(/^(sq|tst|sp|pp|py)\s*\*\s*/, "").replace(/[^a-z]/g, "");
const dayNum = (d) => Math.round(Date.parse(d + "T12:00:00Z") / 864e5);
// Signed amount as it would be stored: expenses positive, refunds negative, income its own kind.
const asStored = (x) => ({ kind: x.kind === "income" ? "income" : "expense", amount: x.kind === "refund" ? -Math.abs(x.amount) : Math.abs(x.amount) });
const sameMerchant = (a, b) => {
  const x = normMerchant(a), y = normMerchant(b);
  if (!x || !y) return true;
  const n = Math.min(x.length, y.length, 8);
  return x.includes(y.slice(0, n)) || y.includes(x.slice(0, n));
};

// Drop what's already in the app (logged by hand or by an earlier import) and repeats inside the paste.
// Each existing transaction can only cancel out one imported line.
function dedupe(found, existing) {
  const pool = existing.map((t) => ({ kind: t.kind, amount: Number(t.amount), date: t.date, name: t.note || "", used: false }));
  const fresh = [];
  const seen = new Set();
  for (const x of found) {
    const s = asStored(x);
    const k = `${x.date}|${s.kind}|${round2(s.amount)}|${normMerchant(x.merchant)}`;
    if (seen.has(k)) continue;
    const hit = pool.find((t) => !t.used && t.kind === s.kind && Math.abs(t.amount - s.amount) <= 0.01 && Math.abs(dayNum(t.date) - dayNum(x.date)) <= 2 && sameMerchant(t.name, x.merchant));
    if (hit) { hit.used = true; continue; }
    seen.add(k);
    fresh.push(x);
  }
  return fresh;
}

export function openImport() {
  const st = { step: "paste", text: "", found: [], progress: "" };
  const sh = sheet(() => {
    if (st.step === "paste") return `<h3>Import past purchases<button data-close>Cancel</button></h3>
      <p class="small muted" style="margin:-6px 2px 12px">Copy your last month of transactions from your bank or card app (or a statement) and paste it below. Messy is fine. Claude reads it. This history powers Insights and the cool-down screens; it doesn't change your balance.</p>
      <textarea class="in" id="paste" rows="9" placeholder="11/02  SQ *BOBA GUYS  $7.25&#10;11/02  DOORDASH*CHIPOTLE  $18.40&#10;…" style="font-size:14px;line-height:1.4">${esc(st.text)}</textarea>
      <button class="btn primary block" id="read" style="margin-top:12px">${ic("clipboard-paste", { size: 18 })}Read it with Claude</button>
      <p class="tiny faint" style="margin:10px 2px 0">Only the text you paste is sent to Claude, once. Account numbers aren't needed, so feel free to delete them first.</p>`;
    if (st.step === "reading") return `<h3>Reading your history…</h3><div class="empty"><span class="empty-ic">${ic("clipboard-paste", { size: 26, stroke: 1.5 })}</span><div>${esc(st.progress)}</div></div>`;
    const spend = st.found.filter((x) => x.kind === "expense");
    const total = round2(spend.reduce((a, x) => a + x.amount, 0));
    const byCat = {};
    for (const x of spend) byCat[x.cat] = round2((byCat[x.cat] || 0) + x.amount);
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 4);
    return `<h3>Found ${plural(st.found.length, "transaction")}<button data-close>Cancel</button></h3>
      <div class="card"><div class="row between"><span class="muted">Spent</span><b class="num">${money(total)}</b></div>
        ${top.map(([c, v]) => `<div class="row between small"><span>${esc(catById(get(), c).name)}</span><span class="num">${money(v)}</span></div>`).join("")}
        ${st.dupes ? `<div class="tiny faint" style="margin-top:6px">${plural(st.dupes, "duplicate")} of things already in the app left out.</div>` : ""}</div>
      <div class="list" style="max-height:34dvh;overflow:auto">${st.found.slice(0, 80).map((x) => `<div class="item"><div class="main"><div class="name">${esc(x.merchant)}</div><div class="meta">${esc(x.date)}, ${x.kind === "income" ? "Income" : x.kind === "refund" ? "Refund" : esc(catById(get(), x.cat).name)}</div></div><div class="amt num ${x.kind !== "expense" ? "pos" : ""}">${x.kind !== "expense" ? "+" : ""}${money(x.amount)}</div></div>`).join("")}${st.found.length > 80 ? `<div class="item"><div class="meta">and ${st.found.length - 80} more</div></div>` : ""}</div>
      <button class="btn primary block" id="add" ${st.found.length ? "" : "disabled"}>Add ${plural(st.found.length, "transaction")} to my history</button>
      <button class="btn ghost block" id="again" style="margin-top:8px">Paste something else</button>`;
  });
  sh.bind = (el) => {
    el.querySelector("[data-close]")?.addEventListener("click", () => sh.close());
    const ta = el.querySelector("#paste");
    if (ta) ta.oninput = () => (st.text = ta.value);
    el.querySelector("#read")?.addEventListener("click", async () => {
      const text = st.text.trim();
      if (text.length < 10) return toast("Paste some transactions first");
      const parts = chunks(text);
      st.step = "reading";
      const found = [];
      let failed = 0;
      let lastErr = null;
      for (let i = 0; i < parts.length; i++) {
        st.progress = parts.length > 1 ? `Part ${i + 1} of ${parts.length}…` : "This takes a few seconds.";
        sh.render();
        try {
          const r = await ai("import", { text: parts[i], today: today() });
          found.push(...(r.transactions || []));
        } catch (e) {
          failed++;
          lastErr = e;
          if (e instanceof AIError && /limit|key|connected/i.test(e.message)) break;
        }
      }
      if (!found.length) {
        st.step = "paste";
        sh.render();
        return toast(!failed ? "Didn't find any purchases in that text." : lastErr instanceof AIError ? lastErr.message : "Claude couldn't read that. Try a smaller chunk.");
      }
      if (failed) toast(`Couldn't read ${plural(failed, "part")} of the paste. Showing the rest.`);
      const fresh = dedupe(found, live(get().tx));
      st.dupes = found.length - fresh.length;
      st.found = fresh.sort((a, b) => (a.date < b.date ? 1 : -1));
      st.step = "review";
      sh.render();
    });
    el.querySelector("#again")?.addEventListener("click", () => { st.step = "paste"; sh.render(); });
    el.querySelector("#add")?.addEventListener("click", () => {
      const s = get();
      const now = Date.now();
      st.found.forEach((x, i) => {
        s.tx.push({
          id: `imp:${now.toString(36)}:${i}`,
          kind: x.kind === "income" ? "income" : "expense",
          amount: x.kind === "refund" ? -x.amount : x.amount,
          note: x.merchant,
          cat: x.kind === "income" ? "income" : x.cat,
          date: x.date,
          ts: now + i,
          updatedAt: now,
          source: "import",
          imported: true,
        });
      });
      commit();
      sh.close();
      toast(`Added ${plural(st.found.length, "transaction")}. Check Insights to see where it went.`);
      location.hash = "#/insights";
    });
  };
  sh.render();
}
