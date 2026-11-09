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
api/log.js, api/widget.js      Vercel functions for Shortcuts / widgets (no dependencies)
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
