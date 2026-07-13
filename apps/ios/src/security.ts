const DEFAULT_PRODUCTION_API_URL = 'https://api.zenfinance.rushingtechnologies.com';

export function resolveApiUrl(configured: string | null | undefined, development: boolean): string {
  const candidate = configured?.trim() || DEFAULT_PRODUCTION_API_URL;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'https:' || (development && url.protocol === 'http:')) {
      return url.toString().replace(/\/$/, '');
    }
  } catch {
    // Fall through to the pinned HTTPS production endpoint.
  }
  return DEFAULT_PRODUCTION_API_URL;
}

export function safeAppStoreSubscriptionUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'apps.apple.com') return null;
    return url.toString();
  } catch {
    return null;
  }
}
