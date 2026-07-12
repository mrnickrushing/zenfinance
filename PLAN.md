# ZenFinance — AI Personal Finance Coach

**A calm, plain-English money coach. Not another dashboard. iOS only.**

ZenFinance links a user's bank and card accounts, enriches every transaction with AI, and delivers short, actionable coaching — *"Cut dining out by $45 this week to hit your savings goal — here's a simple swap"* — instead of charts the user has to interpret themselves. The product's entire personality is the opposite of Mint/YNAB: fewer screens, fewer numbers, one clear next action.

**The product ships exclusively as an iOS app.** There is no web app. The web presence at `zenfinance.rushingtechnologies.com` is non-product: a marketing page with waitlist, a support page, legal pages, and an owner-only admin console — all served by the same Express API that will later power the iOS app (see `apps/site` and `apps/api` in this repo).

This document is the full product + technical plan: premium feature set, architecture on the RushingTech stack, the AI coaching engine, security/compliance, monetization with unit economics, the tooling workflow (including the [`mrnickrushing/agents`](https://github.com/mrnickrushing/agents) toolkit), and a phased roadmap from empty repo to App Store launch.

---

## 1. Positioning & Target User

**One-liner:** "A financial coach in your pocket that reads your transactions so you don't have to."

**Who it's for (launch niche → expansion):**

1. **Launch niche — US millennials/Gen-Z iPhone users with income but no system** (25–40, $50k–$150k household income, 1–3 financial goals, allergic to spreadsheets). They abandoned Mint/YNAB because those tools demand work; ZenFinance demands nothing after linking.
2. **Expansion niche 1 — Freelancers/solo operators:** irregular income, quarterly taxes, cash-flow anxiety. "Can I afford a slow month?" is a killer coaching question no dashboard answers.
3. **Expansion niche 2 — Couples/families:** shared goals, gentle accountability, "money date" weekly summaries for two.

**Differentiation pillars:**

- **Coaching over tracking.** Every insight ends in a verb. If a screen doesn't tell the user what to *do*, it doesn't ship.
- **Calm by design.** Zen brand promise: no red alarm dashboards, no guilt mechanics. Progress framing ("you freed up $120 this month"), not deficit framing.
- **Privacy as a feature.** Read-only access, tokens never on device, data minimization, plain-English privacy page, one-tap disconnect + delete-everything.
- **Fast time-to-value.** First personalized insight within 60 seconds of linking (analyze 90 days of history immediately, don't wait a week).

---

## 2. Premium Feature Set

### Free tier (acquisition + habit formation)
- Link up to 2 accounts (Plaid/Teller)
- AI categorization + merchant cleanup
- One weekly coach brief (push + in-app)
- One active savings goal
- Anomaly alerts (unusual charge, duplicate charge, fee detection) — free because it builds trust and proves ROI

### Premium — "ZenFinance Coach" ($7.99/mo or $59.99/yr, App Store subscription)
- **Unlimited accounts** and full transaction history
- **On-demand chat coach:** conversational Q&A over the user's own data ("How much did I spend on my trip?", "Can I afford a $2,400 e-bike in 3 months?") — backed by a scoped transaction-query tool (§4), not just aggregates, so merchant/date/trip-specific questions actually work
- **What-if simulator:** model a raise, a move, a subscription purge, a debt-payoff plan; see the goal timeline shift live
- **Cash-flow forecast:** 30/60/90-day projection with recurring-bill detection and low-balance warnings ("Your checking dips below $200 on the 27th")
- **Subscription auditor:** finds recurring charges, flags zombies and price creep, drafts the cancellation script/email
- **Goal engine:** multiple goals with priorities, weekly pacing targets, and automatic re-planning when the user falls behind
- **Habit nudges & streaks:** small behavioral loops (no-spend days, brown-bag streaks) chosen from *actual* spending patterns, never generic tips
- **Money Wins ledger:** a running tally of dollars ZenFinance found or saved the user — the single most important retention/renewal screen ("ZenFinance has saved you $412 since March"). This is the ROI proof that justifies the subscription at renewal time.
- **Monthly deep-dive report:** narrative month in review, trend deltas, one focus for next month

### Premium+ / add-ons (post-launch, phase 7+)
- **Freelancer mode** ($3/mo add-on or higher tier): income smoothing math, tax set-aside coaching, invoice-gap alerts
- **Household sharing:** two seats, shared goals, individual privacy zones
- **Voice brief:** 90-second weekly audio summary (TTS) for commutes
- **Annual "Money Physical":** one-time purchasable deep report ($14.99) — also works as a paid trial funnel for non-subscribers

### Deliberately excluded (scope discipline)
- **No web app.** The product is the iOS app; the web presence is marketing/support/admin only.
- No payments/transfers (keeps us read-only → drastically lower compliance surface)
- No investment advice/brokerage data at launch (regulatory line we don't cross; net-worth *display* only, later)
- No manual-entry budgeting workflows — that's the Mint/YNAB trap we're positioned against
- No Android at launch — revisit only after iOS retention proves out

---

## 3. Architecture & Stack

Chosen to match the stack the RushingTech agents toolkit already reviews and scaffolds — every layer here has a corresponding agent for review/audit (see §7).

```
┌─────────────────────────────────────────────────────────────┐
│  Clients                                                     │
│  • iOS app (THE product): Expo / React Native, Zustand,      │
│    RevenueCat SDK — the only product client                  │
│  • Non-product pages (apps/site): marketing + waitlist,      │
│    support, privacy/terms, owner admin console — static      │
│    build served by the API at zenfinance.rushingtech...com   │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS (JWT, refresh rotation)
┌──────────────────────────▼──────────────────────────────────┐
│  API — Node/Express + TypeScript on Railway                  │
│  • Zod validation on every route, Helmet, rate limiting      │
│  • Drizzle ORM → Postgres (Railway)                          │
│  • BullMQ + Redis: ingestion & insight job queues            │
│  • RevenueCat webhooks (App Store IAP entitlements)          │
│  • Plaid webhooks (transactions updates, item status)        │
└───────┬──────────────────────────────┬──────────────────────┘
        │                              │
┌───────▼───────────┐        ┌─────────▼────────────────────┐
│  Data providers   │        │  AI layer — Claude API        │
│  • Plaid (primary)│        │  • Haiku: categorization,     │
│  • Teller (eval   │        │    merchant cleanup, anomaly  │
│    for cost)      │        │    triage (cheap, per-txn)    │
│  Read-only scopes │        │  • Sonnet: weekly briefs,     │
│  Tokens server-   │        │    chat coach, what-ifs       │
│  side only, KMS-  │        │  • Prompt caching + batching  │
│  encrypted        │        │  • Zod-validated JSON outputs │
└───────────────────┘        └──────────────────────────────┘
        Observability: Sentry (API + iOS) · Railway metrics · PostHog product analytics
        CI/CD: GitHub Actions → Railway (API) · EAS (iOS builds/updates)
```

**Key decisions and why:**

- **Node/Express + Drizzle + Zod over FastAPI** — both are supported by the toolkit, but the iOS app is the product's center of gravity and a single TS codebase (shared types between API and clients via a `packages/shared` workspace) is worth more to a solo operator than Python's data ergonomics. Monorepo: `apps/api`, `apps/site`, `apps/ios`, `packages/shared`.
- **Plaid as primary aggregator** — broadest US coverage (~12k institutions) and best docs; start on the free Trial/limited-production tier (~10 live items) for the entire beta. **Teller** stays a live evaluation track: its free 100-connection developer tier could carry the whole beta at $0, but coverage gaps decide it. Build a thin `providers/` interface so the aggregator is swappable — this also future-proofs against CFPB §1033 open-banking standardization. **Plaid Link runs natively in the iOS app** (Plaid Link iOS SDK); the API only ever handles link tokens and access-token exchange.
- **Postgres schema highlights:** `users`, `items` (provider connections), `accounts`, `transactions` (raw + enriched columns), `recurring_streams`, `goals`, `insights` (generated coaching artifacts with feedback state), `money_wins`, `subscriptions_billing`. Transaction table is append-only with enrichment versioning so re-categorization never destroys history.
- **Job-queue-first ingestion:** Plaid webhooks enqueue sync jobs; enrichment and insight generation are separate queue stages. Nothing AI-related happens in a request cycle except chat.
- **Claude model tiering** (cost control is a product feature here):
  - *Haiku* for high-volume, low-stakes work: categorization, merchant name cleanup, recurring-charge detection assist, anomaly triage. Batch 50–100 transactions per call.
  - *Sonnet* for the weekly brief, chat coach, and what-if scenarios where reasoning quality is the product.
  - Prompt caching on the static system/coaching-policy prompt; per-user context assembled as compact structured summaries (see §4). Chat additionally gets a deterministic, user-scoped transaction-query tool (parameterized SQL behind a tool interface, redacted fields only) — the model never receives bulk raw-transaction dumps.
- **RevenueCat as the entitlement and purchase source of truth** for App Store monetization — subscription entitlements for Coach plus non-subscription transaction events for one-time reports. Stripe enters the picture only if a web checkout is ever wanted; nothing in the design depends on it.

---

## 4. The AI Coaching Engine

The engine is a pipeline, not a chatbot bolted onto a database.

**Stage 1 — Ingest & normalize.** Plaid sync → dedupe, pending/posted reconciliation, transfer-pair detection (so moving money between own accounts never counts as spending).

**Stage 2 — Enrich (Haiku, batched).** Category (custom taxonomy ~40 categories tuned for coaching, not accounting), cleaned merchant name, `is_recurring`, `is_discretionary`, confidence score. Low-confidence items fall back to Plaid's own enrichment; user corrections are stored and injected as few-shot examples into that user's future enrichment calls — the coach visibly *learns*.

**Stage 3 — Feature store (plain SQL, no ML infra).** Nightly per-user rollups: spend by category by week, discretionary ratio, recurring load, income cadence, goal pacing, volatility. Each aggregate carries a stable `aggregate_id`. These compact aggregates — not raw transactions — are what feed the LLM for briefs and insights (chat adds the scoped query tool from §3). Keeps prompts small, cheap, and privacy-tighter.

**Stage 4 — Insight generation (Sonnet).** Weekly job assembles: user profile + goals, 8-week aggregate trends, notable events (anomalies, new recurring charges, goal pacing drift), and the coaching policy prompt. Derived figures the coach may cite (goal pacing, projected savings, category deltas) are computed deterministically in code and passed in as inputs — the model never does arithmetic. Output is Zod-validated JSON: `{ headline, body, action: { description, estimated_impact_usd, timeframe }, claims: [{ amount_usd, source_aggregate_id }], tone_check }`. Every verified dollar figure must cite a `source_aggregate_id` present in the inputs — semantic provenance, not just numeric matching, since a model can reuse a valid $45 against the wrong merchant. `estimated_impact_usd` is a model estimate and is labeled as such in the UI, never presented as a verified figure. Invalid JSON, a missing/unknown source id, or a failed rules-pass (see guardrails) → retry once → fall back to a template insight. **Every insight must name a dollar amount and an action.**

**Stage 5 — Delivery & feedback.** Push notification → brief card in app → thumbs up/down + "did you do it?" follow-through check the next week. Feedback loops into per-user tone/topic preferences and into the Money Wins ledger. A win is marked **verified** only when the connection is actively syncing, transaction data is complete for the period, and either the user confirms the cancellation or the expected charge is absent for 2+ consecutive billing cycles — a charge merely disappearing once proves nothing (provider outages, disconnects, and merchant renames all mimic it). Anything short of that displays as *estimated*.

**Guardrails (non-negotiable):**
- Coaching policy prompt forbids: investment/tax/legal advice, shame language, fabricated numbers. Every verified dollar figure must cite a `source_aggregate_id` that exists in the provided inputs — enforced by a post-generation provenance check; model estimates are labeled as estimates.
- Standing "not financial advice; educational only" disclosure in-app and in onboarding.
- A `tone_check` self-rating in the output schema, plus a lightweight rules pass (banned-phrase list) before anything reaches a user.
- **Eval harness from day one:** ~50 synthetic user personas (fixture transaction sets) with golden expectations; every prompt change runs the persona suite in CI and diffs insight quality/cost. This is the moat-maintenance tool — prompt regressions are product regressions here.

---

## 5. Security, Privacy & Compliance

Read-only data access shrinks the regulatory surface — no money movement — but it is **not** an exemption: regulatory posture gets jurisdiction-specific review by a fintech-literate attorney before beta, and no compliance claim ships publicly without that review. Bank data demands bank-grade hygiene regardless:

- **Never store bank credentials** — OAuth via Plaid Link only. Plaid `access_token`s live server-side, encrypted at rest (app-layer encryption with KMS-managed key, on top of Postgres disk encryption). Tokens never touch the client.
- **Auth:** JWT access + refresh-token rotation with revocation (exactly the pattern `AuthSecurityAgent` audits), Apple Sign-In on iOS, optional biometric app-lock (Face ID).
- **API hardening:** Helmet, strict CORS, per-user and per-IP rate limits, Zod on every input, no PII in logs (Sentry PII scrubbing configured — `InfraMonitorAgent` checks this).
- **Data minimization & user rights:** one-tap disconnect (revokes the Plaid item + deletes its transactions), full account deletion with a 30-day purge that propagates everywhere user data lives — Postgres, Redis/BullMQ job payloads, database backups (documented backup-expiry window), Sentry/PostHog events, and deletion requests upstream to Plaid and the model API provider — plus data export. Designed toward CCPA/GDPR expectations; "compliant" is claimed only after legal review. Delete flows are built in Phase 1, not retrofitted.
- **AI privacy posture:** only aggregates and minimal, redacted transaction context go to the model API; no third-party analytics on transaction content; document the flow in the privacy policy in plain English (this is marketing as much as compliance).
- **Roadmap items:** privacy policy + ToS from a fintech-literate template pre-beta (attorney-reviewed); security review gate before every phase exit (see §7); SOC 2 Type I only when a partnership/enterprise reason exists (~post-revenue, ~$20–40k — not before).

---

## 6. Monetization & Unit Economics

**Pricing:** Free tier → **$7.99/mo** or **$59.99/yr** (37% annual discount pushes the higher-retention plan), sold as App Store auto-renewing subscriptions with a 14-day free trial (intro offer). Sits deliberately under YNAB (~$15/mo) and above impulse-purchase pricing — coaching should feel premium.

**Per-premium-user monthly cost model (at modest scale):**

| Cost | Estimate | Notes |
|---|---|---|
| Plaid (≈2 items/user) | $0.60–$2.00 | Trial tier is $0 through beta; negotiate at growth tier |
| LLM — enrichment (Haiku, batched) | ~$0.03–$0.08 | ~300 txns/mo enriched in batches |
| LLM — weekly briefs + chat (Sonnet, cached) | ~$0.15–$0.50 | 4 briefs + moderate chat; prompt caching cuts this hard |
| Infra amortized (Railway, Redis, Sentry) | ~$0.10–$0.30 | Flat costs spread across users |
| **Total** | **~$0.90–$2.90** | **~64–89% gross margin at $7.99, before Apple's 15–30% cut** |

Apple's commission (15% under the Small Business Program while revenue < $1M/yr) comes off the top; even at 15%, blended margin stays healthy (~55–80%).

**Targets:** free→paid conversion 5–8% (finance apps convert well when ROI is visible — that's the Money Wins ledger's job), monthly churn <5% (annual plans + renewal-time savings recap), LTV $85–150. Break-even on fixed costs (~$100–200/mo infra + Plaid Growth minimum) at roughly **35–60 subscribers** (after Apple's cut).

**Monetization mechanics:** App Store IAP via RevenueCat — entitlements, non-subscription purchases, receipt validation, billing-retry/dunning, and webhooks into the API, with RevenueCat as the store state source of truth. Reviewed by `StripeBillingAgent` (which covers RevenueCat sync/receipt validation) before launch (§7). Stripe web checkout is out of scope unless a web purchase path is ever wanted.

---

## 7. Tooling & Resources — the Force-Multiplier Plan

Solo-built doesn't mean unreviewed. Every phase below has an explicit quality gate powered by tools already on hand:

**The `mrnickrushing/agents` toolkit (11 agents, 57 tools) mapped to the lifecycle:**

| Phase activity | Agent(s) | How it's used |
|---|---|---|
| Bootstrap monorepo, API, Expo app | `ScaffolderAgent` | Generate Express API, Expo app, SaaS platform scaffolding + CI configs |
| Every schema/migration | `DatabaseArchitectAgent` | FK index coverage, migration safety, N+1 detection, unique constraints |
| Every route/component PR | `CodeReviewAgent` + `APIArchitectAgent` | Express routes, Zod validation, React/Expo components, Zustand stores; pagination/status-code/error-shape consistency |
| Auth implementation | `AuthSecurityAgent` | JWT refresh rotation, Apple Sign-In nonce/JWKS/audience, shared-secret admin gate, biometric auth |
| Phase-exit security gates | `SecurityAuditAgent` (`cli.py scan --triage`) | Helmet, OWASP Top 10, JWT, injection/XSS/CSRF, dependency scan, CORS — with LLM triage to kill false positives |
| Billing build-out | `StripeBillingAgent` | RevenueCat sync, receipt validation, webhook handler review, dunning, billing security audit |
| Deploy & observability | `RailwayDeployAgent` + `InfraMonitorAgent` | GitHub Actions → Railway, Sentry DSN/sampling/PII config, health-check depth, alert rules, backups |
| App Store submission | `MobileDeployAgent` | EAS profile review (hardcoded-secret detection), App Store submission checklist, RevenueCat SDK setup |
| Design system & screens | `UIGenerationAgent` | Zen design system (color/type/motion/elevation) + component generation with accessibility validation |

Wire `python -m agents.cli scan` into GitHub Actions as a required check on `zenfinance` — free heuristic pass on every PR, `--triage` pass (API key in CI secrets) on release branches.

**Claude Code session agents** mirror the same coverage interactively: `project-scaffolder`, `fullstack-code-reviewer`, `security-auditor`, `stripe-billing-reviewer`, `railway-deploy-advisor`, `ui-designer` — used during development, while the CLI toolkit enforces the same standards in CI.

**External resources:** Plaid sandbox + Link iOS SDK, Teller sandbox (parallel evaluation), RevenueCat sandbox, PostHog free tier (product analytics), Expo EAS free tier, TestFlight, Railway hobby → pro. Total pre-revenue tooling spend: **≈$20–40/mo** (plus the $99/yr Apple Developer Program).

---

## 8. Phased Roadmap — Start to Finish

Timeline assumes one experienced solo builder, part-to-full-time. **~16–20 weeks to App Store launch.** Each phase has an exit gate; don't start the next phase until the gate passes.

### Phase 0 — Foundation & Validation *(Week 1–2)*
- Web presence live at `zenfinance.rushingtechnologies.com` (built in this repo: `apps/site` + `apps/api`): marketing page with the one-liner, 3 example coach briefs, waitlist signup, support page wired to support@rushingtechnologies.com, privacy/terms pages, and the owner admin console (waitlist, support inbox, metrics) — deployed on Railway
- Post concept to r/personalfinance-adjacent communities + Product Hunt "upcoming"; goal: 100 waitlist emails
- Plaid dashboard signup (Trial), Teller dev account, RevenueCat account, Apple Developer Program enrollment
- Monorepo scaffold (`ScaffolderAgent`): `apps/api`, `apps/site`, `apps/ios` (placeholder), `packages/shared`; CI skeleton with lint/typecheck/test + `agents.cli scan`
- Draft the coaching policy prompt + the 50-persona eval fixture plan
- **Exit gate:** site + admin console deployed and collecting waitlist signups; repo scaffolded; CI green; Plaid sandbox keys working.

### Phase 1 — Data Spine: Linking & Ingestion *(Week 3–5)*
- Auth: email + Apple Sign-In, JWT with refresh rotation (`AuthSecurityAgent` review)
- Plaid link-token + token-exchange endpoints on the API, plus a minimal iOS test harness (bare Expo screen wrapping the Plaid Link iOS SDK) — the full app UI comes in Phase 4
- Webhook-driven transaction sync via BullMQ: initial 90-day backfill + incremental updates; dedupe, pending reconciliation, transfer-pair detection
- Drizzle schema for the core tables + delete/disconnect flows (built now, per §5)
- Provider abstraction layer; Teller spike behind it
- **Exit gate:** link a real bank account from the iOS test harness, watch 90 days of clean transactions land in Postgres, disconnect wipes them. `SecurityAuditAgent` scan passes. `DatabaseArchitectAgent` review of schema passes.

### Phase 2 — AI Enrichment *(Week 6–7)*
- Haiku batch enrichment pipeline: categories, merchant cleanup, discretionary/recurring flags, confidence scores; Plaid-enrichment fallback
- Recurring-stream detection (rules + LLM assist) → `recurring_streams`
- Nightly feature-store rollups (SQL aggregates with stable `aggregate_id`s)
- User-correction loop stored as per-user few-shots
- Eval fixtures: a hand-labeled 500-transaction set, split into a few-shot/dev portion and a **held-out portion**; the metric that matters is discretionary/essential split accuracy (more than exact category)
- **Exit gate:** ≥90% discretionary/essential split accuracy on the held-out portion of the hand-labeled set (few-shot/dev transactions excluded); enrichment cost per user per month measured and under $0.10.

### Phase 3 — Coaching Engine MVP *(Week 8–10)*
- Insight generation job (Sonnet): weekly brief with validated JSON schema, provenance check (`source_aggregate_id`s), deterministic derived-figure computation, tone rules pass, template fallback
- Goals CRUD + pacing math; anomaly detection (unusual/duplicate charge, new recurring, fee) with push alerts
- Subscription auditor v1 (from `recurring_streams`)
- Money Wins ledger plumbing (insights → verification criteria from §4 Stage 5 → verified/estimated tally)
- 50-persona eval suite wired into CI; iterate the coaching prompt against it
- **Deliver value in week 1 of any user's life:** immediate "first-look brief" generated from the 90-day backfill at link time
- **Exit gate:** the weekly brief on your own real data is something you'd screenshot and send to a friend. Persona suite passes. Per-user AI cost measured.

### Phase 4 — The iOS App *(Week 11–14)* — the product phase
- Zen design system (`UIGenerationAgent` / `ui-designer`): calm palette, generous whitespace, one-number-per-screen discipline, dark mode
- Expo iOS app: onboarding → Plaid Link (native SDK) → first-look brief → weekly brief cards → chat coach → goals → subscription auditor → Money Wins
- Chat coach (Sonnet, streaming) over the feature store **plus the deterministic, user-scoped transaction-query tool** (parameterized SQL behind a tool interface, redacted fields only) so merchant/date/trip questions are answerable; strict scope guardrails
- What-if simulator (deterministic math core + LLM narration — the LLM never does the arithmetic)
- Push notifications (Expo push → APNs): weekly brief, anomalies, goal pacing — with per-type opt-outs
- Sentry on API + iOS (`InfraMonitorAgent` config review); PostHog funnels on onboarding
- **Exit gate:** TestFlight build; 5 friendly users linked, receiving briefs, and at least 3 report acting on one. `CodeReviewAgent` + accessibility pass on all screens.

### Phase 5 — Monetization *(Week 15–16)*
- RevenueCat entitlements (`zen_coach` premium); App Store auto-renewing subscription products (monthly + annual, 14-day intro trial)
- Free-tier gating (2 accounts, 1 goal, weekly brief only), paywall screens framed around Money Wins ("the coach paid for itself")
- RevenueCat webhooks into the API, receipt validation, billing-retry/dunning handling (`StripeBillingAgent` + `stripe-billing-reviewer` full audit — this gate is blocking)
- Pricing experiment scaffolding (PostHog A/B on paywall framing, not price)
- **Exit gate:** end-to-end purchase, upgrade, cancel, refund, and restore-purchases tested in App Store sandbox; billing audit clean.

**Implementation status in this repo:** Phase 5 is now implemented behind the
RevenueCat `zen_coach` entitlement. The API has billing customer,
entitlement, webhook event, and pricing experiment tables; `/api/billing/*`
status/refresh/restore/event routes; signed RevenueCat webhook processing;
free-tier gates for linked accounts, active goals, chat, what-if,
subscription audit, and Money Wins; and mobile home summaries include billing
limits. The Expo iOS app has a custom RevenueCat paywall, purchase and restore
flows, billing status in settings, and premium-tab routing. Phase 5 backend
coverage lives in `apps/api/src/test/phase5.test.ts`.

### Phase 6 — Hardening, Compliance & Beta *(Week 17–18)*
- Full `SecurityAuditAgent --triage` scan + `security-auditor` deep pass; fix all high/critical
- Privacy policy + ToS (fintech template, attorney-reviewed), disclosure copy audit, App Store privacy nutrition labels
- Plaid production-access application (they review the app; lead time ~1–2 weeks — **start this at Phase 4 exit**, it runs in parallel)
- Load/failure drills: Plaid webhook outage, item re-auth flows, LLM API failure → template fallback verified
- Closed beta via TestFlight: 50–100 waitlist users; instrument activation (link rate, first-brief reaction) and week-4 retention
- **Exit gate:** Plaid production approved; App Store review passed; beta week-4 retention >30%; zero critical Sentry issues for 7 days.

**Implementation status in this repo:** Phase 6 hardening is implemented in code
and docs: dependency upgrades with `npm audit --audit-level=high` passing,
Sentry event scrubbing, central error capture, data export, audited account
deletion, Plaid item reauth/revocation webhook state handling, admin beta
activation/action/week-4 retention metrics, iOS data export access, Expo SDK 57
compatibility, updated privacy/terms pages, App Store privacy inventory, Plaid
production checklist, security audit record, TestFlight beta runbook, and
failure drill runbook. External gates that cannot be completed from the repo
remain Plaid production approval, App Store/TestFlight review, attorney
sign-off, and live beta retention/Sentry observation windows.

### Phase 7 — Launch & Growth Loop *(Week 19+, ongoing)*
- App Store launch: Product Hunt + the waitlist + finance-adjacent newsletters/podcasts; launch offer for waitlist (extended trial, not a discount — protect the price point)
- Weekly growth loop: PostHog cohort review → one retention or conversion experiment per week — nothing else
- Referral mechanic: "give a month, get a month" (finance advice spreads by word of mouth)
- Content flywheel: anonymized, aggregate insight posts ("the average subscriber has 2.3 zombie subscriptions worth $31/mo") — original data earns links; published on the marketing site
- Post-launch feature train (strictly demand-ordered): freelancer mode is built in Phase 8, household sharing is built in Phase 9, voice briefs are built in Phase 10, and Money Physical is built in Phase 11; the next demand-ordered item is net-worth view
- Ops cadence: `agents.cli scan` in CI stays required; monthly dependency + billing audits; watch CFPB §1033 developments for aggregator-cost leverage
- **Success criteria for the first 90 days post-launch:** 1,000 free users, 60+ subscribers (break-even ×~1.5), churn <6%, verified Money Wins average >$25/user/month.

**Implementation status in this repo:** Phase 7 repo-owned launch systems are
implemented: authenticated referral codes and 30-day stackable premium credits
for both referrer and referred user, billing gates that honor active referral
credits without overwriting RevenueCat state, launch KPI metrics in the admin
dashboard, a public sample-size-gated `/insights` aggregate-data page, a
public `/api/content/launch-stats` endpoint, and launch/growth runbooks.
External launch work remains App Store publication, Product Hunt/newsletter
posting, waitlist emailing, and live 90-day KPI measurement.

### Phase 8 — Freelancer Mode *(Post-launch feature train item 1)*
- Premium Freelancer Mode profile with monthly income target, estimated set-aside percentage, runway target, and enabled/paused state
- Six-month income stability summary from linked transactions: income, essential spend, net cash flow, income volatility, cash runway, target gap, estimated set-aside, and slow-month buffer
- Premium-gated API routes: `GET /api/freelancer/profile`, `PATCH /api/freelancer/profile`, and `GET /api/freelancer/summary`
- iOS Settings surface for saving Freelancer Mode inputs and reviewing runway/income recommendations
- Admin metrics for enabled Freelancer Mode users, users with recent income, average runway, and average target gap
- Documentation and legal boundary updates: set-aside math is an estimate for planning, not tax advice
- **Exit gate:** free-user paywall, profile persistence, summary math, recommendations, and admin adoption metrics are covered by `apps/api/src/test/phase8.test.ts`.

**Implementation status in this repo:** Phase 8 is implemented behind the
existing `zen_coach` entitlement. The API owns a `freelancer_profiles` table,
profile and summary routes, deterministic runway/income calculations, and admin
aggregate metrics. The iOS app exposes Freelancer Mode in Settings for premium
users. Docs are updated in `docs/FREELANCER_MODE.md`, README, deploy checklist,
privacy inventory, and public privacy/terms pages. Packaging can still move to
an add-on or higher tier later; the current repo implementation ships it as a
Coach premium feature.

### Phase 9 — Household Sharing *(Post-launch feature train item 2)*
- Two-seat household model with owner/member roles, one household per user at launch, and expiring invite tokens
- Individual privacy zones: household views expose members, invites, shared goals, and contributions, not bank accounts, transactions, chat, personal goals, anomalies, Money Wins, Freelancer Mode, or billing details
- Premium-gated household creation and invite creation; invited members can accept without a second subscription
- Shared household goals with target/progress fields and a contribution ledger
- iOS Settings surface for creating a household, sharing an invite, accepting an invite, creating shared goals, and adding contributions
- Admin metrics for households, active household members, pending invites, and shared goals
- Privacy export includes household membership, shared goals, and contributions
- **Exit gate:** creation paywall, invite acceptance, seat cap, shared goals, contributions, privacy boundary, export, and admin metrics are covered by `apps/api/src/test/phase9.test.ts`.

**Implementation status in this repo:** Phase 9 is implemented behind the
existing `zen_coach` entitlement for household owners. The API owns household,
member, invite, shared-goal, and contribution tables plus `/api/household/*`
routes. The iOS app exposes Household Sharing in Settings. Docs are updated in
`docs/HOUSEHOLD_SHARING.md`, README, deploy checklist, privacy inventory,
public privacy/terms pages, growth loop, and security notes.

### Phase 10 — Voice Briefs *(Post-launch feature train item 3)*
- Premium-gated voice script generation from the latest weekly brief, with first-look fallback
- Persisted `voice_briefs` table with source insight, deterministic script, intro/summary/action/closing segments, estimated duration, play count, and completion timestamp
- iOS Brief tab playback through native `expo-speech`; no generated audio files or external TTS provider
- Playback event endpoint for started/completed listens and app-event analytics
- Admin metrics for generated voice briefs, completed listens, and average duration
- Data export includes generated voice brief scripts and playback metadata
- **Exit gate:** premium gate, idempotent script generation, 90-second duration target, playback events, export, and admin metrics are covered by `apps/api/src/test/phase10.test.ts`.

**Implementation status in this repo:** Phase 10 is implemented behind the
existing `zen_coach` entitlement. The API owns the `voice_briefs` table and
`/api/voice-brief/*` routes. The iOS app uses Expo Speech for on-device
playback from the Brief tab. Docs are updated in `docs/VOICE_BRIEFS.md`,
README, deploy checklist, privacy inventory, App Store privacy inventory,
growth loop, and security notes.

### Phase 11 — Money Physical *(Post-launch feature train item 4)*
- One-time App Store purchase through RevenueCat non-subscription product `com.rushingtechnologies.zenfinance.money_physical`
- Persisted `money_physical_reports` table keyed by RevenueCat transaction id for idempotent restore/webhook handling
- Deterministic 90-day report with score, cash-flow section, spending concentration, goal pacing, recurring burden, Money Wins totals, and three bounded action items
- iOS Money Wins tab purchase/restore surface plus generated report display
- RevenueCat webhook support for `NON_RENEWING_PURCHASE`, client restore endpoint, mobile home status, privacy export, and admin metrics
- **Exit gate:** status, restore, idempotent report generation, webhook duplicate handling, mobile home inclusion, export, and admin metrics are covered by `apps/api/src/test/phase11.test.ts`.

**Implementation status in this repo:** Phase 11 is implemented as a one-time
Money Physical report product. The API owns the `money_physical_reports` table,
`/api/money-physical/*` routes, and RevenueCat non-subscription webhook
handling. The iOS app exposes purchase, restore, and report viewing from the
Money Wins tab. Docs are updated in `docs/MONEY_PHYSICAL.md`, README, deploy
checklist, privacy inventory, App Store privacy inventory, growth loop, public
privacy/terms pages, launch runbook, and security notes.

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Plaid costs balloon at scale | Provider abstraction from day 1; Teller evaluated in parallel; negotiate at Growth tier; §1033 tailwind |
| Insight quality is generic → churn | Persona eval suite in CI; every insight requires a dollar figure + action; user feedback loop; Money Wins as the quality scoreboard |
| LLM cost creep | Model tiering (Haiku for volume), prompt caching, aggregates-not-raw-data prompting, per-user cost metering with alerts |
| Trust/security incident | Read-only scope, no credentials stored, KMS-encrypted tokens, agent-audited gates every phase, minimal PII in prompts |
| "Not financial advice" line | Guardrailed prompt + provenance/rules pass, no investment/tax advice, standing disclosures, deterministic math for simulations |
| Solo-builder burnout / scope creep | Phase exit gates; the §2 "deliberately excluded" list; one growth experiment per week, not five |
| App Store rejection (finance category) | `MobileDeployAgent` checklists, privacy labels done early, read-only posture documented for review notes |
| Single-platform dependence (iOS only) | Accepted trade-off for focus; API and shared packages are platform-agnostic, so an Android/Expo build is a later option, not a rewrite |

---

## 10. KPI Dashboard (tracked from Phase 4)

- **Activation:** signup → account linked (target >60%), link → first brief viewed (>90%, it's automatic)
- **Engagement:** weekly brief open rate (>50%), action follow-through rate (>15%)
- **Value proof:** verified Money Wins $/user/month (>$25 — must exceed 3× the subscription price)
- **Revenue:** trial→paid (>40%), free→paid (5–8%), MRR, churn (<5%/mo)
- **Cost:** blended cost/user/month (<$3), AI cost per brief, Plaid cost per item
- **Quality:** persona-suite pass rate (100%), insight thumbs-up ratio (>80%), Sentry crash-free sessions (>99.5%)

---

*Current status: Phases 0–11 are built in code where repo work can complete them. The app and API now cover onboarding, Plaid Link, first-look/weekly brief cards, Voice Brief playback, coach chat over scoped server-side transaction queries, goals, deterministic what-if simulation, subscription audit, Money Wins, Money Physical one-time reports, notification preferences, RevenueCat monetization, Sentry hardening, privacy export/delete rights, Plaid item-status recovery, beta metrics, referral credits, launch KPIs, public aggregate launch insights, Phase 7 runbooks, Phase 8 Freelancer Mode for variable-income users, Phase 9 Household Sharing with shared goals and individual privacy zones, Phase 10 Voice Briefs, and Phase 11 Money Physical. Mock-provider paths and Phase 11 tests pass. Real-world gates still require external credentials, approvals, distribution, and live operations: Plaid production approval, App Store/TestFlight review, attorney sign-off, EAS/App Store publication, RevenueCat product configuration, Sentry observation, launch promotion, and 90-day KPI measurement.*
