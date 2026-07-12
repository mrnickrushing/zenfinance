# Freelancer Mode

Last updated: July 12, 2026

Freelancer Mode is the Phase 8 post-launch feature for variable-income users. It is included behind the existing `zen_coach` premium entitlement in this implementation; packaging can move to a higher tier or add-on later without changing the data model.

## Product Surface

- iOS Settings exposes Freelancer Mode for premium users.
- Users can save:
  - monthly income target
  - estimated set-aside percentage
  - runway target in months
  - enabled/paused state
- The panel shows average monthly income, cash runway, estimated monthly set-aside, income target gap, and the top recommendations.

## API

All routes require an authenticated premium user. Free users receive the standard `402 premium_required` payload with `feature: "freelancer_mode"`.

- `GET /api/freelancer/profile` creates and returns the user's default profile.
- `PATCH /api/freelancer/profile` updates `enabled`, `targetMonthlyIncomeCents`, `taxSetAsideBps`, and `runwayTargetMonths`.
- `GET /api/freelancer/summary` returns the six-month income/runway summary and recommendations.

## Data Model

`freelancer_profiles` stores one row per user:

- `enabled`
- `target_monthly_income_cents`
- `tax_set_aside_bps`
- `runway_target_months`
- timestamps

The row cascades on account deletion through the `users` foreign key.

## Summary Math

The summary uses the trailing six calendar months, including the current month.

- Income: posted, non-pending, non-removed, non-superseded transactions with negative `amountCents`, excluding own-account transfers.
- Essential spend: positive transactions excluding transfers where the current enrichment is not discretionary. Missing enrichment is treated conservatively as essential.
- Cash runway: cash/depository balances divided by average monthly essential spend.
- Target gap: saved target monthly income minus average monthly income, floored at zero.
- Estimated set-aside: average monthly income multiplied by `taxSetAsideBps`.
- Slow-month buffer: essential monthly spend plus estimated set-aside minus the slowest recent income month, floored at zero.

The set-aside calculation is planning math only. It is not tax advice and must stay labeled as an estimate in product copy.

## Admin Metrics

`GET /api/admin/metrics` includes:

- enabled Freelancer Mode users
- Freelancer Mode users with recent income
- average runway months where enough data exists
- average monthly target gap where users set a target

The admin console renders these as a dedicated Freelancer metrics row.

## Validation

Covered by `apps/api/src/test/phase8.test.ts`:

- free users are premium-gated
- premium users can save profile settings
- linked mock accounts produce income, set-aside, target gap, runway, and recommendations
- admin metrics report Freelancer Mode adoption
