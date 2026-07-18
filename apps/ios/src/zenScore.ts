import type { ZenScoreComponent } from '@zenfinance/shared';

export type ZenScoreDestination = 'brief' | 'transactions' | 'goals' | 'budget';

export interface ZenScoreGuidance {
  title: string;
  body: string;
  actionLabel: string;
  destination: ZenScoreDestination;
}

export function zenScoreGuidance(component: ZenScoreComponent): ZenScoreGuidance {
  const { key, value } = component;

  if (key === 'mindful_spending') {
    if (value === null) {
      return {
        title: 'Finish building your spending picture',
        body: 'Mindful Spending unlocks after connected transactions are categorized. Review your accounts, then refresh this page.',
        actionLabel: 'Review accounts',
        destination: 'transactions',
      };
    }
    if (value < 60) {
      return {
        title: 'Set one realistic flexible-spending cap',
        body: 'Start with the category that is easiest to adjust. A small repeatable change is more useful than cutting everything at once.',
        actionLabel: 'Open Smart Budget',
        destination: 'budget',
      };
    }
    if (value < 80) {
      return {
        title: 'Review your largest flexible category',
        body: 'Your spending mix is taking shape. Use a category cap to protect the progress you have already made.',
        actionLabel: 'Review category caps',
        destination: 'budget',
      };
    }
    return {
      title: 'Keep your spending mix steady',
      body: 'This component is strong. Check your category caps for any new pressure instead of making a broad cut.',
      actionLabel: 'Review Smart Budget',
      destination: 'budget',
    };
  }

  if (key === 'growth_savings') {
    if (value === null) {
      return {
        title: 'Add income data or a savings goal',
        body: 'Growth & Savings needs income activity, an active goal, or both. A goal gives the score a concrete pace to measure.',
        actionLabel: 'Open Savings Goals',
        destination: 'goals',
      };
    }
    if (value < 60) {
      return {
        title: 'Choose one reachable savings milestone',
        body: 'Give your recent cash flow a clear destination. A smaller funded goal can build momentum before a larger one.',
        actionLabel: 'Update Savings Goals',
        destination: 'goals',
      };
    }
    if (value < 80) {
      return {
        title: 'Check the pace of your top goal',
        body: 'Your growth trend is moving. Review the projected completion date and adjust the contribution only if it fits your cash flow.',
        actionLabel: 'Review goal pace',
        destination: 'goals',
      };
    }
    return {
      title: 'Protect your savings rhythm',
      body: 'Your savings and goal pace are strong. Review the next milestone before increasing contributions.',
      actionLabel: 'Review Savings Goals',
      destination: 'goals',
    };
  }

  if (value === null) {
    return {
      title: 'Build at least two active weeks',
      body: 'Consistency compares recent active weeks. Keep accounts syncing and return after another week of income or spending activity.',
      actionLabel: 'Review recent activity',
      destination: 'transactions',
    };
  }
  if (value < 60) {
    return {
      title: 'Pick one weekly money check-in',
      body: 'Use the same day each week to review your brief and one flexible category. Repeatability matters more than a perfect week.',
      actionLabel: 'Review Money Brief',
      destination: 'brief',
    };
  }
  if (value < 80) {
    return {
      title: 'Repeat what worked last week',
      body: 'Your recent weeks are becoming steadier. Use the Money Brief to spot the habit worth carrying forward.',
      actionLabel: 'Open Money Brief',
      destination: 'brief',
    };
  }
  return {
    title: 'Keep the routine simple',
    body: 'Your recent weeks are consistent. Review the latest brief and change course only when the underlying activity changes.',
    actionLabel: 'Review Money Brief',
    destination: 'brief',
  };
}

export function zenScoreFocus(components: ZenScoreComponent[]): ZenScoreComponent | null {
  const available = components.filter((component) => component.value !== null);
  if (available.length > 0) {
    return [...available].sort((a, b) => (a.value as number) - (b.value as number))[0] ?? null;
  }
  return components[0] ?? null;
}

export function zenScoreCoachPrompt(score: number | null, component: ZenScoreComponent): string {
  const scoreText = score === null ? 'still building' : `${score} out of 100`;
  const componentText = component.value === null ? 'does not have enough data yet' : `is ${component.value} out of 100`;
  return `My Zen Score is ${scoreText}, and ${component.label} ${componentText}. Based only on my connected financial data, explain what is driving this component and suggest one realistic next step.`;
}
