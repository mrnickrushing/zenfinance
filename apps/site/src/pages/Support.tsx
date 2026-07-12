import { useState, type FormEvent } from 'react';
import { Button, Card, TextArea, TextInput } from '../components/ui';
import { apiFetch } from '../lib/api';

const faqs = [
  {
    q: 'When does ZenFinance launch?',
    a: 'ZenFinance is in development for iPhone. Join the waitlist on the home page for early TestFlight access — waitlist members get in first.',
  },
  {
    q: 'How does ZenFinance access my bank data?',
    a: 'Through Plaid, the same read-only connection used by major finance apps. We never see or store your bank credentials, and we can never move your money.',
  },
  {
    q: 'Can I delete my data?',
    a: 'Yes — one tap disconnects an account and deletes its transactions, and you can delete your entire account and data from inside the app at any time.',
  },
  {
    q: 'Is ZenFinance financial advice?',
    a: 'No. ZenFinance is an educational coaching tool. It explains your own spending in plain English but does not provide investment, tax, or legal advice.',
  },
  {
    q: 'How much does it cost?',
    a: 'The core experience is free. ZenFinance Coach is $7.99/month or $59.99/year as an App Store subscription, with a 14-day free trial.',
  },
];

export function SupportPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Support</h1>
      <p className="mt-3 text-slate-600 dark:text-slate-300">
        Questions, bugs, or feedback — we read everything. Email{' '}
        <a
          href="mailto:support@rushingtechnologies.com"
          className="font-medium text-primary-700 underline-offset-4 hover:underline dark:text-primary-300"
        >
          support@rushingtechnologies.com
        </a>{' '}
        or use the form below.
      </p>

      <section aria-labelledby="faq-heading" className="mt-12">
        <h2 id="faq-heading" className="text-xl font-semibold">
          Frequently asked questions
        </h2>
        <div className="mt-6 space-y-4">
          {faqs.map((f) => (
            <Card key={f.q}>
              <h3 className="font-medium">{f.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {f.a}
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="contact-heading" className="mt-12">
        <h2 id="contact-heading" className="text-xl font-semibold">
          Contact us
        </h2>
        <ContactForm />
      </section>
    </div>
  );
}

function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState('busy');
    try {
      await apiFetch('/api/support', { method: 'POST', body: JSON.stringify(form) });
      setState('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong');
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <p role="status" className="mt-6 text-primary-700 dark:text-primary-300">
        Thanks — your message is in. We'll reply to your email soon.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <TextInput
          label="Your name"
          id="support-name"
          required
          maxLength={120}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <TextInput
          label="Email address"
          id="support-email"
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </div>
      <TextArea
        label="How can we help?"
        id="support-message"
        required
        minLength={10}
        maxLength={5000}
        value={form.message}
        onChange={(e) => setForm({ ...form, message: e.target.value })}
      />
      {state === 'error' && (
        <p role="alert" className="text-sm text-rose-600">
          {errorMsg}
        </p>
      )}
      <Button type="submit" disabled={state === 'busy'}>
        {state === 'busy' ? 'Sending…' : 'Send message'}
      </Button>
    </form>
  );
}
