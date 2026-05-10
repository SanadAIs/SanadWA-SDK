/**
 * Phase 60 OPS-V2-04 — wire-format webhook fixtures for adopter unit tests.
 *
 * Each fixture returns `{ rawBody, signature, secret, expectedEvent }` so an
 * adopter can:
 *
 * ```ts
 * import { __testFixtures } from '@sanadais/whatsapp-sdk';
 * import { verifyWebhook } from '@sanadais/whatsapp-sdk';
 *
 * const fx = __testFixtures.createMessageDeliveredFixture();
 * const result = verifyWebhook({
 *   rawBody: fx.rawBody,
 *   signature: fx.signature,
 *   secret: fx.secret,
 * });
 * expect(result).toEqual({ valid: true, event: fx.expectedEvent });
 * ```
 *
 * The wire format mirrors what SANAD emits (snake_case envelope:
 * `event_type` + `payload`). Phase 60 SEC-06: `delivery_id` is intentionally
 * absent from the body — adopters dedupe on the `X-Sanad-Delivery-Id` header.
 *
 * The `__` prefix is the contract: this is a TESTING surface, not the
 * supported runtime API. We export it from the package root so adopters can
 * import without reaching into internal paths, but the name signals "not for
 * production use".
 */

import { createHmac } from 'node:crypto';

import type { WebhookEvent } from './types.js';

export interface WebhookFixture {
  /** Exact JSON bytes the webhook server would receive. Sign over THIS, not
   * over a re-stringified object. Re-serializing risks key-order drift. */
  rawBody: string;
  /** `X-Sanad-Signature` header value (`sha256=<hex>`). */
  signature: string;
  /** The shared secret used to compute the signature. Adopter passes this
   * verbatim to `verifyWebhook`. */
  secret: string;
  /** What `verifyWebhook` should return on success — the narrowed
   * `WebhookEvent` union member. */
  expectedEvent: WebhookEvent;
}

const DEFAULT_SECRET = 'whsec_test_fixture_secret_do_not_use_in_prod';

const sign = (secret: string, body: string): string =>
  'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');

const buildFixture = (
  envelope: { event_type: string; payload: Record<string, unknown> },
  expectedEvent: WebhookEvent,
  secret: string = DEFAULT_SECRET,
): WebhookFixture => {
  const rawBody = JSON.stringify(envelope);
  return {
    rawBody,
    signature: sign(secret, rawBody),
    secret,
    expectedEvent,
  };
};

export const createMessageDeliveredFixture = (
  overrides: { messageId?: string; deliveredAt?: string; secret?: string } = {},
): WebhookFixture => {
  const messageId = overrides.messageId ?? 'wamid.HBgMOTY2NTAwMDAwMDAw_DELIVERED';
  const deliveredAt = overrides.deliveredAt ?? '2026-05-10T12:00:00.000Z';
  return buildFixture(
    {
      event_type: 'message.delivered',
      payload: { message_id: messageId, delivered_at: deliveredAt },
    },
    { type: 'message.delivered', data: { messageId, deliveredAt } },
    overrides.secret,
  );
};

export const createMessageReadFixture = (
  overrides: { messageId?: string; readAt?: string; secret?: string } = {},
): WebhookFixture => {
  const messageId = overrides.messageId ?? 'wamid.HBgMOTY2NTAwMDAwMDAw_READ';
  const readAt = overrides.readAt ?? '2026-05-10T12:01:00.000Z';
  return buildFixture(
    {
      event_type: 'message.read',
      payload: { message_id: messageId, read_at: readAt },
    },
    { type: 'message.read', data: { messageId, readAt } },
    overrides.secret,
  );
};

export const createInboundMessageFixture = (
  overrides: {
    fromPhone?: string;
    text?: string;
    messageType?: string;
    secret?: string;
  } = {},
): WebhookFixture => {
  const fromPhone = overrides.fromPhone ?? '+966500000000';
  const text = overrides.text ?? 'Hello from a test fixture';
  const messageType = overrides.messageType ?? 'text';
  return buildFixture(
    {
      event_type: 'inbound.message',
      payload: { from_phone: fromPhone, text, type: messageType, raw: null },
    },
    {
      type: 'inbound.message',
      data: { fromPhone, text, messageType, raw: null },
    },
    overrides.secret,
  );
};
