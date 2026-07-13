import { describe, expect, it } from 'vitest';
import { resolveApiUrl, safeAppStoreSubscriptionUrl } from './security.js';

describe('iOS production security helpers', () => {
  it('rejects plaintext or malformed production API endpoints', () => {
    expect(resolveApiUrl('http://api.example.com', false)).toBe('https://api.zenfinance.rushingtechnologies.com');
    expect(resolveApiUrl('not a url', false)).toBe('https://api.zenfinance.rushingtechnologies.com');
    expect(resolveApiUrl('https://secure.example.com/', false)).toBe('https://secure.example.com');
    expect(resolveApiUrl('http://localhost:3000', true)).toBe('http://localhost:3000');
  });

  it('allows only HTTPS App Store subscription-management links', () => {
    expect(safeAppStoreSubscriptionUrl('https://apps.apple.com/account/subscriptions')).toBe(
      'https://apps.apple.com/account/subscriptions',
    );
    expect(safeAppStoreSubscriptionUrl('zenfinance://settings')).toBeNull();
    expect(safeAppStoreSubscriptionUrl('https://example.com/account/subscriptions')).toBeNull();
    expect(safeAppStoreSubscriptionUrl('http://apps.apple.com/account/subscriptions')).toBeNull();
  });
});
