import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  AdminMetrics,
  Paginated,
  SupportTicket,
  WaitlistEntry,
} from '@zenfinance/shared';
import { Badge, Button, Card, TextInput } from '../components/ui';
import { adminFetch, useAdminStore } from '../store/admin';

export function AdminPage() {
  const accessToken = useAdminStore((s) => s.accessToken);
  const refresh = useAdminStore((s) => s.refresh);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    // Try to resume a session from the refresh cookie on first load.
    refresh().finally(() => setBooted(true));
  }, [refresh]);

  if (!booted) return <PageShell>Loading…</PageShell>;
  return accessToken ? <Dashboard /> : <LoginCard />;
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 px-6 py-12 dark:bg-slate-950">
      <div className="mx-auto max-w-5xl">{children}</div>
    </div>
  );
}

function LoginCard() {
  const login = useAdminStore((s) => s.login);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(secret);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <div className="mx-auto max-w-sm pt-20">
        <Card>
          <div className="mb-6 flex items-center gap-3">
            <img src="/favicon-64.png" alt="" className="h-9 w-9 rounded-lg" />
            <h1 className="text-lg font-semibold">ZenFinance Admin</h1>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <TextInput
              label="Admin secret"
              id="admin-secret"
              type="password"
              required
              autoComplete="current-password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
            {error && (
              <p role="alert" className="text-sm text-rose-600">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>
      </div>
    </PageShell>
  );
}

function Dashboard() {
  const logout = useAdminStore((s) => s.logout);
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    adminFetch<AdminMetrics>('/api/admin/metrics')
      .then(setMetrics)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load metrics'));
  }, []);

  useEffect(load, [load]);

  return (
    <PageShell>
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/favicon-64.png" alt="" className="h-9 w-9 rounded-lg" />
          <h1 className="text-xl font-semibold">ZenFinance Admin</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void logout()}>
          Sign out
        </Button>
      </header>

      {error && (
        <p role="alert" className="mb-6 text-sm text-rose-600">
          {error}
        </p>
      )}

      {metrics && (
        <>
          <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Waitlist total" value={metrics.waitlist.total} />
            <StatTile label="Signups · 7 days" value={metrics.waitlist.last7Days} />
            <StatTile label="Signups · 30 days" value={metrics.waitlist.last30Days} />
            <StatTile
              label="Open support tickets"
              value={metrics.support.open}
              sub={`${metrics.support.resolved} resolved`}
            />
          </section>

          <section aria-label="Beta metrics" className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Registered users" value={metrics.beta.registeredUsers} />
            <StatTile label="Linked users" value={metrics.beta.linkedUsers} />
            <StatTile
              label="First-brief activation"
              value={Math.round(metrics.beta.activationRate * 100)}
              sub={`${metrics.beta.firstBriefUsers} users · percent`}
            />
            <StatTile
              label="Week-4 retention"
              value={Math.round(metrics.beta.week4RetentionRate * 100)}
              sub={`${metrics.beta.retainedWeek4Users} users · percent`}
            />
          </section>

          <section aria-label="Launch metrics" className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Active users · 7 days" value={metrics.launch.activeUsers7Days} />
            <StatTile label="Premium users" value={metrics.launch.premiumUsers} sub={`${metrics.launch.trialUsers} trial · ${metrics.launch.paidUsers} paid`} />
            <StatTile label="MRR" value={Math.round(metrics.launch.mrrCents / 100)} sub="USD, annualized monthly" />
            <StatTile
              label="Avg verified wins"
              value={Math.round(metrics.launch.verifiedMoneyWinsAvgCents / 100)}
              sub={`${metrics.launch.referralRedemptions} referral redemptions`}
            />
          </section>

          <Card className="mt-6">
            <h2 className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Waitlist signups — last 30 days
            </h2>
            <SignupsChart daily={metrics.waitlist.dailySignups} />
          </Card>
        </>
      )}

      <WaitlistSection />
      <SupportSection onChanged={load} />
    </PageShell>
  );
}

function StatTile({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card>
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
    </Card>
  );
}

/** Single-series daily bar chart. Colors validated for both surfaces:
 *  #7c3aed on white, #8b5cf6 on slate-950. */
function SignupsChart({ daily }: { daily: Array<{ date: string; count: number }> }) {
  const [hover, setHover] = useState<number | null>(null);

  // Fill the full 30-day window so quiet days render as gaps, not omissions.
  const byDate = new Map(daily.map((d) => [d.date, d.count]));
  const days: Array<{ date: string; count: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, count: byDate.get(key) ?? 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.count));

  const W = 600;
  const H = 120;
  const gap = 2;
  const barW = (W - gap * (days.length - 1)) / days.length;

  return (
    <div className="relative mt-4">
      <svg
        viewBox={`0 0 ${W} ${H + 18}`}
        role="img"
        aria-label={`Daily waitlist signups for the last 30 days, peak ${max} per day`}
        className="w-full"
      >
        <line x1="0" y1={H} x2={W} y2={H} className="stroke-slate-200 dark:stroke-slate-700" />
        {days.map((d, i) => {
          const h = d.count === 0 ? 0 : Math.max(3, (d.count / max) * (H - 8));
          const x = i * (barW + gap);
          return (
            <g key={d.date}>
              {d.count > 0 && (
                <rect
                  x={x}
                  y={H - h}
                  width={barW}
                  height={h}
                  rx={2}
                  className={
                    hover === i
                      ? 'fill-primary-800 dark:fill-primary-300'
                      : 'fill-primary-600 dark:fill-primary-500'
                  }
                />
              )}
              <rect
                x={x - gap / 2}
                y={0}
                width={barW + gap}
                height={H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
              {d.count === max && d.count > 0 && (
                <text
                  x={x + barW / 2}
                  y={H - h - 5}
                  textAnchor="middle"
                  className="fill-slate-500 text-[10px] tabular-nums dark:fill-slate-400"
                >
                  {d.count}
                </text>
              )}
            </g>
          );
        })}
        <text x="0" y={H + 14} className="fill-slate-400 text-[10px]">
          {days[0]!.date}
        </text>
        <text x={W} y={H + 14} textAnchor="end" className="fill-slate-400 text-[10px]">
          {days[days.length - 1]!.date}
        </text>
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute -top-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-soft dark:border-slate-700 dark:bg-slate-900"
          style={{ left: `${(hover / days.length) * 100}%` }}
          role="status"
        >
          <span className="font-medium tabular-nums">{days[hover]!.count}</span>{' '}
          <span className="text-slate-500 dark:text-slate-400">on {days[hover]!.date}</span>
        </div>
      )}
    </div>
  );
}

function WaitlistSection() {
  const [data, setData] = useState<Paginated<WaitlistEntry> | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  useEffect(() => {
    adminFetch<Paginated<WaitlistEntry>>(`/api/admin/waitlist?page=${page}&pageSize=${pageSize}`)
      .then(setData)
      .catch(() => setData(null));
  }, [page]);

  async function exportCsv() {
    const token = useAdminStore.getState().accessToken;
    const res = await fetch('/api/admin/waitlist?format=csv', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zenfinance-waitlist.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <section aria-labelledby="waitlist-heading" className="mt-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="waitlist-heading" className="text-lg font-semibold">
          Waitlist
        </h2>
        <Button variant="secondary" size="sm" onClick={() => void exportCsv()}>
          Export CSV
        </Button>
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <th scope="col" className="px-5 py-3">Email</th>
              <th scope="col" className="px-5 py-3">Source</th>
              <th scope="col" className="px-5 py-3">Joined</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/50">
                <td className="px-5 py-3 font-medium">{row.email}</td>
                <td className="px-5 py-3 text-slate-500 dark:text-slate-400">{row.source ?? '—'}</td>
                <td className="px-5 py-3 text-slate-500 tabular-nums dark:text-slate-400">
                  {row.createdAt.slice(0, 10)}
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-8 text-center text-slate-500 dark:text-slate-400">
                  No signups yet — share the landing page.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      {pages > 1 && (
        <div className="mt-3 flex items-center gap-3 text-sm">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← Prev
          </Button>
          <span className="text-slate-500 dark:text-slate-400">
            Page {page} of {pages}
          </span>
          <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next →
          </Button>
        </div>
      )}
    </section>
  );
}

function SupportSection({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<Paginated<SupportTicket> | null>(null);

  const load = useCallback(() => {
    adminFetch<Paginated<SupportTicket>>('/api/admin/support?page=1&pageSize=50')
      .then(setData)
      .catch(() => setData(null));
  }, []);

  useEffect(load, [load]);

  async function setStatus(id: number, status: 'open' | 'resolved') {
    await adminFetch(`/api/admin/support/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    load();
    onChanged();
  }

  return (
    <section aria-labelledby="support-heading" className="mt-10">
      <h2 id="support-heading" className="mb-4 text-lg font-semibold">
        Support inbox
      </h2>
      <div className="space-y-4">
        {data?.items.map((t) => (
          <Card key={t.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">
                  {t.name}{' '}
                  <a
                    href={`mailto:${t.email}`}
                    className="font-normal text-primary-700 underline-offset-4 hover:underline dark:text-primary-300"
                  >
                    {t.email}
                  </a>
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  #{t.id} · {t.createdAt.slice(0, 16).replace('T', ' ')}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={t.status === 'open' ? 'open' : 'resolved'}>{t.status}</Badge>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void setStatus(t.id, t.status === 'open' ? 'resolved' : 'open')}
                >
                  {t.status === 'open' ? 'Mark resolved' : 'Reopen'}
                </Button>
              </div>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {t.message}
            </p>
          </Card>
        ))}
        {data && data.items.length === 0 && (
          <Card>
            <p className="text-center text-sm text-slate-500 dark:text-slate-400">
              Inbox zero — no support tickets.
            </p>
          </Card>
        )}
      </div>
    </section>
  );
}
