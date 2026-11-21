/**
 * Webhook fixture tests.
 *
 * Every fixture must round-trip through `verifyWebhook`: valid, with the
 * fixture's `recognized`, `eventType` and `expectedEvent`. Tampering with the
 * body, the signature or the secret must flip the result to invalid.
 */

import { describe, expect, it } from 'vitest';

import { __testFixtures, verifyWebhook } from '../index.js';
import type { WebhookFixture } from '../index.js';

const fixtures: Array<{ name: string; build: (secret?: string) => WebhookFixture; recognized: boolean; eventType: string }> = [
  {
    name: 'createMessageSentFixture',
    build: (secret) => __testFixtures.createMessageSentFixture(secret ? { secret } : {}),
    recognized: true,
    eventType: 'message.sent',
  },
  {
    name: 'createTextMessageSentFixture',
    build: (secret) => __testFixtures.createTextMessageSentFixture(secret ? { secret } : {}),
    recognized: true,
    eventType: 'message.sent',
  },
  {
    name: 'createMessageDeliveredFixture',
    build: (secret) => __testFixtures.createMessageDeliveredFixture(secret ? { secret } : {}),
    recognized: true,
    eventType: 'message.delivered',
  },
  {
    name: 'createMessageReadFixture',
    build: (secret) => __testFixtures.createMessageReadFixture(secret ? { secret } : {}),
    recognized: true,
    eventType: 'message.read',
  },
  {
    name: 'createMessageFailedFixture',
    build: (secret) => __testFixtures.createMessageFailedFixture(secret ? { secret } : {}),
    recognized: true,
    eventType: 'message.failed',
  },
  {
    name: 'createInboundMessageFixture',
    build: (secret) => __testFixtures.createInboundMessageFixture(secret ? { secret } : {}),
    recognized: true,
    eventType: 'inbound.message',
  },
  {
    name: 'createTestEventFixture',
    build: (secret) => __testFixtures.createTestEventFixture(secret ? { secret } : {}),
    recognized: true,
    eventType: 'inbound.message',
  },
  {
    name: 'createUnknownEventFixture',
    build: (secret) => __testFixtures.createUnknownEventFixture(secret ? { secret } : {}),
    recognized: false,
    eventType: 'campaign.completed',
  },
];

const verifyFixture = (f: WebhookFixture) =>
  verifyWebhook({ rawBody: f.rawBody, signature: f.signature, secret: f.secret });

describe('__testFixtures', () => {
  for (const fx of fixtures) {
    describe(fx.name, () => {
      it('declares recognized and eventType', () => {
        const f = fx.build();
        expect(f.recognized).toBe(fx.recognized);
        expect(f.eventType).toBe(fx.eventType);
      });

      it('round-trips through verifyWebhook', () => {
        const f = fx.build();
        expect(verifyFixture(f)).toEqual({
          valid: true,
          signatureValid: true,
          recognized: f.recognized,
          eventType: f.eventType,
          envelope: JSON.parse(f.rawBody),
          event: f.expectedEvent,
        });
      });

      it('mutating rawBody flips to invalid', () => {
        const f = fx.build();
        const result = verifyWebhook({
          rawBody: f.rawBody.replace(/}$/, ',"x":1}'),
          signature: f.signature,
          secret: f.secret,
        });
        expect(result.valid).toBe(false);
      });

      it('mutating signature flips to invalid', () => {
        const f = fx.build();
        const bad = f.signature.slice(0, -1) + (f.signature.endsWith('a') ? 'b' : 'a');
        const result = verifyWebhook({ rawBody: f.rawBody, signature: bad, secret: f.secret });
        expect(result.valid).toBe(false);
      });

      it('wrong secret flips to invalid', () => {
        const f = fx.build();
        const result = verifyWebhook({ rawBody: f.rawBody, signature: f.signature, secret: 'whsec_different' });
        expect(result.valid).toBe(false);
      });

      it('signature header includes the sha256= prefix', () => {
        expect(fx.build().signature.startsWith('sha256=')).toBe(true);
      });

      it('honors a custom secret', () => {
        const custom = fx.build('whsec_custom_for_test');
        expect(custom.secret).toBe('whsec_custom_for_test');
        expect(verifyFixture(custom).valid).toBe(true);
        // A default-secret fixture must not verify with the custom secret.
        const f = fx.build();
        expect(verifyWebhook({ rawBody: f.rawBody, signature: f.signature, secret: custom.secret }).valid).toBe(false);
      });
    });
  }

  it('createMessageDeliveredFixture honors overrides', () => {
    const f = __testFixtures.createMessageDeliveredFixture({
      messageId: '9001',
      deliveredAt: '2030-01-01T00:00:00.000Z',
      providerMsgId: 'wamid.FAKE_OVERRIDE_0001',
      toPhone: '+12025550123',
    });
    expect(f.expectedEvent).toEqual({
      type: 'message.delivered',
      data: {
        messageId: '9001',
        providerMsgId: 'wamid.FAKE_OVERRIDE_0001',
        toPhone: '+12025550123',
        deliveredAt: '2030-01-01T00:00:00.000Z',
        raw: {
          message_id: '9001',
          provider_msg_id: 'wamid.FAKE_OVERRIDE_0001',
          to_phone: '+12025550123',
          delivered_at: '2030-01-01T00:00:00.000Z',
        },
      },
    });
    expect(verifyFixture(f)).toMatchObject({ valid: true, event: f.expectedEvent });
  });

  it('delivered and read fixtures expose providerMsgId and toPhone by default', () => {
    const delivered = __testFixtures.createMessageDeliveredFixture().expectedEvent;
    const read = __testFixtures.createMessageReadFixture().expectedEvent;
    expect(delivered).toMatchObject({ data: { providerMsgId: expect.stringMatching(/^wamid\./), toPhone: '+966500000000' } });
    expect(read).toMatchObject({ data: { providerMsgId: expect.stringMatching(/^wamid\./), toPhone: '+966500000000' } });
  });

  it('createMessageReadFixture honors providerMsgId and toPhone overrides', () => {
    const f = __testFixtures.createMessageReadFixture({ providerMsgId: 'wamid.FAKE_READ_0002', toPhone: '+12025550124' });
    expect(f.expectedEvent).toMatchObject({ data: { providerMsgId: 'wamid.FAKE_READ_0002', toPhone: '+12025550124' } });
    expect(verifyFixture(f)).toMatchObject({ valid: true, event: f.expectedEvent });
  });

  it('createMessageFailedFixture carries the six-key error by default', () => {
    const f = __testFixtures.createMessageFailedFixture();
    const sentence = 'In order to maintain a healthy ecosystem engagement, the message failed to be delivered.';
    expect(JSON.parse(f.rawBody).data.error).toEqual({
      code: 131049,
      title: 'Message failed to send',
      message: 'This message was not delivered to maintain healthy ecosystem engagement.',
      error_data: { details: sentence },
      details: sentence,
      error_user_msg: null,
    });
    expect(f.expectedEvent).toMatchObject({
      type: 'message.failed',
      data: {
        messageId: '4244',
        providerMsgId: expect.stringMatching(/^wamid\./),
        toPhone: '+966500000000',
        error: {
          code: 131049,
          title: 'Message failed to send',
          message: 'This message was not delivered to maintain healthy ecosystem engagement.',
          errorData: { details: sentence },
          details: sentence,
          errorUserMsg: null,
        },
      },
    });
  });

  it('createMessageFailedFixture honors the error overrides', () => {
    const f = __testFixtures.createMessageFailedFixture({
      errorCode: 131026,
      errorTitle: 'Message undeliverable',
      errorMessage: 'Message undeliverable',
      errorData: null,
      details: null,
      errorUserMsg: 'Ask the customer to update the app.',
      providerMsgId: 'wamid.FAKE_FAILED_0002',
      toPhone: '+12025550123',
    });
    expect(f.expectedEvent).toMatchObject({
      data: {
        providerMsgId: 'wamid.FAKE_FAILED_0002',
        toPhone: '+12025550123',
        error: {
          code: 131026,
          title: 'Message undeliverable',
          message: 'Message undeliverable',
          errorData: null,
          details: null,
          errorUserMsg: 'Ask the customer to update the app.',
        },
      },
    });
    expect(verifyFixture(f)).toMatchObject({ valid: true, event: f.expectedEvent });
  });

  it('createTestEventFixture mirrors the console test delivery', () => {
    const f = __testFixtures.createTestEventFixture();
    const data = { test: true, from: '+966500000000', message: { type: 'text', text: { body: 'SanadWA test event.' } } };
    expect(JSON.parse(f.rawBody)).toEqual({ event: 'inbound.message', tenant_id: 1, data });
    expect(f.expectedEvent).toEqual({
      type: 'test',
      data: { test: true, from: '+966500000000', text: 'SanadWA test event.', raw: data },
    });
  });

  it('createUnknownEventFixture defaults and overrides', () => {
    const f = __testFixtures.createUnknownEventFixture();
    const data = { campaign_id: '42', completed_at: '2026-11-21T10:00:00.000Z' };
    expect(JSON.parse(f.rawBody)).toEqual({ event: 'campaign.completed', tenant_id: 1, data });
    expect(f.expectedEvent).toEqual({ type: 'unknown', data: { raw: data } });

    const custom = __testFixtures.createUnknownEventFixture({ eventType: 'contact.updated', data: { contact_id: '7' } });
    expect(custom.eventType).toBe('contact.updated');
    expect(custom.recognized).toBe(false);
    expect(verifyFixture(custom)).toMatchObject({
      valid: true,
      recognized: false,
      eventType: 'contact.updated',
      event: { type: 'unknown', data: { raw: { contact_id: '7' } } },
    });
  });

  it('createInboundMessageFixture honors overrides', () => {
    const f = __testFixtures.createInboundMessageFixture({
      fromPhone: '+12025550123',
      text: 'custom',
      messageType: 'text',
    });
    expect(verifyFixture(f)).toMatchObject({
      valid: true,
      recognized: true,
      event: { type: 'inbound.message', data: { from: '+12025550123', text: 'custom' } },
    });
  });

  it('createTextMessageSentFixture is the text variant of message.sent and honors overrides', () => {
    const f = __testFixtures.createTextMessageSentFixture({
      messageId: 'wamid.TEXT_OVERRIDE',
      toPhone: '+12025550123',
      text: 'Thanks, we received your request.',
      sentAt: '2026-11-21T09:00:00.000Z',
    });
    expect(JSON.parse(f.rawBody).data).toEqual({
      message_id: 'wamid.TEXT_OVERRIDE',
      message_type: 'text',
      to_phone: '+12025550123',
      text: 'Thanks, we received your request.',
      template_name: null,
      template_language: null,
      sent_at: '2026-11-21T09:00:00.000Z',
    });
    const result = verifyFixture(f);
    expect(result).toMatchObject({
      valid: true,
      recognized: true,
      event: {
        type: 'message.sent',
        data: {
          messageId: 'wamid.TEXT_OVERRIDE',
          messageType: 'text',
          toPhone: '+12025550123',
          templateName: null,
          templateLanguage: null,
          text: 'Thanks, we received your request.',
          sentAt: '2026-11-21T09:00:00.000Z',
        },
      },
    });
  });

  it('status fixtures emit null provider_msg_id and to_phone when overridden with null', () => {
    for (const build of [
      __testFixtures.createMessageDeliveredFixture,
      __testFixtures.createMessageReadFixture,
      __testFixtures.createMessageFailedFixture,
    ]) {
      const f = build({ providerMsgId: null, toPhone: null });
      expect(JSON.parse(f.rawBody).data).toMatchObject({ provider_msg_id: null, to_phone: null });
      expect(verifyFixture(f)).toMatchObject({
        valid: true,
        event: { data: { providerMsgId: null, toPhone: null } },
      });
    }
  });
});
