# Phase 11 Money Physical

Money Physical is the post-Phase-10 one-time report product. It is sold as a non-subscription App Store purchase through RevenueCat and generates a deterministic 90-day money checkup from the user's existing ZenFinance data.

## Product

- Product id: `com.rushingtechnologies.zenfinance.money_physical`
- Price label: `$14.99`
- Access model: one-time purchase, separate from the `zen_coach` subscription entitlement
- iOS surface: Money Wins tab, above the Money Wins ledger

## Backend

- `money_physical_reports` stores one generated report per RevenueCat transaction id.
- `GET /api/money-physical/status` returns purchase/report state and the latest report.
- `POST /api/money-physical/restore` validates the authenticated RevenueCat app user id, accepts a non-subscription transaction id, and generates the report.
- `/api/webhooks/revenuecat` also generates the report when RevenueCat posts a `NON_RENEWING_PURCHASE` event for the Money Physical product.

The report is deterministic. It scores:

- 90-day income, spending, net cash flow, and savings rate
- top spending categories and largest charge
- active/behind goals and remaining goal balance
- recurring monthly burden and cancellation candidates
- verified and estimated Money Wins

The action plan is bounded to three concrete actions and labels estimated impact separately from verified Money Wins.

## Privacy

Money Physical does not send additional data to a new processor. RevenueCat handles the purchase receipt; ZenFinance stores the product id, transaction id, purchase timestamp, generated report sections, score, and action plan. Data export includes generated Money Physical reports, and account deletion removes them through the user cascade.

## Admin Metrics

`/api/admin/metrics` includes:

- purchased reports
- generated reports
- average score
- estimated one-time report revenue at `$14.99` per report

## Exit Gate

`apps/api/src/test/phase11.test.ts` covers status before purchase, client restore, idempotent generation, mobile home inclusion, RevenueCat webhook processing, duplicate webhook handling, data export, and admin metrics.
