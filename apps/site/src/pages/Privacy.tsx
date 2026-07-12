export function PrivacyPage() {
  return (
    <div className="prose-zen mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        Last updated July 12, 2026 — prepared for final legal review before App Store submission.
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
            <li>You can export your data from the app or through the API before deleting.</li>
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
            reports, first-party usage events, subscription entitlement status, and support
            requests you send us). If you use referrals, we store your referral code,
            redemption status, and premium-credit expiration dates.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            How we use data
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            We use your data to authenticate your account, sync read-only financial data, generate
            coaching, detect anomalies, manage subscriptions, send notifications you enable, handle
            support, prevent abuse, run the referral program, publish minimum-sample aggregate
            launch insights, and understand whether the beta or launch is working.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Processors
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            ZenFinance uses Plaid for read-only account linking, RevenueCat for App Store
            subscription entitlements, Anthropic for optional AI enrichment/coaching, Sentry for
            diagnostics, Expo/APNs for push notifications, Railway/Postgres for hosting, and Resend
            for support email. We configure diagnostics to avoid default PII collection and scrub
            common secrets before error events leave the server.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            How deletion works
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            Deleting your account revokes linked provider items when possible, removes your
            account data from production database tables through cascade deletion, and stores only
            non-PII deletion evidence: a salted email hash, item count, revocation-failure count,
            and completion timestamp. Backups expire within their documented window, currently 30
            days.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Your choices
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            You can disconnect a bank, export your data, disable notification types, cancel your
            subscription through the App Store, or delete your account from the app. Privacy
            requests can also be sent to support@rushingtechnologies.com.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Public aggregate insights
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            ZenFinance may publish launch-cohort statistics only as anonymized aggregate metrics,
            such as average recurring charges or average verified Money Wins. We do not publish
            raw transactions, individual merchants tied to a user, or small-cohort slices.
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
