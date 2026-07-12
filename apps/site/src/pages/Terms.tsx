export function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        Draft — these terms will be finalized with legal review before the app launches.
      </p>

      <div className="mt-8 space-y-8 text-slate-700 dark:text-slate-300">
        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">The service</h2>
          <p className="mt-3 text-sm leading-relaxed">
            ZenFinance is an educational money-coaching app operated by Rushing Technologies. It
            summarizes and explains your own financial activity in plain language.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Not financial advice
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            ZenFinance provides educational information and behavioral coaching only. It does not
            provide investment, tax, legal, or professional financial advice, and its suggestions
            should not be treated as such. Consult a qualified professional for decisions that
            need one.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Subscriptions
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            Premium features are sold as auto-renewing App Store subscriptions managed through your
            Apple ID. Pricing and trial terms are shown at purchase. You can cancel any time in
            your App Store settings.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Contact</h2>
          <p className="mt-3 text-sm leading-relaxed">
            Questions about these terms:{' '}
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
