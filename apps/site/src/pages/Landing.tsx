import { useState, type FormEvent } from 'react';
import { Button, Card } from '../components/ui';
import { apiFetch } from '../lib/api';

const exampleBriefs = [
  {
    headline: 'Dining out is running hot',
    body: "You've spent $186 on dining this week — $45 over your usual pace. Skipping two takeout orders keeps your Japan-trip goal on track.",
    impact: 'Keeps you on pace · ~$45',
  },
  {
    headline: 'A subscription started charging more',
    body: 'StreamMax quietly went from $11.99 to $16.99 this month. Want the cancellation script, or is it a keeper?',
    impact: 'Potential save · $60/yr',
  },
  {
    headline: 'Nice work — goal ahead of schedule',
    body: "Three no-spend days this week put your emergency fund 9 days ahead of plan. Nothing to do — just don't touch anything.",
    impact: 'Verified win · +$120',
  },
];

const features = [
  {
    title: 'Coaching, not dashboards',
    body: 'No charts to decode. One short brief a week that names a dollar amount and exactly one action.',
  },
  {
    title: 'Calm by design',
    body: 'No red alarms, no guilt streaks. Progress framing from an app that respects your attention.',
  },
  {
    title: 'Private by default',
    body: 'Read-only bank access, credentials never stored, one tap to disconnect and delete everything.',
  },
];

export function LandingPage() {
  return (
    <>
      <section className="mx-auto max-w-5xl px-6 pb-20 pt-16 text-center sm:pt-24">
        <img
          src="/icon-512.png"
          alt="ZenFinance app icon"
          className="mx-auto mb-8 h-24 w-24 rounded-3xl shadow-glow"
        />
        <h1 className="mx-auto max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
          A financial coach in your pocket that reads your transactions{' '}
          <span className="text-primary-600 dark:text-primary-400">so you don't have to</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-slate-600 dark:text-slate-300">
          ZenFinance links your accounts, understands your spending, and tells you the one thing
          worth doing this week — in plain English.
        </p>
        <div className="mt-10">
          <WaitlistForm />
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
            Coming soon to iPhone · Join the waitlist for early TestFlight access
          </p>
        </div>
      </section>

      <section aria-labelledby="briefs-heading" className="bg-ledger-panel py-20 dark:bg-ledger-panelDark/70">
        <div className="mx-auto max-w-5xl px-6">
          <h2 id="briefs-heading" className="text-center text-3xl font-bold tracking-tight">
            What a coach brief looks like
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-center text-slate-600 dark:text-slate-300">
            Real advice with real numbers from your own spending — never generic tips.
          </p>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {exampleBriefs.map((brief) => (
              <Card key={brief.headline} className="text-left">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-accent-400">
                  {brief.impact}
                </p>
                <h3 className="mt-2 font-semibold">{brief.headline}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {brief.body}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="features-heading" className="py-20">
        <div className="mx-auto max-w-5xl px-6">
          <h2 id="features-heading" className="text-center text-3xl font-bold tracking-tight">
            Built to be deleted from your mind
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-center text-slate-600 dark:text-slate-300">
            Set it up once. It speaks up only when there's money on the table.
          </p>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="text-center">
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-primary-950 py-20 text-center text-white">
        <div className="mx-auto max-w-2xl px-6">
          <h2 className="text-3xl font-bold tracking-tight">Free to start. $7.99/mo for the full coach.</h2>
          <p className="mt-4 text-primary-200">
            The free tier watches for unusual charges and sends a weekly brief. Premium adds the
            on-demand chat coach, cash-flow forecasts, the subscription auditor, and a running tally
            of every dollar it saves you.
          </p>
          <p className="mt-6 text-sm text-primary-300">
            ZenFinance is educational coaching, not financial advice.
          </p>
        </div>
      </section>
    </>
  );
}

function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState('busy');
    try {
      await apiFetch('/api/waitlist', {
        method: 'POST',
        body: JSON.stringify({ email, source: 'landing' }),
      });
      setState('done');
    } catch {
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <p role="status" className="text-lg font-medium text-primary-600 dark:text-primary-400">
        You're on the list — we'll be in touch when TestFlight opens. 🪷
      </p>
    );
  }

  return (
    <form
      id="waitlist"
      onSubmit={submit}
      className="mx-auto flex max-w-md flex-col gap-3 sm:flex-row"
    >
      <label htmlFor="waitlist-email" className="sr-only">
        Email address
      </label>
      <input
        id="waitlist-email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="h-12 flex-1 rounded-card border border-ledger-border bg-ledger-panel px-5 text-sm text-ledger-ink placeholder:text-slate-400 focus:border-primary-500 dark:border-ledger-borderDark dark:bg-ledger-panelDark dark:text-ledger-warm"
      />
      <Button type="submit" size="lg" disabled={state === 'busy'} className="h-12">
        {state === 'busy' ? 'Joining…' : 'Join the waitlist'}
      </Button>
      {state === 'error' && (
        <p role="alert" className="text-sm text-rose-600 sm:absolute sm:mt-14">
          Something went wrong — please try again.
        </p>
      )}
    </form>
  );
}
