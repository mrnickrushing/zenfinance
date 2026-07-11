# ZenFinance — AI Personal Finance Coach

**A calm, plain-English money coach. Not another dashboard.**

ZenFinance links a user's bank and card accounts, enriches every transaction with AI, and delivers short, actionable coaching — *"Cut dining out by $45 this week to hit your savings goal — here's a simple swap"* — instead of charts the user has to interpret themselves. The product's entire personality is the opposite of Mint/YNAB: fewer screens, fewer numbers, one clear next action.

This document is the full product + technical plan: premium feature set, architecture on the RushingTech stack, the AI coaching engine, security/compliance, monetization with unit economics, the tooling workflow (including the [`mrnickrushing/agents`](https://github.com/mrnickrushing/agents) toolkit), and a phased roadmap from empty repo to public launch.

---

## 1. Positioning & Target User

**One-liner:** "A financial coach in your pocket that reads your transactions so you don't have to."

**Who it's for (launch niche → expansion):**

1. **Launch niche — US millennials/Gen-Z with income but no system** (25–40, $50k–$150k household income, 1–3 financial goals, allergic to spreadsheets). They abandoned Mint/YNAB because those tools demand work; ZenFinance demands nothing after linking.
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

### Premium — "ZenFinance Coach" ($7.99/mo or $59.99/yr)
- **Unlimited accounts** and full transaction history
- **On-demand chat coach:** conversational Q&A over the user's own data ("How much did I spend on my trip?", "Can I afford a $2,400 e-bike in 3 months?")
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
- No payments/transfers (keeps us read-only → drastically lower compliance surface)
- No investment advice/brokerage data at launch (regulatory line we don't cross; net-worth *display* only, later)
- No manual-entry budgeting workflows — that's the Mint/YNAB trap we're positioned against

---

## 3. Architecture & Stack

Chosen to match the stack the RushingTech agents toolkit already reviews and scaffolds — every layer here has a corresponding agent for review/audit (see §7).

```
┌─────────────────────────────────────────────────────────────┐
│  Clients                                                     │
│  • Mobile: Expo / React Native, Zustand, RevenueCat SDK      │
│  • Web: React + TypeScript SPA (marketing + web app)         │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS (JWT, refresh rotation)
┌──────────────────────────▼──────────────────────────────────┐
│  API — Node/Express + TypeScript on Railway                  │
│  • Zod validation on every route, Helmet, rate limiting      │
│  • Drizzle ORM → Postgres (Railway)                          │
│  • BullMQ + Redis: ingestion & insight job queues            │
│  • Stripe (web billing) + RevenueCat webhooks (mobile IAP)   │
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
        Observability: Sentry (API + mobile) · Railway metrics · PostHog product analytics
        CI/CD: GitHub Actions → Railway (API) · EAS (mobile builds/updates)
```

**Key decisions and why:**

- **Node/Express + Drizzle + Zod over FastAPI** — both are supported by the toolkit, but the mobile app is the product's center of gravity and a single TS codebase (shared types between API and clients via a `packages/shared` workspace) is worth more to a solo operator than Python's data ergonomics. Monorepo: `apps/api`, `apps/mobile`, `apps/web`, `packages/shared`.
- **Plaid as primary aggregator** — broadest US coverage (~12k institutions) and best docs; start on the free Trial/limited-production tier (~10 live items) for the entire beta. **Teller** stays a live evaluation track: its free 100-connection developer tier could carry the whole beta at $0, but coverage gaps decide it. Build a thin `providers/` interface so the aggregator is swappable — this also future-proofs against CFPB §1033 open-banking standardization.
- **Postgres schema highlights:** `users`, `items` (provider connections), `accounts`, `transactions` (raw + enriched columns), `recurring_streams`, `goals`, `insights` (generated coaching artifacts with feedback state), `money_wins`, `subscriptions_billing`. Transaction table is append-only with enrichment versioning so re-categorization never destroys history.
- **Job-queue-first ingestion:** Plaid webhooks enqueue sync jobs; enrichment and insight generation are separate queue stages. Nothing AI-related happens in a request cycle except chat.
- **Claude model tiering** (cost control is a product feature here):
  - *Haiku* for high-volume, low-stakes work: categorization, merchant name cleanup, recurring-charge detection assist, anomaly triage. Batch 50–100 transactions per call.
  - *Sonnet* for the weekly brief, chat coach, and what-if scenarios where reasoning quality is the product.
  - Prompt caching on the static system/coaching-policy prompt; per-user context assembled as compact structured summaries (see §4), never raw transaction dumps.
- **RevenueCat as the single entitlement source of truth** across Stripe (web) and App Store/Play (mobile) — its Stripe integration means one entitlements check in the API regardless of purchase platform.

---

## 4. The AI Coaching Engine

The engine is a pipeline, not a chatbot bolted onto a database.

**Stage 1 — Ingest & normalize.** Plaid sync → dedupe, pending/posted reconciliation, transfer-pair detection (so moving money between own accounts never counts as spending).

**Stage 2 — Enrich (Haiku, batched).** Category (custom taxonomy ~40 categories tuned for coaching, not accounting), cleaned merchant name, `is_recurring`, `is_discretionary`, confidence score. Low-confidence items fall back to Plaid's own enrichment; user corrections are stored and injected as few-shot examples into that user's future enrichment calls — the coach visibly *learns*.

**Stage 3 — Feature store (plain SQL, no ML infra).** Nightly per-user rollups: spend by category by week, discretionary ratio, recurring load, income cadence, goal pacing, volatility. These compact aggregates — not raw transactions — are what feed the LLM. Keeps prompts small, cheap, and privacy-tighter.

**Stage 4 — Insight generation (Sonnet).** Weekly job assembles: user profile + goals, 8-week aggregate trends, notable events (anomalies, new recurring charges, goal pacing drift), and the coaching policy prompt. Output is Zod-validated JSON: `{ headline, body, action: { description, estimated_impact_usd, timeframe }, tone_check }`. Invalid JSON or a failed rules-pass (see guardrails) → retry once → fall back to a template insight. **Every insight must name a dollar amount and an action.**

**Stage 5 — Delivery & feedback.** Push notification → brief card in app → thumbs up/down + "did you do it?" follow-through check the next week. Feedback loops into per-user tone/topic preferences and into the Money Wins ledger when an action verifiably happened (e.g., the flagged subscription's charge stops appearing).

**Guardrails (non-negotiable):**
- Coaching policy prompt forbids: investment/tax/legal advice, shame language, fabricated numbers (every dollar figure must come from the provided aggregates — enforced by a post-generation check that extracts numbers and matches them against inputs).
- Standing "not financial advice; educational only" disclosure in-app and in onboarding.
- A `tone_check` self-rating in the output schema, plus a lightweight rules pass (banned-phrase list) before anything reaches a user.
- **Eval harness from day one:** ~50 synthetic user personas (fixture transaction sets) with golden expectations; every prompt change runs the persona suite in CI and diffs insight quality/cost. This is the moat-maintenance tool — prompt regressions are product regressions here.

---

## 5. Security, Privacy & Compliance

Read-only data access keeps ZenFinance out of money-movement regulation, but bank data demands bank-grade hygiene:

- **Never store bank credentials** — OAuth via Plaid Link only. Plaid `access_token`s live server-side, encrypted at rest (app-layer encryption with KMS-managed key, on top of Postgres disk encryption). Tokens never touch the client.
- **Auth:** JWT access + refresh-token rotation with revocation (exactly the pattern `AuthSecurityAgent` audits), Apple/Google Sign-In on mobile, optional biometric app-lock.
- **API hardening:** Helmet, strict CORS, per-user and per-IP rate limits, Zod on every input, no PII in logs (Sentry PII scrubbing configured — `InfraMonitorAgent` checks this).
- **Data minimization & user rights:** one-tap disconnect (revokes Plaid item + deletes transactions), full account deletion with 30-day purge, data export (CCPA/GDPR-ready even though launch is US-only). Delete flows are built in Phase 1, not retrofitted.
- **AI privacy posture:** only aggregates and minimal transaction context go to the model API; no third-party analytics on transaction content; document the flow in the privacy policy in plain English (this is marketing as much as compliance).
- **Roadmap items:** privacy policy + ToS from a fintech-literate template pre-beta; security review gate before every phase exit (see §7); SOC 2 Type I only when a partnership/enterprise reason exists (~post-revenue, ~$20–40k — not before).

---

## 6. Monetization & Unit Economics

**Pricing:** Free tier → **$7.99/mo** or **$59.99/yr** (37% annual discount pushes the higher-retention plan). 14-day full-featured trial, card required only on web (mobile follows store norms). Sits deliberately under YNAB (~$15/mo) and above impulse-purchase pricing — coaching should feel premium.

**Per-premium-user monthly cost model (at modest scale):**

| Cost | Estimate | Notes |
|---|---|---|
| Plaid (≈2 items/user) | $0.60–$2.00 | Trial tier is $0 through beta; negotiate at growth tier |
| LLM — enrichment (Haiku, batched) | ~$0.03–$0.08 | ~300 txns/mo enriched in batches |
| LLM — weekly briefs + chat (Sonnet, cached) | ~$0.15–$0.50 | 4 briefs + moderate chat; prompt caching cuts this hard |
| Infra amortized (Railway, Redis, Sentry) | ~$0.10–$0.30 | Flat costs spread across users |
| **Total** | **~$0.90–$2.90** | **~64–89% gross margin at $7.99** |

**Targets:** free→paid conversion 5–8% (finance apps convert well when ROI is visible — that's the Money Wins ledger's job), monthly churn <5% (annual plans + renewal-time savings recap), LTV $85–150. Break-even on fixed costs (~$100–200/mo infra + Plaid Growth minimum) at roughly **30–50 subscribers**.

**Monetization mechanics:** Stripe Checkout + customer portal on web; RevenueCat on mobile; RevenueCat as cross-platform entitlement truth. Dunning, receipt validation, and webhook handling reviewed by `StripeBillingAgent` before launch (§7).

---

## 7. Tooling & Resources — the Force-Multiplier Plan

Solo-built doesn't mean unreviewed. Every phase below has an explicit quality gate powered by tools already on hand:

**The `mrnickrushing/agents` toolkit (11 agents, 57 tools) mapped to the lifecycle:**

| Phase activity | Agent(s) | How it's used |
|---|---|---|
| Bootstrap monorepo, API, Expo app | `ScaffolderAgent` | Generate Express API, Expo app, SaaS platform scaffolding + CI configs |
| Every schema/migration | `DatabaseArchitectAgent` | FK index coverage, migration safety, N+1 detection, unique constraints |
| Every route/component PR | `CodeReviewAgent` + `APIArchitectAgent` | Express routes, Zod validation, React/Expo components, Zustand stores; pagination/status-code/error-shape consistency |
| Auth implementation | `AuthSecurityAgent` | JWT refresh rotation, Apple Sign-In nonce/JWKS/audience, Google OAuth CSRF, biometric auth |
| Phase-exit security gates | `SecurityAuditAgent` (`cli.py scan --triage`) | Helmet, OWASP Top 10, JWT, injection/XSS/CSRF, dependency scan, CORS — with LLM triage to kill false positives |
| Billing build-out | `StripeBillingAgent` | Webhook handler review, RevenueCat sync, receipt validation, dunning, billing security audit |
| Deploy & observability | `RailwayDeployAgent` + `InfraMonitorAgent` | GitHub Actions → Railway, Sentry DSN/sampling/PII config, health-check depth, alert rules, backups |
| Store submission | `MobileDeployAgent` | EAS profile review (hardcoded-secret detection), App Store/Play checklists, RevenueCat SDK setup |
| Design system & screens | `UIGenerationAgent` | Zen design system (color/type/motion/elevation) + component generation with accessibility validation |

Wire `python -m agents.cli scan` into GitHub Actions as a required check on `zenfinance` — free heuristic pass on every PR, `--triage` pass (API key in CI secrets) on release branches.

**Claude Code session agents** mirror the same coverage interactively: `project-scaffolder`, `fullstack-code-reviewer`, `security-auditor`, `stripe-billing-reviewer`, `railway-deploy-advisor`, `ui-designer` — used during development, while the CLI toolkit enforces the same standards in CI.

**External resources:** Plaid sandbox + Link SDKs, Teller sandbox (parallel evaluation), RevenueCat sandbox, Stripe test mode, PostHog free tier (product analytics), Expo EAS free tier, Railway hobby → pro. Total pre-revenue tooling spend: **≈$20–40/mo**.

---

## 8. Phased Roadmap — Start to Finish

Timeline assumes one experienced solo builder, part-to-full-time. **~16–20 weeks to public launch.** Each phase has an exit gate; don't start the next phase until the gate passes.

### Phase 0 — Foundation & Validation *(Week 1–2)*
- Landing page (React, on the `zenfinance` domain) with the one-liner, 3 example coach briefs, and a waitlist — validate message before writing app code
- Post concept to r/personalfinance-adjacent communities + Product Hunt "upcoming"; goal: 100 waitlist emails
- Plaid dashboard signup (Trial), Teller dev account, Stripe + RevenueCat accounts
- Monorepo scaffold (`ScaffolderAgent`): `apps/api`, `apps/mobile`, `apps/web`, `packages/shared`; CI skeleton with lint/typecheck/test + `agents.cli scan`
- Draft the coaching policy prompt + the 50-persona eval fixture plan
- **Exit gate:** waitlist live and collecting; repo scaffolded; CI green; Plaid sandbox keys working.

### Phase 1 — Data Spine: Linking & Ingestion *(Week 3–5)*
- Auth: email + Apple/Google Sign-In, JWT with refresh rotation (`AuthSecurityAgent` review)
- Plaid Link flow (web first — faster iteration), token exchange, encrypted token storage
- Webhook-driven transaction sync via BullMQ: initial 90-day backfill + incremental updates; dedupe, pending reconciliation, transfer-pair detection
- Drizzle schema for the core tables + delete/disconnect flows (built now, per §5)
- Provider abstraction layer; Teller spike behind it
- **Exit gate:** link a real bank account, watch 90 days of clean transactions land in Postgres, disconnect wipes them. `SecurityAuditAgent` scan passes. `DatabaseArchitectAgent` review of schema passes.

### Phase 2 — AI Enrichment *(Week 6–7)*
- Haiku batch enrichment pipeline: categories, merchant cleanup, discretionary/recurring flags, confidence scores; Plaid-enrichment fallback
- Recurring-stream detection (rules + LLM assist) → `recurring_streams`
- Nightly feature-store rollups (SQL aggregates)
- User-correction loop stored as per-user few-shots
- Eval fixtures: categorization accuracy vs. a hand-labeled 500-transaction set; target ≥90% on discretionary/essential split (matters more than exact category)
- **Exit gate:** own real data enriched with ≥90% accuracy on the split that drives coaching; cost per user per month of enrichment measured and under $0.10.

### Phase 3 — Coaching Engine MVP *(Week 8–10)*
- Insight generation job (Sonnet): weekly brief with validated JSON schema, number-grounding check, tone rules pass, template fallback
- Goals CRUD + pacing math; anomaly detection (unusual/duplicate charge, new recurring, fee) with push alerts
- Subscription auditor v1 (from `recurring_streams`)
- Money Wins ledger plumbing (insights → user confirmation → tally)
- 50-persona eval suite wired into CI; iterate the coaching prompt against it
- **Deliver value in week 1 of any user's life:** immediate "first-look brief" generated from the 90-day backfill at link time
- **Exit gate:** the weekly brief on your own real data is something you'd screenshot and send to a friend. Persona suite passes. Per-user AI cost measured.

### Phase 4 — Mobile App & Premium UX *(Week 11–14)*
- Zen design system (`UIGenerationAgent` / `ui-designer`): calm palette, generous whitespace, one-number-per-screen discipline, dark mode
- Expo app: onboarding → Plaid Link (native SDK) → first-look brief → weekly brief cards → chat coach → goals → subscription auditor → Money Wins
- Chat coach (Sonnet, streaming) over the feature store with strict scope guardrails; what-if simulator (deterministic math core + LLM narration — the LLM never does the arithmetic)
- Push notifications (Expo push): weekly brief, anomalies, goal pacing — with per-type opt-outs
- Sentry on API + mobile (`InfraMonitorAgent` config review); PostHog funnels on onboarding
- **Exit gate:** TestFlight/internal-track build; 5 friendly users linked, receiving briefs, and at least 3 report acting on one. `CodeReviewAgent` + accessibility pass on all screens.

### Phase 5 — Monetization *(Week 15–16)*
- RevenueCat entitlements (`zen_coach` premium); App Store/Play IAP products; Stripe Checkout + portal on web
- Free-tier gating (2 accounts, 1 goal, weekly brief only), 14-day trial, paywall screens framed around Money Wins ("the coach paid for itself")
- Dunning + billing webhooks (`StripeBillingAgent` + `stripe-billing-reviewer` full audit — this gate is blocking)
- Annual plan + launch pricing experiment scaffolding (PostHog A/B)
- **Exit gate:** end-to-end purchase, upgrade, cancel, refund, and restore-purchases tested in sandbox on both platforms; billing audit clean.

### Phase 6 — Hardening, Compliance & Beta *(Week 17–18)*
- Full `SecurityAuditAgent --triage` scan + `security-auditor` deep pass; fix all high/critical
- Privacy policy + ToS (fintech template, reviewed), disclosure copy audit, App Store privacy labels / Play data-safety forms
- Plaid production-access application (they review the app; lead time ~1–2 weeks — **start this at Phase 4 exit**, it runs in parallel)
- Load/failure drills: Plaid webhook outage, item re-auth flows, LLM API failure → template fallback verified
- Closed beta: 50–100 waitlist users; instrument activation (link rate, first-brief reaction) and week-4 retention
- **Exit gate:** Plaid production approved; store review passed; beta week-4 retention >30%; zero critical Sentry issues for 7 days.

### Phase 7 — Launch & Growth Loop *(Week 19+, ongoing)*
- Public launch: Product Hunt + the waitlist + finance-adjacent newsletters/podcasts; launch offer for waitlist (extended trial, not a discount — protect the price point)
- Weekly growth loop: PostHog cohort review → one retention or conversion experiment per week — nothing else
- Referral mechanic: "give a month, get a month" (finance advice spreads by word of mouth)
- Content flywheel: anonymized, aggregate insight posts ("the average subscriber has 2.3 zombie subscriptions worth $31/mo") — original data earns links
- Post-launch feature train (strictly demand-ordered): freelancer mode → household sharing → voice briefs → Money Physical one-time report → net-worth view
- Ops cadence: `agents.cli scan` in CI stays required; monthly dependency + billing audits; watch CFPB §1033 developments for aggregator-cost leverage
- **Success criteria for the first 90 days post-launch:** 1,000 free users, 60+ subscribers (break-even ×~1.5), churn <6%, Money Wins average >$25/user/month.

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Plaid costs balloon at scale | Provider abstraction from day 1; Teller evaluated in parallel; negotiate at Growth tier; §1033 tailwind |
| Insight quality is generic → churn | Persona eval suite in CI; every insight requires a dollar figure + action; user feedback loop; Money Wins as the quality scoreboard |
| LLM cost creep | Model tiering (Haiku for volume), prompt caching, aggregates-not-raw-data prompting, per-user cost metering with alerts |
| Trust/security incident | Read-only scope, no credentials stored, KMS-encrypted tokens, agent-audited gates every phase, minimal PII in prompts |
| "Not financial advice" line | Guardrailed prompt + rules pass, no investment/tax advice, standing disclosures, deterministic math for simulations |
| Solo-builder burnout / scope creep | Phase exit gates; the §2 "deliberately excluded" list; one growth experiment per week, not five |
| App Store rejection (finance category) | `MobileDeployAgent` checklists, privacy labels done early, read-only posture documented for review notes |

---

## 10. KPI Dashboard (tracked from Phase 4)

- **Activation:** signup → account linked (target >60%), link → first brief viewed (>90%, it's automatic)
- **Engagement:** weekly brief open rate (>50%), action follow-through rate (>15%)
- **Value proof:** Money Wins $/user/month (>$25 — must exceed 3× the subscription price)
- **Revenue:** trial→paid (>40%), free→paid (5–8%), MRR, churn (<5%/mo)
- **Cost:** blended cost/user/month (<$3), AI cost per brief, Plaid cost per item
- **Quality:** persona-suite pass rate (100%), insight thumbs-up ratio (>80%), Sentry crash-free sessions (>99.5%)

---

*Next step: Phase 0 — landing page + monorepo scaffold. The provider abstraction and the coaching-policy prompt are the two artifacts worth the most care; everything else is replaceable.*
