/**
 * HTTP request layer: typed error mapping, retries with backoff, `Retry-After`
 * handling, a per-attempt timeout, and one `Idempotency-Key` per call.
 *
 * Error class by response (first match wins):
 *   code `send_failed` (any status) → SendFailedError, never retried
 *   400 → ValidationError · 401/403 → AuthError · 404 → NotFoundError
 *   409 `idempotency_in_progress` → RateLimitedError (retried)
 *   409 other, 422 → ValidationError · 429 → RateLimitedError (retried)
 *   5xx → ServerError (retried) · anything else → SanadApiError
 *   no response → ServerError `network_error` / `timeout`, status 0 (retried)
 */

import {
  SanadApiError,
  RateLimitedError,
  ValidationError,
  AuthError,
  NotFoundError,
  ServerError,
  SendFailedError,
} from './errors.js';

/** Default per-attempt timeout. */
export const DEFAULT_TIMEOUT_MS = 30_000;

const MAX_COMPUTED_BACKOFF_MS = 30_000;
const MAX_RETRY_AFTER_MS = 60_000;

export interface CreateRequesterOptions {
  apiKey: string;
  baseUrl: string;
  retries: number;
  fetchImpl: typeof fetch;
  userAgent: string;
  /** Per-attempt timeout in milliseconds (default 30000). `0` disables it. */
  timeoutMs?: number;
}

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  query?: Record<string, string | number | boolean | undefined> | undefined;
  body?: unknown;
  /**
   * Multipart body. Sent as-is (fetch sets the `Content-Type` with its
   * boundary) and reused on every retry. Cannot be combined with `body`.
   */
  formData?: FormData;
  /** When true, send one `Idempotency-Key` header reused across retries. */
  idempotent?: boolean;
  /** Exact caller-supplied header value; a UUID is generated when omitted. */
  idempotencyKey?: string;
  /** Callback invoked once per attempt with the final (non-retried) response headers. */
  onHeaders?: (headers: Headers) => void;
}

export type Requester = <T>(opts: RequestOptions) => Promise<T>;

interface ErrorBody {
  [key: string]: unknown;
  success?: false;
  code?: unknown;
  message?: unknown;
  message_ar?: unknown;
  details?: unknown;
  upstream_code?: unknown;
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
 * Compute the wait before the next attempt.
 *
 * With a server `Retry-After`: that value, capped at 60000ms.
 * Without: 250ms × 2^(attempt-1), capped at 30000ms.
 */
export const computeBackoff = (attempt: number, retryAfterMs: number | null): number => {
  if (retryAfterMs != null) return Math.min(MAX_RETRY_AFTER_MS, retryAfterMs);
  const exp = 250 * 2 ** (attempt - 1);
  return Math.min(MAX_COMPUTED_BACKOFF_MS, exp);
};

const scalarString = (value: unknown): string | null =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : null;

const errorDetails = (value: unknown): Record<string, unknown> | unknown[] =>
  value !== null && typeof value === 'object'
    ? value as Record<string, unknown> | unknown[]
    : [];

const plainObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

/** `X-RateLimit-*` value: a non-negative integer, else `null`. */
const parseCountHeader = (header: string | null): number | null =>
  header !== null && /^\d+$/.test(header) ? Number(header) : null;

const isTimeoutError = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'TimeoutError';

/**
 * Whether a response is retried automatically. `send_failed` never is: after
 * a WhatsApp 5xx/408/429 the API marks the send "uncertain" and answers a
 * repeat with the same key 409 `send_failed`, which would hide the original
 * WhatsApp error from the caller.
 */
export const isRetryable = (status: number, code: string): boolean => {
  if (code === 'send_failed') return false;
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
  headers: Headers,
): SanadApiError => {
  const code = scalarString(body.code) ?? 'unknown_error';
  const message = scalarString(body.message) ?? `Request failed with status ${status}`;
  const commonArgs = {
    message,
    code,
    status,
    requestId,
    messageAr: scalarString(body.message_ar),
    details: errorDetails(body.details),
    upstreamCode: scalarString(body.upstream_code),
    rawBody: body,
  };
  const rateLimitArgs = () => ({
    ...commonArgs,
    retryAfterSec,
    limit: parseCountHeader(headers.get('x-ratelimit-limit')),
    remaining: parseCountHeader(headers.get('x-ratelimit-remaining')),
  });

  if (code === 'send_failed') {
    return new SendFailedError({ ...commonArgs, metaError: plainObject(body.meta_error) });
  }
  if (status === 400) {
    return new ValidationError(commonArgs);
  }
  if (status === 401 || status === 403) {
    return new AuthError(commonArgs);
  }
  if (status === 404) {
    return new NotFoundError(commonArgs);
  }
  if (status === 409) {
    if (code === 'idempotency_in_progress') {
      return new RateLimitedError(rateLimitArgs());
    }
    // Every other 409 is a state conflict the caller must resolve: not retried.
    return new ValidationError(commonArgs);
  }
  if (status === 422) {
    return new ValidationError(commonArgs);
  }
  if (status === 429) {
    return new RateLimitedError(rateLimitArgs());
  }
  if (status >= 500 && status < 600) {
    return new ServerError(commonArgs);
  }
  // 402, 413, 415 and any other status.
  return new SanadApiError(commonArgs);
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
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async <T>(reqOpts: RequestOptions): Promise<T> => {
    if (reqOpts.body !== undefined && reqOpts.formData !== undefined) {
      throw new TypeError('Request options `body` and `formData` cannot both be set.');
    }

    const idempotencyKey = reqOpts.idempotent === true
      ? (reqOpts.idempotencyKey ?? globalThis.crypto.randomUUID())
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
      } else if (reqOpts.formData !== undefined) {
        // No Content-Type here: fetch adds it with the multipart boundary.
        init.body = reqOpts.formData;
      }
      if (timeoutMs > 0) init.signal = AbortSignal.timeout(timeoutMs);

      let res: Response;
      try {
        res = await fetchImpl(url, init);
      } catch (err) {
        // No response (network failure or attempt timeout): retryable.
        if (attempt < maxAttempts) {
          await sleep(computeBackoff(attempt, null));
          continue;
        }
        const timedOut = isTimeoutError(err);
        throw new ServerError({
          message: timedOut ? 'Request timed out' : 'Network error',
          code: timedOut ? 'timeout' : 'network_error',
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
        if (text.length > 0) {
          const decoded = JSON.parse(text) as unknown;
          if (decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded)) {
            bodyJson = decoded as ErrorBody;
          }
        }
      } catch {
        bodyJson = {};
      }

      const code = scalarString(bodyJson.code) ?? 'unknown_error';
      const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
      const retryAfterSec = retryAfterMs != null ? Math.ceil(retryAfterMs / 1000) : null;

      if (isRetryable(res.status, code) && attempt < maxAttempts) {
        await sleep(computeBackoff(attempt, retryAfterMs));
        continue;
      }

      lastError = mapErrorResponse(res.status, bodyJson, requestId, retryAfterSec, res.headers);
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
