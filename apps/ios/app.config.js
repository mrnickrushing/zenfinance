// Dynamic app config (replaces the old static app.json) so eas.json build
// profiles can inject the right API URL / Sentry DSN / RevenueCat key per
// environment via env vars, without hand-editing this file per build.
module.exports = {
  expo: {
    name: 'ZenFinance',
    slug: 'zenfinance',
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/app-icon-master.png',
    scheme: 'zenfinance',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: 'com.rushingtechnologies.zenfinance',
      supportsTablet: false,
    },
    plugins: [
      'expo-secure-store',
      [
        'expo-notifications',
        {
          sounds: [],
        },
      ],
      '@sentry/react-native/expo',
    ],
    runtimeVersion: {
      policy: 'fingerprint',
    },
    updates: {
      url: 'https://u.expo.dev/d8a500af-3ff0-476e-85a0-6cfc003d4b61',
    },
    extra: {
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
      sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
      revenueCatIosApiKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? '',
      eas: {
        projectId: 'd8a500af-3ff0-476e-85a0-6cfc003d4b61',
      },
    },
    owner: 'rushingtechnologies',
  },
};
