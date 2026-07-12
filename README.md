# ZenFinance

**A calm, plain-English AI money coach. Not another dashboard. iOS only.**

ZenFinance links bank and card accounts (read-only, via Plaid), enriches every transaction with AI, and delivers short, actionable coaching — *"Cut dining out by $45 this week to hit your savings goal — here's a simple swap"* — instead of charts the user has to interpret themselves.

The product ships exclusively as an **iOS app**. The web presence at [zenfinance.rushingtechnologies.com](https://zenfinance.rushingtechnologies.com) is non-product: marketing + waitlist, support, legal pages, and an owner admin console.

## Repo layout

```
apps/api/          Express + TypeScript + Zod + Drizzle/Postgres — the backend
                   (waitlist, support, admin console now; the iOS app's API later)
apps/site/         Marketing page, support, privacy/terms, admin console
                   (Vite + React + Tailwind; static build served by the API)
apps/ios/          Placeholder — the Expo iOS app lands here in the product phase
packages/shared/   Zod schemas + API types shared across workspaces
infra/             railway.toml deploy config
```

## Docs

- **[PLAN.md](PLAN.md)** — the full product + technical plan: premium feature set, architecture, AI coaching engine, security/compliance, unit economics, and the 8-phase roadmap (~16–20 weeks) to App Store launch
- **[DEPLOY.md](DEPLOY.md)** — Railway deploy, GoDaddy DNS, Resend email setup, and the local dev loop

## Quick start

```bash
docker compose up -d                     # Postgres 15
cp .env.example .env                     # set JWT_SECRET + ADMIN_SECRET (32+ chars)
npm install
npm run db:migrate -w @zenfinance/api
npm run dev:api                          # API on :3000
npm run dev:site                         # site on :5173
npm test                                 # API test suite (needs zenfinance_test DB)
```
