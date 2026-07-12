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

`PORT` and `DATABASE_URL` are provided by Railway automatically.

**Plaid webhook:** in the Plaid dashboard, set the transactions webhook URL to
`https://zenfinance.rushingtechnologies.com/api/webhooks/plaid`.

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
- [ ] Database backups: enable Railway's Postgres backups, and note the retention window in the privacy policy (deletion propagation)

## Local development

```bash
docker compose up -d          # Postgres 15 on :5432
cp .env.example .env          # fill in JWT_SECRET + ADMIN_SECRET (32+ chars each)
npm install
npm run db:migrate -w @zenfinance/api
npm run dev:api               # API on :3000
npm run dev:site              # Vite on :5173, proxies /api + /health to :3000
npm test                      # needs a zenfinance_test database
```
