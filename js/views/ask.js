// "Ask Claude about my budget": a chat that sees your numbers and recent purchases.
// The conversation stays on this device (not synced).
import { get, commit } from "../store.js";
import { sheet, esc, ic, toast } from "../ui.js";
import { ai, AIError, budgetContext } from "../ai.js";

const SUGGESTIONS = [
  "Where did my money actually go this month?",
  "How much did I waste on food and boba?",
  "What daily limit gets me to my end date with $100 left?",
  "Can I afford a $40 concert this weekend?",
  "What's my worst habit right now?",
];

const chatLog = () => (get().meta.chat ||= []);

export function openAsk(prefill = "") {
  let busy = false;
  const sh = sheet(() => {
    const log = chatLog();
    return `<h3><span class="row" style="gap:10px"><span class="tile" style="--c:#2e6a47">${ic("message-circle", { size: 19 })}</span>Ask about your money</span><button data-close>Done</button></h3>
      <div class="chat" id="chat">
        ${log.length ? log.map((m) => `<div class="bubble ${m.role}">${esc(m.text).replace(/\n/g, "<br>")}</div>`).join("") : `<p class="muted small" style="margin:0 2px 10px">Claude sees your daily number, bills, goals and the last 45 days of purchases, and answers with your real numbers. Your budget data is sent only when you ask.</p>`}
        ${busy ? `<div class="bubble assistant typing"><i></i><i></i><i></i></div>` : ""}
      </div>
      ${log.length ? "" : `<div class="chips" style="margin:6px 0 12px">${SUGGESTIONS.map((q) => `<button type="button" class="chip-btn" data-q="${esc(q)}"><span>${esc(q)}</span></button>`).join("")}</div>`}
      <div class="ask-row"><textarea class="in" id="q" rows="1" placeholder="Ask anything about your spending" maxlength="600">${esc(prefill)}</textarea><button class="btn primary" id="send" aria-label="Send" ${busy ? "disabled" : ""}>${ic("send", { size: 18 })}</button></div>
      ${log.length ? `<button class="btn sm ghost" id="clear" style="margin-top:10px">Start over</button>` : ""}`;
  });
  async function send(text) {
    const q = String(text || "").trim();
    if (!q || busy) return;
    const log = chatLog();
    const history = log.slice(-8);
    log.push({ role: "user", text: q });
    busy = true;
    prefill = "";
    sh.render();
    try {
      const r = await ai("chat", { question: q, history, context: budgetContext() });
      log.push({ role: "assistant", text: r.ok ? r.answer : "I couldn't answer that one. Try asking it another way." });
    } catch (e) {
      log.pop();
      prefill = q;
      toast(e instanceof AIError ? e.message : "Claude couldn't answer right now. Try again.");
    }
    busy = false;
    get().meta.chat = log.slice(-30);
    commit({ sync: false, silent: true });
    sh.render();
  }
  sh.bind = (el) => {
    el.querySelector("[data-close]").onclick = () => sh.close();
    const q = el.querySelector("#q");
    const grow = () => { q.style.height = "auto"; q.style.height = Math.min(q.scrollHeight, 140) + "px"; };
    q.oninput = () => { prefill = q.value; grow(); };
    q.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(q.value); } };
    el.querySelector("#send").onclick = () => send(q.value);
    el.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => send(b.dataset.q)));
    el.querySelector("#clear")?.addEventListener("click", () => { get().meta.chat = []; commit({ sync: false, silent: true }); sh.render(); });
    const chat = el.querySelector("#chat");
    chat.lastElementChild?.scrollIntoView({ block: "end" });
    grow();
  };
  sh.render();
  return sh;
}
