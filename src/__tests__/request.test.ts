import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRequester,
  parseRetryAfter,
  computeBackoff,
  isRetryable,
} from '../request.js';
import {
  SanadApiError,
  RateLimitedError,
  ValidationError,
  AuthError,
  NotFoundError,
  ServerError,
  SendFailedError,
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
  apiKey: 'pk_test_fake_key',
  baseUrl: 'https://api.test/v1',
  userAgent: '@sanadwa/whatsapp-sdk/0.4.0',
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

  it('honors retryAfterMs override up to the 60000ms cap', () => {
    expect(computeBackoff(1, 5000)).toBe(5000);
    expect(computeBackoff(7, 100)).toBe(100);
    expect(computeBackoff(1, 45_000)).toBe(45_000);
    expect(computeBackoff(1, 60_000)).toBe(60_000);
    expect(computeBackoff(1, 3_600_000)).toBe(60_000);
  });
});

// ---------- isRetryable ----------

describe('isRetryable', () => {
  it('retries 429, 409 idempotency_in_progress and 5xx', () => {
    expect(isRetryable(429, 'rate_limited')).toBe(true);
    expect(isRetryable(409, 'idempotency_in_progress')).toBe(true);
    expect(isRetryable(500, 'server_error')).toBe(true);
    expect(isRetryable(503, 'balance_check_failed')).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 429, 500, 503])('never retries send_failed (%i)', (status) => {
    expect(isRetryable(status, 'send_failed')).toBe(false);
  });

  it.each([
    [400, 'validation_error'],
    [401, 'unauthorized'],
    [402, 'insufficient_credits'],
    [403, 'api_scope_insufficient'],
    [404, 'tag_not_found'],
    [409, 'idempotency_conflict'],
    [409, 'campaign_busy'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [415, 'import_file_not_csv'],
    [422, 'audience_empty'],
  ] as const)('does not retry %i %s', (status, code) => {
    expect(isRetryable(status, code)).toBe(false);
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

  it('Caller Idempotency-Key is exact and reused across retries', async () => {
    const randomUuid = vi.spyOn(globalThis.crypto, 'randomUUID');
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(mkResponse(500, { code: 'server_error' }))
      .mockResolvedValueOnce(mkResponse(200, { ok: true }));
    const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });

    const promise = req({
      method: 'POST',
      path: '/messages/template',
      body: { idempotency_key: 'caller-key-123' },
      idempotent: true,
      idempotencyKey: 'caller-key-123',
    });
    await vi.runAllTimersAsync();
    await promise;

    const sent = fetchImpl.mock.calls.map(([, init]: [string, RequestInit]) =>
      (init.headers as Record<string, string>)['Idempotency-Key']);
    expect(sent).toEqual(['caller-key-123', 'caller-key-123']);
    expect(randomUuid).not.toHaveBeenCalled();
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

  it('Retry-After: 45 sleeps 45000ms', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(mkResponse(429, { code: 'rate_limited' }, { 'retry-after': '45' }))
      .mockResolvedValueOnce(mkResponse(200, { ok: true }));
    const req = createRequester({ ...baseOpts, retries: 2, fetchImpl: fetchImpl as unknown as typeof fetch });
    const promise = req({ method: 'GET', path: '/x' });

    await vi.advanceTimersByTimeAsync(44_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await promise;

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('Retry-After: 120 sleeps 60000ms (cap) and retryAfterSec stays 120', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(mkResponse(429, { code: 'rate_limited' }, { 'retry-after': '120' }))
      .mockResolvedValueOnce(mkResponse(429, { code: 'rate_limited' }, { 'retry-after': '120' }));
    const req = createRequester({ ...baseOpts, retries: 2, fetchImpl: fetchImpl as unknown as typeof fetch });
    const promise = req({ method: 'GET', path: '/x' }).catch((caught: unknown) => caught);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const error = await promise;

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSec).toBe(120);
  });

  it('Retry-After is honoured on a retried 5xx', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(mkResponse(503, { code: 'balance_check_failed' }, { 'retry-after': '60' }))
      .mockResolvedValueOnce(mkResponse(200, { ok: true }));
    const req = createRequester({ ...baseOpts, retries: 2, fetchImpl: fetchImpl as unknown as typeof fetch });
    const promise = req({ method: 'GET', path: '/x' });

    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
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

  it('RateLimitedError reports the uncapped server Retry-After value', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mkResponse(429, { code: 'rate_limited', message: 'slow' }, { 'retry-after': '3600' }),
    );
    const req = createRequester({ ...baseOpts, retries: 1, fetchImpl: fetchImpl as unknown as typeof fetch });

    const error = await req({ method: 'GET', path: '/x' }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSec).toBe(3600);
  });

  it('Max attempts exhausted on 5xx → ServerError with upstreamCode', async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(mkResponse(502, { code: 'bad_gateway', message: 'upstream fail', upstream_code: 'WA_X' })));
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

  it('preserves live 402 Arabic message, details, and raw body', async () => {
    const body = {
      success: false,
      code: 'PREPAID_CREDIT_CAP_REACHED',
      message: 'Prepaid messaging cap exceeded',
      message_ar: 'تم تجاوز حد الرسائل المدفوعة مسبقاً',
      details: { cap_sar: 100, spent_sar: 100, required_sar: 0.25 },
    };
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(402, body, { 'x-request-id': 'req_cap' }));
    const req = createRequester({ ...baseOpts, retries: 1, fetchImpl: fetchImpl as unknown as typeof fetch });

    const error = await req({ method: 'GET', path: '/health' }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SanadApiError);
    expect(error).not.toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({
      code: 'PREPAID_CREDIT_CAP_REACHED',
      status: 402,
      requestId: 'req_cap',
      messageAr: body.message_ar,
      details: body.details,
      upstreamCode: null,
      rawBody: body,
    });
  });

  it('preserves upstream_code on a non-5xx send_failed error', async () => {
    const body = {
      success: false,
      code: 'send_failed',
      message: 'Meta rejected the message',
      message_ar: 'رفضت ميتا الرسالة',
      details: { phone_number_id: '123456789' },
      upstream_code: 'META_131047',
    };
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(400, body));
    const req = createRequester({ ...baseOpts, retries: 1, fetchImpl: fetchImpl as unknown as typeof fetch });

    const error = await req({ method: 'POST', path: '/messages/template', body: {} })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SendFailedError);
    expect(error).not.toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({
      code: 'send_failed',
      messageAr: body.message_ar,
      details: body.details,
      upstreamCode: 'META_131047',
      rawBody: body,
    });
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
    expect(headers['Authorization']).toBe('Bearer pk_test_fake_key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Accept']).toBe('application/json');
    expect(headers['User-Agent']).toBe('@sanadwa/whatsapp-sdk/0.4.0');
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

// ---------- 0.4.0: error mapping (spec 3.1) ----------

const META_ERROR = {
  title: 'Message undeliverable',
  message: '(#131026) Message undeliverable',
  code: 131026,
  subcode: 2494010,
  type: 'OAuthException',
  fbtrace_id: 'FAKE_TRACE_0001',
};

const sendFailedBody = (extra: Record<string, unknown> = {}) => ({
  success: false,
  code: 'send_failed',
  message: 'WhatsApp rejected the message',
  message_ar: 'رفض واتساب الرسالة',
  upstream_code: '131026',
  meta_error: META_ERROR,
  ...extra,
});

describe('createRequester — error mapping', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const failOnce = async (
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
    retries = 5,
  ) => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(mkResponse(status, body, headers)));
    const req = createRequester({ ...baseOpts, retries, fetchImpl: fetchImpl as unknown as typeof fetch });
    const p = req({ method: 'POST', path: '/messages/template', body: {}, idempotent: true })
      .catch((caught: unknown) => caught);
    await vi.runAllTimersAsync();
    return { error: await p, fetchImpl };
  };

  it.each([400, 401, 403, 404, 409, 429, 500, 503])(
    'send_failed with status %i → SendFailedError, one call, no sleep',
    async (status) => {
      const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(mkResponse(status, sendFailedBody())));
      const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
      const error = await req({ method: 'POST', path: '/messages/template', body: {}, idempotent: true })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(SendFailedError);
      expect(error).toBeInstanceOf(SanadApiError);
      expect(error).not.toBeInstanceOf(AuthError);
      expect(error).not.toBeInstanceOf(NotFoundError);
      expect(error).not.toBeInstanceOf(RateLimitedError);
      expect(error).not.toBeInstanceOf(ServerError);
      expect(error).not.toBeInstanceOf(ValidationError);
      expect(error).toMatchObject({
        name: 'SendFailedError',
        code: 'send_failed',
        status,
        upstreamStatus: status,
        upstreamCode: '131026',
        metaError: META_ERROR,
      });
      expect(Object.keys((error as SendFailedError).metaError!)).toHaveLength(6);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('send_failed without meta_error → metaError null', async () => {
    const { error } = await failOnce(500, { code: 'send_failed', message: 'failed' });
    expect(error).toBeInstanceOf(SendFailedError);
    expect((error as SendFailedError).metaError).toBeNull();
    expect((error as SendFailedError).upstreamCode).toBeNull();
  });

  it('send_failed with a non-object meta_error → metaError null', async () => {
    const { error } = await failOnce(500, sendFailedBody({ meta_error: 'oops' }));
    expect((error as SendFailedError).metaError).toBeNull();
    const second = await failOnce(500, sendFailedBody({ meta_error: ['a'] }));
    expect((second.error as SendFailedError).metaError).toBeNull();
  });

  it('send_failed keeps recovery reachable through rawBody', async () => {
    const recovery = { action: 'add_payment_method', url: 'https://example.test/billing' };
    const { error } = await failOnce(402, sendFailedBody({ upstream_code: '131042', recovery }));
    expect(error).toBeInstanceOf(SendFailedError);
    expect((error as SendFailedError).rawBody.recovery).toEqual(recovery);
  });

  it('409 customer_service_window_closed → ValidationError with details', async () => {
    const details = {
      last_inbound_at: '2026-11-20T09:00:00.000Z',
      window_expires_at: '2026-11-21T09:00:00.000Z',
      template_required: true,
    };
    const { error, fetchImpl } = await failOnce(409, {
      code: 'customer_service_window_closed', message: 'closed', details,
    });
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).details).toEqual(details);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('422 → ValidationError, not retried', async () => {
    const { error, fetchImpl } = await failOnce(422, { code: 'audience_empty', message: 'empty' });
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).status).toBe(422);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('403 → AuthError', async () => {
    const { error, fetchImpl } = await failOnce(403, { code: 'api_scope_insufficient', message: 'no' });
    expect(error).toBeInstanceOf(AuthError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    [402, 'insufficient_credits'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [415, 'import_file_not_csv'],
  ] as const)('%i %s → base SanadApiError, not retried', async (status, code) => {
    const { error, fetchImpl } = await failOnce(status, { code, message: 'x' });
    expect(error).toBeInstanceOf(SanadApiError);
    expect((error as Error).constructor).toBe(SanadApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('5xx with another code → ServerError after retries', async () => {
    const { error, fetchImpl } = await failOnce(503, { code: 'campaign_create_timeout', message: 'x' }, {}, 3);
    expect(error).toBeInstanceOf(ServerError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('503 other code retried then succeeds with the same Idempotency-Key', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(mkResponse(503, { code: 'balance_check_failed' }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(mkResponse(409, { code: 'idempotency_in_progress' }, { 'retry-after': '1' }))
      .mockResolvedValueOnce(mkResponse(200, { ok: true }));
    const req = createRequester({ ...baseOpts, retries: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    const p = req({ method: 'POST', path: '/x', body: {}, idempotent: true });
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ ok: true });
    const keys = fetchImpl.mock.calls.map(([, init]: [string, RequestInit]) =>
      (init.headers as Record<string, string>)['Idempotency-Key']);
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ---------- 0.4.0: rate-limit headers ----------

describe('createRequester — rate-limit headers', () => {
  const fail = async (status: number, code: string, headers: Record<string, string>) => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(status, { code, message: 'slow' }, headers));
    const req = createRequester({ ...baseOpts, retries: 1, fetchImpl: fetchImpl as unknown as typeof fetch });
    return req({ method: 'GET', path: '/x' }).catch((caught: unknown) => caught) as Promise<RateLimitedError>;
  };

  it('429 exposes limit and remaining', async () => {
    const error = await fail(429, 'rate_limited', { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '0' });
    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error.limit).toBe(60);
    expect(error.remaining).toBe(0);
  });

  it('409 idempotency_in_progress exposes limit and remaining', async () => {
    const error = await fail(409, 'idempotency_in_progress', {
      'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '59', 'retry-after': '1',
    });
    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error.limit).toBe(60);
    expect(error.remaining).toBe(59);
    expect(error.retryAfterSec).toBe(1);
  });

  it('absent headers give null', async () => {
    const error = await fail(429, 'rate_limited', {});
    expect(error.limit).toBeNull();
    expect(error.remaining).toBeNull();
  });

  it.each(['abc', '-1', '1.5', '', '6 0'])('non-numeric header %j gives null', async (value) => {
    const error = await fail(429, 'rate_limited', { 'x-ratelimit-limit': value, 'x-ratelimit-remaining': value });
    expect(error.limit).toBeNull();
    expect(error.remaining).toBeNull();
  });
});

// ---------- 0.4.0: timeout ----------

describe('createRequester — timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const timeoutError = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

  it('passes an AbortSignal built from the default 30000ms to fetch', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(200, { ok: true }));
    const req = createRequester({ ...baseOpts, retries: 1, fetchImpl: fetchImpl as unknown as typeof fetch });
    await req({ method: 'GET', path: '/x' });
    expect(spy).toHaveBeenCalledWith(30_000);
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('uses the configured timeoutMs, one fresh signal per attempt', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(mkResponse(500, { code: 'server_error' }))
      .mockResolvedValueOnce(mkResponse(200, { ok: true }));
    const req = createRequester({
      ...baseOpts, retries: 2, timeoutMs: 1234, fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const p = req({ method: 'GET', path: '/x' });
    await vi.runAllTimersAsync();
    await p;
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 1234);
    const signals = fetchImpl.mock.calls.map(([, init]: [string, RequestInit]) => init.signal);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it('timeoutMs: 0 passes no signal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(200, { ok: true }));
    const req = createRequester({
      ...baseOpts, retries: 1, timeoutMs: 0, fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await req({ method: 'GET', path: '/x' });
    expect('signal' in (fetchImpl.mock.calls[0]![1] as RequestInit)).toBe(false);
  });

  it('a timed-out attempt is retried, then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(mkResponse(200, { ok: true }));
    const req = createRequester({ ...baseOpts, retries: 3, fetchImpl: fetchImpl as unknown as typeof fetch });
    const p = req({ method: 'GET', path: '/x' });
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('timeouts on every attempt end as ServerError code=timeout status=0', async () => {
    const cause = timeoutError();
    const fetchImpl = vi.fn().mockRejectedValue(cause);
    const req = createRequester({ ...baseOpts, retries: 3, fetchImpl: fetchImpl as unknown as typeof fetch });
    const p = req({ method: 'GET', path: '/x' }).catch((caught: unknown) => caught);
    await vi.runAllTimersAsync();
    const error = await p as ServerError;
    expect(error).toBeInstanceOf(ServerError);
    expect(error.code).toBe('timeout');
    expect(error.status).toBe(0);
    expect(error.cause).toBe(cause);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

// ---------- 0.4.0: multipart transport (spec 2.9) ----------

describe('createRequester — formData', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const mkForm = () => {
    const form = new FormData();
    form.append('file', new Blob(['phone\n+12025550123\n'], { type: 'text/csv' }), 'contacts.csv');
    form.append('tags', 'vip,new');
    return form;
  };

  it('sends the FormData as the body without a Content-Type header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(200, { ok: true }));
    const req = createRequester({ ...baseOpts, retries: 1, fetchImpl: fetchImpl as unknown as typeof fetch });
    const form = mkForm();
    await req({ method: 'POST', path: '/contacts/import', formData: form, idempotent: true });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe(form);
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('content-type');
    expect(headers['Idempotency-Key']).toBeTruthy();
  });

  it('reuses the same FormData on retry', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(mkResponse(500, { code: 'contacts_import_failed' }))
      .mockResolvedValueOnce(mkResponse(200, { ok: true }));
    const req = createRequester({ ...baseOpts, retries: 2, fetchImpl: fetchImpl as unknown as typeof fetch });
    const form = mkForm();
    const p = req({ method: 'POST', path: '/contacts/import', formData: form, idempotent: true });
    await vi.runAllTimersAsync();
    await p;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).body).toBe(form);
    expect((fetchImpl.mock.calls[1]![1] as RequestInit).body).toBe(form);
  });

  it('body + formData throws TypeError before any HTTP', async () => {
    const fetchImpl = vi.fn();
    const req = createRequester({ ...baseOpts, retries: 1, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(req({ method: 'POST', path: '/x', body: {}, formData: mkForm() }))
      .rejects.toBeInstanceOf(TypeError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('DELETE without a body is sent and an empty success body returns undefined', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const req = createRequester({ ...baseOpts, retries: 1, fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await req({ method: 'DELETE', path: '/tags/42', idempotent: true });
    expect(out).toBeUndefined();
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).method).toBe('DELETE');
  });
});
