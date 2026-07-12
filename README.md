# ZenFinance

**A calm, plain-English AI money coach. Not another dashboard. iOS only.**

ZenFinance links bank and card accounts (read-only, via Plaid), enriches every transaction with AI, and delivers short, actionable coaching — *"Cut dining out by $45 this week to hit your savings goal — here's a simple swap"* — instead of charts the user has to interpret themselves.

The product ships exclusively as an **iOS app**. The web presence at [zenfinance.rushingtechnologies.com](https://zenfinance.rushingtechnologies.com) is non-product: marketing + waitlist, support, legal pages, and an owner admin console.

## Repo layout

```
apps/api/          Express + TypeScript + Zod + Drizzle/Postgres — the backend
                   (auth, linking, coaching, billing, webhooks, site serving)
apps/site/         Marketing page, support, privacy/terms, admin console
                   (Vite + React + Tailwind; static build served by the API)
apps/ios/          Expo iOS app with Plaid Link, coaching screens, RevenueCat IAP
packages/shared/   Zod schemas + API types shared across workspaces
infra/             railway.toml deploy config
```

## Docs

- **[PLAN.md](PLAN.md)** — the full product + technical plan: premium feature set, architecture, AI coaching engine, security/compliance, unit economics, and the 8-phase roadmap (~16–20 weeks) to App Store launch
- **[DEPLOY.md](DEPLOY.md)** — Railway deploy, GoDaddy DNS, Resend email setup, and the local dev loop
- **[docs/APP_STORE_PRIVACY.md](docs/APP_STORE_PRIVACY.md)** — App Store privacy answers and data inventory
- **[docs/PLAID_PRODUCTION_CHECKLIST.md](docs/PLAID_PRODUCTION_CHECKLIST.md)** — Plaid production-access checklist and webhook coverage
- **[docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)** — Phase 6 dependency audit, remediations, and release security checks
- **[docs/BETA_RUNBOOK.md](docs/BETA_RUNBOOK.md)** / **[docs/FAILURE_DRILLS.md](docs/FAILURE_DRILLS.md)** — TestFlight beta operations and outage drills

## Quick start

```bash
docker compose up -d                     # Postgres 15
cp .env.example .env                     # set JWT_SECRET + ADMIN_SECRET (32+ chars)
npm install
npm run db:migrate -w @zenfinance/api
npm run dev:api                          # API on :3000
npm run dev:site                         # site on :5173
docker start zenfinance-test-postgres || docker run --name zenfinance-test-postgres -e POSTGRES_USER=dev -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=zenfinance_test -p 5434:5432 -d postgres:15
DATABASE_URL=postgres://dev:dev@localhost:5434/zenfinance_test npm run test -w @zenfinance/api
```

For iOS store testing, set `REVENUECAT_IOS_API_KEY` on the API and
`expo.extra.revenueCatIosApiKey` in `apps/ios/app.json`, then run an Expo dev
build. RevenueCat webhooks should post to `/api/webhooks/revenuecat`.
