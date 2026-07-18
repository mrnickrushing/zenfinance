import { describe, expect, it } from 'vitest';
import type { ZenScoreComponent } from '@zenfinance/shared';
import { zenScoreCoachPrompt, zenScoreFocus, zenScoreGuidance } from './zenScore.js';

function component(key: ZenScoreComponent['key'], value: number | null): ZenScoreComponent {
  return { key, value, label: key, detail: 'Test detail' };
}

describe('Zen Score guidance', () => {
  it('focuses the lowest available component instead of treating missing data as zero', () => {
    expect(zenScoreFocus([
      component('mindful_spending', null),
      component('growth_savings', 72),
      component('consistency', 48),
    ])?.key).toBe('consistency');
  });

  it('routes every component to a useful non-paywalled destination', () => {
    expect(zenScoreGuidance(component('mindful_spending', 45)).destination).toBe('budget');
    expect(zenScoreGuidance(component('growth_savings', 45)).destination).toBe('goals');
    expect(zenScoreGuidance(component('consistency', 45)).destination).toBe('brief');
    expect(zenScoreGuidance(component('mindful_spending', null)).destination).toBe('transactions');
  });

  it('builds a score-specific coach question without inventing financial facts', () => {
    expect(zenScoreCoachPrompt(64, { ...component('growth_savings', 51), label: 'Growth & Savings' }))
      .toBe('My Zen Score is 64 out of 100, and Growth & Savings is 51 out of 100. Based only on my connected financial data, explain what is driving this component and suggest one realistic next step.');
  });
});
