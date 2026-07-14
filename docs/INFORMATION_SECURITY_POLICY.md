# Information Security Policy

**Company:** Rushing Technologies (ZenFinance)
**Policy owner:** Nicholas Rushing, Founder
**Adopted:** 2026-07-14
**Review cadence:** every 6 months, and after any material change to architecture, data handling, or third-party processors.

This policy documents the security program for ZenFinance, an iOS personal
finance application with a Node.js API. Rushing Technologies is a
single-member company; controls are sized to that reality and this document
records what is actually practiced, not aspirations. Supporting documents:
`docs/SECURITY_AUDIT.md` (assessment results and remediations),
`docs/FAILURE_DRILLS.md` (failure-mode drills), `docs/APP_STORE_PRIVACY.md`
(data inventory and processor list).

## 1. Ownership and Responsibility

The Founder owns the information security program end to end: policy,
risk assessment, secure development, vendor selection, incident response,
and remediation. Security contact: `support@rushingtechnologies.com`
(monitored).

## 2. Risk Assessment and Review

Risks are assessed on a defined cadence and at defined trigger points:

- **Monthly:** dependency vulnerability review (`npm audit
  --audit-level=high` gate; moderate advisories in non-production tooling
  are tracked in `SECURITY_AUDIT.md` and rechecked).
- **Every pull request:** automated CI security scan (heuristic pass) plus
  typecheck and test suite; release branches additionally run an
  LLM-triaged scan where CONFIRMED findings at or above the configured
  severity fail the build (`.github/scripts/gate_security_scan.py`).
- **Before each external release:** the release checklist in
  `SECURITY_AUDIT.md` (typecheck, full API test suite, build, dependency
  audit, native dependency check).
- **On architectural change:** any new data category, third-party
  processor, or externally reachable surface triggers an update to the
  data inventory (`APP_STORE_PRIVACY.md`) and this policy.
- **Failure drills:** documented failure modes (provider webhook outage,
  reauthentication, LLM provider failure, billing webhook failure, account
  deletion failure) with expected behavior and the automated tests that
  validate each (`FAILURE_DRILLS.md`).

Findings deemed material are remediated before release; applied
remediations are recorded in `SECURITY_AUDIT.md`.

## 3. Access Control

- Production infrastructure (Railway), DNS/static hosting (Cloudflare),
  source control (GitHub), and vendor dashboards (Plaid, RevenueCat,
  Sentry, Anthropic, Resend, Apple/Expo) are accessible only to the
  Founder, with per-service authentication and MFA where the provider
  supports it.
- The API enforces authentication on all user routes (JWT), hashes
  passwords with bcrypt, and gates the admin console behind a separate
  high-entropy secret.
- Per-user and per-route rate limiting is enforced on sensitive endpoints
  (authentication, account linking, token exchange).
- The API refuses to start with missing or weak secrets (fail-closed
  environment validation) rather than falling back to defaults.

## 4. Data Protection

- **In transit:** TLS for all client–API and API–vendor traffic; the iOS
  app enforces App Transport Security with no arbitrary-loads exceptions.
- **At rest:** the production Postgres database is hosted on Railway with
  provider-managed encryption at rest. Bank access tokens are additionally
  encrypted at the application layer (AES-256-GCM with a dedicated key)
  before storage, so database access alone does not expose provider
  tokens.
- **On device:** session tokens are stored in the iOS Keychain via
  SecureStore with device-bound accessibility.
- **Minimization:** bank access is read-only; card/payment details are
  never stored (subscription state only, via RevenueCat); LLM processors
  receive compact, redacted summaries — never credentials or raw access
  tokens.
- **Secrets:** all credentials live in platform environment configuration
  (Railway), never in the repository; encryption and signing keys are
  generated with a CSPRNG at 256-bit strength.

## 5. Secure Development

- All changes flow through pull requests with automated review, CI
  typechecking, an automated test suite (including webhook-signature,
  authorization, rate-limit, and deletion-path tests), and the security
  scan described in §2.
- Inbound webhooks are cryptographically verified (Plaid: ES256 JWT with
  body-hash and issued-at freshness checks; RevenueCat: shared-secret
  authorization plus HMAC signature).
- Request bodies are schema-validated (Zod) with size limits; responses
  set `Cache-Control: no-store` on financial/session data; standard
  hardening headers via Helmet; CORS restricted to first-party origins in
  production.
- Error handling is centralized: clients never receive stack traces, and
  logs/telemetry are scrubbed of tokens, secrets, credentials, and
  email-like keys before leaving the server.

## 6. Monitoring and Incident Response

- Runtime errors and crashes are captured in Sentry (server and iOS) with
  PII scrubbing enabled at both SDK and event-processing layers.
- On detection of a suspected incident the Founder: (1) triages severity
  and scope from telemetry and logs; (2) contains it (revoking credentials,
  disabling the affected surface, or rolling back); (3) remediates root
  cause; (4) notifies affected users and processors as required by
  applicable law and vendor agreements (Plaid incident reporting
  included); (5) records the event and remediation in
  `SECURITY_AUDIT.md`.
- Users can disconnect linked institutions, export their data, or delete
  their account at any time; deletion revokes provider access, cascades
  removal, and writes a non-PII audit event.

## 7. Vendor and Third-Party Management

Processors are limited to those listed in `APP_STORE_PRIVACY.md` (Plaid,
RevenueCat, Anthropic, Sentry, Expo/APNs, Resend, plus Railway, Cloudflare,
and GitHub as infrastructure). Each receives the minimum data needed for
its function. Adding a processor requires updating the data inventory,
the App Store privacy disclosure, and this policy.

## 8. Independent Assurance

Internal security assessments are performed and documented (most recent:
July 2026, `SECURITY_AUDIT.md`), supplemented by automated scanning on
every change. Independent third-party penetration testing has not yet been
performed; it will be commissioned as the user base and team grow, and
this section will be updated when that occurs.
