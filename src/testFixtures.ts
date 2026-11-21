/**
 * Wire-format webhook fixtures for adopter unit tests.
 *
 * Each fixture returns `{ rawBody, signature, secret, expectedEvent,
 * recognized, eventType }` so an adopter can:
 *
 * ```ts
 * import { __testFixtures, verifyWebhook } from '@sanadwa/whatsapp-sdk';
 *
 * const fx = __testFixtures.createMessageDeliveredFixture();
 * const result = verifyWebhook({
 *   rawBody: fx.rawBody,
 *   signature: fx.signature,
 *   secret: fx.secret,
 * });
 * expect(result).toMatchObject({
 *   valid: true,
 *   recognized: fx.recognized,
 *   event: fx.expectedEvent,
 * });
 * ```
 *
 * Fixtures: `createMessageSentFixture`, `createMessageDeliveredFixture`,
 * `createMessageReadFixture`, `createMessageFailedFixture`,
 * `createInboundMessageFixture`, `createTestEventFixture` (the console's
 * "Send test event" delivery) and `createUnknownEventFixture` (a signed
 * event the SDK does not type).
 *
 * The wire format mirrors what SanadWA emits: the envelope is
 * `{ event, tenant_id, data }` (snake_case under `data`). There is no
 * delivery id in the body; dedupe on the `X-Sanad-Delivery-Id` header.
 *
 * The `__` prefix is the contract: this is a TESTING surface, not the
 * supported runtime API. It is exported from the package root so adopters can
 * import it without reaching into internal paths.
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
  /** What `verifyWebhook` should report as `recognized`: false only for an
   * event the SDK returns as `unknown`. */
  recognized: boolean;
  /** The wire event name (`event` in the body), reported by `verifyWebhook`
   * as `eventType`. */
  eventType: string;
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
    recognized: expectedEvent.type !== 'unknown',
    eventType: envelope.event,
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

const DEFAULT_TO_PHONE = '+966500000000';

export const createMessageDeliveredFixture = (
  overrides: {
    messageId?: string;
    deliveredAt?: string;
    providerMsgId?: string | null;
    toPhone?: string | null;
    secret?: string;
  } = {},
): WebhookFixture => {
  const messageId = overrides.messageId ?? '4242';
  const deliveredAt = overrides.deliveredAt ?? '2026-05-10T12:00:00.000Z';
  const providerMsgId = overrides.providerMsgId !== undefined
    ? overrides.providerMsgId
    : 'wamid.HBgMOTY2NTAwMDAwMDAw_DELIVERED';
  const toPhone = overrides.toPhone !== undefined ? overrides.toPhone : DEFAULT_TO_PHONE;
  const data = {
    message_id: messageId,
    provider_msg_id: providerMsgId,
    to_phone: toPhone,
    delivered_at: deliveredAt,
  };
  return buildFixture(
    { event: 'message.delivered', tenant_id: DEFAULT_TENANT_ID, data },
    { type: 'message.delivered', data: { messageId, providerMsgId, toPhone, deliveredAt, raw: data } },
    overrides.secret,
  );
};

export const createMessageReadFixture = (
  overrides: {
    messageId?: string;
    readAt?: string;
    providerMsgId?: string | null;
    toPhone?: string | null;
    secret?: string;
  } = {},
): WebhookFixture => {
  const messageId = overrides.messageId ?? '4243';
  const readAt = overrides.readAt ?? '2026-05-10T12:01:00.000Z';
  const providerMsgId = overrides.providerMsgId !== undefined
    ? overrides.providerMsgId
    : 'wamid.HBgMOTY2NTAwMDAwMDAw_READ';
  const toPhone = overrides.toPhone !== undefined ? overrides.toPhone : DEFAULT_TO_PHONE;
  const data = {
    message_id: messageId,
    provider_msg_id: providerMsgId,
    to_phone: toPhone,
    read_at: readAt,
  };
  return buildFixture(
    { event: 'message.read', tenant_id: DEFAULT_TENANT_ID, data },
    { type: 'message.read', data: { messageId, providerMsgId, toPhone, readAt, raw: data } },
    overrides.secret,
  );
};

const DEFAULT_FAILED_DETAILS =
  'In order to maintain a healthy ecosystem engagement, the message failed to be delivered.';

const nonEmptyString = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

/**
 * `message.failed` with the six-key `error` object the API sends. Like the
 * API, `details` and `errorUserMsg` default to `errorData.details` and
 * `errorData.error_user_msg`.
 */
export const createMessageFailedFixture = (
  overrides: {
    messageId?: string;
    failedAt?: string;
    errorCode?: number;
    errorTitle?: string;
    errorMessage?: string;
    errorData?: Record<string, unknown> | null;
    details?: string | null;
    errorUserMsg?: string | null;
    providerMsgId?: string | null;
    toPhone?: string | null;
    secret?: string;
  } = {},
): WebhookFixture => {
  const messageId = overrides.messageId ?? '4244';
  const failedAt = overrides.failedAt ?? '2026-05-10T12:02:00.000Z';
  const code = overrides.errorCode ?? 131049;
  const title = overrides.errorTitle ?? 'Message failed to send';
  const message = overrides.errorMessage ?? 'This message was not delivered to maintain healthy ecosystem engagement.';
  const errorData = overrides.errorData !== undefined
    ? overrides.errorData
    : { details: DEFAULT_FAILED_DETAILS };
  const details = overrides.details !== undefined
    ? overrides.details
    : nonEmptyString(errorData?.details);
  const errorUserMsg = overrides.errorUserMsg !== undefined
    ? overrides.errorUserMsg
    : nonEmptyString(errorData?.error_user_msg);
  const providerMsgId = overrides.providerMsgId !== undefined
    ? overrides.providerMsgId
    : 'wamid.HBgMOTY2NTAwMDAwMDAw_FAILED';
  const toPhone = overrides.toPhone !== undefined ? overrides.toPhone : DEFAULT_TO_PHONE;
  const data = {
    message_id: messageId,
    provider_msg_id: providerMsgId,
    to_phone: toPhone,
    failed_at: failedAt,
    error: { code, title, message, error_data: errorData, details, error_user_msg: errorUserMsg },
  };
  return buildFixture(
    { event: 'message.failed', tenant_id: DEFAULT_TENANT_ID, data },
    {
      type: 'message.failed',
      data: {
        messageId,
        providerMsgId,
        toPhone,
        failedAt,
        error: { code, title, message, errorData, details, errorUserMsg },
        raw: data,
      },
    },
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

/**
 * The console's "Send test event" delivery: event name `inbound.message`
 * with `data.test === true`. `verifyWebhook` returns it as a `test` event;
 * handlers should answer 2xx and ignore it.
 */
export const createTestEventFixture = (
  overrides: { secret?: string } = {},
): WebhookFixture => {
  const from = DEFAULT_TO_PHONE;
  const text = 'SanadWA test event.';
  const data = {
    test: true,
    from,
    message: { type: 'text', text: { body: text } },
  };
  return buildFixture(
    { event: 'inbound.message', tenant_id: DEFAULT_TENANT_ID, data },
    { type: 'test', data: { test: true, from, text, raw: data } },
    overrides.secret,
  );
};

/**
 * A correctly signed delivery with an event name the SDK does not type.
 * `verifyWebhook` returns `valid: true, recognized: false` and an `unknown`
 * event; handlers should answer 2xx. Pass an `eventType` the SDK does not
 * know: this fixture always expects an `unknown` event.
 */
export const createUnknownEventFixture = (
  overrides: { eventType?: string; data?: Record<string, unknown>; secret?: string } = {},
): WebhookFixture => {
  const eventType = overrides.eventType ?? 'campaign.completed';
  const data = overrides.data ?? { campaign_id: '42', completed_at: '2026-11-21T10:00:00.000Z' };
  return buildFixture(
    { event: eventType, tenant_id: DEFAULT_TENANT_ID, data },
    { type: 'unknown', data: { raw: data } },
    overrides.secret,
  );
};
