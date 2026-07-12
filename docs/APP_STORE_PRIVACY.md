# App Store Privacy Answers

Last updated: 2026-07-12

Use this as the source inventory for App Store Connect's App Privacy section. Apple requires the answers to cover ZenFinance and third-party SDKs/processors integrated into the app.

## Privacy Policy URL

`https://zenfinance.rushingtechnologies.com/privacy`

## Tracking

ZenFinance does not track users across apps or websites owned by other companies, and it does not sell data.

## Data Linked To The User

| App Store data type | Collected | Purpose | Notes |
|---|---:|---|---|
| Contact Info: Email Address | Yes | App functionality, account management, support | Stored in Postgres. Used for sign-in/support only. |
| Financial Info: Payment Info | No | N/A | App Store and RevenueCat process subscription state; ZenFinance stores entitlement status, product id, renewal/cancellation dates, and RevenueCat app user id, not card details. |
| Financial Info: Credit Info | No | N/A | Not collected. |
| Financial Info: Other Financial Info | Yes | App functionality, analytics within the product | Plaid account balances, account metadata, transactions, recurring streams, goals, shared household goals, Freelancer Mode profile settings, alerts, and coaching artifacts. |
| User Content: Customer Support | Yes | Support | Support tickets submitted on the site/API. |
| Identifiers: User ID | Yes | App functionality, account management | Internal user id and RevenueCat app user id. |
| Purchases | Yes | App functionality | Subscription entitlement/product status from RevenueCat. |
| Usage Data: Product Interaction | Yes | Analytics | First-party app events only: registration, linking, paywall, coach use, referrals, Household Sharing use, Freelancer Mode use, and beta/launch retention events. |
| Diagnostics: Crash Data | Yes | App stability | Sentry with `sendDefaultPii=false` and server-side scrubbing. |

## Data Not Linked To The User

Aggregate launch metrics may be published without linking to a user only after the minimum sample size is reached. These are derived from first-party app data and do not include raw transactions or user-level slices.

## Third-Party Processors And SDKs

| Processor/SDK | Data shared | Purpose |
|---|---|---|
| Plaid | Institution account metadata and transactions through the user's linked item | Read-only account linking and transaction sync. |
| RevenueCat | App user id, subscription product/entitlement state, store receipt handling | App Store subscription entitlement management. |
| Anthropic | Compact coaching context and redacted transaction summaries, not raw access tokens or credentials | Transaction enrichment and coaching brief generation when enabled. |
| Sentry | Crash/error diagnostics after PII scrubbing | Reliability and crash triage. |
| Expo Notifications/APNs | Push token and notification delivery metadata | Weekly briefs, anomalies, goal pacing. |
| Resend | Support ticket email content | Forwarding support requests to support@rushingtechnologies.com. |

## Privacy Choices

Users can:

- Disconnect a linked bank item from Settings.
- Export their data from Settings or `GET /api/me/export`.
- Delete the account from Settings or `DELETE /api/me`; the API revokes provider items, cascades the database delete, and writes a non-PII deletion audit event.
- Share or redeem referral codes from Settings; referral records are deleted with the account.
- Pause or edit Freelancer Mode settings from Settings; profile rows are deleted with the account.
- Create, join, or leave a household from Settings; household membership is deleted with the account, while shared-goal history may keep a null author reference for the remaining household.

## App Store Submission Checks

- Confirm the live privacy policy URL resolves before submitting.
- Confirm RevenueCat products match:
  - `com.rushingtechnologies.zenfinance.coach.monthly`
  - `com.rushingtechnologies.zenfinance.coach.annual`
- Confirm Sentry, Plaid, RevenueCat, and any Expo privacy manifests are included in the native build output.
- Update App Store Connect whenever data collection or third-party processors change.
