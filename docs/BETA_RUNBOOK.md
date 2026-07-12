# Closed Beta Runbook

Last updated: 2026-07-12

## Entry Criteria

- GitHub Actions green on `main`.
- Railway production `/health` returns `{ "ok": true, "db": "up" }`.
- Plaid production access approved or beta explicitly limited to sandbox/test institutions.
- RevenueCat sandbox purchase, restore, cancellation, refund, and webhook paths verified.
- App Store Connect TestFlight build uploaded with the privacy policy URL.
- No critical Sentry issues open for the current build.

## TestFlight Cohort

- Start with 10 friendly users.
- Expand to 50 only after 7 days with no critical Sentry issues.
- Expand to 100 only after activation and support load are stable.

## Metrics To Watch

Admin dashboard now exposes:

- Registered users.
- Linked users.
- First-brief activation rate.
- Users who report follow-through on an insight.
- Week-4 retention.

Target thresholds for Phase 6 exit:

- Week-4 retention greater than 30%.
- At least 5 friendly users linked.
- At least 3 users report acting on one insight.
- Zero critical Sentry issues for 7 days.

## Daily Beta Routine

1. Check Railway health and logs.
2. Check Sentry for critical/high-frequency issues.
3. Check admin beta metrics.
4. Review support tickets.
5. Confirm Plaid webhook delivery has no persistent failures.
6. Confirm RevenueCat entitlement webhooks match subscription events.

## Escalation Rules

- Critical data access bug: disable new TestFlight invites, revoke affected sessions if needed, fix forward.
- Plaid outage or webhook backlog: leave linking enabled only if sync latency is acceptable; otherwise pause invites and post support notice.
- LLM provider outage: keep app live; template fallback should continue producing briefs.
- Billing webhook failure: keep purchase UI live only if RevenueCat SDK restore/status refresh works; otherwise pause premium tests.
