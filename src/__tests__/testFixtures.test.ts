/**
 * Phase 60 OPS-V2-04 — webhook fixtures unit tests.
 *
 * Each fixture must round-trip through verifyWebhook to {valid:true, event}
 * matching the declared expectedEvent. Mutation tests confirm that tampering
 * with the body or signature flips verification to {valid:false, ...}.
 */

import { describe, expect, it } from 'vitest';

import { __testFixtures, verifyWebhook } from '../index.js';

const fixtures = [
  {
    name: 'message.delivered',
    build: () => __testFixtures.createMessageDeliveredFixture(),
  },
  {
    name: 'message.read',
    build: () => __testFixtures.createMessageReadFixture(),
  },
  {
    name: 'inbound.message',
    build: () => __testFixtures.createInboundMessageFixture(),
  },
] as const;

describe('__testFixtures', () => {
  for (const fx of fixtures) {
    describe(fx.name, () => {
      it('round-trips through verifyWebhook to {valid:true}', () => {
        const f = fx.build();
        const result = verifyWebhook({
          rawBody: f.rawBody,
          signature: f.signature,
          secret: f.secret,
        });
        expect(result).toEqual({ valid: true, event: f.expectedEvent });
      });

      it('mutating rawBody flips to invalid', () => {
        const f = fx.build();
        const tampered = f.rawBody.replace(/}$/, ',"x":1}');
        const result = verifyWebhook({
          rawBody: tampered,
          signature: f.signature,
          secret: f.secret,
        });
        expect(result.valid).toBe(false);
      });

      it('mutating signature flips to invalid', () => {
        const f = fx.build();
        const bad = f.signature.slice(0, -1) + (f.signature.endsWith('a') ? 'b' : 'a');
        const result = verifyWebhook({
          rawBody: f.rawBody,
          signature: bad,
          secret: f.secret,
        });
        expect(result.valid).toBe(false);
      });

      it('wrong secret flips to invalid', () => {
        const f = fx.build();
        const result = verifyWebhook({
          rawBody: f.rawBody,
          signature: f.signature,
          secret: 'whsec_different',
        });
        expect(result.valid).toBe(false);
      });

      it('signature header includes the sha256= prefix', () => {
        const f = fx.build();
        expect(f.signature.startsWith('sha256=')).toBe(true);
      });
    });
  }

  it('createMessageDeliveredFixture honors overrides', () => {
    const f = __testFixtures.createMessageDeliveredFixture({
      messageId: 'wamid.OVERRIDE',
      deliveredAt: '2030-01-01T00:00:00.000Z',
    });
    expect(f.expectedEvent).toEqual({
      type: 'message.delivered',
      data: {
        messageId: 'wamid.OVERRIDE',
        deliveredAt: '2030-01-01T00:00:00.000Z',
        raw: {
          message_id: 'wamid.OVERRIDE',
          provider_msg_id: 'wamid.HBgMOTY2NTAwMDAwMDAw_DELIVERED',
          to_phone: '+966500000000',
          delivered_at: '2030-01-01T00:00:00.000Z',
        },
      },
    });
  });

  it('createMessageSentFixture round-trips to {valid:true}', () => {
    const f = __testFixtures.createMessageSentFixture();
    const result = verifyWebhook({ rawBody: f.rawBody, signature: f.signature, secret: f.secret });
    expect(result).toEqual({ valid: true, event: f.expectedEvent });
  });

  it('createMessageFailedFixture round-trips with structured error', () => {
    const f = __testFixtures.createMessageFailedFixture();
    const result = verifyWebhook({ rawBody: f.rawBody, signature: f.signature, secret: f.secret });
    expect(result).toEqual({ valid: true, event: f.expectedEvent });
    if (result.valid && result.event.type === 'message.failed') {
      expect(result.event.data.error.code).toBe(131049);
    }
  });

  it('createInboundMessageFixture honors overrides', () => {
    const f = __testFixtures.createInboundMessageFixture({
      fromPhone: '+15551112222',
      text: 'custom',
      messageType: 'text',
    });
    const r = verifyWebhook({
      rawBody: f.rawBody,
      signature: f.signature,
      secret: f.secret,
    });
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.event.type).toBe('inbound.message');
  });

  it('honors a custom secret across all three fixtures', () => {
    for (const fx of fixtures) {
      const f = fx.build();
      const customSecret = 'whsec_custom_for_test';
      // Re-build with custom secret via the override pathway.
      let custom;
      if (fx.name === 'message.delivered')
        custom = __testFixtures.createMessageDeliveredFixture({ secret: customSecret });
      else if (fx.name === 'message.read')
        custom = __testFixtures.createMessageReadFixture({ secret: customSecret });
      else custom = __testFixtures.createInboundMessageFixture({ secret: customSecret });
      expect(custom.secret).toBe(customSecret);
      // Default-secret fixture must NOT verify with the custom secret.
      const cross = verifyWebhook({
        rawBody: f.rawBody,
        signature: f.signature,
        secret: customSecret,
      });
      expect(cross.valid).toBe(false);
    }
  });
});
