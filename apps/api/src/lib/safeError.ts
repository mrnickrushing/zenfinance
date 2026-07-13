/**
 * Return a log-safe error summary. Third-party SDK errors commonly carry the
 * complete HTTP request config (including authorization headers) as enumerable
 * properties, so never pass the original object to console logging.
 */
export function safeErrorSummary(error: unknown): { name: string; message: string } {
  if (!(error instanceof Error)) return { name: 'UnknownError', message: 'Unknown error' };
  return {
    name: error.name || 'Error',
    message: error.message.slice(0, 500),
  };
}
