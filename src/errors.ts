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
  cause?: unknown;
}

export class SanadApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly requestId: string | undefined;

  constructor(args: SanadApiErrorArgs) {
    super(args.message, args.cause !== undefined ? { cause: args.cause } : undefined);
    // Subclasses inherit name automatically via new.target
    this.name = new.target.name;
    this.code = args.code;
    this.status = args.status;
    this.requestId = args.requestId;
  }
}

export interface RateLimitedErrorArgs extends SanadApiErrorArgs {
  retryAfterSec?: number | null;
}

export class RateLimitedError extends SanadApiError {
  public readonly retryAfterSec: number | null;

  constructor(args: RateLimitedErrorArgs) {
    super(args);
    this.retryAfterSec = args.retryAfterSec ?? null;
  }
}

export class ValidationError extends SanadApiError {}
export class AuthError extends SanadApiError {}
export class NotFoundError extends SanadApiError {}

export interface ServerErrorArgs extends SanadApiErrorArgs {
  upstreamCode?: string | null;
}

export class ServerError extends SanadApiError {
  public readonly upstreamCode: string | null;

  constructor(args: ServerErrorArgs) {
    super(args);
    this.upstreamCode = args.upstreamCode ?? null;
  }
}

export const isSanadApiError = (e: unknown): e is SanadApiError =>
  e instanceof SanadApiError;
