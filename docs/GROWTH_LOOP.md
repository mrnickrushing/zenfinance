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
5. Subscription-auditor entry point from Money Wins.

## Content Flywheel

The `/insights` page reads `GET /api/content/launch-stats` and publishes only anonymized aggregate metrics. The API suppresses publishable content until the linked-user sample reaches the configured minimum. Never publish raw transactions, merchants tied to a single user, or small-cohort slices.

## Feature Train

Demand order stays:

1. Freelancer mode.
2. Household sharing.
3. Voice brief.
4. Money Physical one-time report.
5. Net-worth view.

A feature moves forward only when support tickets, user interviews, and usage data all point to the same demand.
