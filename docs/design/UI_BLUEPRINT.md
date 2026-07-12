# ZenFinance UI Blueprint

Date: 2026-07-12

## Lazyweb Reference Scan

I used Lazyweb against the core ZenFinance surface patterns after scanning the repo:

- Desktop personal finance dashboards: Origin, Quicken, Monarch Money, Empower, Yahoo Finance.
- Mobile finance home: Credit Karma, Chime, Capital One, Copilot, Fivecents.
- Mobile AI coach chat: Lemonade, Brainly, Grok, Speak, Halo Habits.
- Mobile subscription paywalls: Reuters, NYT Games, Zeus, Epoch Times, PlantIn.
- Finance landing pages: Empower, Ramp, Yahoo Finance, Bujeti, Causal.

The strongest reusable patterns were:

- Finance products earn trust by showing the product immediately: account state, money movement, and concrete actions should be visible before abstract promises.
- The best dashboards are dense but calm: one hero number or coach brief, then tightly grouped money facts and action rows.
- AI coach surfaces work better when they show suggested prompts, provenance/facts, and a short answer history rather than an empty generic chat room.
- Paywalls need proof of unlocked value before plan selection: saved dollars, subscription finds, forecast clarity, and premium-only coach powers.
- Landing pages in this category should show the app cockpit, privacy posture, and money outcomes in the first viewport.

## Product Inventory From Repo

The repo has three visible products:

- `apps/ios`: main customer app with auth, bank linking, weekly brief, coach chat, goals, subscriptions, wins, Money Physical, settings, referrals, household sharing, freelancer mode, push preferences, paywall, and privacy controls.
- `apps/site`: marketing, public insights, support, privacy, terms.
- `apps/site` admin build: internal metrics, waitlist, support, beta/launch/freelancer/household/voice/Money Physical reporting.

The current design is coherent and calm, but it reads more like a prototype than a premium financial coach. The main gap is not usability. The gap is product presence: ZenFinance should make users feel, instantly, that the app has already found signal in their money.

## North Star

Build ZenFinance as a premium "money cockpit with a calm coach," not a wellness-styled finance app.

The visual system should feel:

- Precise: dense information, clear hierarchy, tabular numbers, low ambiguity.
- Warm: human guidance, soft surfaces, no alarmist red finance anxiety.
- Premium: dark graphite, porcelain surfaces, mineral teal, restrained gold, crisp typography.
- Evidential: every recommendation shows a dollar amount, source, status, or next action.

## Visual Language

Use a "ledger glass" system:

- Backgrounds: warm off-white in light mode, graphite black in dark mode.
- Surfaces: white/charcoal panels with 1px borders, subtle inset highlights, no heavy card stacks.
- Accent: keep the current teal direction for coaching intelligence, use gold only for premium/value moments, use green for verified savings.
- Shape: keep app controls at 8px radius. Avoid pill-heavy UI except selected tabs or compact badges.
- Type: tabular numeric treatment for money, compact section headers, no oversized dashboard headings.
- Motion: small state transitions only: value reveal, progress sweep, row expansion, chat answer insertion.

Recommended tokens:

- Ink: `#12161c`
- Graphite: `#0d1117`
- Panel: `#ffffff`
- Panel dark: `#151b22`
- Border: `#d9e0e2`
- Border dark: `#26313a`
- Coach teal: `#2f7f7a`
- Coach teal bright: `#6bd2c7`
- Value gold: `#c8902e`
- Verified green: `#2f8f5b`
- Risk red: `#c2413a`
- Warm base: `#f6f3ed`

## iOS App Direction

### Product Shell

Replace the plain title bar with a compact cockpit header:

- Left: "Today" plus last sync state.
- Center/right: premium state, sync icon, and notification indicator.
- Under it, a horizontal status rail: linked banks, transactions synced, open alerts, premium/wins.

The bottom nav should remain, but rename around outcomes:

- Brief
- Coach
- Goals
- Audit
- Wins
- More

### Brief Home

Make the home screen the product's signature surface.

Top composition:

- A "Money Brief" hero panel with one decisive headline, one dollar impact, and the recommended action.
- Three inline evidence chips: source transactions, timeframe, confidence/status.
- A "Play voice brief" row embedded in the hero when premium, not a separate panel.

Below:

- "This week" metric rail: saved, at risk, recurring, goal pace.
- "Next best actions" rows with icon, impact, and one-line reason.
- "Recent money movement" grouped by category and amount.

Why: Lazyweb finance references consistently show the strongest dashboard value in the first screen, not behind secondary tabs.

### Coach

Make chat feel like a financial analyst, not a blank chatbot.

- Empty state should show a "question board" with categorized prompts: Spending, Affordability, Subscriptions, Goals.
- Each answer bubble should include a small facts ledger: amount, date range, source count, confidence.
- Action recommendations should render as tappable rows with an icon and expected impact.
- Composer should include quick chips above input for "Can I afford...", "Find waste", "Explain this charge".

### Paywall

Make the paywall value-led:

- Header: "Keep the dollars ZenFinance already found."
- Proof block before plan cards: verified wins, subscription candidates, forecast unlocked, chat coach unlocked.
- Annual card should be visually dominant when `savingsLabel` exists.
- CTA should include trial clarity and store-safe renewal text directly below it.
- Restore stays secondary.

Use premium gold sparingly: plan highlight, crown icon, "best value" marker.

### Goals

Turn goals into progress narratives:

- Each goal card should show current/target, projected date, pace label, and a short coach sentence.
- What-if should open as a compact scenario panel with before/after completion date and weekly tradeoff.
- New goal form should be a bottom-section composer, not a generic text-input stack.

### Subscriptions

Make this a cancellation cockpit:

- Top summary: monthly total, candidates, potential monthly save.
- Candidate rows should look different from normal recurring charges.
- Price creep should be a visible warning line with old/new delta.
- "I canceled this" should stay close to the amount.

### Wins And Money Physical

Make Money Wins emotional but still precise:

- Big running total at top with verified vs estimated split.
- Money Physical should look like a report cover: score, headline, two core section metrics, recommended actions.
- Charge alerts should use a review/recovered workflow with high visual contrast, but avoid panic red unless real risk.

### Settings

Settings currently carries too much feature surface. Split visually into zones:

- Account and billing.
- Growth credits.
- Premium modes: Freelancer, Household.
- Privacy and data.
- Connected institutions.

Each zone should use a plain section band, not stacked panels inside panels.

## Marketing Site Direction

The landing page should stop leading with an abstract sentence and start leading with the product.

First viewport:

- Full-bleed product cockpit visual: phone/home brief, action rows, and a small coach answer preview.
- H1: "ZenFinance"
- Supporting copy: "An AI money coach that reads your transactions and tells you the one move worth making this week."
- Primary CTA: waitlist/TestFlight.
- Secondary trust row: read-only Plaid, delete anytime, educational only.

Next sections:

- "What it finds": three realistic money briefs with amounts.
- "How it works": Link accounts -> Get brief -> Ask coach -> Track wins.
- "Why people pay": premium unlocks chat coach, forecasts, subscription audit, Money Physical, household/freelancer modes.
- "Privacy posture": read-only, credentials never stored, disconnect/delete controls.

Avoid marketing-card sprawl. Use full-width bands with one strong product visual per section.

## Public Insights Direction

Turn `InsightsPage` into a public data room:

- Keep aggregate privacy language prominent.
- Add a "sample locked/unlocked" status treatment.
- Metrics should read like a compact public report, not generic stat cards.
- Include a simple cohort timeline once data exists.

## Admin Direction

Admin should be operational, dense, and scan-friendly:

- Left sidebar for sections: Growth, Beta, Launch, Revenue, Freelancer, Household, Voice, Support.
- Top bar: environment, refresh, sign out.
- Metric tiles should use consistent units and sparklines where available.
- Support and waitlist tables should be tighter, with status filters and count summaries.

Do not make admin visually theatrical. Make it premium by being fast to read.

## Component System

Add shared component concepts across web and mobile:

- `MoneyMetric`: label, value, trend/status, optional icon.
- `CoachCard`: headline, body, evidence, action.
- `ActionRow`: icon, title, detail, impact, chevron/action.
- `PlanOption`: title, price, trial, savings, selected state.
- `InsightLedger`: rows of facts behind a recommendation.
- `StatusRail`: compact horizontal state summary.
- `SectionBand`: full-width web content band or mobile section zone.

## Phased Implementation Plan

### Phase 0 - Baseline And Screenshots

Goal: lock the current state before changing the design.

- Capture current iOS screenshots for auth, link account, brief home, coach, paywall, goals, subscriptions, wins, and settings.
- Capture current web screenshots for landing, insights, support, and admin dashboard.
- Save screenshots under `docs/design/current-state/`.
- Run Lazyweb hosted reports for the first two high-impact screens:
  - iOS paywall: objective `optimize`, goal `trial starts / annual plan selection`.
  - iOS brief home: objective `improve`, intent `make the app feel premium and instantly valuable`.
- Convert the winning Lazyweb recommendations into implementation tickets.

Exit criteria:

- Current-state screenshots exist.
- Lazyweb report URLs are saved in this document or a companion report index.
- Design implementation scope is ordered and unambiguous.

### Phase 1 - Design Tokens And Shared Primitives

Goal: establish the visual system before touching individual screens.

- Replace the current warm beige/mobile palette with the ledger-glass tokens:
  - Graphite dark mode, warm off-white light mode.
  - Coach teal, value gold, verified green, risk red.
  - 8px radius for app controls and panels.
- Add reusable iOS primitives:
  - `MoneyMetric`
  - `CoachCard`
  - `ActionRow`
  - `PlanOption`
  - `InsightLedger`
  - `StatusRail`
  - `SectionBand`
- Tighten typography:
  - Tabular number treatment for money.
  - Smaller, denser section titles.
  - No hero-scale text inside compact app panels.
- Update button/input/panel styles across iOS to use the new tokens.
- Mirror web tokens in Tailwind config and web UI components.

Exit criteria:

- iOS and web share the same brand color language.
- Existing screens still compile and render with updated primitives.
- No screen has nested cards or oversized rounded elements.

### Phase 2 - iOS Product Shell

Goal: make the app feel like a premium money cockpit immediately after login.

- Replace the plain top bar with a compact cockpit header:
  - "Today" or current brief context.
  - Last sync state.
  - Transaction count.
  - Refresh button.
  - Premium/notification state.
- Add a `StatusRail` under the header:
  - Linked banks.
  - Transactions synced.
  - Open alerts.
  - Premium/wins state.
- Rename bottom tabs around outcomes:
  - Brief
  - Coach
  - Goals
  - Audit
  - Wins
  - More
- Keep the tab bar dense and predictable, with no decorative treatment.

Exit criteria:

- The app shell explains current money state before the user scrolls.
- Navigation labels match the product's real jobs.
- Brief, Coach, Goals, Audit, Wins, and More all remain reachable.

### Phase 3 - iOS Brief Home

Goal: make the home screen the signature ZenFinance experience.

- Replace the current stacked metric/panel layout with a "Money Brief" hero.
- Hero includes:
  - One decisive headline.
  - One dollar impact.
  - One recommended action.
  - Evidence chips for source transactions, timeframe, and status.
- Embed voice brief controls inside the hero when premium.
- Add a "This week" metric rail:
  - Saved.
  - At risk.
  - Recurring.
  - Goal pace.
- Redesign "Next Actions" as high-signal rows:
  - Icon.
  - Title.
  - Dollar impact or count.
  - Reason.
- Group recent transactions into a compact money movement list.

Exit criteria:

- First screen communicates what ZenFinance found and what to do next.
- Voice brief feels like part of the weekly brief, not a separate feature card.
- Recent transactions are readable without competing with the brief.

### Phase 4 - iOS Paywall

Goal: sell premium through proven value before price.

- Run or attach the Lazyweb paywall report before implementation.
- Rebuild paywall around the value proof sequence:
  - Headline: "Keep the dollars ZenFinance already found."
  - Proof block: verified wins, subscription candidates, forecast unlock, coach unlock.
  - Feature list tied to real app jobs.
  - Plan cards.
  - Trial CTA.
  - Renewal/store disclosure.
  - Restore purchases.
- Make annual visually dominant when `savingsLabel` exists.
- Keep gold restrained to premium/value indicators.
- Track existing billing events unchanged.

Exit criteria:

- The paywall shows value before price.
- Monthly and annual selection remains functional.
- RevenueCat purchase and restore paths are untouched behaviorally.

### Phase 5 - iOS Coach

Goal: make AI feel grounded in the user's money, not generic chat.

- Redesign empty state into a categorized prompt board:
  - Spending.
  - Affordability.
  - Subscriptions.
  - Goals.
- Add quick prompt chips above the composer:
  - "Can I afford..."
  - "Find waste"
  - "Explain this charge"
- Redesign answer bubbles as `CoachCard`:
  - Answer body.
  - Fact ledger.
  - Source/date range.
  - Suggested actions.
- Keep existing `/api/chat` behavior unchanged.

Exit criteria:

- Empty coach screen invites useful finance questions.
- Every answer visibly carries facts or source context.
- Composer remains usable with the keyboard open.

### Phase 6 - iOS Goals And What-If

Goal: make goals feel paced and coachable rather than static progress bars.

- Redesign each goal as a progress narrative:
  - Current amount.
  - Target amount.
  - Projected completion date.
  - Pacing status.
  - One coach sentence.
- Make what-if results a before/after scenario card.
- Move new goal creation into a compact composer section.
- Keep free goal limit and paywall branching intact.

Exit criteria:

- A goal card answers "am I on track?" without requiring interpretation.
- What-if output clearly shows the tradeoff and time impact.
- Free and premium behavior remains unchanged.

### Phase 7 - iOS Subscription Audit

Goal: make cancellation candidates obvious and actionable.

- Redesign the top audit summary:
  - Monthly recurring total.
  - Candidate count.
  - Potential monthly savings.
- Visually separate cancellation candidates from normal recurring charges.
- Promote price creep deltas inline with old/new context.
- Keep "I canceled this" close to the candidate amount.
- Add empty and loading states if needed.

Exit criteria:

- A user can identify cancellation candidates in under five seconds.
- Price creep and cadence are visible without opening detail.
- Cancel-recording behavior still calls the same endpoint.

### Phase 8 - iOS Wins And Money Physical

Goal: make saved money feel concrete and emotionally rewarding without losing precision.

- Redesign Money Wins top summary:
  - Big total.
  - Verified split.
  - Estimated split.
- Redesign Money Physical as a report-cover experience:
  - Score.
  - Headline.
  - Summary.
  - Two section metrics.
  - Recommended actions.
- Improve charge alerts:
  - Clear title/detail.
  - Recovery action.
  - Strong but calm risk treatment.
- Keep purchase/restore paths unchanged.

Exit criteria:

- Wins screen shows cumulative value immediately.
- Money Physical feels like a premium deliverable.
- Charge alert recovery remains obvious.

### Phase 9 - iOS Settings, Privacy, Referral, Household, Freelancer

Goal: make the dense settings surface scannable and trustworthy.

- Split settings into visible zones:
  - Billing.
  - Invite Credit.
  - Freelancer Mode.
  - Household Sharing.
  - Notifications.
  - Linked Banks.
  - Data Rights.
- Reduce repeated full cards where section bands and rows are enough.
- Give privacy/data controls stronger visual grouping.
- Keep destructive actions visually separated.
- Preserve every existing feature and endpoint.

Exit criteria:

- Settings reads as organized zones, not a long feature dump.
- Delete/export/disconnect actions are easy to find but not accidentally emphasized.
- Household and freelancer flows remain complete.

### Phase 10 - Marketing Landing Page

Goal: make the website show the product instead of explaining around it.

- Redesign the first viewport:
  - H1: "ZenFinance"
  - Supporting copy: "An AI money coach that reads your transactions and tells you the one move worth making this week."
  - Primary CTA: waitlist/TestFlight.
  - Secondary trust row: read-only Plaid, delete anytime, educational only.
  - Large product cockpit visual, not a generic hero card.
- Add product-led sections:
  - What it finds.
  - How it works.
  - Why people pay.
  - Privacy posture.
- Replace abstract feature cards with realistic money brief examples.
- Keep waitlist API behavior unchanged.

Exit criteria:

- Product value is visible in the first viewport.
- Waitlist form still works.
- Page avoids generic SaaS/finance marketing patterns.

### Phase 11 - Public Insights And Support

Goal: make public pages feel like part of the same trust system.

- Redesign Insights as a public data room:
  - Cohort status.
  - Aggregate privacy language.
  - Key metrics.
  - Locked/unlocked sample treatment.
- Tighten Support page styling to match the new system.
- Keep Privacy and Terms readable and plain.

Exit criteria:

- Public data feels trustworthy and restrained.
- Support remains easy to use.
- Legal pages are not over-designed.

### Phase 12 - Admin Console

Goal: make admin operationally dense and fast to scan.

- Add an admin shell:
  - Left sidebar.
  - Top environment/refresh/sign-out bar.
  - Section navigation for Growth, Beta, Launch, Revenue, Freelancer, Household, Voice, Support.
- Normalize metric tiles:
  - Consistent unit labeling.
  - Compact values.
  - Optional mini charts where data exists.
- Tighten waitlist and support sections:
  - Filters.
  - Status badges.
  - Denser rows.
- Keep auth and admin API behavior unchanged.

Exit criteria:

- Admin can be scanned by section instead of one long page.
- Existing metrics remain present.
- Waitlist and support workflows still function.

### Phase 13 - Responsive And Accessibility Pass

Goal: make the redesigned UI durable across device sizes and themes.

- Verify iOS light/dark mode contrast.
- Check text wrapping on all buttons and row titles.
- Verify tab labels do not collide.
- Validate dynamic content:
  - Long merchant names.
  - Long goal names.
  - Missing subscription data.
  - No transactions.
  - No wins.
  - Free vs premium states.
- Check web mobile and desktop breakpoints.
- Confirm focus states on web controls.

Exit criteria:

- No overlapping text or clipped button labels.
- Empty/loading/error states are designed.
- Light and dark modes both meet contrast expectations.

### Phase 14 - Validation And Lazyweb Follow-Up

Goal: validate the most important redesigns with screenshots and Lazyweb.

- Run typechecks:
  - `npm run typecheck`
  - `npm run typecheck -w zenfinance-ios`
  - `npm run typecheck -w @zenfinance/site`
- Capture after screenshots for:
  - iOS brief home.
  - iOS paywall.
  - iOS coach.
  - Web landing.
  - Admin dashboard.
- Run Lazyweb compare/report follow-ups for:
  - Paywall after implementation.
  - Landing page after implementation.
  - Brief home after implementation.
- Save final screenshots under `docs/design/final-state/`.

Exit criteria:

- Typechecks pass.
- Before/after screenshots exist.
- Lazyweb follow-up recommendations are captured for the next iteration.

## Lazyweb Hosted Report Targets

Lazyweb's full report pipeline is screen-specific. Best report order:

1. iOS paywall, objective `optimize`, goal `trial starts / annual plan selection`.
2. iOS brief home, objective `improve`, intent `make the app feel premium and instantly valuable`.
3. Web landing page, objective `optimize`, goal `waitlist signup`.
4. Admin dashboard, objective `improve`, intent `make operator metrics faster to scan`.

For each, capture a current screenshot, upload it through Lazyweb image upload, call `lazyweb_generate_report`, then implement the winning direction.
