# Failure Drills

Last updated: 2026-07-12

## Plaid Webhook Outage

Expected behavior:

- `/api/webhooks/plaid` returns 200 without leaking whether an item exists.
- Sync enqueue failures are logged.
- Existing data remains readable.
- Items that receive `ITEM` error/expiration/revocation webhooks are marked `login_required` or `disconnected`.

Validation:

- `apps/api/src/test/phase1.test.ts` covers transaction sync webhook behavior.
- `apps/api/src/test/phase6.test.ts` covers item error, repair, and revocation state transitions.

## Item Reauthentication

Expected behavior:

- Plaid `ITEM/ERROR` with `ITEM_LOGIN_REQUIRED`, `PENDING_EXPIRATION`, or `PENDING_DISCONNECT` marks the item `login_required`.
- Plaid `LOGIN_REPAIRED` marks the item `active`.
- The iOS app surfaces item status from `/api/items` and settings.

Manual beta check:

- Fire sandbox item webhooks from Plaid.
- Confirm the linked bank status changes in API output and app settings.

## LLM Provider Failure

Expected behavior:

- Brief generation retries once.
- If the model throws or fails provenance/tone checks, the deterministic template brief is stored.
- No request cycle depends on LLM calls except premium chat.

Validation:

- `apps/api/src/coaching/pipeline.ts` contains retry and fallback logic.
- `apps/api/src/test/coachingEval.test.ts` and `apps/api/src/test/phase3.test.ts` cover guardrail behavior and template-safe output.

## Billing Webhook Failure

Expected behavior:

- RevenueCat webhook authorization and HMAC failures return 401.
- Duplicate RevenueCat events are idempotent.
- Client restore can reconcile status through RevenueCat REST when `REVENUECAT_SECRET_API_KEY` is configured.

Validation:

- `apps/api/src/test/phase5.test.ts` covers signed webhooks, duplicate events, bad auth, bad signatures, and premium unlocks.

## Account Deletion Failure

Expected behavior:

- Provider revoke failures are logged but do not block the user's deletion right.
- Database rows cascade-delete.
- A non-PII `privacy_deletion_events` row records item count, revocation failure count, completion time, and processor status.

Validation:

- `apps/api/src/test/phase6.test.ts` covers account deletion evidence.
