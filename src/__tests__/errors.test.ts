import { describe, it, expect } from 'vitest';
import {
  SanadApiError,
  RateLimitedError,
  ValidationError,
  AuthError,
  NotFoundError,
  ServerError,
  isSanadApiError,
} from '../errors.js';

describe('SanadApiError', () => {
  it('sets all fields and is instanceof Error + SanadApiError', () => {
    const details = { field: 'phone_number_id' };
    const rawBody = { code: 'oops', details };
    const err = new SanadApiError({
      message: 'boom',
      code: 'oops',
      status: 500,
      requestId: 'req_1',
      messageAr: 'خطأ',
      details,
      upstreamCode: 'META_1',
      rawBody,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SanadApiError);
    expect(err.message).toBe('boom');
    expect(err.code).toBe('oops');
    expect(err.status).toBe(500);
    expect(err.requestId).toBe('req_1');
    expect(err.messageAr).toBe('خطأ');
    expect(err.details).toBe(details);
    expect(err.upstreamCode).toBe('META_1');
    expect(err.rawBody).toBe(rawBody);
    expect(err.name).toBe('SanadApiError');
  });

  it('supports Error.cause via constructor arg', () => {
    const cause = new Error('root');
    const err = new SanadApiError({ message: 'wrapped', code: 'x', status: 0, cause });
    expect(err.cause).toBe(cause);
  });

  it('omits requestId when not provided', () => {
    const err = new SanadApiError({ message: 'm', code: 'c', status: 400 });
    expect(err.requestId).toBeUndefined();
    expect(err.messageAr).toBeNull();
    expect(err.details).toEqual([]);
    expect(err.upstreamCode).toBeNull();
    expect(err.rawBody).toEqual({});
  });
});

describe('RateLimitedError', () => {
  it('sets retryAfterSec, name, and inherits SanadApiError', () => {
    const err = new RateLimitedError({ message: 'slow down', code: 'rate_limited', status: 429, retryAfterSec: 12 });
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err).toBeInstanceOf(SanadApiError);
    expect(err.retryAfterSec).toBe(12);
    expect(err.name).toBe('RateLimitedError');
  });

  it('defaults retryAfterSec to null when not provided', () => {
    const err = new RateLimitedError({ message: 'slow', code: 'rate_limited', status: 429 });
    expect(err.retryAfterSec).toBeNull();
  });
});

describe('subclasses keep their own name', () => {
  it.each([
    [ValidationError, 'ValidationError', 400, 'validation_error'],
    [AuthError, 'AuthError', 401, 'unauthorized'],
    [NotFoundError, 'NotFoundError', 404, 'not_found'],
  ] as const)('%p sets name=%s', (Cls, name, status, code) => {
    const e = new Cls({ message: 'x', code, status });
    expect(e.name).toBe(name);
    expect(e).toBeInstanceOf(SanadApiError);
    expect(e).toBeInstanceOf(Error);
  });
});

describe('ServerError', () => {
  it('carries upstreamCode when provided', () => {
    const e = new ServerError({ message: 'send fail', code: 'send_failed', status: 502, upstreamCode: 'WA_400' });
    expect(e.upstreamCode).toBe('WA_400');
    expect(e.name).toBe('ServerError');
    expect(e).toBeInstanceOf(SanadApiError);
  });

  it('defaults upstreamCode to null', () => {
    const e = new ServerError({ message: 'x', code: 'server_error', status: 500 });
    expect(e.upstreamCode).toBeNull();
  });
});

describe('isSanadApiError', () => {
  it('returns true for instances and subclasses', () => {
    expect(isSanadApiError(new SanadApiError({ message: 'm', code: 'c', status: 1 }))).toBe(true);
    expect(isSanadApiError(new RateLimitedError({ message: 'm', code: 'c', status: 429 }))).toBe(true);
    expect(isSanadApiError(new ValidationError({ message: 'm', code: 'c', status: 400 }))).toBe(true);
  });

  it('returns false for plain Error / object / null / primitives', () => {
    expect(isSanadApiError(new Error('x'))).toBe(false);
    expect(isSanadApiError({ code: 'c', status: 500, message: 'x' })).toBe(false);
    expect(isSanadApiError(null)).toBe(false);
    expect(isSanadApiError(undefined)).toBe(false);
    expect(isSanadApiError('error')).toBe(false);
    expect(isSanadApiError(42)).toBe(false);
  });
});

describe('does not leak apiKey when serialized (T-52-01)', () => {
  it('JSON.stringify does not include any bearer token (request layer never logs them)', () => {
    const err = new SanadApiError({ message: 'auth failed', code: 'unauthorized', status: 401, requestId: 'req_x' });
    const s = JSON.stringify({ ...err, message: err.message, code: err.code, status: err.status, requestId: err.requestId });
    expect(s).not.toContain('Bearer');
    expect(s).not.toMatch(/pk_(live|test)_/);
  });
});
