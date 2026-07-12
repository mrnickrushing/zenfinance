# Plaid Production Checklist

Last updated: 2026-07-12

This is the production-access checklist to execute in Plaid before closed beta.

## Required App Details

- App name: ZenFinance
- Bundle ID: `com.rushingtechnologies.zenfinance`
- Redirect URI / scheme: `zenfinance://`
- Website: `https://zenfinance.rushingtechnologies.com`
- Privacy policy: `https://zenfinance.rushingtechnologies.com/privacy`
- Terms: `https://zenfinance.rushingtechnologies.com/terms`
- Support email: `support@rushingtechnologies.com`

## Required Product Configuration

- Products: Transactions.
- Access: read-only.
- Account scopes: depository and credit accounts.
- Webhook URL: `https://zenfinance.rushingtechnologies.com/api/webhooks/plaid`.

## Webhooks Implemented In Repo

- `TRANSACTIONS/SYNC_UPDATES_AVAILABLE`, `DEFAULT_UPDATE`, `INITIAL_UPDATE`, `HISTORICAL_UPDATE`: enqueue item sync.
- `ITEM/ERROR` with `ITEM_LOGIN_REQUIRED`: mark item `login_required`.
- `ITEM/PENDING_EXPIRATION` and `ITEM/PENDING_DISCONNECT`: mark item `login_required`.
- `ITEM/LOGIN_REPAIRED`: mark item `active`.
- `ITEM/USER_PERMISSION_REVOKED` and `ITEM/USER_ACCOUNT_REVOKED`: mark item `disconnected`.

## Sandbox Verification

Use Plaid sandbox webhooks to verify:

- Initial link creates item/accounts and backfills transactions.
- Transactions webhook reconciles pending-to-posted and provider removals.
- Error webhook moves item to `login_required`.
- Login repaired webhook moves item back to `active`.
- Permission revoked webhook moves item to `disconnected`.
- Disconnect in app calls provider remove and deletes item/account/transaction rows.

## External Approval Tasks

- Submit Plaid production access request in the Plaid dashboard.
- Upload screenshots or TestFlight build if Plaid requests review.
- Do not flip `PLAID_ENV=production` until Plaid approves production access.
