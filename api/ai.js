// POST /api/ai  { t: LINK_TOKEN, task: "categorize" | "parse" | "checkin", ...input }
// Claude-powered helpers. Needs ANTHROPIC_API_KEY set on the Vercel project.
// Only what each task needs is sent: store names, one typed sentence, or a week's totals. Never the whole budget.
import Anthropic from "@anthropic-ai/sdk";
import { rpc, validToken, params } from "./_lib.js";

const MODEL = "claude-opus-5-5";
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const ID = /^[a-z0-9_-]{1,24}$/;
const MOODS = ["need", "treat", "bored", "stressed", "social", "hungry", "deal"];

// One structured-output call. Opus 5.5 always thinks; effort sets how much.
async function ask({ system, user, schema, effort = "low", maxTokens = 8000 }) {
  const r = await client.beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
  });
  if (r.stop_reason === "refusal") throw Object.assign(new Error("declined"), { status: 422 });
  if (r.stop_reason === "max_tokens") throw Object.assign(new Error("too long"), { status: 502 });
  const text = r.content.find((b) => b.type === "text")?.text;
  if (!text) throw Object.assign(new Error("empty answer"), { status: 502 });
  return JSON.parse(text);
}

function cleanCats(cats) {
  return (Array.isArray(cats) ? cats : [])
    .filter((c) => c && ID.test(String(c.id)))
    .slice(0, 40)
    .map((c) => ({ id: String(c.id), name: String(c.name || c.id).slice(0, 40) }));
}

async function categorize(p) {
  const cats = cleanCats(p.cats);
  const merchants = [...new Set((Array.isArray(p.merchants) ? p.merchants : []).map((m) => String(m).slice(0, 80)).filter(Boolean))].slice(0, 25);
  if (!cats.length || !merchants.length) return { results: [] };
  const ids = cats.map((c) => c.id);
  const out = await ask({
    system: "You sort card transactions for a college student's budget app into spending categories. Merchant strings come straight from Apple Pay and can be abbreviated or prefixed (e.g. 'SQ *', 'TST*', store numbers). Use your knowledge of real businesses. If you genuinely can't tell what a merchant sells, use 'other'.",
    user: `Categories (id: name):\n${cats.map((c) => `${c.id}: ${c.name}`).join("\n")}\n\nMerchants:\n${merchants.map((m, i) => `${i + 1}. ${m}`).join("\n")}`,
    schema: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: { type: "object", properties: { merchant: { type: "string" }, cat: { type: "string", enum: ids } }, required: ["merchant", "cat"], additionalProperties: false },
        },
      },
      required: ["results"],
      additionalProperties: false,
    },
  });
  return { results: (out.results || []).filter((r) => merchants.includes(r.merchant) && ids.includes(r.cat)) };
}

async function parse(p) {
  const cats = cleanCats(p.cats);
  const text = String(p.text || "").slice(0, 300).trim();
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(p.today)) ? String(p.today) : new Date().toISOString().slice(0, 10);
  if (!text || !cats.length) return { ok: false };
  const out = await ask({
    system: "You turn one sentence a student typed into a single budget entry. Amounts are in their local currency. 'got', 'paid me', 'payday' mean income; 'returned', 'refund' mean refund; everything else is spending. Dates are relative to today; default to today. Pick the mood only if the sentence says or clearly implies why they bought it, otherwise use an empty string.",
    user: `Today is ${today}.\nCategories (id: name):\n${cats.map((c) => `${c.id}: ${c.name}`).join("\n")}\nMoods: ${MOODS.join(", ")}\n\nSentence: ${text}`,
    schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["expense", "income", "refund"] },
        amount: { type: "number" },
        merchant: { type: "string" },
        cat: { type: "string", enum: cats.map((c) => c.id) },
        mood: { type: "string", enum: ["", ...MOODS] },
        date: { type: "string" },
      },
      required: ["kind", "amount", "merchant", "cat", "mood", "date"],
      additionalProperties: false,
    },
  });
  if (!(out.amount > 0) || out.amount > 100000) return { ok: false };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.date) || out.date > today) out.date = today;
  return { ok: true, entry: out };
}

async function checkin(p) {
  const w = p.week && typeof p.week === "object" ? p.week : null;
  if (!w) return { ok: false };
  const facts = JSON.stringify(w).slice(0, 4000);
  const out = await ask({
    effort: "medium",
    system: "You write a short weekly money check-in for a college student who wants to stop overspending. Be specific to their numbers, warm but direct, no lecturing, no generic tips. Mention one thing that went well if anything did. Plain sentences, no emoji, no lists. Amounts use the currency symbol given.",
    user: `This week's numbers (JSON):\n${facts}\n\nWrite: a headline under 8 words; a body of 2-3 sentences about what drove their spending; and one concrete, small thing to try next week tied to their actual pattern.`,
    schema: {
      type: "object",
      properties: { headline: { type: "string" }, body: { type: "string" }, tryThis: { type: "string" } },
      required: ["headline", "body", "tryThis"],
      additionalProperties: false,
    },
  });
  return { ok: true, checkin: { headline: String(out.headline).slice(0, 120), body: String(out.body).slice(0, 700), tryThis: String(out.tryThis).slice(0, 300) } };
}

const COACH = "You are the money coach inside a budgeting app for a full-time college student who is paid by contracts (irregular income) and is actively trying to break an overspending habit, especially on food delivery, eating out, coffee and boba. You see their real numbers. Be specific: quote their actual amounts, counts, merchants and dates. Be direct and a little blunt, with dry humor; it's fine to make them feel the cost of a habit, but never cruel, never moralizing about their character, no shame about necessities like groceries or rent. Plain sentences, no emoji, no markdown headings. Never invent transactions or numbers that aren't in the data.";

const clip = (v, n) => JSON.stringify(v ?? null).slice(0, n);

// Chat about the budget. The app sends a compact summary of the budget plus recent purchases.
async function chat(p) {
  const q = String(p.question || "").slice(0, 600).trim();
  if (!q) return { ok: false };
  const history = (Array.isArray(p.history) ? p.history : []).slice(-8).map((m) => `${m.role === "assistant" ? "You" : "Student"}: ${String(m.text || "").slice(0, 800)}`).join("\n");
  const out = await ask({
    effort: "medium",
    system: `${COACH} Answer the student's question using the budget data. Keep it under 120 words unless they ask for detail. When it helps, end with one concrete next step they can do in the app (set a daily limit, start a cool-down timer before buying, add a rule, put something on the waitlist, skip a category for a week). If they ask whether they can afford something, use their safe-to-spend today, daily number and days left, and say what it does to the rest of their days.`,
    user: `Budget data (JSON):\n${clip(p.context, 24000)}\n\n${history ? `Conversation so far:\n${history}\n\n` : ""}Student: ${q}`,
    schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false },
  });
  return { ok: true, answer: String(out.answer || "").slice(0, 2500) };
}

// Turn pasted bank/card history into transactions (one chunk at a time; the app splits long pastes).
async function importTx(p) {
  const cats = cleanCats(p.cats);
  const text = String(p.text || "").slice(0, 9000).trim();
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(p.today)) ? String(p.today) : new Date().toISOString().slice(0, 10);
  if (!text || !cats.length) return { ok: true, transactions: [] };
  const out = await ask({
    maxTokens: 16000,
    system: "You convert pasted bank or card statement text into transactions for a budgeting app. Each line or row may include a date, a description/merchant, and an amount; formats vary by bank (CSV, copied tables, app screenshots as text). Skip balances, headers, totals, pending holds that also appear posted, and transfers between the person's own accounts or to savings. Money out is 'expense'; money in from work, clients, family or Venmo is 'income'; returns are 'refund'. Clean merchant names (e.g. 'SQ *BOBA GUYS 0423' becomes 'Boba Guys'). Dates are YYYY-MM-DD; if the year is missing, use the most recent past date that fits given today.",
    user: `Today is ${today}.\nCategories (id: name):\n${cats.map((c) => `${c.id}: ${c.name}`).join("\n")}\n\nStatement text:\n${text}`,
    schema: {
      type: "object",
      properties: {
        transactions: {
          type: "array",
          items: {
            type: "object",
            properties: { date: { type: "string" }, merchant: { type: "string" }, amount: { type: "number" }, kind: { type: "string", enum: ["expense", "income", "refund"] }, cat: { type: "string", enum: cats.map((c) => c.id) } },
            required: ["date", "merchant", "amount", "kind", "cat"],
            additionalProperties: false,
          },
        },
      },
      required: ["transactions"],
      additionalProperties: false,
    },
  });
  const ok = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.date <= today && x.amount > 0 && x.amount < 100000;
  return { ok: true, transactions: (out.transactions || []).filter(ok).slice(0, 400).map((x) => ({ ...x, merchant: String(x.merchant).slice(0, 60) })) };
}

// The voice on the cool-down screen: one or two lines, specific to this purchase and their history.
async function nudge(p) {
  const out = await ask({
    system: `${COACH} The student is about to buy something and the app has made them wait a few minutes first. Write what a sharp friend who knows their numbers would say right now to talk them out of it, in 1-2 short sentences (max 40 words). Use their numbers for this category. If skipping clearly makes sense, say so plainly.`,
    user: `About to buy (JSON):\n${clip(p.purchase, 3000)}`,
    schema: { type: "object", properties: { line: { type: "string" } }, required: ["line"], additionalProperties: false },
  });
  return { ok: true, line: String(out.line || "").slice(0, 400) };
}

// "Reality check": what they actually spent and wasted recently, and what it could have been.
async function roast(p) {
  const out = await ask({
    effort: "medium",
    system: `${COACH} Write a reality check of their recent spending. Lead with the habit that cost the most. Receipts are short, punchy lines with exact numbers (e.g. "14 boba runs in 30 days: $93, about 8 days of your budget"). "Could have been" turns the avoidable total into concrete things a student would actually want. End with one rule that would have saved the most.`,
    user: `Their last ${Number(p.days) || 30} days (JSON):\n${clip(p.summary, 16000)}`,
    schema: {
      type: "object",
      properties: { headline: { type: "string" }, receipts: { type: "array", items: { type: "string" } }, couldHaveBeen: { type: "string" }, rule: { type: "string" } },
      required: ["headline", "receipts", "couldHaveBeen", "rule"],
      additionalProperties: false,
    },
  });
  return { ok: true, roast: { headline: String(out.headline).slice(0, 140), receipts: (out.receipts || []).slice(0, 5).map((r) => String(r).slice(0, 200)), couldHaveBeen: String(out.couldHaveBeen).slice(0, 300), rule: String(out.rule).slice(0, 200) } };
}

const TASKS = { categorize, parse, checkin, chat, import: importTx, nudge, roast };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "use POST" });
  if (!client) return res.status(503).json({ ok: false, error: "no_key" });
  const p = params(req);
  const run = TASKS[p.task];
  if (!run) return res.status(400).json({ ok: false, error: "unknown task" });
  if (!validToken(p.t)) return res.status(400).json({ ok: false, error: "bad token" });
  try {
    if (!(await rpc("budget_ai_ok", { p_token: p.t }))) return res.status(429).json({ ok: false, error: "limit" });
    return res.status(200).json(await run(p));
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ ok: false, error: "busy" });
    if (e instanceof Anthropic.AuthenticationError) return res.status(503).json({ ok: false, error: "bad_key" });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ ok: false, error: `claude ${e.status}` });
    return res.status(e.status || 500).json({ ok: false, error: e.message });
  }
}
