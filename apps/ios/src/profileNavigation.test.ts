import { describe, expect, it } from 'vitest';
import { PROFILE_MENU_GROUPS, SETTINGS_SECTION_COPY } from './profileNavigation.js';

describe('profile navigation', () => {
  const items = PROFILE_MENU_GROUPS.flatMap((group) => group.items);

  it('gives every visible row a unique destination', () => {
    const destinations = items.map((item) => JSON.stringify(item.destination));
    expect(new Set(destinations).size).toBe(destinations.length);
  });

  it('does not bring back a generic settings row', () => {
    expect(items.some((item) => item.label.toLowerCase() === 'settings')).toBe(false);
  });

  it('provides copy for every settings destination', () => {
    const sections = items.flatMap((item) => item.destination.kind === 'settings' ? [item.destination.section] : []);
    expect(sections.every((section) => Boolean(SETTINGS_SECTION_COPY[section]))).toBe(true);
  });
});
