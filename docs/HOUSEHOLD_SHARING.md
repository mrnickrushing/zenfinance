# Household Sharing

Last updated: July 12, 2026

Household Sharing is the Phase 9 post-launch feature train item after Freelancer Mode. It creates a two-seat household space for shared goals while keeping each member's personal bank data private.

## Product Surface

- iOS Settings exposes Household Sharing.
- A premium user can create a household and share one invite code.
- The invited member can join with the code from their own authenticated account.
- Members can create shared goals and add contributions.
- The household view shows member emails, roles, shared goals, and contribution history.

## Privacy Model

Household Sharing uses an `individual` privacy mode at launch:

- Shared: household membership, pending invites, shared goals, and contribution ledger.
- Private: linked banks, account balances, transactions, chat history, personal goals, anomalies, Money Wins, Freelancer Mode, and billing details.

The API never includes transaction or account payloads in `GET /api/household`.

## API

- `GET /api/household` returns the user's household, or `null`.
- `POST /api/household` creates a two-seat household. Requires premium.
- `POST /api/household/invites` creates an expiring invite token. Requires premium household owner.
- `POST /api/household/invites/accept` accepts an invite for the invited email. Does not require premium.
- `DELETE /api/household/membership` leaves a household, or deletes a one-member household.
- `POST /api/household/goals` creates a shared goal for household members.
- `PATCH /api/household/goals/:id` edits a shared goal.
- `POST /api/household/goals/:id/contributions` records a contribution and increments shared progress.
- `DELETE /api/household/goals/:id` deletes a shared goal.

## Data Model

- `households`
- `household_members`
- `household_invites`
- `household_goals`
- `household_goal_contributions`

Membership is limited to one household per user at launch. Household rows cascade to members, invites, shared goals, and contributions. User deletion removes that user's membership and nulls historical shared-goal author/contribution references where preserving household context is appropriate.

## Admin Metrics

`GET /api/admin/metrics` includes:

- total households
- active household members
- pending, unexpired invites
- shared goals

The admin console renders these as the Household metrics row.

## Validation

Covered by `apps/api/src/test/phase9.test.ts`:

- free users cannot create households
- premium owners can create households and invite one member
- invited members can accept with the invited email
- two-seat cap is enforced
- shared goals and member contributions update progress
- household views exclude private bank/account/transaction data
- data export includes household data
- admin metrics report household adoption
