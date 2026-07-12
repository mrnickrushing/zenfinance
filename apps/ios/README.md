# ZenFinance iOS App

**The product.** This is the Expo SDK 57 iOS app: onboarding, Plaid Link, first-look and weekly brief cards, native text-to-speech Voice Briefs, coach chat, goals, deterministic what-if simulations, subscription audit, Money Wins, Money Physical one-time reports, RevenueCat paywall/purchase/restore, referral credits, Freelancer Mode settings, Household Sharing, data export, notification preferences, Sentry wiring, and mobile funnel events.

## Running the App

The Plaid Link SDK is native code, so Expo Go will not work. Use a dev build:

```bash
npm install
npm run typecheck -w zenfinance-ios
npm run prebuild -w zenfinance-ios
npm run ios -w zenfinance-ios
```

Point the app at your API by editing `expo.extra.apiUrl` in `app.json`:

- Simulator against local API: `http://localhost:3000`
- Physical device: your machine's LAN IP, e.g. `http://192.168.1.20:3000`

For Plaid sandbox linking, run the API with `TRANSACTION_PROVIDER=plaid`,
`PLAID_CLIENT_ID`, `PLAID_SECRET`, and `PLAID_ENV=sandbox`. Plaid sandbox test
bank credentials are `user_good` / `pass_good`.

For RevenueCat sandbox purchases, set `expo.extra.revenueCatIosApiKey` in
`app.json` and configure both the Coach subscription products and the Money
Physical non-subscription product in RevenueCat/App Store Connect. Run a
development build or TestFlight build. Expo Go cannot test native Plaid or
RevenueCat purchase flows.

`assets/app-icon-master.png` is the App Store icon master.
