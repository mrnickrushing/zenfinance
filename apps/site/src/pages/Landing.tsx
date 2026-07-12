import { useState, type FormEvent } from 'react';
import { Card } from '../components/ui';
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
      <section className="bg-ledger-graphite px-6 pb-0 pt-9 text-center text-ledger-warm">
        <img
          src="/icon-512.png"
          alt="ZenFinance app icon"
          className="mx-auto mb-4 h-24 w-24 rounded-3xl shadow-glow"
        />
        <h1 className="mx-auto max-w-2xl text-4xl font-bold leading-none tracking-tight sm:text-5xl">
          A financial coach in your pocket that reads your transactions{' '}
          <span className="text-primary-400">so you don't have to</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg leading-7 text-slate-300">
          ZenFinance links your accounts, understands your spending, and tells you the one thing
          worth doing this week — in plain English.
        </p>
        <TryBriefWaitlist />
      </section>

      <section
        aria-labelledby="briefs-heading"
        className="bg-[#101820] py-4 text-ledger-warm"
      >
        <div className="mx-auto max-w-[62rem] px-6">
          <h2 id="briefs-heading" className="text-center text-3xl font-bold tracking-tight">
            What a coach brief looks like
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-center text-slate-300">
            Real advice with real numbers from your own spending — never generic tips.
          </p>
          <div className="mt-4 grid gap-6 md:grid-cols-3">
            {exampleBriefs.map((brief) => (
              <Card
                key={brief.headline}
                className="border-ledger-borderDark bg-ledger-panelDark/70 text-left shadow-none"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-accent-400">
                  {brief.impact}
                </p>
                <h3 className="mt-2 font-semibold">{brief.headline}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">
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

function TryBriefWaitlist() {
  const [transaction, setTransaction] = useState('"I spent $186 dining out this week"');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [brief, setBrief] = useState({
    action: 'Cap dining out at $100 to stay on track for your Japan trip goal.',
    impact: 'Potential impact: Save $45',
  });

  function generateBrief(e: FormEvent) {
    e.preventDefault();
    const input = transaction.trim().toLowerCase();

    if (input.includes('subscription') || input.includes('stream') || input.includes('netflix')) {
      setBrief({
        action: 'Cancel one unused subscription before it renews and move that money toward your buffer.',
        impact: 'Potential impact: Save $60/yr',
      });
      return;
    }

    if (input.includes('coffee') || input.includes('cafe')) {
      setBrief({
        action: 'Set a $25 coffee cap for the rest of the week and keep the difference in savings.',
        impact: 'Potential impact: Save $18',
      });
      return;
    }

    setBrief({
      action: 'Cap dining out at $100 to stay on track for your Japan trip goal.',
      impact: 'Potential impact: Save $45',
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState('busy');
    try {
      await apiFetch('/api/waitlist', {
        method: 'POST',
        body: JSON.stringify({ email, source: 'landing-try-the-brief' }),
      });
      setState('done');
    } catch {
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <p role="status" className="mx-auto mt-8 max-w-xl text-lg font-medium text-primary-300">
        You're on the list — we'll be in touch when TestFlight opens.
      </p>
    );
  }

  return (
    <div className="mx-auto mt-4 max-w-[35rem]">
      <form
        onSubmit={generateBrief}
        className="rounded-card border border-ledger-borderDark bg-ledger-panelDark/70 p-4 text-left shadow-soft"
      >
        <label htmlFor="transaction-demo" className="block text-sm font-semibold text-slate-200">
          Try it: paste a transaction
        </label>
        <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_156px]">
          <input
            id="transaction-demo"
            type="text"
            value={transaction}
            onChange={(e) => setTransaction(e.target.value)}
            placeholder='"I spent $186 dining out this week"'
            className="h-12 min-w-0 rounded-card border border-ledger-borderDark bg-[#111820] px-5 text-sm text-ledger-warm placeholder:text-slate-400 focus:border-primary-400"
          />
          <button
            type="submit"
            className="h-12 whitespace-nowrap rounded-card bg-primary-500 px-4 text-sm font-semibold text-white shadow-glow transition-colors duration-standard hover:bg-primary-400"
          >
            Generate my brief
          </button>
        </div>
      </form>

      <div className="mt-3 flex items-center gap-4 rounded-card border border-ledger-borderDark bg-ledger-panelDark/70 p-4 text-left shadow-soft">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-500 text-3xl leading-none text-white">
          <span aria-hidden="true" className="-mt-1">
            ✓
          </span>
        </div>
        <div>
          <p className="text-base font-bold text-white">This week's action:</p>
          <p className="mt-1 text-sm leading-6 text-slate-200">{brief.action}</p>
          <p className="mt-1 text-sm font-semibold text-emerald-400">{brief.impact}</p>
        </div>
      </div>

      <form
        id="waitlist"
        onSubmit={submit}
        className="mx-auto mt-4 grid max-w-[28rem] gap-3 sm:grid-cols-[1fr_190px]"
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
          className="h-12 min-w-0 rounded-card border border-ledger-borderDark bg-ledger-panelDark/70 px-5 text-sm text-ledger-warm placeholder:text-slate-400 focus:border-primary-400"
        />
        <button
          type="submit"
          disabled={state === 'busy'}
          className="h-12 rounded-card bg-primary-500 px-6 text-sm font-semibold text-white shadow-glow transition-colors duration-standard hover:bg-primary-400 disabled:pointer-events-none disabled:opacity-60"
        >
          {state === 'busy' ? 'Joining…' : 'Join the waitlist'}
        </button>
      </form>
      <p className="mt-3 text-sm text-slate-400">Send this brief to my inbox + early TestFlight access</p>
      {state === 'error' && (
        <p role="alert" className="mt-3 text-sm text-rose-300">
          Something went wrong — please try again.
        </p>
      )}
    </div>
  );
}
