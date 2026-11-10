// Cool-down before a food / coffee / boba purchase: a few minutes to reconsider, with your own numbers
// in front of you. "Buy anyway" stays locked until the timer runs out. Skipping is celebrated.
import { get, put } from "./store.js";
import { today } from "./dates.js";
import { compute, impact, categoryStats, catById, live, uid, round2, weekly, isWeekly } from "./engine.js";
import { esc, money, ic, costFrame, toast, haptic, catLook } from "./ui.js";
import { ai } from "./ai.js";

export const DEFAULT_PAUSE = { coffee: 10, food: 10 };
// Minutes to wait before buying in this category (0 = no cool-down; bigger buys use the waitlist instead).
export function pauseMinutes(cat, st = get()) {
  const p = st.settings.pause || DEFAULT_PAUSE;
  return Number(p[cat] ?? 0) || 0;
}

// Starts (or reopens) a cool-down. Returns the waitlist item that holds the timer.
export function startCooldown({ name, price, cat, minutes, wallet }) {
  const w = put("wish", { id: uid(), name: name || catById(get(), cat).name, price: round2(price), cat, wallet: wallet === "parents" ? "parents" : undefined, status: "waiting", short: true, added: Date.now(), unlockAt: Date.now() + minutes * 60000 });
  openCooldown(w.id);
  return w;
}

let open = null;
export function openCooldown(wishId) {
  open?.close();
  const st = get();
  const w = live(st.wish).find((x) => x.id === wishId);
  if (!w) return;
  const cat = catById(st, w.cat);
  const look = catLook(cat);
  const stats = categoryStats(st, w.cat);
  const r = impact(st, w.price, w.cat, today(), w.wallet || "mine");
  const who = w.wallet === "parents" ? "your parents' card" : "your card";
  const c = compute(st);
  const total = Math.max(1, Math.round((w.unlockAt - (w.added || Date.now())) / 1000));

  const el = document.createElement("div");
  el.className = "cooldown";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", `Cool-down before buying ${w.name}`);
  const cups = Math.min(stats.n, 40);
  const cards = [
    stats.n
      ? `<div class="cd-card"><div class="cd-stack" aria-hidden="true">${Array.from({ length: cups }, (_, i) => `<span style="animation-delay:${i * 60}ms">${ic(look.icon, { size: 18 })}</span>`).join("")}${stats.n > cups ? `<em>+${stats.n - cups}</em>` : ""}</div>
         <div class="cd-big">${stats.n} ${stats.n === 1 ? "time" : "times"} in 30 days</div><div class="cd-sub">${money(stats.total)} on ${esc(cat.name.toLowerCase())}${costFrame(stats.total) ? `, ${costFrame(stats.total)}` : ""}${stats.top && stats.top[1] > 1 ? `. ${esc(stats.top[0])} alone: ${stats.top[1]} times.` : "."}</div></div>`
      : "",
    `<div class="cd-card"><div class="cd-big">${money(w.price)} is ${costFrame(w.price) || "real money"}</div><div class="cd-sub">${r.week && r.week.limit > 0 ? (r.week.leftAfter >= 0 ? `Buy it and you have ${money(r.week.leftAfter)} left this week on ${who}, with ${r.week.daysLeftInWeek} ${r.week.daysLeftInWeek === 1 ? "day" : "days"} to go.` : `Buy it and you're ${money(-r.week.leftAfter)} over this week on ${who}.`) + ` Skip it and you keep ${money(r.week.leftBefore)}.` : r.leftAfter >= 0 ? `Buy it and you have ${money(r.leftAfter)} left for today.` : `Buy it and you're ${money(-r.leftAfter)} over today; every day until ${esc(r.end.slice(5).replace("-", "/"))} drops to ${money(r.dailyAfter ?? 0)}.`}${r.week && r.week.limit > 0 ? "" : ` Skip it and you keep ${money(c.leftToday)} for today.`}</div></div>`,
    stats.rated
      ? `<div class="cd-card"><div class="cd-big">You regretted ${stats.regretted} of ${stats.rated}</div><div class="cd-sub">That's your own rating of your recent ${esc(cat.name.toLowerCase())} buys.</div></div>`
      : stats.late
        ? `<div class="cd-card"><div class="cd-big">${stats.late} of them were after 10pm</div><div class="cd-sub">Late-night buys are the ones people regret most.</div></div>`
        : "",
    `<div class="cd-card cd-claude" id="cd-claude"><div class="cd-sub">Thinking about your numbers…</div></div>`,
  ].filter(Boolean);

  el.innerHTML = `<div class="cd-inner">
    <div class="cd-top"><span class="tile" style="--c:${look.color}">${ic(look.icon, { size: 19 })}</span><div><div class="cd-title">Hold on.</div><div class="cd-what">${esc(w.name)}, ${money(w.price)}</div></div></div>
    <div class="cd-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="bg" cx="60" cy="60" r="52"/><circle class="fg" id="cd-arc" cx="60" cy="60" r="52"/></svg><div class="cd-time num" id="cd-time" aria-live="polite">--:--</div></div>
    <div class="cd-cards" id="cd-cards">${cards.map((h, i) => `<div class="cd-slide ${i === 0 ? "on" : ""}">${h}</div>`).join("")}</div>
    <div class="cd-dots">${cards.map((_, i) => `<i class="${i === 0 ? "on" : ""}"></i>`).join("")}</div>
    <div class="cd-actions">
      <button class="btn good block" id="cd-skip">${ic("piggy-bank", { size: 19 })}Skip it, keep ${money(w.price)}</button>
      <button class="btn block" id="cd-buy" disabled>${ic("lock-open", { size: 18 })}<span id="cd-buy-t">Buy anyway</span></button>
      <button class="btn sm ghost" id="cd-leave">Leave the timer running</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));

  const arc = el.querySelector("#cd-arc");
  const C = 2 * Math.PI * 52;
  arc.style.strokeDasharray = C;
  const timeEl = el.querySelector("#cd-time");
  const buy = el.querySelector("#cd-buy");
  const buyT = el.querySelector("#cd-buy-t");
  function tick() {
    const ms = Math.max(0, w.unlockAt - Date.now());
    const sLeft = Math.ceil(ms / 1000);
    timeEl.textContent = `${Math.floor(sLeft / 60)}:${String(sLeft % 60).padStart(2, "0")}`;
    arc.style.strokeDashoffset = C * (1 - sLeft / total);
    if (ms <= 0) {
      buy.disabled = false;
      buyT.textContent = "Still want it? Buy it";
      el.classList.add("done");
      timeEl.textContent = "0:00";
    } else buyT.textContent = `Buy anyway (unlocks in ${Math.floor(sLeft / 60)}:${String(sLeft % 60).padStart(2, "0")})`;
  }
  tick();
  const timer = setInterval(tick, 1000);

  // rotate the reality cards
  let idx = 0;
  const show = (i) => {
    const slides = [...el.querySelectorAll(".cd-slide")];
    const dots = [...el.querySelectorAll(".cd-dots i")];
    if (!slides.length) return;
    idx = (i + slides.length) % slides.length;
    slides.forEach((s, j) => s.classList.toggle("on", j === idx));
    dots.forEach((d, j) => d.classList.toggle("on", j === idx));
  };
  // If Claude has nothing to say, take its card and its dot out of the rotation.
  const dropClaude = () => {
    const slide = el.querySelector("#cd-claude")?.closest(".cd-slide");
    if (!slide) return;
    const at = [...el.querySelectorAll(".cd-slide")].indexOf(slide);
    slide.remove();
    el.querySelectorAll(".cd-dots i")[at]?.remove();
    show(idx > at ? idx - 1 : idx);
  };
  const rotator = setInterval(() => show(idx + 1), 6500);
  el.querySelector("#cd-cards").onclick = () => show(idx + 1);

  // Claude's line, from their own numbers (skipped quietly if Claude isn't available)
  ai("nudge", { purchase: { item: w.name, price: w.price, category: cat.name, currency: st.settings.currency || "$", last30Days: stats, costInDaysOfBudget: costFrame(w.price), safeToSpendToday: c.leftToday, dailyNumber: c.dailyBase, daysLeft: c.daysLeft } })
    .then((res) => {
      const box = el.querySelector("#cd-claude");
      if (box && res.ok && res.line) box.innerHTML = `<div class="cd-quote">“${esc(res.line)}”</div><div class="cd-sub">Claude, looking at your numbers</div>`;
      else dropClaude();
    })
    .catch(dropClaude);

  function close() {
    clearInterval(timer);
    clearInterval(rotator);
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
    open = null;
  }
  open = { close };

  el.querySelector("#cd-leave").onclick = () => { close(); toast("Timer's still running. It's on your Today screen."); };
  el.querySelector("#cd-skip").onclick = () => {
    put("wish", { id: w.id, status: "skipped", decidedDay: today() });
    haptic(30);
    celebrate(el, w.price);
    setTimeout(close, 1900);
  };
  buy.onclick = () => {
    if (buy.disabled) return;
    put("wish", { id: w.id, status: "bought", decidedDay: today() });
    put("tx", { id: uid(), kind: "expense", amount: w.price, wallet: w.wallet, note: w.name, cat: w.cat, date: today(), ts: Date.now(), source: "manual" });
    close();
    const after = compute(get());
    const s2 = categoryStats(get(), w.cat);
    const wl = isWeekly(get()) ? weekly(get())[w.wallet === "parents" ? "parents" : "mine"] : null;
    toast(`Logged. That's ${s2.n} ${cat.name.toLowerCase()} buys in 30 days (${money(s2.total)}). ${wl && wl.limit > 0 ? (wl.left >= 0 ? `${money(wl.left)} left this week.` : `${money(-wl.left)} over this week.`) : after.leftToday >= 0 ? `${money(after.leftToday)} left today.` : `${money(-after.leftToday)} over today.`}`);
  };
}

// Coins fly into the piggy bank: skipping should feel like winning.
function celebrate(el, amount) {
  const box = document.createElement("div");
  box.className = "cd-win";
  box.innerHTML = `<div class="cd-coins" aria-hidden="true">${Array.from({ length: 12 }, (_, i) => `<span style="--x:${(i % 6) * 18 - 45}px;--d:${i * 70}ms">${ic("circle-dollar-sign", { size: 22 })}</span>`).join("")}</div>
    <div class="cd-jar">${ic("piggy-bank", { size: 56, stroke: 1.5 })}</div><div class="cd-kept num">+${money(amount)} kept</div><div class="cd-sub">Nice. That's real money still in your account.</div>`;
  el.querySelector(".cd-inner").appendChild(box);
}
