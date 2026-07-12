# Deploying ZenFinance to Railway + Cloudflare

The API runs as a single Railway service at `api.zenfinance.rushingtechnologies.com`.
The marketing site (landing, support, privacy, terms, insights) and the admin
console are separate static Cloudflare Workers at
`zenfinance.rushingtechnologies.com` and
`admin.zenfinance.rushingtechnologies.com` — they talk to the API cross-origin.
DNS for `rushingtechnologies.com` is managed in Cloudflare (not GoDaddy).

## 1. Railway project (API only)

1. Create a new Railway project → **Deploy from GitHub repo** → `mrnickrushing/zenfinance`, branch `main`.
2. Add a **PostgreSQL** database and a **Redis** database to the project (Railway injects `DATABASE_URL` / `REDIS_URL` into the service as reference variables).
3. Set the service's build/start config directly (Railway's Railpack builder doesn't reliably pick up `infra/railway.toml`'s Config Path setting in practice — set these fields on the service instead):
   - **Build command:** `npm ci --workspace=@zenfinance/api --workspace=@zenfinance/shared --include-workspace-root && npm run build`
     (workspace-scoped deliberately — Railpack auto-mounts a persistent BuildKit cache volume for `apps/site/node_modules/.vite` because it detects `vite` as a devDependency there; a plain `npm ci` tries to reconcile that workspace's `node_modules` against the lockfile and fails with `EBUSY: resource busy or locked` trying to rmdir the live mount. Scoping the install to only the workspaces the API needs avoids touching it.)
   - **Start command:** `node apps/api/dist/server.js`
   - **Healthcheck path:** `/ready` (verifies DB and production readiness prerequisites), timeout 300s
   - **Restart policy:** on_failure, max 3 retries
4. Run database migrations as a controlled release step before routing traffic to
   code that depends on them: `npm run db:migrate -w @zenfinance/api`. Keep
   migrations backward-compatible with the currently serving version so rollback
   remains possible.

## 2. Environment variables (service → Variables)

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | `openssl rand -hex 32` — min 32 chars, the API refuses to boot without it |
| `ADMIN_SECRET` | `openssl rand -hex 32` — this is the admin console login; store it in your password manager |
| `RESEND_API_KEY` | from Resend (step 4) |
| `RESEND_FROM_EMAIL` | `zenfinance@rushingtechnologies.com` (must be on a Resend-verified domain) |
| `SUPPORT_EMAIL` | `support@rushingtechnologies.com` |
| `FRONTEND_URL` | `https://zenfinance.rushingtechnologies.com` — the marketing Worker's origin, used for CORS and referral links |
| `ADMIN_URL` | `https://admin.zenfinance.rushingtechnologies.com` — the admin Worker's origin, used for CORS |
| `SENTRY_DSN` | optional — from a Sentry Node project |
| `TOKEN_ENC_KEY` | `openssl rand -hex 32` — encrypts Plaid access tokens at the app layer |
| `TRANSACTION_PROVIDER` | `plaid` |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` | from the Plaid dashboard (sandbox keys until production access is approved) |
| `PLAID_ENV` | `sandbox` → `production` after Plaid approves the app |
| `APPLE_BUNDLE_ID` | `com.rushingtechnologies.zenfinance` (Apple Sign-In verification) |
| `REDIS_URL` | injected automatically from the Redis service reference; sync/enrichment/rollup jobs run on BullMQ |
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
`https://api.zenfinance.rushingtechnologies.com/api/webhooks/plaid`.

**RevenueCat webhook:** in RevenueCat, set the webhook URL to
`https://api.zenfinance.rushingtechnologies.com/api/webhooks/revenuecat`, set the
Authorization header to `REVENUECAT_WEBHOOK_AUTH`, and enable webhook signing
with `REVENUECAT_WEBHOOK_SIGNING_SECRET`.

## 3. Custom domain for the API (Cloudflare DNS)

1. `railway domain --service zenfinance-api api.zenfinance.rushingtechnologies.com` (or via the dashboard: service → Settings → Networking → Custom Domain). Railway prints a CNAME target (`*.up.railway.app`) and a `_railway-verify` TXT record.
2. In Cloudflare DNS for the `rushingtechnologies.com` zone, add:
   - `CNAME api.zenfinance` → the Railway target, **DNS only** (grey cloud, not proxied)
   - `TXT _railway-verify.api.zenfinance` → the `railway-verify=...` value Railway gave you
3. Wait for `Verified: yes` / `Certificate status: CERTIFICATE_STATUS_TYPE_ISSUED` (`railway domain status <id>`), then confirm `https://api.zenfinance.rushingtechnologies.com/health` returns `{"ok":true,"db":"up"}`.

## 4. Marketing site + admin console (Cloudflare Workers)

The site (`apps/site`) builds as **two** static bundles from one Vite codebase,
selected by `VITE_APP_TARGET` at build time, each deployed as its own Worker
with static assets (no D1/KV needed — both talk directly to the Railway API
cross-origin via `VITE_API_URL` + `credentials: 'include'`):

```bash
npm run build:site   # builds dist-marketing/ and dist-admin/ (apps/site)

cd apps/site
npx wrangler deploy --config wrangler.site.jsonc   # zenfinance-site  -> zenfinance.rushingtechnologies.com
npx wrangler deploy --config wrangler.admin.jsonc  # zenfinance-admin -> admin.zenfinance.rushingtechnologies.com
```

`wrangler.site.jsonc` / `wrangler.admin.jsonc` each declare a `routes` entry
with `custom_domain: true`, which makes `wrangler deploy` provision the
Cloudflare DNS record and certificate automatically — no manual DNS step
needed for these two, unlike the Railway API domain above.

Requires a Cloudflare API token (Workers Scripts:Edit, Account:Read) exported
as `CLOUDFLARE_API_TOKEN` for `wrangler`.

## 5. Support email (Resend)

1. Resend → Domains → add `rushingtechnologies.com` and add the DKIM/SPF records it lists to Cloudflare DNS. Wait for verification.
2. Create an API key → set `RESEND_API_KEY` on the Railway service.
3. Support-form tickets are stored in Postgres **first** and then emailed to `SUPPORT_EMAIL`; if email delivery fails they still appear in the admin console inbox.

## 6. Post-deploy checklist

- [ ] `/health` returns 200 with `db: "up"` at `api.zenfinance.rushingtechnologies.com`
- [ ] Marketing site loads at `zenfinance.rushingtechnologies.com`; waitlist form on `/` stores a row (check the admin console)
- [ ] Support form on `/support` stores a ticket AND arrives at support@rushingtechnologies.com
- [ ] Admin console loads at `admin.zenfinance.rushingtechnologies.com`; login works with `ADMIN_SECRET`; metrics, waitlist, CSV export, and inbox render
- [ ] CORS: requests from origins other than `FRONTEND_URL` and `ADMIN_URL` are rejected
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
npm run dev:site               # Vite on :5173, proxies /api + /health to :3000
npm test                       # uses test Postgres on :5434 from compose
```

`npm run dev:site` runs the marketing route tree (Landing, Insights, Support,
Privacy, Terms) since `VITE_APP_TARGET` is unset in plain dev mode. To work on
the admin console locally, run `npm run dev:admin -w @zenfinance/site`
instead. Committed Vite mode env files point at `http://localhost:3000`; set
`VITE_API_URL` in the deployment environment for production Cloudflare builds.
