import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught render error', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-ledger-warm px-6 text-center dark:bg-ledger-graphite">
          <div>
            <h1 className="text-xl font-semibold text-ledger-ink dark:text-ledger-warm">Something went wrong</h1>
            <p className="mt-2 text-sm text-ledger-muted dark:text-slate-300">Try reloading the page. If it keeps happening, let us know.</p>
            <Button className="mt-6" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
