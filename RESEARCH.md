# Research: what actually helps a student who overspends

Short version: give one number that's safe to spend today, make paying feel real again, put a pause between the urge and the purchase, and automate everything else so the app keeps getting used.

## What the market does (Nov 2026)

| App | What it's known for | What we took |
|---|---|---|
| YNAB (free for verified college students, otherwise about $15/mo or $109/yr) | Zero-based budgeting, "In My Pocket" safe-to-spend after bills | A single **safe-to-spend** number as the home screen |
| Copilot (iPhone only, about $13/mo) | Polished design, auto-categorization | Merchant memory: categories learned from your own history |
| Rocket Money | Finding and cancelling subscriptions | Bills & subs with yearly cost in hours of work, a **subscription check-up**, free-trial warnings |
| Goodbudget / PocketGuard | Envelopes, no bank sync needed | Category budgets with a pace marker, works without linking a bank |
| WalletPal, CashJot, Flow | Apple Pay "Transaction" Shortcuts automation | **Auto-logging every Apple Pay tap** with no bank login |

What none of them combine for a student: lump-sum smoothing for aid refunds, a pre-purchase check, a cooling-off waitlist, and regret/trigger tracking, all free, private and working without a bank connection. That's the gap this app fills.

## Behavioral findings and the feature each one became

1. **Pain of paying** (Prelec & Loewenstein 1998; Thomas et al.). Cards and taps feel painless, so people spend more, especially spendthrifts.
   → Every price shown as **hours of work**. The logging screen shows a live "leaves $X today / $X over today" line. Overspending turns the home screen red and shows tomorrow's lower allowance.
2. **Lump sums get spent early.** MDRC's *Aid Like A Paycheck* randomized trial paid aid every two weeks instead of in one lump. It reduced first-semester federal loan use and debt to the college, though the effect faded by the fourth semester.
   → **Stretch funds**: a refund or scholarship is set aside and released weekly, and the daily number only counts what's been released.
3. **Cooling-off periods / 24–72h rules.** These are widely recommended for impulse buying. Note: we found no randomized trials of app-based waiting periods. It's practitioner advice plus the psychology of urges fading.
   → **Waitlist** with a timer (24/48/72h, your choice), and a "Still want it?" card when it's up.
4. **Decide before, not after.** Most budgeting apps only log after the money's gone.
   → **"Can I afford it?"** check: the verdict, the impact on today and every remaining day, hours of work, category budget, goal trade-off, and your own rules. Then Wait, Skip, or Buy.
5. **Make resisting feel like a win.** Skipping a purchase is otherwise invisible.
   → A **"Not spent" total**, with one tap to move the skipped amount into a goal.
6. **Emotional and situational triggers.** Fashion and discretionary items are bought on impulse far more than groceries, and boredom, stress and social settings drive a lot of it.
   → An optional **"Why?" tag** (bored, stressed, friends, saw a deal…), automatic **late-night** detection, and Insights showing spending by trigger and weekday.
7. **Regret is information.** Asking "was it worth it?" a day later separates purchases you value from ones you regret.
   → **Worth-it check** on bigger or unplanned buys, a regret rate by category, and suggested rules.
8. **Implementation intentions.** Specific if-then plans beat vague goals.
   → **My rules**, written by you and shown at the moment of decision for that category.
9. **Pay yourself first / defaults** (e.g. Save More Tomorrow).
   → Goals **auto-save each payday** before the money hits your daily number. Optional **round-ups**.
10. **Salience and frequency of feedback.** A number you see constantly works better than a monthly report.
    → **Home/lock-screen widget**, an **app-icon badge** with today's dollars, and morning/evening **Shortcuts notifications**.

## Honest limits

- The strongest evidence above is for the lump-sum effect (one randomized trial) and the pain-of-paying lab work. Most "anti-impulse" app features are reasonable designs, not proven in trials. The app tracks your own regret and trigger data so you can see what works for you.
- Apple Pay auto-logging only covers Wallet taps (not card swipes or online checkouts). Some users report the Transaction trigger has been flaky on some iOS versions.
- No bank sync (Plaid etc.). That needs a paid API and a backend that holds bank credentials. The tradeoff is privacy and $0 cost.

## Sources

- [Prelec & Loewenstein / spendthrift-tightwad scale (CMU)](https://www.cmu.edu/dietrich/sds/docs/loewenstein/TightwadSpendThrift.pdf)
- [Credit cards and impulse purchases (Wharton)](https://knowledge.wharton.upenn.edu/wp-content/uploads/2013/09/13421.pdf)
- [Impulse buying and payment method, 2025 (GMIJB)](https://doaj.org/article/ce5dc05c3e0f498892d4561dce482f05)
- [7 psychology-backed ways to curb overspending](https://empeople.com/learn/empeople-insights/7-psychology-backed-ways-to-curb-overspending/)
- [MDRC: Aid Like A Paycheck](https://www.mdrc.org/node/15650) · [Aligning Aid with Enrollment](https://www.mdrc.org/publication/aligning-aid-enrollment)
- [Best budgeting apps for college students (BestMoney)](https://www.bestmoney.com/financial-advisor/learn-more/best-budgeting-apps-college-students) · [LendEDU roundup](https://lendedu.com/blog/best-budgeting-apps/)
- [AppleInsider: iOS 17 Shortcuts Transaction trigger](https://appleinsider.com/inside/ios-17/tips/how-to-use-ios-17s-new-shortcuts-features-to-control-displays-record-spending-and-more) · [WalletPal Apple Pay automation guide](https://walletpalapp.github.io/apple-pay-expense-tracker-shortcuts.html)
- [WebKit: Badging for Home Screen web apps](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/) · [MDN: app badges](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Display_badge_on_app_icon)
- [Canstar: impulse buying (48-hour rule, hours-of-work framing)](https://www.canstar.com.au/budgeting/impulse-buying)
