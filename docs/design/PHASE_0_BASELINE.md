# Phase 0 Baseline

Date: 2026-07-12

## Captured Locally

Web screenshots were captured from local Vite dev servers with Chromium headless.

Marketing server:

- URL: `http://127.0.0.1:5173`
- Command: `npm run dev -w @zenfinance/site -- --host 127.0.0.1 --port 5173`

Admin server:

- URL: `http://127.0.0.1:5174`
- Command: `npm run dev:admin -w @zenfinance/site -- --host 127.0.0.1 --port 5174`

Screenshots:

- `docs/design/current-state/web/landing-desktop.png`
- `docs/design/current-state/web/landing-mobile.png`
- `docs/design/current-state/web/insights-desktop.png`
- `docs/design/current-state/web/support-desktop.png`
- `docs/design/current-state/web/admin-desktop.png`

## iOS Capture Status

iOS screenshots could not be captured in this Linux workspace because iOS Simulator requires macOS/Xcode tooling. `xcrun` is not available here.

Required mobile current-state captures:

- `docs/design/current-state/mobile/auth.png`
- `docs/design/current-state/mobile/link-account.png`
- `docs/design/current-state/mobile/brief-home.png`
- `docs/design/current-state/mobile/coach.png`
- `docs/design/current-state/mobile/paywall.png`
- `docs/design/current-state/mobile/goals.png`
- `docs/design/current-state/mobile/subscriptions.png`
- `docs/design/current-state/mobile/wins.png`
- `docs/design/current-state/mobile/settings.png`

Recommended capture path on macOS:

1. Run `npm run ios -w zenfinance-ios`.
2. Seed or log in to a test account with linked mock data.
3. Capture each screen with Simulator screenshots.
4. Save the files into `docs/design/current-state/mobile/` using the names above.

## Lazyweb Reports

The full Lazyweb report pipeline requires a concrete screenshot. Because native iOS screenshots are unavailable in this workspace, the iOS paywall and iOS brief-home reports are blocked until the mobile screenshots above exist.

Generated from available local capture:

- Web landing page optimize report
  - Objective: waitlist signup conversion
  - Source screenshot: `docs/design/current-state/web/landing-desktop.png`
  - Lazyweb job id: `6dd1fdd7-1633-4dd8-af74-3efacc394d8b`
  - Report URL: pending after repeated polls on 2026-07-12

## Phase 0 Follow-Up Tickets

- Capture native iOS current-state screenshots on macOS or from a device.
- Run Lazyweb optimize report for `mobile/paywall.png`.
- Run Lazyweb improve report for `mobile/brief-home.png`.
- Add report URLs to this file.
- Use report recommendations to refine Phase 4 and Phase 3 implementation tickets.
