import { useEffect, useState } from 'react';
import type { LaunchContentStatsView } from '@zenfinance/shared';
import { Card } from '../components/ui';
import { apiFetch } from '../lib/api';

function usd(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

export function InsightsPage() {
  const [stats, setStats] = useState<LaunchContentStatsView | null>(null);

  useEffect(() => {
    apiFetch<LaunchContentStatsView>('/api/content/launch-stats')
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-primary-700 dark:text-primary-300">
        ZenFinance Launch Data
      </p>
      <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight">
        Aggregate money patterns from the ZenFinance launch cohort
      </h1>
      <p className="mt-5 max-w-2xl text-lg text-slate-600 dark:text-slate-300">
        These numbers come from anonymized, aggregate app data. We publish only cohort-level
        metrics and suppress the page until the linked-user sample is large enough.
      </p>

      <div className="mt-10 grid gap-5 md:grid-cols-3">
        <MetricCard label="Linked users" value={stats ? String(stats.metrics.linkedUsers) : '...'} />
        <MetricCard
          label="Avg recurring charges"
          value={stats ? stats.metrics.avgRecurringStreamsPerLinkedUser.toFixed(1) : '...'}
        />
        <MetricCard
          label="Avg verified wins"
          value={stats ? usd(stats.metrics.avgVerifiedMoneyWinsCentsPerUser) : '...'}
        />
      </div>

      <Card className="mt-8">
        {stats?.publishable ? (
          <div className="grid gap-4 md:grid-cols-2">
            <p className="text-slate-600 dark:text-slate-300">
              The current linked cohort averages{' '}
              <strong>{stats.metrics.avgRecurringStreamsPerLinkedUser.toFixed(1)}</strong> recurring
              charges and <strong>{usd(stats.metrics.avgRecurringMonthlyCentsPerLinkedUser)}</strong>{' '}
              in recurring monthly spend.
            </p>
            <p className="text-slate-600 dark:text-slate-300">
              Referral sharing has produced <strong>{stats.metrics.referralRedemptions}</strong>{' '}
              redeemed invites so far, with <strong>{stats.metrics.premiumUsers}</strong> users
              currently in a premium state.
            </p>
          </div>
        ) : (
          <p className="text-slate-600 dark:text-slate-300">
            Public launch metrics unlock at {stats?.minimumSampleSize ?? 10} linked users. Current
            linked sample: {stats?.sampleSize ?? 0}.
          </p>
        )}
        {stats && (
          <p className="mt-5 text-xs text-slate-500 dark:text-slate-400">
            Last generated {new Date(stats.generatedAt).toLocaleString()}.
          </p>
        )}
      </Card>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight">{value}</p>
    </Card>
  );
}
