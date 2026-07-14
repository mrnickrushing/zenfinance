interface SafeErrorSummary {
  name: string;
  message: string;
  // Populated only from error.response (the body a provider like Plaid sent
  // back describing what was wrong with our request) — never from
  // error.config/request, which carry our outgoing auth headers.
  providerStatus?: number;
  providerError?: unknown;
}

/**
 * Return a log-safe error summary. Third-party SDK errors commonly carry the
 * complete HTTP request config (including authorization headers) as enumerable
 * properties, so never pass the original object to console logging.
 */
export function safeErrorSummary(error: unknown): SafeErrorSummary {
  if (!(error instanceof Error)) return { name: 'UnknownError', message: 'Unknown error' };
  const summary: SafeErrorSummary = {
    name: error.name || 'Error',
    message: error.message.slice(0, 500),
  };
  const response = (error as { response?: { status?: number; data?: unknown } }).response;
  if (response && typeof response === 'object') {
    summary.providerStatus = response.status;
    summary.providerError = response.data;
  }
  return summary;
}
