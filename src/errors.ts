/**
 * Typed error class hierarchy for the SANAD WhatsApp SDK.
 *
 * All HTTP failures throw a subclass of `SanadApiError`. Callers can use
 * `instanceof` checks for narrowing or the `isSanadApiError` type guard.
 */

export interface SanadApiErrorArgs {
  message: string;
  code: string;
  status: number;
  requestId?: string | undefined;
  messageAr?: string | null | undefined;
  details?: Record<string, unknown> | unknown[] | undefined;
  upstreamCode?: string | null | undefined;
  rawBody?: Record<string, unknown> | undefined;
  cause?: unknown;
}

export class SanadApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly requestId: string | undefined;
  public readonly messageAr: string | null;
  public readonly details: Record<string, unknown> | unknown[];
  public readonly upstreamCode: string | null;
  public readonly rawBody: Record<string, unknown>;

  constructor(args: SanadApiErrorArgs) {
    super(args.message, args.cause !== undefined ? { cause: args.cause } : undefined);
    // Subclasses inherit name automatically via new.target
    this.name = new.target.name;
    this.code = args.code;
    this.status = args.status;
    this.requestId = args.requestId;
    this.messageAr = args.messageAr ?? null;
    this.details = args.details ?? [];
    this.upstreamCode = args.upstreamCode ?? null;
    this.rawBody = args.rawBody ?? {};
  }
}

export interface RateLimitedErrorArgs extends SanadApiErrorArgs {
  retryAfterSec?: number | null;
  limit?: number | null;
  remaining?: number | null;
}

/**
 * Thrown for HTTP 429 and for 409 `idempotency_in_progress`, after the
 * automatic retries are used up.
 */
export class RateLimitedError extends SanadApiError {
  /** The server's `Retry-After` value in seconds (not capped), or `null`. */
  public readonly retryAfterSec: number | null;
  /** `X-RateLimit-Limit`: requests allowed per window for this key, or `null`. */
  public readonly limit: number | null;
  /** `X-RateLimit-Remaining`: requests left in the current window, or `null`. */
  public readonly remaining: number | null;

  constructor(args: RateLimitedErrorArgs) {
    super(args);
    this.retryAfterSec = args.retryAfterSec ?? null;
    this.limit = args.limit ?? null;
    this.remaining = args.remaining ?? null;
  }
}

export interface SendFailedErrorArgs extends SanadApiErrorArgs {
  metaError?: Record<string, unknown> | null;
}

/**
 * Thrown whenever the API answers with code `send_failed`, whatever the HTTP
 * status. The status is WhatsApp's own status, so a 401/403 here is not about
 * your API key. Never retried automatically.
 *
 * It extends `SanadApiError` only: it is not an `AuthError`, `NotFoundError`,
 * `ValidationError`, `RateLimitedError` or `ServerError`.
 */
export class SendFailedError extends SanadApiError {
  /**
   * The HTTP status of the API response (equals `status`). For most failures
   * this is WhatsApp's status (500 when WhatsApp gave none); it is the API's
   * own 409/503 when it refused a repeat of an unresolved send.
   */
  public readonly upstreamStatus: number;
  /**
   * The response's `meta_error` object, unchanged (`title`, `message`, `code`,
   * `subcode`, `type`, `fbtrace_id`; also `details` for WhatsApp billing
   * error 131042). `null` when absent.
   */
  public readonly metaError: Record<string, unknown> | null;

  constructor(args: SendFailedErrorArgs) {
    super(args);
    this.upstreamStatus = args.status;
    this.metaError = args.metaError ?? null;
  }
}

export class ValidationError extends SanadApiError {}
export class AuthError extends SanadApiError {}
export class NotFoundError extends SanadApiError {}

export interface ServerErrorArgs extends SanadApiErrorArgs {}

export class ServerError extends SanadApiError {}

export const isSanadApiError = (e: unknown): e is SanadApiError =>
  e instanceof SanadApiError;
