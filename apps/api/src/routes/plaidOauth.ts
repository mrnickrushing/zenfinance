import { Router } from 'express';

// Apple's team ID for this app's signing identity — paired with the bundle id
// to form the appID Apple's universal-link validator checks against.
const APPLE_TEAM_ID = 'PH4AKDQ4Q7';
const BUNDLE_ID = 'com.rushingtechnologies.zenfinance';

// Serves the two pieces required for Plaid Link's OAuth redirect on iOS (see
// DEPLOY.md "Plaid OAuth redirect"): the Apple App Site Association file that
// proves this domain belongs to the app (so iOS opens the app instead of a
// browser for the redirect URL below), and a plain landing page at that
// redirect URL as a fallback for the rare case the universal link doesn't
// intercept (e.g. the app isn't installed).
export function createPlaidOauthRouter(): ReturnType<typeof Router> {
  const router = Router();

  // Must be served at exactly this path, with no redirect and no file
  // extension, per Apple's spec — a JSON content type is enough.
  router.get('/.well-known/apple-app-site-association', (_req, res) => {
    res.json({
      applinks: {
        apps: [],
        details: [
          {
            appID: `${APPLE_TEAM_ID}.${BUNDLE_ID}`,
            paths: ['/plaid-oauth-return'],
          },
        ],
      },
    });
  });

  router.get('/plaid-oauth-return', (_req, res) => {
    res.type('html').send(
      '<!doctype html><html><head><meta charset="utf-8"><title>Zen-Finance</title></head>' +
        '<body style="font-family: -apple-system, sans-serif; text-align: center; padding-top: 3rem;">' +
        '<p>Finishing up in Zen-Finance&hellip;</p>' +
        '<p>If nothing happens, return to the Zen-Finance app to continue linking your bank.</p>' +
        '</body></html>',
    );
  });

  return router;
}
