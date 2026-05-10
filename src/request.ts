/**
 * HTTP request layer with typed error mapping, retry+backoff, Retry-After
 * honor, and per-call idempotency UUID generation.
 *
 * Wire-format JSON envelopes are mapped to typed errors per the SANAD Public
 * API contract — see `<interfaces>` in the plan / publicApi.js for canonical
 * codes.
 */

import {
  SanadApiError,
  RateLimitedError,
  ValidationError,
  AuthError,
  NotFoundError,
  ServerError,
} from './errors.js';

export interface CreateRequesterOptions {
  apiKey: string;
  baseUrl: string;
  retries: number;
  fetchImpl: typeof fetch;
  userAgent: string;
}

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  query?: Record<string, string | number | boolean | undefined> | undefined;
  body?: unknown;
  /** When true, generate a UUID `Idempotency-Key` header (reused across retries). */
  idempotent?: boolean;
  /** Callback invoked once per attempt with the final (non-retried) response headers. */
  onHeaders?: (headers: Headers) => void;
}

export type Requester = <T>(opts: RequestOptions) => Promise<T>;

interface ErrorBody {
  success?: false;
  code?: string;
  message?: string;
  upstream_code?: string | null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Parse `Retry-After` header. Accepts integer seconds OR HTTP-date (RFC 7231).
 * Returns milliseconds, or `null` for invalid / absent / negative.
 */
export const parseRetryAfter = (header: string | null): number | null => {
  if (!header) return null;
  const trimmed = header.trim();
  if (trimmed.length === 0) return null;
  // Try integer seconds first.
  if (/^\d+$/.test(trimmed)) {
    const sec = Number(trimmed);
    if (sec < 0) return null;
    return sec * 1000;
  }
  // Try HTTP-date.
  const epoch = Date.parse(trimmed);
  if (Number.isNaN(epoch)) return null;
  const delta = epoch - Date.now();
  if (delta < 0) return null;
  return delta;
};

/**
 * Compute backoff for a given attempt. If `retryAfterMs` is provided it
 * overrides the exponential math.
 *
 * Schedule: 250ms × 2^(attempt-1), capped at 30000ms.
 */
export const computeBackoff = (attempt: number, retryAfterMs: number | null): number => {
  if (retryAfterMs != null) return retryAfterMs;
  const exp = 250 * 2 ** (attempt - 1);
  return Math.min(30_000, exp);
};

const isRetryable = (status: number, code: string): boolean => {
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  if (status === 409 && code === 'idempotency_in_progress') return true;
  return false;
};

const mapErrorResponse = (
  status: number,
  body: ErrorBody,
  requestId: string | undefined,
  retryAfterSec: number | null,
): SanadApiError => {
  const code = String(body.code ?? 'unknown_error');
  const message = String(body.message ?? `Request failed with status ${status}`);
  const upstreamCode = body.upstream_code ?? null;

  if (status === 400) {
    return new ValidationError({ message, code, status, requestId });
  }
  if (status === 401 || status === 403) {
    return new AuthError({ message, code, status, requestId });
  }
  if (status === 404) {
    return new NotFoundError({ message, code, status, requestId });
  }
  if (status === 409) {
    if (code === 'idempotency_in_progress') {
      return new RateLimitedError({ message, code, status, requestId, retryAfterSec });
    }
    // idempotency_conflict and other 409s: client-side bug, NOT retryable.
    return new ValidationError({ message, code, status, requestId });
  }
  if (status === 429) {
    return new RateLimitedError({ message, code, status, requestId, retryAfterSec });
  }
  if (status >= 500 && status < 600) {
    return new ServerError({ message, code, status, requestId, upstreamCode });
  }
  // Fallback for unexpected statuses.
  return new SanadApiError({ message, code, status, requestId });
};

const buildUrl = (
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string => {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const p = path.startsWith('/') ? path : `/${path}`;
  let url = `${base}${p}`;
  if (query) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      sp.append(k, String(v));
    }
    const qs = sp.toString();
    if (qs.length > 0) url += `?${qs}`;
  }
  return url;
};

export const createRequester = (opts: CreateRequesterOptions): Requester => {
  const { apiKey, baseUrl, retries, fetchImpl, userAgent } = opts;
  const maxAttempts = Math.max(1, retries);

  return async <T>(reqOpts: RequestOptions): Promise<T> => {
    const idempotencyKey = reqOpts.idempotent === true
      ? globalThis.crypto.randomUUID()
      : null;

    const url = buildUrl(baseUrl, reqOpts.path, reqOpts.query);

    let lastError: SanadApiError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'User-Agent': userAgent,
      };
      if (reqOpts.body !== undefined) headers['Content-Type'] = 'application/json';
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

      const init: RequestInit = {
        method: reqOpts.method,
        headers,
      };
      if (reqOpts.body !== undefined) {
        init.body = JSON.stringify(reqOpts.body);
      }

      let res: Response;
      try {
        res = await fetchImpl(url, init);
      } catch (err) {
        // Network error — treat as retryable.
        if (attempt < maxAttempts) {
          await sleep(computeBackoff(attempt, null));
          continue;
        }
        throw new ServerError({
          message: 'Network error',
          code: 'network_error',
          status: 0,
          cause: err,
        });
      }

      const requestId = res.headers.get('x-request-id') ?? undefined;

      if (res.ok) {
        if (reqOpts.onHeaders) reqOpts.onHeaders(res.headers);
        // 204 / empty body → return undefined cast as T.
        const text = await res.text();
        if (text.length === 0) return undefined as T;
        return JSON.parse(text) as T;
      }

      let bodyJson: ErrorBody = {};
      try {
        const text = await res.text();
        if (text.length > 0) bodyJson = JSON.parse(text) as ErrorBody;
      } catch {
        bodyJson = {};
      }

      const code = String(bodyJson.code ?? 'unknown_error');
      const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
      const retryAfterSec = retryAfterMs != null ? Math.ceil(retryAfterMs / 1000) : null;

      if (isRetryable(res.status, code) && attempt < maxAttempts) {
        await sleep(computeBackoff(attempt, retryAfterMs));
        continue;
      }

      lastError = mapErrorResponse(res.status, bodyJson, requestId, retryAfterSec);
      throw lastError;
    }

    // Unreachable in practice — loop either returns or throws.
    throw lastError ?? new ServerError({
      message: 'Retry loop exhausted without response',
      code: 'retry_exhausted',
      status: 0,
    });
  };
};
