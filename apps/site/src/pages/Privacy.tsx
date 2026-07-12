export function PrivacyPage() {
  return (
    <div className="prose-zen mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        Draft — this policy will be finalized with legal review before the app launches.
      </p>

      <div className="mt-8 space-y-8 text-slate-700 dark:text-slate-300">
        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            The plain-English version
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
            <li>We never see or store your bank username or password — linking happens through Plaid.</li>
            <li>Our access to your accounts is read-only. We cannot move your money.</li>
            <li>You can disconnect an account or delete everything with one tap, any time.</li>
            <li>We don't sell your data. Ever.</li>
            <li>
              Only the minimum context needed to generate your coaching is shared with our AI
              provider — compact summaries, not raw exports of your life.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            What we collect
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            Your email address; account and transaction data from institutions you choose to link
            (via Plaid); goals and preferences you set in the app; and standard diagnostics (crash
            reports, anonymized usage events).
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            How deletion works
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            Deleting your account removes your data from our production systems immediately and
            from backups within their documented expiry window (30 days), and triggers deletion
            requests with our processors, including Plaid and our AI provider.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Contact</h2>
          <p className="mt-3 text-sm leading-relaxed">
            Privacy questions:{' '}
            <a
              href="mailto:support@rushingtechnologies.com"
              className="font-medium text-primary-700 underline-offset-4 hover:underline dark:text-primary-300"
            >
              support@rushingtechnologies.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
