# Phase 7 Launch Runbook

Last updated: July 12, 2026

## Launch Gates

- Plaid production access approved and production webhook URL verified.
- App Store review approved for the iOS build.
- Attorney-reviewed Privacy Policy and Terms are live.
- `npm run typecheck`, API tests, `npm run build`, `npm audit --audit-level=high`, and `npx expo install --check` are green.
- Sentry has no critical issues for the preceding 7 days.

## Launch Sequence

1. Export the waitlist from `/admin` and send the launch email in batches.
2. Publish the App Store URL on the landing page, Product Hunt, and finance-adjacent newsletter/community posts.
3. Keep the launch offer as extra trial access through referral credits. Do not discount the subscription price.
4. Monitor `/admin` launch metrics twice daily for the first week: active users, paid users, MRR, churn, referrals, verified Money Wins, and Freelancer Mode adoption.
5. Use `/insights` as the public aggregate-data page once it reaches the minimum linked-user sample size.

## Referral Program

- Every authenticated user receives a code from `GET /api/referrals/me`.
- A user redeems another user's code with `POST /api/referrals/redeem`.
- Redemption grants 30 days of ZenFinance Coach credit to both users.
- Credits stack by extending the recipient's latest active referral-credit expiration.
- Users cannot redeem their own code and each account can redeem only one code.

## First 90 Days

Targets:

- 1,000 free users.
- 60+ subscribers.
- Monthly churn under 6%.
- Verified Money Wins average above $25 per user per month.

Decision rule: run one retention or conversion experiment per week, selected from the biggest drop-off in the admin dashboard.
