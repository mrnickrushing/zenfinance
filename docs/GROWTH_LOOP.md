# Growth Loop

Last updated: July 12, 2026

## Weekly Cadence

Monday:

- Review admin launch metrics.
- Pick one experiment: activation, paywall conversion, weekly brief engagement, referral sharing, or Money Wins proof.
- Write the expected metric movement before changing code or copy.

Wednesday:

- Check early operational quality: support tickets, Sentry, failed webhooks, billing issues, referral errors.
- Stop the experiment early only if it creates support or trust risk.

Friday:

- Record the result and ship, revert, or iterate.
- Publish an aggregate insight only if `/api/content/launch-stats` is above the minimum sample size.

## Experiment Backlog

1. Referral share copy: Money Wins framing vs. early-access framing.
2. Paywall framing: Money Wins ROI vs. unlimited coach access.
3. First-brief prompt variants that increase action follow-through.
4. Weekly brief notification timing.
5. Voice Brief entry point from Brief tab vs. notification prompt.
6. Household Sharing entry point from Settings vs. shared-goal prompts.
7. Freelancer Mode entry point from Settings vs. brief recommendations.
8. Subscription-auditor entry point from Money Wins.

## Content Flywheel

The `/insights` page reads `GET /api/content/launch-stats` and publishes only anonymized aggregate metrics. The API suppresses publishable content until the linked-user sample reaches the configured minimum. Never publish raw transactions, merchants tied to a single user, or small-cohort slices.

## Feature Train

Demand order after Phase 11:

1. Net-worth view.

A feature moves forward only when support tickets, user interviews, and usage data all point to the same demand.

Built train:

- Phase 8: Freelancer Mode.
- Phase 9: Household Sharing.
- Phase 10: Voice Briefs.
- Phase 11: Money Physical one-time report.
