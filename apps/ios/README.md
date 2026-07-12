# ZenFinance iOS App

**The product.** Right now this is the Phase 1 **link harness**: sign in, link a bank through Plaid Link, watch the 90-day backfill land, disconnect. The full coaching UI arrives in Phase 4 (see `PLAN.md`).

## Running the harness

The Plaid Link SDK is native code, so Expo Go won't work — you need a dev build:

```bash
cd apps/ios
npm install                     # this app is intentionally OUTSIDE the npm workspaces
npx expo prebuild --platform ios
npx expo run:ios                # requires Xcode; runs on simulator or device
```

Point the app at your API by editing `expo.extra.apiUrl` in `app.json`:
- Simulator against local API: `http://localhost:3000`
- Physical device: your machine's LAN IP, e.g. `http://192.168.1.20:3000`

The API must run with Plaid sandbox credentials (`TRANSACTION_PROVIDER=plaid`,
`PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=sandbox`). In the Plaid sandbox,
Link's test bank accepts `user_good` / `pass_good`.

## Phase 1 exit gate

Link a real account from this harness → 90 days of transactions in Postgres →
disconnect wipes them. Verify via the API:

```bash
curl -s localhost:3000/api/transactions -H "Authorization: Bearer $TOKEN" | head
```

`assets/app-icon-master.png` is the App Store icon master.
