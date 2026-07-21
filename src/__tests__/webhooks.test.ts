import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyWebhook } from '../resources/webhooks.js';
// Cross-validation against the canonical reference impl in SanadWA-API.
import { verifyHmac } from '../../../SanadWA/API/scripts/lib/webhook-verify.mjs';

const SECRET = 'whsec_test_xxx';

const sign = (secret: string, body: string): string =>
  'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

// Live wire envelope: { event, tenant_id, data }.
const env = (event: string, data: Record<string, unknown>): string =>
  JSON.stringify({ event, tenant_id: 1, data });

describe('verifyWebhook — happy path', () => {
  it('valid signature for message.sent → narrowed event', () => {
    const body = env('message.sent', {
      message_id: 'msg_1',
      to_phone: '+962790000000',
      template_name: 'hello',
      template_language: 'en',
      sent_at: '2026-05-10T00:00:00Z',
    });
    const result = verifyWebhook({ rawBody: body, signature: sign(SECRET, body), secret: SECRET });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.event.type).toBe('message.sent');
      if (result.event.type === 'message.sent') {
        expect(result.event.data.messageId).toBe('msg_1');
        expect(result.event.data.toPhone).toBe('+962790000000');
        expect(result.event.data.templateLanguage).toBe('en');
      }
    }
  });

  it('Buffer (Uint8Array) rawBody also verifies', () => {
    const body = env('message.delivered', { message_id: 'm', delivered_at: 'now' });
    const buf = Buffer.from(body, 'utf8');
    const result = verifyWebhook({ rawBody: new Uint8Array(buf), signature: sign(SECRET, body), secret: SECRET });
    expect(result.valid).toBe(true);
  });

  it.each([
    ['message.sent', { message_id: 'm', to_phone: '+1', template_name: 't', template_language: 'en', sent_at: 'now' }, 'message.sent'],
    ['message.delivered', { message_id: 99, provider_msg_id: 'wamid.x', delivered_at: 'now' }, 'message.delivered'],
    ['message.read', { message_id: 99, read_at: 'now' }, 'message.read'],
    ['message.failed', { message_id: 99, failed_at: 'now', error: { code: 131049, title: 'failed', message: 'oops' } }, 'message.failed'],
    ['inbound.message', { message_id: 'wamid.in', from: '+1', text: 'hi', type: 'text', timestamp: 'now' }, 'inbound.message'],
  ] as const)('narrows %s correctly', (eventType, data, expectedType) => {
    const body = env(eventType, data as Record<string, unknown>);
    const result = verifyWebhook({ rawBody: body, signature: sign(SECRET, body), secret: SECRET });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.event.type).toBe(expectedType);
  });

  it('message.delivered with numeric message_id coerces to string id', () => {
    const body = env('message.delivered', { message_id: 4242, delivered_at: 'now' });
    const result = verifyWebhook({ rawBody: body, signature: sign(SECRET, body), secret: SECRET });
    expect(result.valid).toBe(true);
    if (result.valid && result.event.type === 'message.delivered') {
      expect(result.event.data.messageId).toBe('4242');
    }
  });

  it('message.failed exposes the structured error object', () => {
    const body = env('message.failed', {
      message_id: 7,
      failed_at: 'now',
      error: { code: 131049, title: 'Failed', message: 'spam-blocked' },
    });
    const result = verifyWebhook({ rawBody: body, signature: sign(SECRET, body), secret: SECRET });
    expect(result.valid).toBe(true);
    if (result.valid && result.event.type === 'message.failed') {
      expect(result.event.data.error).toEqual({ code: 131049, title: 'Failed', message: 'spam-blocked' });
    }
  });

  it('inbound.message uses live `from` field and exposes raw payload', () => {
    const body = env('inbound.message', {
      message_id: 'wamid.in',
      from: '+966500000000',
      type: 'text',
      text: 'hi',
      timestamp: '2026-05-10T00:00:00Z',
    });
    const result = verifyWebhook({ rawBody: body, signature: sign(SECRET, body), secret: SECRET });
    expect(result.valid).toBe(true);
    if (result.valid && result.event.type === 'inbound.message') {
      expect(result.event.data.from).toBe('+966500000000');
      expect(result.event.data.raw.from).toBe('+966500000000');
    }
  });

  it('inbound.message without text omits text field but stays valid', () => {
    const body = env('inbound.message', { from: '+1', type: 'image' });
    const result = verifyWebhook({ rawBody: body, signature: sign(SECRET, body), secret: SECRET });
    expect(result.valid).toBe(true);
    if (result.valid && result.event.type === 'inbound.message') {
      expect(result.event.data.text).toBeUndefined();
      expect(result.event.data.messageType).toBe('image');
    }
  });

  it('legacy { event_type, payload } envelope still narrows (backward-compat)', () => {
    const body = JSON.stringify({
      event_type: 'message.delivered',
      payload: { message_id: 'm', delivered_at: 'now' },
    });
    const result = verifyWebhook({ rawBody: body, signature: sign(SECRET, body), secret: SECRET });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.event.type).toBe('message.delivered');
  });
});

describe('verifyWebhook — failure modes', () => {
  it('tampered body → signature_mismatch', () => {
    const body = env('message.sent', {
      message_id: 'm', to_phone: '+1', template_name: 't', template_language: 'en', sent_at: 'now',
    });
    const sig = sign(SECRET, body);
    const tampered = body.replace('"+1"', '"+9999"');
    const result = verifyWebhook({ rawBody: tampered, signature: sig, secret: SECRET });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('signature_mismatch');
  });

  it('wrong secret → signature_mismatch', () => {
    const body = env('message.delivered', { message_id: 'm', delivered_at: 'now' });
    const result = verifyWebhook({ rawBody: body, signature: sign('wrong', body), secret: SECRET });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('signature_mismatch');
  });

  it('missing sha256= prefix → malformed_signature', () => {
    const body = env('message.delivered', { message_id: 'm', delivered_at: 'now' });
    const sig = sign(SECRET, body).replace('sha256=', '');
    const result = verifyWebhook({ rawBody: body, signature: sig, secret: SECRET });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('malformed_signature');
  });

  it('empty after sha256= → empty_signature', () => {
    const body = env('message.delivered', { message_id: 'm', delivered_at: 'now' });
    const result = verifyWebhook({ rawBody: body, signature: 'sha256=', secret: SECRET });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('empty_signature');
  });

  it('wrong-length signature → signature_length_mismatch', () => {
    const body = env('message.delivered', { message_id: 'm', delivered_at: 'now' });
    const result = verifyWebhook({ rawBody: body, signature: 'sha256=abcdef', secret: SECRET });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('signature_length_mismatch');
  });

  it('empty secret → invalid_secret', () => {
    const result = verifyWebhook({ rawBody: 'x', signature: 'sha256=abc', secret: '' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('invalid_secret');
  });

  it('null rawBody → missing_body', () => {
    const result = verifyWebhook({ rawBody: null as unknown as string, signature: 'sha256=abc', secret: SECRET });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('missing_body');
  });

  it('unknown event_type → unknown_event_type (signature OK but payload unrecognized)', () => {
    const body = JSON.stringify({ event_type: 'something.weird', payload: {} });
    const result = verifyWebhook({ rawBody: body, signature: sign(SECRET, body), secret: SECRET });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('unknown_event_type');
  });

  it('valid signature for non-JSON body → verification_error', () => {
    const body = 'not json at all';
    const result = verifyWebhook({ rawBody: body, signature: sign(SECRET, body), secret: SECRET });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('verification_error');
  });
});

describe('verifyWebhook — never throws', () => {
  it.each([
    [undefined, 'sha256=abc', SECRET],
    ['x' as unknown, 42 as unknown, SECRET],
    [{} as unknown, 'sha256=abc', SECRET],
    ['x' as unknown, 'sha256=abc', undefined],
  ])('garbage input #%# returns {valid:false}', (rawBody, signature, secret) => {
    const result = verifyWebhook({
      rawBody: rawBody as never,
      signature: signature as never,
      secret: secret as never,
    });
    expect(result.valid).toBe(false);
  });

  it('no inputs at all → returns {valid:false}', () => {
    const result = verifyWebhook(undefined as unknown as never);
    expect(result.valid).toBe(false);
  });
});

describe('cross-validation against canonical verifyHmac (T-52-02)', () => {
  const cases = [
    { name: 'valid', mutate: (b: string) => b, secret: SECRET, useSecret: SECRET, expect: true },
    { name: 'tampered', mutate: (b: string) => b.replace('m', 'X'), secret: SECRET, useSecret: SECRET, expect: false },
    { name: 'wrong-secret', mutate: (b: string) => b, secret: SECRET, useSecret: 'other', expect: false },
  ];

  it.each(cases)('SDK and reference agree on $name', ({ mutate, secret, useSecret, expect: ok }) => {
    const body = env('message.delivered', { message_id: 'm', delivered_at: 'now' });
    const sig = sign(secret, body);
    const usedBody = mutate(body);
    const refOk = verifyHmac(useSecret, usedBody, sig);
    const sdkOk = verifyWebhook({ rawBody: usedBody, signature: sig, secret: useSecret }).valid;
    // Reference returns boolean for signature validity only.
    // SDK additionally requires payload narrowing — for valid+tampered cases the boolean part should match.
    if (ok) {
      expect(refOk).toBe(true);
      expect(sdkOk).toBe(true);
    } else {
      expect(refOk).toBe(false);
      expect(sdkOk).toBe(false);
    }
  });
});
