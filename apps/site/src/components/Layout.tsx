import { Link, Outlet } from 'react-router-dom';

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-ledger-borderDark bg-ledger-graphite/90 text-ledger-warm backdrop-blur">
        <div className="mx-auto flex max-w-[62rem] flex-col gap-3 px-6 py-4 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:py-0">
          <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <img src="/favicon-64.png" alt="" className="h-8 w-8 rounded-lg" />
            ZenFinance
          </Link>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <Link
              to="/insights"
              className="text-slate-300 transition-colors duration-standard hover:text-primary-300"
            >
              Insights
            </Link>
            <Link
              to="/support"
              className="text-slate-300 transition-colors duration-standard hover:text-primary-300"
            >
              Support
            </Link>
            <Link
              to="/#waitlist"
              className="rounded-card bg-primary-600 px-4 py-2 font-medium text-white transition-colors duration-standard hover:bg-primary-700"
            >
              Join the waitlist
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-ledger-border bg-ledger-panel dark:border-ledger-borderDark dark:bg-ledger-graphite">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between dark:text-slate-400">
          <p>© {new Date().getFullYear()} Rushing Technologies. All rights reserved.</p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            <Link to="/support" className="hover:text-primary-700 dark:hover:text-primary-300">
              Support
            </Link>
            <Link to="/insights" className="hover:text-primary-700 dark:hover:text-primary-300">
              Insights
            </Link>
            <a
              href="mailto:support@rushingtechnologies.com"
              className="hover:text-primary-700 dark:hover:text-primary-300"
            >
              support@rushingtechnologies.com
            </a>
            <Link to="/privacy" className="hover:text-primary-700 dark:hover:text-primary-300">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-primary-700 dark:hover:text-primary-300">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
