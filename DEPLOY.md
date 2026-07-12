# Deploying ZenFinance (site + API) to Railway

One Railway service runs the Express API, which also serves the built site
(marketing, support, legal, admin) at `zenfinance.rushingtechnologies.com`.

## 1. Railway project

1. Create a new Railway project → **Deploy from GitHub repo** → `mrnickrushing/zenfinance`, branch `main`.
2. Add a **PostgreSQL** database to the project (Railway injects `DATABASE_URL` into the service).
3. In the service settings, set **Config Path** to `infra/railway.toml` (or copy that file to the repo root as `railway.toml`).
   - Build: nixpacks, `npm ci && npm run build && npm run db:migrate -w @zenfinance/api` (migrations run at build/deploy time against the linked DB)
   - Start: `node apps/api/dist/server.js`
   - Health check: `/health` (verifies the DB with `SELECT 1`)

## 2. Environment variables (service → Variables)

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | `openssl rand -hex 32` — min 32 chars, the API refuses to boot without it |
| `ADMIN_SECRET` | `openssl rand -hex 32` — this is the admin console login; store it in your password manager |
| `RESEND_API_KEY` | from Resend (step 4) |
| `RESEND_FROM_EMAIL` | `zenfinance@rushingtechnologies.com` (must be on a Resend-verified domain) |
| `SUPPORT_EMAIL` | `support@rushingtechnologies.com` |
| `FRONTEND_URL` | `https://zenfinance.rushingtechnologies.com` |
| `SENTRY_DSN` | optional — from a Sentry Node project |
| `TOKEN_ENC_KEY` | `openssl rand -hex 32` — encrypts Plaid access tokens at the app layer |
| `TRANSACTION_PROVIDER` | `plaid` |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` | from the Plaid dashboard (sandbox keys until production access is approved) |
| `PLAID_ENV` | `sandbox` → `production` after Plaid approves the app |
| `APPLE_BUNDLE_ID` | `com.rushingtechnologies.zenfinance` (Apple Sign-In verification) |
| `REDIS_URL` | add a **Redis** service to the Railway project; sync/enrichment/rollup jobs run on BullMQ |
| `ENRICHMENT_PROVIDER` | `anthropic` |
| `ANTHROPIC_API_KEY` | from the Anthropic Console — powers transaction categorization (Haiku) and coaching briefs (Sonnet) |
| `ENRICHMENT_MODEL` | `claude-haiku-4-5` |
| `INSIGHT_PROVIDER` | `anthropic` |
| `INSIGHT_MODEL` | `claude-sonnet-5` — the coaching brief runs on Sonnet for reasoning quality |
| `REVENUECAT_IOS_API_KEY` | RevenueCat public iOS SDK key; also set this in `apps/ios/app.json` for builds |
| `REVENUECAT_SECRET_API_KEY` | RevenueCat secret REST key for server-side subscriber refresh and restore validation |
| `REVENUECAT_WEBHOOK_AUTH` | Shared Authorization value configured on the RevenueCat webhook |
| `REVENUECAT_WEBHOOK_SIGNING_SECRET` | RevenueCat webhook HMAC signing secret |
| `REVENUECAT_ENTITLEMENT_ID` | `zen_coach` |
| `REVENUECAT_MONTHLY_PRODUCT_ID` | `com.rushingtechnologies.zenfinance.coach.monthly` |
| `REVENUECAT_ANNUAL_PRODUCT_ID` | `com.rushingtechnologies.zenfinance.coach.annual` |

`PORT` and `DATABASE_URL` are provided by Railway automatically.

**Plaid webhook:** in the Plaid dashboard, set the transactions webhook URL to
`https://zenfinance.rushingtechnologies.com/api/webhooks/plaid`.

**RevenueCat webhook:** in RevenueCat, set the webhook URL to
`https://zenfinance.rushingtechnologies.com/api/webhooks/revenuecat`, set the
Authorization header to `REVENUECAT_WEBHOOK_AUTH`, and enable webhook signing
with `REVENUECAT_WEBHOOK_SIGNING_SECRET`.

## 3. Custom domain (GoDaddy DNS)

1. Railway service → Settings → Networking → **Custom Domain** → `zenfinance.rushingtechnologies.com`. Railway shows a CNAME target.
2. GoDaddy → DNS for `rushingtechnologies.com` → add record:
   - Type `CNAME`, Name `zenfinance`, Value = the Railway CNAME target, TTL default.
3. Wait for the certificate to issue (usually minutes). Verify `https://zenfinance.rushingtechnologies.com/health` returns `{"ok":true,"db":"up"}`.

## 4. Support email (Resend)

1. Resend → Domains → add `rushingtechnologies.com` and add the DKIM/SPF records it lists to GoDaddy DNS. Wait for verification.
2. Create an API key → set `RESEND_API_KEY` on the Railway service.
3. Support-form tickets are stored in Postgres **first** and then emailed to `SUPPORT_EMAIL`; if email delivery fails they still appear in the admin console inbox.

## 5. Post-deploy checklist

- [ ] `/health` returns 200 with `db: "up"`
- [ ] Waitlist form on `/` stores a row (check the admin console)
- [ ] Support form on `/support` stores a ticket AND arrives at support@rushingtechnologies.com
- [ ] `/admin` login works with `ADMIN_SECRET`; metrics, waitlist, CSV export, and inbox render
- [ ] CORS: requests from other origins are rejected (`FRONTEND_URL` is the only allowed origin)
- [ ] Sentry receives a test event (if configured)
- [ ] RevenueCat sandbox purchase, cancellation, refund, and restore update `/api/billing/status`
- [ ] RevenueCat Money Physical one-time purchase posts `NON_RENEWING_PURCHASE`, creates a `money_physical_reports` row, appears in `GET /api/money-physical/status`, and shows in `/admin`
- [ ] Plaid sandbox item webhooks update item state (`login_required`, `active`, `disconnected`)
- [ ] `/api/me/export` returns an authenticated data export and `DELETE /api/me` records a non-PII deletion audit event
- [ ] App Store privacy answers in `docs/APP_STORE_PRIVACY.md` match the final native build and App Store Connect entry
- [ ] Referral redemption works: `/api/referrals/me`, `/api/referrals/redeem`, and billing status shows referral premium credit
- [ ] `/insights` loads aggregate launch stats and suppresses public copy below the minimum sample size
- [ ] Freelancer Mode works for premium users: `GET /api/freelancer/summary` returns income/runway data, free users get `402 premium_required`, and `/admin` shows the Freelancer metrics row
- [ ] Household Sharing works: free users get `402 premium_required` on household creation, a premium owner can create a household, share an invite, the invited account can accept, shared goals accept contributions, and `/admin` shows the Household metrics row
- [ ] Voice Briefs work: free users get `402 premium_required`, premium users get `GET /api/voice-brief/latest`, iOS plays it through native speech, playback events post to `/api/voice-briefs/:id/events`, and `/admin` shows the Voice Brief metrics row
- [ ] Money Physical works: the Money Wins tab loads the one-time RevenueCat product, purchase/restore syncs the non-subscription transaction id to `/api/money-physical/restore`, the generated report renders, export includes it, and `/admin` shows the Money Physical metrics row
- [ ] Database backups: enable Railway's Postgres backups, and note the retention window in the privacy policy (deletion propagation)

## Local development

```bash
docker compose up -d          # Postgres 15 on :5432
cp .env.example .env          # fill in JWT_SECRET + ADMIN_SECRET (32+ chars each)
npm install
npm run db:migrate -w @zenfinance/api
npm run dev:api               # API on :3000
npm run dev:site              # Vite on :5173, proxies /api + /health to :3000
docker start zenfinance-test-postgres || docker run --name zenfinance-test-postgres -e POSTGRES_USER=dev -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=zenfinance_test -p 5434:5432 -d postgres:15
DATABASE_URL=postgres://dev:dev@localhost:5434/zenfinance_test npm run test -w @zenfinance/api
```
