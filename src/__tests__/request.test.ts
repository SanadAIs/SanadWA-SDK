import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRequester,
  parseRetryAfter,
  computeBackoff,
} from '../request.js';
import {
  RateLimitedError,
  ValidationError,
  AuthError,
  NotFoundError,
  ServerError,
} from '../errors.js';

// ---------- helpers ----------

const mkResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response => {
  const h = new Headers({ 'content-type': 'application/json', ...headers });
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: h,
  });
};

const baseOpts = {
  apiKey: 'pk_test_xxx',
  baseUrl: 'https://api.test/v1',
  userAgent: '@sanadais/whatsapp-sdk/0.1.0',
};

// ---------- parseRetryAfter ----------

describe('parseRetryAfter', () => {
  it('parses integer seconds → ms', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter('0')).toBe(0);
    expect(parseRetryAfter('  10  ')).toBe(10000);
  });

  it('parses HTTP-date in future → ms', () => {
    const future = new Date(Date.now() + 3000).toUTCString();
    const ms = parseRetryAfter(future);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThan(1000);
    expect(ms!).toBeLessThanOrEqual(3500);
  });

  it('returns null for invalid / past / null / empty', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter('   ')).toBeNull();
    expect(parseRetryAfter('not-a-date')).toBeNull();
    expect(parseRetryAfter('-5')).toBeNull(); // negative is rejected by /^\d+$/
    const past = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfter(past)).toBeNull();
  });
});

// ---------- computeBackoff ----------

describe('computeBackoff', () => {
  it('exponential schedule starting at 250ms, capped at 30000ms', () => {
    expect(computeBackoff(1, null)).toBe(250);
    expect(computeBackoff(2, null)).toBe(500);
    expect(computeBackoff(3, null)).toBe(1000);
    expect(computeBackoff(7, null)).toBe(16_000);
    expect(computeBackoff(8, null)).toBe(30_000); // 250*128 = 32000 → capped
    expect(computeBackoff(20, null)).toBe(30_000);
  });

  it('honors retryAfterMs override', () => {
    expect(computeBackoff(1, 5000)).toBe(5000);
    expect(computeBackoff(7, 100)).toBe(100);
  });
});

// ---------- request loop ----------

describe('createRequester', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns parsed JSON on 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(200, { ok: true, value: 42 }));
    const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    const promise = req<{ ok: boolean; value: number }>({ method: 'GET', path: '/x' });
    await vi.runAllTimersAsync();
    const body = await promise;
    expect(body).toEqual({ ok: true, value: 42 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('Idempotency UUID generated ONCE and reused across retries', async () => {
    let counter = 0;
    const uuids = ['uuid-A', 'uuid-B', 'uuid-C'];
    const orig = globalThis.crypto.randomUUID;
    const stub = vi.fn(() => uuids[counter++] as `${string}-${string}-${string}-${string}-${string}`);
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: stub, configurable: true });

    try {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(mkResponse(429, { code: 'rate_limited', message: 'slow' }, { 'retry-after': '0' }))
        .mockResolvedValueOnce(mkResponse(429, { code: 'rate_limited', message: 'slow' }, { 'retry-after': '0' }))
        .mockResolvedValueOnce(mkResponse(200, { ok: true }));
      const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
      const promise = req({ method: 'POST', path: '/messages/template', body: { x: 1 }, idempotent: true });
      await vi.runAllTimersAsync();
      await promise;
      expect(stub).toHaveBeenCalledTimes(1);
      const sent = fetchImpl.mock.calls.map(([, init]: [string, RequestInit]) =>
        (init.headers as Record<string, string>)['Idempotency-Key']);
      expect(sent).toEqual(['uuid-A', 'uuid-A', 'uuid-A']);
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: orig, configurable: true });
    }
  });

  it('No Idempotency-Key header when idempotent not set', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(200, { ok: true }));
    const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    const promise = req({ method: 'GET', path: '/x' });
    await vi.runAllTimersAsync();
    await promise;
    const headers = fetchImpl.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBeUndefined();
  });

  it('Retry on 429 honors Retry-After (overrides backoff math)', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(mkResponse(429, { code: 'rate_limited' }, { 'retry-after': '1' }))
      .mockResolvedValueOnce(mkResponse(200, { ok: true }));
    const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    const promise = req({ method: 'GET', path: '/x' });
    // advance 999ms — should still be sleeping
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    await promise;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('Retry on 5xx with exponential backoff', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(mkResponse(500, { code: 'server_error' }))
      .mockResolvedValueOnce(mkResponse(500, { code: 'server_error' }))
      .mockResolvedValueOnce(mkResponse(200, { ok: true }));
    const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    const promise = req({ method: 'GET', path: '/x' });
    // attempt 1 backoff = 250ms
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // attempt 2 backoff = 500ms
    await vi.advanceTimersByTimeAsync(500);
    await promise;
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('Max attempts exhausted on 429 → RateLimitedError with retryAfterSec', async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(mkResponse(429, { code: 'rate_limited' }, { 'retry-after': '1' })));
    const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    const promise = req({ method: 'GET', path: '/x' });
    const settled = expect(promise).rejects.toBeInstanceOf(RateLimitedError);
    await vi.runAllTimersAsync();
    await settled;
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    // verify the error fields
    const fetchImpl2 = vi.fn().mockImplementation(() =>
      Promise.resolve(mkResponse(429, { code: 'rate_limited', message: 'slow' }, { 'retry-after': '7' })));
    const req2 = createRequester({ ...baseOpts, retries: 2, fetchImpl: fetchImpl2 as unknown as typeof fetch });
    const p2 = req2({ method: 'GET', path: '/x' }).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await p2 as RateLimitedError;
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.status).toBe(429);
    expect(err.retryAfterSec).toBe(7);
  });

  it('Max attempts exhausted on 500 → ServerError with upstreamCode', async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(mkResponse(502, { code: 'send_failed', message: 'wa fail', upstream_code: 'WA_X' })));
    const req = createRequester({ ...baseOpts, retries: 3, fetchImpl: fetchImpl as unknown as typeof fetch });
    const p = req({ method: 'POST', path: '/x', body: {} }).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await p as ServerError;
    expect(err).toBeInstanceOf(ServerError);
    expect(err.status).toBe(502);
    expect(err.upstreamCode).toBe('WA_X');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('No retry on 400 validation_error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(400, { code: 'validation_error', message: 'bad' }));
    const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    const p = req({ method: 'POST', path: '/x', body: {} }).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await p as ValidationError;
    expect(err).toBeInstanceOf(ValidationError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('No retry on 401 → AuthError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(401, { code: 'unauthorized', message: 'nope' }));
    const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    const p = req({ method: 'GET', path: '/x' }).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await p;
    expect(err).toBeInstanceOf(AuthError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('No retry on 404 → NotFoundError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(404, { code: 'message_not_found', message: 'no' }));
    const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    const p = req({ method: 'GET', path: '/x' }).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await p;
    expect(err).toBeInstanceOf(NotFoundError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('No retry on 409 idempotency_conflict → ValidationError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(409, { code: 'idempotency_conflict', message: 'conflict' }));
    const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    const p = req({ method: 'POST', path: '/x', body: {}, idempotent: true }).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await p;
    expect(err).toBeInstanceOf(ValidationError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('Retry on 409 idempotency_in_progress → eventually 200', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(mkResponse(409, { code: 'idempotency_in_progress' }, { 'retry-after': '1' }))
      .mockResolvedValueOnce(mkResponse(200, { ok: true }));
    const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    const p = req({ method: 'POST', path: '/x', body: {}, idempotent: true });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('Network error retried, then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(mkResponse(200, { ok: true }));
    const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    const p = req({ method: 'GET', path: '/x' });
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('Network error exhausted → ServerError code=network_error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const req = createRequester({ ...baseOpts, retries: 3, fetchImpl: fetchImpl as unknown as typeof fetch });
    const p = req({ method: 'GET', path: '/x' }).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await p as ServerError;
    expect(err).toBeInstanceOf(ServerError);
    expect(err.code).toBe('network_error');
    expect(err.status).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('Bearer token + Content-Type + User-Agent + Accept headers set', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(200, { ok: true }));
    const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    const p = req({ method: 'POST', path: '/x', body: { a: 1 } });
    await vi.runAllTimersAsync();
    await p;
    const headers = fetchImpl.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer pk_test_xxx');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Accept']).toBe('application/json');
    expect(headers['User-Agent']).toBe('@sanadais/whatsapp-sdk/0.1.0');
  });

  it('No Content-Type when no body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(200, { ok: true }));
    const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    const p = req({ method: 'GET', path: '/x' });
    await vi.runAllTimersAsync();
    await p;
    const headers = fetchImpl.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('Query string encoded via URLSearchParams', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(200, { ok: true }));
    const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    const p = req({ method: 'GET', path: '/x', query: { q: 'hello world', page: 2 } });
    await vi.runAllTimersAsync();
    await p;
    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain('q=hello+world');
    expect(url).toContain('page=2');
  });

  it('captures requestId from X-Request-Id header into errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(401, { code: 'unauthorized' }, { 'x-request-id': 'req_zzz' }));
    const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    const p = req({ method: 'GET', path: '/x' }).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await p as AuthError;
    expect(err.requestId).toBe('req_zzz');
  });

  it('onHeaders callback fires on success with response headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(200, { ok: true }, { 'x-idempotent-replay': 'true' }));
    const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    let captured: string | null = null;
    const p = req({ method: 'POST', path: '/x', body: {}, idempotent: true, onHeaders: (h) => { captured = h.get('x-idempotent-replay'); } });
    await vi.runAllTimersAsync();
    await p;
    expect(captured).toBe('true');
  });
});
