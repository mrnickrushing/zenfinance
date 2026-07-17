// Dynamic app config (replaces the old static app.json) so eas.json build
// profiles can inject the right API URL / Sentry DSN / RevenueCat key per
// environment via env vars, without hand-editing this file per build.
module.exports = {
  expo: {
    name: 'Zen-Finance',
    slug: 'zenfinance',
    version: '0.1.1',
    orientation: 'portrait',
    icon: './assets/app-icon-master.png',
    scheme: 'zenfinance',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: 'com.rushingtechnologies.zenfinance',
      supportsTablet: false,
      // Adds the "Sign in with Apple" capability/entitlement to the native
      // target. The token is verified server-side against this bundle id
      // (APPLE_BUNDLE_ID) in /api/auth/apple.
      usesAppleSignIn: true,
      // Universal link so Plaid Link can redirect back into the app after an
      // OAuth institution's bank-hosted auth step (see DEPLOY.md "Plaid OAuth
      // redirect"). Requires the AASA file served at
      // https://api.zenfinance.rushingtechnologies.com/.well-known/apple-app-site-association
      // and PLAID_REDIRECT_URI set server-side to the matching URL.
      associatedDomains: ['applinks:api.zenfinance.rushingtechnologies.com'],
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: false,
          NSAllowsLocalNetworking: false,
        },
      },
    },
    plugins: [
      'expo-apple-authentication',
      'expo-font',
      'expo-secure-store',
      [
        'expo-notifications',
        {
          sounds: [],
        },
      ],
      [
        '@sentry/react-native',
        {
          organization: 'rushing-technologies',
          project: 'zenfinance',
          url: 'https://sentry.io/',
        },
      ],
      './withFollyCoroutineFix',
    ],
    // 'appVersion' ties the OTA runtime version to the `version` field above
    // (bump it on any native-code-affecting release). Deliberately not using
    // the 'fingerprint' policy: our Podfile plugins patch files under
    // node_modules/@sentry/react-native during the build (folly coroutine +
    // Hermes profiler fixes), which made the content-hash-based fingerprint
    // diverge between the local pre-upload calculation and the one EAS
    // computes server-side, hard-failing the build with a runtime-version
    // mismatch even though the actual compiled app was fine.
    runtimeVersion: {
      policy: 'appVersion',
    },
    updates: {
      url: 'https://u.expo.dev/d8a500af-3ff0-476e-85a0-6cfc003d4b61',
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 3000,
    },
    extra: {
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'https://api.zenfinance.rushingtechnologies.com',
      sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
      revenueCatIosApiKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? '',
      eas: {
        projectId: 'd8a500af-3ff0-476e-85a0-6cfc003d4b61',
      },
    },
    owner: 'rushingtechnologies',
  },
};
