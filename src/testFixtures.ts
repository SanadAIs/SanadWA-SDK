/**
 * Phase 60 OPS-V2-04 — wire-format webhook fixtures for adopter unit tests.
 *
 * Each fixture returns `{ rawBody, signature, secret, expectedEvent }` so an
 * adopter can:
 *
 * ```ts
 * import { __testFixtures } from '@sanadwa/whatsapp-sdk';
 * import { verifyWebhook } from '@sanadwa/whatsapp-sdk';
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
 * The wire format mirrors what SANAD emits — the live envelope is
 * `{ event, tenant_id, data }` (snake_case payload under `data`). Phase 60
 * SEC-06: `delivery_id` is intentionally absent from the body — adopters
 * dedupe on the `X-Sanad-Delivery-Id` header.
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
const DEFAULT_TENANT_ID = 1;

const sign = (secret: string, body: string): string =>
  'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');

const buildFixture = (
  envelope: { event: string; tenant_id: number; data: Record<string, unknown> },
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

export const createMessageSentFixture = (
  overrides: {
    messageId?: string;
    toPhone?: string;
    templateName?: string;
    templateLanguage?: string;
    sentAt?: string;
    secret?: string;
  } = {},
): WebhookFixture => {
  const messageId = overrides.messageId ?? 'wamid.HBgMOTY2NTAwMDAwMDAw_SENT';
  const toPhone = overrides.toPhone ?? '+966500000000';
  const templateName = overrides.templateName ?? 'hello_world';
  const templateLanguage = overrides.templateLanguage ?? 'en';
  const sentAt = overrides.sentAt ?? '2026-05-10T12:00:00.000Z';
  const data = {
    message_id: messageId,
    to_phone: toPhone,
    template_name: templateName,
    template_language: templateLanguage,
    sent_at: sentAt,
  };
  return buildFixture(
    { event: 'message.sent', tenant_id: DEFAULT_TENANT_ID, data },
    {
      type: 'message.sent',
      data: {
        messageId,
        messageType: 'template',
        toPhone,
        templateName,
        templateLanguage,
        text: null,
        sentAt,
        raw: data,
      },
    },
    overrides.secret,
  );
};

export const createMessageDeliveredFixture = (
  overrides: { messageId?: string; deliveredAt?: string; secret?: string } = {},
): WebhookFixture => {
  const messageId = overrides.messageId ?? '4242';
  const deliveredAt = overrides.deliveredAt ?? '2026-05-10T12:00:00.000Z';
  const data = {
    message_id: messageId,
    provider_msg_id: 'wamid.HBgMOTY2NTAwMDAwMDAw_DELIVERED',
    to_phone: '+966500000000',
    delivered_at: deliveredAt,
  };
  return buildFixture(
    { event: 'message.delivered', tenant_id: DEFAULT_TENANT_ID, data },
    { type: 'message.delivered', data: { messageId, deliveredAt, raw: data } },
    overrides.secret,
  );
};

export const createMessageReadFixture = (
  overrides: { messageId?: string; readAt?: string; secret?: string } = {},
): WebhookFixture => {
  const messageId = overrides.messageId ?? '4243';
  const readAt = overrides.readAt ?? '2026-05-10T12:01:00.000Z';
  const data = {
    message_id: messageId,
    provider_msg_id: 'wamid.HBgMOTY2NTAwMDAwMDAw_READ',
    to_phone: '+966500000000',
    read_at: readAt,
  };
  return buildFixture(
    { event: 'message.read', tenant_id: DEFAULT_TENANT_ID, data },
    { type: 'message.read', data: { messageId, readAt, raw: data } },
    overrides.secret,
  );
};

export const createMessageFailedFixture = (
  overrides: {
    messageId?: string;
    failedAt?: string;
    errorCode?: number;
    errorTitle?: string;
    errorMessage?: string;
    secret?: string;
  } = {},
): WebhookFixture => {
  const messageId = overrides.messageId ?? '4244';
  const failedAt = overrides.failedAt ?? '2026-05-10T12:02:00.000Z';
  const code = overrides.errorCode ?? 131049;
  const title = overrides.errorTitle ?? 'Message failed to send';
  const message = overrides.errorMessage ?? 'This message was not delivered to maintain healthy ecosystem engagement.';
  const data = {
    message_id: messageId,
    provider_msg_id: 'wamid.HBgMOTY2NTAwMDAwMDAw_FAILED',
    to_phone: '+966500000000',
    failed_at: failedAt,
    error: { code, title, message },
  };
  return buildFixture(
    { event: 'message.failed', tenant_id: DEFAULT_TENANT_ID, data },
    { type: 'message.failed', data: { messageId, failedAt, error: { code, title, message }, raw: data } },
    overrides.secret,
  );
};

export const createInboundMessageFixture = (
  overrides: {
    from?: string;
    /** @deprecated live envelope uses `from`; kept as an alias for ergonomics. */
    fromPhone?: string;
    text?: string;
    messageType?: string;
    messageId?: string;
    timestamp?: string;
    secret?: string;
  } = {},
): WebhookFixture => {
  const from = overrides.from ?? overrides.fromPhone ?? '+966500000000';
  const text = overrides.text ?? 'Hello from a test fixture';
  const messageType = overrides.messageType ?? 'text';
  const messageId = overrides.messageId ?? 'wamid.HBgMOTY2NTAwMDAwMDAw_INBOUND';
  const timestamp = overrides.timestamp ?? '2026-05-10T12:03:00.000Z';
  const data = {
    message_id: messageId,
    from,
    type: messageType,
    timestamp,
    text,
  };
  return buildFixture(
    { event: 'inbound.message', tenant_id: DEFAULT_TENANT_ID, data },
    {
      type: 'inbound.message',
      data: { from, messageType, messageId, text, timestamp, raw: data },
    },
    overrides.secret,
  );
};
