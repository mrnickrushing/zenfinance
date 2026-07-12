export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// The site is deployed separately from the API (Cloudflare Workers vs.
// Railway), so requests are cross-origin — VITE_API_URL points at the API
// and cookies must be sent explicitly via credentials: 'include'.
export const API_BASE = import.meta.env.VITE_API_URL ?? '';

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : null;
  if (!res.ok) {
    const code = body?.error?.code ?? 'request_failed';
    const message = body?.error?.message ?? `Request failed (${res.status})`;
    throw new ApiRequestError(res.status, code, message);
  }
  return body as T;
}
