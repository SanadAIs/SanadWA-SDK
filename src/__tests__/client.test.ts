import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SanadWhatsApp,
  SanadApiError,
  RateLimitedError,
  NotFoundError,
  ServerError,
  ValidationError,
  isSanadApiError,
} from '../index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const mkResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...headers },
});

describe('SanadWhatsApp constructor', () => {
  it('throws when apiKey missing', () => {
    expect(() => new SanadWhatsApp({} as never)).toThrow(/apiKey/);
  });
  it('throws on empty apiKey', () => {
    expect(() => new SanadWhatsApp({ apiKey: '' })).toThrow(/apiKey/);
  });
  it('constructs with valid apiKey', () => {
    const c = new SanadWhatsApp({ apiKey: 'pk_test', fetch: (() => Promise.resolve(mkResponse(200, {}))) as unknown as typeof fetch });
    expect(c).toBeInstanceOf(SanadWhatsApp);
    expect(typeof c.health).toBe('function');
    expect(typeof c.templates.list).toBe('function');
    expect(typeof c.messages.send).toBe('function');
    expect(typeof c.messages.reply).toBe('function');
    expect(typeof c.messages.get).toBe('function');
    expect(typeof c.webhooks.verify).toBe('function');
  });
});

describe('SanadWhatsApp.health', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('GETs default base URL + /health and maps response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(200, {
      success: true, tenant_id: 't_1', scope: 'send', server_time: '2026-05-10T00:00:00Z',
    }));
    const sdk = new SanadWhatsApp({ apiKey: 'pk_x', fetch: fetchImpl as unknown as typeof fetch });
    const p = sdk.health();
    await vi.runAllTimersAsync();
    const out = await p;
    expect(out).toEqual({ tenantId: 't_1', scope: 'send', serverTime: '2026-05-10T00:00:00Z' });
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.sanadwa.com/api/public/v1/health');
  });

  it('respects custom baseUrl', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(200, {
      success: true, tenant_id: 't', scope: 's', server_time: 'now',
    }));
    const sdk = new SanadWhatsApp({
      apiKey: 'k',
      baseUrl: 'https://staging.sanad.test/api/public/v1',
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const p = sdk.health();
    await vi.runAllTimersAsync();
    await p;
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://staging.sanad.test/api/public/v1/health');
  });
});

describe('SanadWhatsApp.templates.list', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('passes query string', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(200, {
      success: true, page: 2, limit: 25, data: [],
    }));
    const sdk = new SanadWhatsApp({ apiKey: 'k', fetch: fetchImpl as unknown as typeof fetch });
    const p = sdk.templates.list({ page: 2 });
    await vi.runAllTimersAsync();
    await p;
    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain('/templates?page=2');
  });
});

describe('SanadWhatsApp.messages.send', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('POSTs snake_case body and Idempotency-Key matches UUID v4', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(200, {
      success: true, message_id: 'msg_1', accepted_at: 'now', upstream: {},
    }));
    const sdk = new SanadWhatsApp({ apiKey: 'k', fetch: fetchImpl as unknown as typeof fetch });
    const p = sdk.messages.send({
      phoneNumberId: 'PNID', toPhone: '+1', templateName: 't', templateLanguage: 'en', templateParams: ['x'],
    });
    await vi.runAllTimersAsync();
    await p;
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      phone_number_id: 'PNID', to_phone: '+1', template_name: 't', template_language: 'en', template_params: ['x'],
    });
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toMatch(UUID_RE);
    expect(headers['User-Agent']).toBe('@sanadwa/whatsapp-sdk/0.3.0');
  });

  it('UUID is reused across retries (D-08 invariant)', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(mkResponse(429, { code: 'rate_limited' }, { 'retry-after': '0' }))
      .mockResolvedValueOnce(mkResponse(200, { success: true, message_id: 'm', accepted_at: 'now' }));
    const sdk = new SanadWhatsApp({ apiKey: 'k', fetch: fetchImpl as unknown as typeof fetch });
    const p = sdk.messages.send({ phoneNumberId: 'P', toPhone: '+1', templateName: 't' });
    await vi.runAllTimersAsync();
    await p;
    const k1 = (fetchImpl.mock.calls[0]![1].headers as Record<string, string>)['Idempotency-Key'];
    const k2 = (fetchImpl.mock.calls[1]![1].headers as Record<string, string>)['Idempotency-Key'];
    expect(k1).toMatch(UUID_RE);
    expect(k1).toBe(k2);
  });

  it('rejects an unsafe caller idempotency key before invoking a custom fetch', async () => {
    const fetchImpl = vi.fn();
    const sdk = new SanadWhatsApp({
      apiKey: 'k',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const error = await sdk.messages.send({
      phoneNumberId: 'P',
      toPhone: '+1',
      templateName: 't',
      idempotencyKey: 'abc\r\nX-Evil: 1',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).code).toBe('invalid_idempotency_key');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('SanadWhatsApp.messages.reply', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('POSTs a text reply and generates an Idempotency-Key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(200, {
      success: true,
      message_id: 'wamid.TEXT',
      message_type: 'text',
      accepted_at: 'now',
      upstream: {},
    }));
    const sdk = new SanadWhatsApp({ apiKey: 'k', fetch: fetchImpl as unknown as typeof fetch });
    const promise = sdk.messages.reply({
      phoneNumberId: 'PNID',
      toPhone: '+966500000000',
      text: 'How can we help?',
      previewUrl: false,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://api.sanadwa.com/api/public/v1/messages/text',
    );
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      phone_number_id: 'PNID',
      to_phone: '+966500000000',
      text: 'How can we help?',
      preview_url: false,
    });
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(UUID_RE);
    expect(result.messageType).toBe('text');
  });
});

describe('SanadWhatsApp.messages.get', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('404 → NotFoundError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(404, { code: 'message_not_found', message: 'no' }));
    const sdk = new SanadWhatsApp({ apiKey: 'k', fetch: fetchImpl as unknown as typeof fetch });
    const p = sdk.messages.get('msg_x').catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await p;
    expect(err).toBeInstanceOf(NotFoundError);
    expect(isSanadApiError(err)).toBe(true);
  });
});

describe('SanadWhatsApp.webhooks.verify', () => {
  it('does not invoke fetch', () => {
    const fetchImpl = vi.fn();
    const sdk = new SanadWhatsApp({ apiKey: 'k', fetch: fetchImpl as unknown as typeof fetch });
    const result = sdk.webhooks.verify({ rawBody: '', signature: '', secret: 's' });
    expect(result.valid).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Custom retries config', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('retries=2 stops after 2 attempts on 500', async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(mkResponse(500, { code: 'server_error' })));
    const sdk = new SanadWhatsApp({ apiKey: 'k', retries: 2, fetch: fetchImpl as unknown as typeof fetch });
    const p = sdk.health().catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await p;
    expect(err).toBeInstanceOf(ServerError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('Re-exports', () => {
  it('errors and type guard re-exported', () => {
    expect(SanadApiError).toBeDefined();
    expect(RateLimitedError).toBeDefined();
    expect(NotFoundError).toBeDefined();
    expect(ServerError).toBeDefined();
    expect(typeof isSanadApiError).toBe('function');
  });
});
