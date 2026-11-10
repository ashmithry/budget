# Budget: safe to spend

A budgeting app for students who overspend. It shows one number, **what's safe to spend today**, after bills, savings and the days until your next money comes in. Around that number are speed bumps for impulse buys and as much automation as a phone allows.

Live: **https://budget.ashmithyaramada.com** (on iPhone: open in Safari → Share → **Add to Home Screen**).

Why each feature exists: see [RESEARCH.md](RESEARCH.md).

## Features

- **Safe to spend today**: (spendable money − bills due before payday − cushion) ÷ days until payday. Spend less and tomorrow goes up; overspend and you see exactly how much every remaining day drops.
- **Can I afford it?**: a pre-purchase check showing the verdict, impact on today and every remaining day, hours of work, category budget, goal trade-off and your rules. Then Wait / Skip / Buy.
- **Waitlist**: a 24/48/72h cooling-off timer and a "still want it?" card. Skipped buys count as **money not spent** and can go straight to a goal.
- **Fast logging**: keypad, merchant memory that auto-picks the category, and an optional "why" (bored, stressed, friends…).
- **Bills & subscriptions**: log themselves on the due date and are set aside ahead of time. Shows yearly cost in hours of work, a subscription check-up, and free-trial warnings.
- **Income & paydays**: auto-logged, with a one-tap fix if a check is different. Goals **auto-save each payday** (pay yourself first). Optional **round-ups**.
- **Stretch a lump sum**: aid refunds or scholarships are released weekly like a paycheck, so they last the semester.
- **Insights**: leaks (small repeat purchases with yearly cost), spending by trigger, regret rate, risky weekdays, late-night buys, week in review.
- **Worth it?**: rate bigger or unplanned purchases the next day so regret patterns show up.
- **My rules**: if-then rules you write, shown when you check a purchase.
- **Calendar**: no-spend days, under-limit days, over days. No-spend streak.
- **Match my bank** reconciliation, JSON export/import, light/dark.

### Automation & widgets (Automate screen in the app)
- **Apple Pay auto-log**: an iOS Shortcuts *Transaction* automation posts every Wallet tap to `/api/log`. The app files it next time it opens (known merchants silently, new ones in "Check these").
- **Home-screen + lock-screen widget** via the free Scriptable app (script generated in-app) from `/api/widget`. It updates with every Apple Pay tap, even before the app is opened.
- **One-tap "Log spend" widget**: a Shortcuts widget, also works with Siri, the Action Button and Back Tap.
- **Daily notifications**: Shortcuts time-of-day automations read `/api/widget?format=text`.
- **App-icon badge** = today's dollars left (iOS 16.4+ Home Screen apps).
- **Android**: long-press shortcuts (manifest), MacroDroid/Tasker → `/api/log`, KWGT → `/api/widget`.

### Stopping the spend
- **Daily limit:** cap your daily number below what the math allows; the rest stays in your account.
- **Cool-down timers:** food and coffee/boba (configurable per category: 5 to 30 min) make you wait before buying. A full-screen countdown shows your own 30-day spending in that category, the cost in days of budget, what skipping does to today, your regret record, and a note from Claude. "Buy anyway" unlocks only when the timer ends; skipping is celebrated.
- **Guilt line** after logging everyday buys: "That's 9 coffee & snacks buys in 30 days ($63)."
- **Contract / gig pay:** nothing is assumed to come in; you pick the date your money must last until; contract pay can auto set aside a tax %.

### Claude features (optional)
Needs `ANTHROPIC_API_KEY` set on the `budget` Vercel project (Settings › Environment Variables, Production), plus sync turned on in the app.
- **Sorts unknown Apple Pay stores:** after a sync, stores the app has never seen (e.g. "SQ *BLUE DOOR") are categorized by Claude and tagged "sorted by Claude". Only the store names are sent.
- **Type it out:** in Log spending, type "23 on pizza with friends" and tap Fill in. Only that sentence (plus your category names) is sent.
- **Weekly check-in** on Insights: a short read on what drove your week plus one thing to try, on demand. Only the week's totals are sent.
- **Ask about your money:** a chat (Home header, Insights) that sees your daily number, bills, goals and last 45 days of purchases.
- **Import past purchases:** paste text from your bank app; Claude turns it into history that powers Insights and the cool-downs (it never changes your balance).
- **Reality check:** your worst habits in the last 30 days with exact numbers, what the money could have been, and the one rule that would have saved the most.
- **Cool-down note:** a short, personal "think about it" line on the cool-down screen.

Runs on `claude-opus-5-5` (`api/ai.js`) with structured JSON output and Anthropic's default refusal fallback. Each call needs a valid budget link token and is capped at 120 calls a day per budget (`budget_ai_ok`), so the public endpoint can't run up the bill.

## Privacy & architecture

- Plain HTML/CSS/JS modules, no build step. Data lives on the device (`localStorage`). Works offline (service worker).
- **Optional sync is end-to-end encrypted.** A random sync key is generated on the device. From it come (1) an AES-256-GCM key that encrypts the whole budget before upload and (2) a token that identifies the cloud copy. The server only stores a hash of the token, the ciphertext, a tiny widget snapshot (today's numbers) and pending Shortcut logs.
- Storage: Supabase (`planner` project), tables `budget_vault` and `budget_inbox`, with RLS on and no policies. Access is only through the `budget_*` security-definer functions. See [`sql/budget.sql`](sql/budget.sql).
- Merging: every record has an id + `updatedAt`. Auto-posted bills and paydays use predictable ids, so two devices never double-post.

```
index.html, css/, js/          the app
  js/engine.js                 money math (pure, tested)
  js/store.js                  local state + merge
  js/sync.js                   encryption + cloud sync
  js/views/*.js                screens
api/log.js, api/widget.js      Vercel functions for Shortcuts / widgets
api/ai.js                      Claude features (needs ANTHROPIC_API_KEY)
sql/budget.sql                 database functions
tests/engine.test.mjs          node --test
```

## Develop

```bash
npm test
```

```bash
python3 -m http.server 5173
```

Deploys on Vercel as a static site plus the two functions in `api/`.
