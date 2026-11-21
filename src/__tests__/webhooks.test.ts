import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyWebhook } from '../resources/webhooks.js';

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
      to_phone: '+966500000000',
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
        expect(result.event.data.toPhone).toBe('+966500000000');
        expect(result.event.data.messageType).toBe('template');
        expect(result.event.data.templateLanguage).toBe('en');
      }
    }
  });

  it('valid text message.sent → narrowed free-form reply event', () => {
    const body = env('message.sent', {
      message_id: 'wamid.TEXT',
      message_type: 'text',
      to_phone: '+966500000000',
      text: 'How can we help?',
      template_name: null,
      template_language: null,
      sent_at: '2026-07-21T12:00:00Z',
    });
    const result = verifyWebhook({ rawBody: body, signature: sign(SECRET, body), secret: SECRET });

    expect(result.valid).toBe(true);
    if (result.valid && result.event.type === 'message.sent') {
      expect(result.event.data).toMatchObject({
        messageId: 'wamid.TEXT',
        messageType: 'text',
        toPhone: '+966500000000',
        text: 'How can we help?',
        templateName: null,
        templateLanguage: null,
      });
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
      // A legacy three-key error gives the three newer fields as null.
      expect(result.event.data.error).toEqual({
        code: 131049,
        title: 'Failed',
        message: 'spam-blocked',
        errorData: null,
        details: null,
        errorUserMsg: null,
      });
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

  it('same character count but more bytes (non-ASCII) → signature_length_mismatch, not verification_error', () => {
    const body = env('message.delivered', { message_id: 'm', delivered_at: 'now' });
    const result = verifyWebhook({ rawBody: body, signature: `sha256=${'é'.repeat(64)}`, secret: SECRET });
    expect(result).toMatchObject({ valid: false, reason: 'signature_length_mismatch' });
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

const verify = (body: string, secret: string = SECRET) =>
  verifyWebhook({ rawBody: body, signature: sign(secret, body), secret });

describe('verifyWebhook — result shape', () => {
  it('a valid result carries signatureValid, recognized, eventType and envelope', () => {
    const data = { message_id: 'm', delivered_at: 'now' };
    const body = env('message.delivered', data);
    const result = verify(body);
    expect(result).toMatchObject({
      valid: true,
      signatureValid: true,
      recognized: true,
      eventType: 'message.delivered',
      envelope: { event: 'message.delivered', tenant_id: 1, data },
    });
  });

  it('an invalid result carries signatureValid false and recognized false', () => {
    const body = env('message.delivered', { message_id: 'm', delivered_at: 'now' });
    const result = verifyWebhook({ rawBody: body, signature: sign('wrong', body), secret: SECRET });
    expect(result).toEqual({
      valid: false,
      signatureValid: false,
      recognized: false,
      reason: 'signature_mismatch',
    });
  });

  it('eventType reports the legacy event_type name', () => {
    const body = JSON.stringify({ event_type: 'message.read', payload: { message_id: 1, read_at: 'now' } });
    const result = verify(body);
    expect(result).toMatchObject({ valid: true, recognized: true, eventType: 'message.read' });
  });
});

describe('verifyWebhook — signed deliveries the SDK cannot type', () => {
  it('unknown event name → valid, not recognized, event unknown with raw data', () => {
    const data = { campaign_id: '42' };
    const body = env('campaign.completed', data);
    const result = verify(body);
    expect(result).toEqual({
      valid: true,
      signatureValid: true,
      recognized: false,
      eventType: 'campaign.completed',
      envelope: { event: 'campaign.completed', tenant_id: 1, data },
      event: { type: 'unknown', data: { raw: data } },
    });
  });

  it('legacy envelope with an unknown event name is never unknown_event_type', () => {
    const body = JSON.stringify({ event_type: 'something.weird', payload: {} });
    const result = verify(body);
    expect(result).toMatchObject({
      valid: true,
      recognized: false,
      eventType: 'something.weird',
      event: { type: 'unknown', data: { raw: {} } },
    });
  });

  it.each([
    ['message.sent without sent_at', 'message.sent', { message_id: 'm', to_phone: '+966500000000', template_name: 't', template_language: 'en' }],
    ['message.sent template without template_language', 'message.sent', { message_id: 'm', to_phone: '+966500000000', template_name: 't', sent_at: 'now' }],
    ['message.sent with an undeclared message type', 'message.sent', { message_id: 'm', message_type: 'image', to_phone: '+966500000000', sent_at: 'now' }],
    ['message.delivered without message_id', 'message.delivered', { delivered_at: 'now' }],
    ['message.read without read_at', 'message.read', { message_id: 5 }],
    ['message.failed without failed_at', 'message.failed', { message_id: 5, error: null }],
    ['inbound.message without type', 'inbound.message', { from: '+966500000000' }],
  ])('%s → valid, not recognized, raw kept', (_name, eventType, data) => {
    const body = env(eventType, data);
    const result = verify(body);
    expect(result).toMatchObject({
      valid: true,
      signatureValid: true,
      recognized: false,
      eventType,
      event: { type: 'unknown', data: { raw: data } },
    });
  });

  it('signed non-JSON body → valid, envelope null, event unknown', () => {
    const result = verify('not json at all');
    expect(result).toEqual({
      valid: true,
      signatureValid: true,
      recognized: false,
      eventType: null,
      envelope: null,
      event: { type: 'unknown', data: { raw: {} } },
    });
  });

  it.each([
    ['a JSON array', '[1,2,3]', [1, 2, 3], null],
    ['a JSON string', '"hello"', 'hello', null],
    ['JSON null', 'null', null, null],
    ['an object without an event name', '{"data":{"a":1}}', { data: { a: 1 } }, null],
    ['an empty event name', '{"event":"","data":{"a":1}}', { event: '', data: { a: 1 } }, null],
    ['a numeric event name', '{"event":7,"data":{"a":1}}', { event: 7, data: { a: 1 } }, null],
  ])('%s → valid, not recognized', (_name, body, envelope, eventType) => {
    const result = verify(body);
    expect(result).toMatchObject({ valid: true, recognized: false, eventType, envelope });
    if (result.valid) expect(result.event.type).toBe('unknown');
  });

  it('keeps the data object as raw when only the event name is unusable', () => {
    const result = verify('{"data":{"a":1}}');
    expect(result.valid && result.event).toEqual({ type: 'unknown', data: { raw: { a: 1 } } });
  });

  it.each([
    ['missing', '{"event":"message.read"}'],
    ['an array', '{"event":"message.read","data":[1]}'],
    ['a string', '{"event":"message.read","data":"x"}'],
    ['null', '{"event":"message.read","data":null}'],
  ])('data %s → unknown with empty raw, eventType kept', (_name, body) => {
    const result = verify(body);
    expect(result).toMatchObject({
      valid: true,
      recognized: false,
      eventType: 'message.read',
      event: { type: 'unknown', data: { raw: {} } },
    });
  });
});

describe('verifyWebhook — test event', () => {
  it('data.test === true is a test event whatever the event name', () => {
    const data = { test: true, from: '+966500000000', message: { type: 'text', text: { body: 'SanadWA test event.' } } };
    for (const name of ['inbound.message', 'message.delivered', 'campaign.completed']) {
      const result = verify(env(name, data));
      expect(result).toMatchObject({
        valid: true,
        recognized: true,
        eventType: name,
        event: { type: 'test', data: { test: true, from: '+966500000000', text: 'SanadWA test event.', raw: data } },
      });
    }
  });

  it('from and text are null when absent or not strings', () => {
    const result = verify(env('inbound.message', { test: true, from: 5, message: { text: {} } }));
    expect(result.valid && result.event).toMatchObject({ type: 'test', data: { test: true, from: null, text: null } });
    const bare = verify(env('inbound.message', { test: true }));
    expect(bare.valid && bare.event).toMatchObject({ type: 'test', data: { from: null, text: null } });
  });

  it('a truthy but non-boolean test flag is not a test event', () => {
    const result = verify(env('inbound.message', { test: 'true', from: '+966500000000', type: 'text' }));
    expect(result.valid && result.event.type).toBe('inbound.message');
  });
});

describe('verifyWebhook — status events expose providerMsgId and toPhone', () => {
  it.each([
    ['message.delivered', 'delivered_at'],
    ['message.read', 'read_at'],
    ['message.failed', 'failed_at'],
  ])('%s maps provider_msg_id and to_phone', (eventType, tsKey) => {
    const result = verify(env(eventType, {
      message_id: 4242,
      provider_msg_id: 'wamid.FAKE_STATUS_0001',
      to_phone: '+966500000000',
      [tsKey]: 'now',
    }));
    expect(result.valid && result.event).toMatchObject({
      type: eventType,
      data: { messageId: '4242', providerMsgId: 'wamid.FAKE_STATUS_0001', toPhone: '+966500000000' },
    });
  });

  it.each([
    ['message.delivered', 'delivered_at'],
    ['message.read', 'read_at'],
    ['message.failed', 'failed_at'],
  ])('%s gives null when the keys are absent, null or empty', (eventType, tsKey) => {
    const absent = verify(env(eventType, { message_id: 1, [tsKey]: 'now' }));
    expect(absent.valid && absent.event).toMatchObject({ type: eventType, data: { providerMsgId: null, toPhone: null } });
    const empty = verify(env(eventType, { message_id: 1, provider_msg_id: null, to_phone: '', [tsKey]: 'now' }));
    expect(empty.valid && empty.event).toMatchObject({ type: eventType, data: { providerMsgId: null, toPhone: null } });
  });
});

describe('verifyWebhook — failed-event error', () => {
  const failed = (error: unknown) => {
    const result = verify(env('message.failed', { message_id: 7, failed_at: 'now', error }));
    if (!result.valid || result.event.type !== 'message.failed') throw new Error('expected message.failed');
    return result.event.data.error;
  };
  const allNull = { code: null, title: null, message: null, errorData: null, details: null, errorUserMsg: null };

  it('maps all six keys', () => {
    expect(failed({
      code: 131026,
      title: 'Message undeliverable',
      message: 'Message undeliverable',
      error_data: { details: 'Receiver is incapable of receiving this message', error_user_msg: 'Ask the customer to update the app.' },
      details: 'Receiver is incapable of receiving this message',
      error_user_msg: 'Ask the customer to update the app.',
    })).toEqual({
      code: 131026,
      title: 'Message undeliverable',
      message: 'Message undeliverable',
      errorData: { details: 'Receiver is incapable of receiving this message', error_user_msg: 'Ask the customer to update the app.' },
      details: 'Receiver is incapable of receiving this message',
      errorUserMsg: 'Ask the customer to update the app.',
    });
  });

  it('mistyped values become null', () => {
    expect(failed({ code: '131026', title: '', message: 5, error_data: ['x'], details: {}, error_user_msg: '' })).toEqual(allNull);
  });

  it('a bare-string error still maps to message', () => {
    expect(failed('legacy failure text')).toEqual({ ...allNull, message: 'legacy failure text' });
  });

  it('a missing or null error gives six nulls', () => {
    expect(failed(undefined)).toEqual(allNull);
    expect(failed(null)).toEqual(allNull);
  });
});

describe('verifyWebhook — message.sent messageId', () => {
  const sent = (messageId: unknown) => {
    const data: Record<string, unknown> = {
      to_phone: '+966500000000', template_name: 't', template_language: 'en', sent_at: 'now',
    };
    if (messageId !== undefined) data.message_id = messageId;
    const result = verify(env('message.sent', data));
    if (!result.valid || result.event.type !== 'message.sent') throw new Error('expected message.sent');
    expect(result.recognized).toBe(true);
    return result.event.data.messageId;
  };

  it('null or absent message_id gives messageId null', () => {
    expect(sent(null)).toBeNull();
    expect(sent(undefined)).toBeNull();
  });

  it('string and numeric ids still work', () => {
    expect(sent('wamid.FAKE_SENT_0001')).toBe('wamid.FAKE_SENT_0001');
    expect(sent(98765)).toBe('98765');
  });

  it('text variant accepts a null message_id too', () => {
    const result = verify(env('message.sent', {
      message_id: null, message_type: 'text', to_phone: '+966500000000', text: 'hi', sent_at: 'now',
    }));
    expect(result.valid && result.event).toMatchObject({
      type: 'message.sent',
      data: { messageId: null, messageType: 'text', text: 'hi' },
    });
  });
});

// Fixed vectors: HMAC-SHA256 computed once with node:crypto over the exact
// body bytes. They pin the signature algorithm without importing anything
// from outside this repository.
const VECTOR_SECRET = 'whsec_fixed_vector_secret_do_not_use';
const VECTORS = {
  V1: {
    body: '{"event":"inbound.message","tenant_id":1,"data":{"test":true,"from":"+966500000000","message":{"type":"text","text":{"body":"SanadWA test event."}}}}',
    bytes: 149,
    hex: '7a85c34eb3ab5888638f1796670354afcc964a0e6ab22d63e6c9bd3d2e1e3f9a',
  },
  V2: {
    body: '{"event":"campaign.completed","tenant_id":1,"data":{"campaign_id":"42","completed_at":"2026-11-21T10:00:00.000Z"}}',
    bytes: 114,
    hex: '8462f769b32da3ac6237f6b672bd7f9397aa64e19420cfc946a36ce6f7498d0f',
  },
  V3: {
    body: '{"event":"message.failed","tenant_id":1,"data":{"message_id":"4244","provider_msg_id":"wamid.FAKE_FAILED_0001","to_phone":"+966500000000","failed_at":"2026-11-21T10:02:00.000Z","error":{"code":131049,"title":"Message failed to send","message":"This message was not delivered to maintain healthy ecosystem engagement.","error_data":{"details":"In order to maintain a healthy ecosystem engagement, the message failed to be delivered."},"details":"In order to maintain a healthy ecosystem engagement, the message failed to be delivered.","error_user_msg":null}}}',
    bytes: 559,
    hex: '32b4b65bcff32d87fc91bfa96faa160a9aab9d38cd213537eea0f5d4f2dfec7d',
  },
  V4: {
    body: '{"event":"message.sent","tenant_id":1,"data":{"message_id":null,"to_phone":"+966500000000","template_name":"hello_world","template_language":"en","sent_at":"2026-11-21T10:00:00.000Z"}}',
    bytes: 184,
    hex: '40f8ffbd12683d011e4a1d7af31bd92cac05704a51a16d3682388cf021a09973',
  },
} as const;

const verifyVector = (id: keyof typeof VECTORS, hex: string = VECTORS[id].hex) =>
  verifyWebhook({ rawBody: VECTORS[id].body, signature: `sha256=${hex}`, secret: VECTOR_SECRET });

const flipOneDigit = (hex: string): string => (hex.startsWith('0') ? '1' : '0') + hex.slice(1);

describe('verifyWebhook — fixed signature vectors', () => {
  it.each(Object.keys(VECTORS) as Array<keyof typeof VECTORS>)('%s has the documented byte length', (id) => {
    expect(Buffer.byteLength(VECTORS[id].body, 'utf8')).toBe(VECTORS[id].bytes);
  });

  it('V1 test event', () => {
    const result = verifyVector('V1');
    expect(result).toMatchObject({
      valid: true,
      signatureValid: true,
      recognized: true,
      eventType: 'inbound.message',
      event: { type: 'test', data: { test: true, from: '+966500000000', text: 'SanadWA test event.' } },
    });
  });

  it('V2 unknown event', () => {
    const result = verifyVector('V2');
    expect(result).toMatchObject({
      valid: true,
      signatureValid: true,
      recognized: false,
      eventType: 'campaign.completed',
      envelope: JSON.parse(VECTORS.V2.body),
      event: { type: 'unknown', data: { raw: { campaign_id: '42', completed_at: '2026-11-21T10:00:00.000Z' } } },
    });
  });

  it('V3 failed event with the six-key error', () => {
    const result = verifyVector('V3');
    const sentence = 'In order to maintain a healthy ecosystem engagement, the message failed to be delivered.';
    expect(result).toMatchObject({
      valid: true,
      recognized: true,
      eventType: 'message.failed',
      event: {
        type: 'message.failed',
        data: {
          messageId: '4244',
          providerMsgId: 'wamid.FAKE_FAILED_0001',
          toPhone: '+966500000000',
          failedAt: '2026-11-21T10:02:00.000Z',
          error: {
            code: 131049,
            title: 'Message failed to send',
            message: 'This message was not delivered to maintain healthy ecosystem engagement.',
            errorData: { details: sentence },
            details: sentence,
            errorUserMsg: null,
          },
        },
      },
    });
  });

  it('V4 message.sent with a null id', () => {
    const result = verifyVector('V4');
    expect(result).toMatchObject({
      valid: true,
      recognized: true,
      eventType: 'message.sent',
      event: { type: 'message.sent', data: { messageId: null, messageType: 'template', templateName: 'hello_world' } },
    });
  });

  it.each(Object.keys(VECTORS) as Array<keyof typeof VECTORS>)('%s with one hex digit changed → signature_mismatch', (id) => {
    const result = verifyVector(id, flipOneDigit(VECTORS[id].hex));
    expect(result).toEqual({ valid: false, signatureValid: false, recognized: false, reason: 'signature_mismatch' });
  });

  it.each(Object.keys(VECTORS) as Array<keyof typeof VECTORS>)('%s with the wrong secret → signature_mismatch', (id) => {
    const result = verifyWebhook({
      rawBody: VECTORS[id].body,
      signature: `sha256=${VECTORS[id].hex}`,
      secret: 'whsec_some_other_secret',
    });
    expect(result).toMatchObject({ valid: false, reason: 'signature_mismatch' });
  });
});
