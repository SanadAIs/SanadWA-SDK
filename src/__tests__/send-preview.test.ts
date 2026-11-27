import { describe, it, expect, vi } from 'vitest';
import { previewMessage } from '../resources/messages.js';
import { toSendPreview } from '../resources/send-preview.js';
import { SanadApiError, SanadWhatsApp } from '../index.js';
import type { SendPreview } from '../index.js';
import type { Requester, RequestOptions } from '../request.js';

const fakeRequester = (response: unknown) => {
  const calls: RequestOptions[] = [];
  const fn = vi.fn(async (opts: RequestOptions) => {
    calls.push(opts);
    opts.onHeaders?.(new Headers());
    return response;
  });
  return { req: fn as unknown as Requester, calls, fn };
};

const previewWire = {
  kind: 'template',
  would_send: false,
  refusal: {
    status: 402,
    code: 'PREPAID_CREDIT_CAP_REACHED',
    message: 'Not enough credits. Purchase credits to continue.',
    message_ar: 'الرصيد غير كافٍ. اشحن رصيدك للمتابعة.',
    details: { needed: 1, remaining: 0, shortfall: 1 },
  },
  template: { name: 'order_update', language: 'ar', category: 'UTILITY' },
  recipients: { requested: 1, opted_out: 0, suppressed: 0, invalid_phone: 0, duplicate: 0, allowlist_blocked: 0, eligible: 1 },
  credits: {
    billing_type: 'prepaid', charge_category: 'utility', per_message: 1, estimated: 1,
    from_free_allowance: 0, from_paid_balance: 1, covered_by_subscription: false,
  },
  balance: { available_credits: 0, after_send: -1, unlimited: false },
  as_of: '2026-11-27T10:00:00.000Z',
};

const previewSdk: SendPreview = {
  kind: 'template',
  wouldSend: false,
  refusal: {
    status: 402,
    code: 'PREPAID_CREDIT_CAP_REACHED',
    message: 'Not enough credits. Purchase credits to continue.',
    messageAr: 'الرصيد غير كافٍ. اشحن رصيدك للمتابعة.',
    details: { needed: 1, remaining: 0, shortfall: 1 },
  },
  template: { name: 'order_update', language: 'ar', category: 'UTILITY' },
  recipients: { requested: 1, optedOut: 0, suppressed: 0, invalidPhone: 0, duplicate: 0, allowlistBlocked: 0, eligible: 1 },
  credits: {
    billingType: 'prepaid', chargeCategory: 'utility', perMessage: 1, estimated: 1,
    fromFreeAllowance: 0, fromPaidBalance: 1, coveredBySubscription: false,
  },
  balance: { availableCredits: 0, afterSend: -1, unlimited: false },
  asOf: '2026-11-27T10:00:00.000Z',
};

const input = { phoneNumberId: '100000000000001', toPhone: '+12025550123', templateName: 'order_update', templateLanguage: 'ar' };

describe('messages.preview', () => {
  it('posts the template body to /messages/preview without an idempotency key', async () => {
    const { req, calls } = fakeRequester({ success: true, data: previewWire });
    await previewMessage(req, { ...input, templateParams: ['Sara'] });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/messages/preview',
      body: { phone_number_id: '100000000000001', to_phone: '+12025550123', template_name: 'order_update', template_language: 'ar', template_params: ['Sara'] },
    });
    expect(calls[0]!.idempotent).not.toBe(true);
    expect(calls[0]!.idempotencyKey).toBeUndefined();
    expect(calls[0]!.body).not.toHaveProperty('idempotency_key');
  });

  it('sends the text body for a text input', async () => {
    const { req, calls } = fakeRequester({ success: true, data: { ...previewWire, kind: 'text', template: null } });
    await previewMessage(req, { phoneNumberId: '100000000000001', toPhone: '+12025550123', text: 'Hello', previewUrl: true });
    expect(calls[0]!.body).toEqual({ phone_number_id: '100000000000001', to_phone: '+12025550123', text: 'Hello', preview_url: true });
    expect(calls[0]!.path).toBe('/messages/preview');
  });

  it('never forwards an idempotencyKey a caller passes anyway', async () => {
    const { req, calls } = fakeRequester({ success: true, data: previewWire });
    await previewMessage(req, { ...input, idempotencyKey: 'k-1' } as never);
    expect(calls[0]!.idempotencyKey).toBeUndefined();
    expect(calls[0]!.body).not.toHaveProperty('idempotency_key');
  });

  it('maps the whole preview to camelCase, refusal included, and does not throw on a refusal', async () => {
    const { req } = fakeRequester({ success: true, data: previewWire });
    expect(await previewMessage(req, input)).toEqual(previewSdk);
  });

  it('accepts null recipients/credits/balance/template', async () => {
    const { req } = fakeRequester({
      success: true,
      data: { ...previewWire, kind: 'text', template: null, recipients: null, credits: null, balance: null, refusal: null, would_send: true },
    });
    const result = await previewMessage(req, input);
    expect(result).toMatchObject({ kind: 'text', wouldSend: true, refusal: null, template: null, recipients: null, credits: null, balance: null });
  });

  it('accepts postpaid null balances and a null refusal detail', async () => {
    const wire = {
      ...previewWire,
      refusal: { ...previewWire.refusal, details: null },
      credits: { ...previewWire.credits, billing_type: 'postpaid' },
      balance: { available_credits: null, after_send: null, unlimited: false },
    };
    const { req } = fakeRequester({ success: true, data: wire });
    const result = await previewMessage(req, input);
    expect(result.refusal?.details).toBeNull();
    expect(result.balance).toEqual({ availableCredits: null, afterSend: null, unlimited: false });
    expect(result.credits?.billingType).toBe('postpaid');
  });

  it('refuses a kind outside the enum, an unknown billing type and a missing count, naming the snake_case path', async () => {
    const cases: [unknown, string][] = [
      [{ ...previewWire, kind: 'sms' }, 'data.kind'],
      [{ ...previewWire, credits: { ...previewWire.credits, billing_type: 'weekly' } }, 'data.credits.billing_type'],
      [{ ...previewWire, recipients: { ...previewWire.recipients, opted_out: undefined } }, 'data.recipients.opted_out'],
      [{ ...previewWire, refusal: { ...previewWire.refusal, message_ar: 5 } }, 'data.refusal.message_ar'],
    ];
    for (const [data, field] of cases) {
      const error = await Promise.resolve().then(() => toSendPreview({ success: true, data })).then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(SanadApiError);
      expect(error).toMatchObject({ code: 'malformed_response', status: 0 });
      expect((error as SanadApiError).message).toContain(`\`${field}\``);
    }
  });

  it('client exposes sdk.messages.preview', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, data: previewWire }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const sdk = new SanadWhatsApp({ apiKey: 'pk_test_x', fetch: fetchImpl as unknown as typeof fetch, retries: 0 });
    expect(await sdk.messages.preview(input)).toEqual(previewSdk);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toMatch(/\/messages\/preview$/);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('idempotency-key')).toBeNull();
  });
});
