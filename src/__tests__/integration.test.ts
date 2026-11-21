/**
 * Integration tests: the real client with a fake `fetch`, proving that the
 * resources are wired to one requester and behave end to end.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as entry from '../index.js';
import {
  SanadWhatsApp,
  PhoneNumbersResource,
  BalanceResource,
  TagsResource,
  ContactsResource,
  CampaignsResource,
  RateLimitedError,
  SendFailedError,
  ServerError,
  __testFixtures,
  verifyWebhook,
} from '../index.js';
import type { ListTemplatesResponse, Page, Tag, Template } from '../index.js';

const BASE = 'https://api.example.test/v1';

const mkResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...headers },
});

const mkSdk = (fetchImpl: unknown, retries = 3): SanadWhatsApp => new SanadWhatsApp({
  apiKey: 'pk_test_fake_key',
  baseUrl: BASE,
  retries,
  fetch: fetchImpl as typeof fetch,
});

const headersOf = (call: unknown[]): Record<string, string> =>
  (call[1] as { headers: Record<string, string> }).headers;

describe('client wiring', () => {
  it('exposes each new resource as an instance of its class', () => {
    const sdk = mkSdk(vi.fn());
    expect(sdk.phoneNumbers).toBeInstanceOf(PhoneNumbersResource);
    expect(sdk.balance).toBeInstanceOf(BalanceResource);
    expect(sdk.tags).toBeInstanceOf(TagsResource);
    expect(sdk.contacts).toBeInstanceOf(ContactsResource);
    expect(sdk.campaigns).toBeInstanceOf(CampaignsResource);
  });

  it('exports the runtime surface from the package entry', () => {
    expect(Object.keys(entry).sort()).toEqual([
      'AuthError',
      'BalanceResource',
      'CampaignsResource',
      'ContactsResource',
      'NotFoundError',
      'PhoneNumbersResource',
      'RateLimitedError',
      'SanadApiError',
      'SanadWhatsApp',
      'SendFailedError',
      'ServerError',
      'TagsResource',
      'ValidationError',
      '__testFixtures',
      'isSanadApiError',
      'verifyWebhook',
    ]);
  });

  it('templates use the same page shape as the new paged resources', () => {
    const templates: ListTemplatesResponse = { page: 1, limit: 50, data: [] };
    const page: Page<Template> = templates;
    const tags: Page<Tag> = { page: 1, limit: 50, data: [] };
    expect(Object.keys(page)).toEqual(Object.keys(tags));
  });
});

describe('new resources through the real client', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('every resource reaches its endpoint with the client key and base URL', async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(mkResponse(200, { success: true, page: 1, limit: 50, data: [] })));
    const sdk = mkSdk(fetchImpl);

    await sdk.phoneNumbers.list();
    await sdk.tags.list();
    await sdk.contacts.list();
    await sdk.campaigns.list();
    await sdk.balance.get();

    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      `${BASE}/phone-numbers`,
      `${BASE}/tags`,
      `${BASE}/contacts`,
      `${BASE}/campaigns`,
      `${BASE}/balance`,
    ]);
    for (const call of fetchImpl.mock.calls) {
      expect(headersOf(call).Authorization).toBe('Bearer pk_test_fake_key');
      expect(headersOf(call)['Idempotency-Key']).toBeUndefined();
    }
  });

  it('tags.create is retried after a 429 with the same Idempotency-Key', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(mkResponse(
        429,
        { success: false, code: 'rate_limited', message: 'Too many requests.' },
        { 'Retry-After': '2', 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '0' },
      ))
      .mockResolvedValueOnce(mkResponse(201, {
        success: true,
        data: { id: 42, name: 'vip', description: null, created_at: '2026-11-21T10:00:00.000Z' },
      }));
    const sdk = mkSdk(fetchImpl);

    const pending = sdk.tags.create({ name: 'vip' });
    await vi.runAllTimersAsync();
    const tag = await pending;

    expect(tag).toEqual({ id: '42', name: 'vip', description: null, createdAt: '2026-11-21T10:00:00.000Z' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const first = headersOf(fetchImpl.mock.calls[0]!)['Idempotency-Key'];
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(headersOf(fetchImpl.mock.calls[1]!)['Idempotency-Key']).toBe(first);
    const init = fetchImpl.mock.calls[0]![1] as { method: string; body: string };
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'vip' });
  });

  it('a 429 that never clears ends as RateLimitedError with the rate-limit headers', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(mkResponse(
      429,
      { success: false, code: 'rate_limited', message: 'Too many requests.' },
      { 'Retry-After': '1', 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '0' },
    )));
    const sdk = mkSdk(fetchImpl, 2);

    const pending = sdk.tags.delete('42').catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = await pending;

    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err).toMatchObject({ limit: 60, remaining: 0, retryAfterSec: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('send_failed end to end', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it.each([500, 503, 429, 409])('status %i is thrown after one call, with no retry', async (status) => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(mkResponse(
      status,
      {
        success: false,
        code: 'send_failed',
        message: 'WhatsApp did not accept the message.',
        upstream_code: '131000',
        meta_error: { title: 'Something went wrong', code: 131000, fbtrace_id: 'FAKE_TRACE' },
      },
      { 'Retry-After': '1' },
    )));
    const sdk = mkSdk(fetchImpl, 5);

    const pending = sdk.messages.sendText({
      phoneNumberId: '100000000000001',
      toPhone: '+966500000000',
      text: 'Hello',
    }).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = await pending;

    expect(err).toBeInstanceOf(SendFailedError);
    expect(err).not.toBeInstanceOf(ServerError);
    expect(err).not.toBeInstanceOf(RateLimitedError);
    expect(err).toMatchObject({ code: 'send_failed', status, upstreamStatus: status, upstreamCode: '131000' });
    expect((err as SendFailedError).metaError).toEqual({ title: 'Something went wrong', code: 131000, fbtrace_id: 'FAKE_TRACE' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('unknown signed webhook event end to end', () => {
  it('verifies through the client and the standalone function', () => {
    const fetchImpl = vi.fn();
    const sdk = mkSdk(fetchImpl);
    const fixture = __testFixtures.createUnknownEventFixture();

    for (const verify of [sdk.webhooks.verify, verifyWebhook]) {
      const result = verify({
        rawBody: fixture.rawBody,
        signature: fixture.signature,
        secret: fixture.secret,
      });
      expect(result.valid).toBe(true);
      if (!result.valid) throw new Error('expected a valid result');
      expect(result.signatureValid).toBe(true);
      expect(result.recognized).toBe(false);
      expect(result.eventType).toBe('campaign.completed');
      expect(result.event).toEqual({
        type: 'unknown',
        data: { raw: { campaign_id: '42', completed_at: '2026-11-21T10:00:00.000Z' } },
      });
      expect(result.envelope).toMatchObject({ event: 'campaign.completed' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('the same delivery with a wrong secret is invalid', () => {
    const fixture = __testFixtures.createUnknownEventFixture();
    const result = verifyWebhook({
      rawBody: fixture.rawBody,
      signature: fixture.signature,
      secret: 'whsec_another_fake_secret',
    });
    expect(result).toMatchObject({ valid: false, recognized: false, reason: 'signature_mismatch' });
  });
});
