export function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        Last updated July 12, 2026 — prepared for final legal review before App Store submission.
      </p>

      <div className="mt-8 space-y-8 text-slate-700 dark:text-slate-300">
        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">The service</h2>
          <p className="mt-3 text-sm leading-relaxed">
            ZenFinance is an educational money-coaching app operated by Rushing Technologies. It
            summarizes and explains your own financial activity in plain language. The service is
            read-only: it cannot move money, make payments, or place trades.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Not financial advice
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            ZenFinance provides educational information and behavioral coaching only. It does not
            provide investment, tax, legal, or professional financial advice, and its suggestions
            should not be treated as such. Freelancer Mode set-aside calculations are estimates for
            planning, not tax advice. Consult a qualified professional for decisions that need one.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Purchases
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            Premium features are sold as auto-renewing App Store subscriptions managed through your
            Apple ID. Pricing and trial terms are shown at purchase. You can cancel any time in
            your App Store settings. Money Physical is sold as a one-time App Store purchase and
            generates a report from your available ZenFinance data at the time the purchase or
            restore is processed.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Referral credits
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            Referral credits are promotional access to ZenFinance Coach. A valid referral
            redemption grants the stated number of premium-access days to both accounts. Credits
            are not cash, are not transferable, cannot be refunded, and may be limited or revoked
            for abuse.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Linked accounts
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            By linking an institution, you authorize ZenFinance and its data provider to retrieve
            read-only account and transaction information for coaching. You can disconnect a linked
            item or delete your ZenFinance account at any time.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Household Sharing
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            Household Sharing is for shared planning between invited members. Shared goals,
            contribution history, member emails, and invite status are visible to household
            members. Linked accounts, transactions, personal goals, chat, alerts, and billing
            details remain individual unless a future feature explicitly says otherwise.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Voice Briefs
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            Voice Briefs are spoken versions of existing coaching briefs. The app uses on-device
            text-to-speech playback and does not create an account-transfer, payment, or advisory
            service. Treat spoken guidance the same as written ZenFinance coaching: educational
            information, not professional advice.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Money Physical
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            Money Physical is an educational 90-day checkup based on linked accounts, transactions,
            goals, recurring charges, and Money Wins. It is not a credit score, investment advice,
            tax advice, or a guarantee of future financial outcomes.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Beta availability
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            During TestFlight and closed beta, features may change, access may be limited, and
            production financial institution coverage depends on Plaid and App Store approvals.
            We may pause invites or specific integrations to protect reliability and user data.
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
