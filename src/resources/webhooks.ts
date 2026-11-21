/**
 * Server-only HMAC webhook verifier.
 *
 * Algorithm: HMAC-SHA256 of the raw body with the webhook secret, hex,
 * compared in constant time against the `X-Sanad-Signature: sha256=<hex>`
 * header. Malformed input always returns `{ valid: false, ... }`; the
 * verifier never throws.
 *
 * `valid` reports the signature only. A correctly signed delivery the SDK
 * cannot type is still `valid: true`, with `recognized: false` and an
 * `unknown` event.
 *
 * Node ≥20 only — relies on `node:crypto`. For browser webhook
 * verification, use SubtleCrypto manually.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  WebhookEvent,
  WebhookFailedError,
  WebhookInvalidReason,
  WebhookVerifyInput,
  WebhookVerifyResult,
} from '../types.js';

type JsonObject = Record<string, unknown>;

const asObject = (v: unknown): JsonObject | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : undefined;

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

// `message_id` arrives as the numeric DB row id on status events and as a
// string WA id on send/inbound events — coerce both to a string id.
const asId = (v: unknown): string | undefined => {
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
};

// `data.error` carries six keys (`null` when absent). A value of the wrong
// type maps to `null`. A bare string (legacy) is surfaced as `message`.
const parseFailedError = (raw: unknown): WebhookFailedError => {
  const e = asObject(raw);
  if (e) {
    return {
      code: typeof e.code === 'number' && Number.isFinite(e.code) ? e.code : null,
      title: asString(e.title) ?? null,
      message: asString(e.message) ?? null,
      errorData: asObject(e.error_data) ?? null,
      details: asString(e.details) ?? null,
      errorUserMsg: asString(e.error_user_msg) ?? null,
    };
  }
  return {
    code: null,
    title: null,
    message: asString(raw) ?? null,
    errorData: null,
    details: null,
    errorUserMsg: null,
  };
};

// On status events `message_id` is SanadWA's row id; `provider_msg_id` is the
// WhatsApp message id (`wamid.…`).
const statusIds = (d: JsonObject): { providerMsgId: string | null; toPhone: string | null } => ({
  providerMsgId: asString(d.provider_msg_id) ?? null,
  toPhone: asString(d.to_phone) ?? null,
});

const unknownEvent = (raw: JsonObject): WebhookEvent => ({ type: 'unknown', data: { raw } });

/**
 * Type a known event from its name and `data` object. Returns `null` when the
 * name is not a known one or a required field is missing.
 */
const narrowKnownEvent = (t: string, d: JsonObject): WebhookEvent | null => {
  switch (t) {
    case 'message.sent': {
      // `message_id` is null when WhatsApp returned no id for the send.
      const messageId = asId(d.message_id) ?? null;
      const toPhone = asString(d.to_phone);
      const sentAt = asString(d.sent_at);
      if (!toPhone || !sentAt) return null;

      const declaredType = asString(d.message_type);
      const inferredType = declaredType ?? (asString(d.text) ? 'text' : 'template');
      if (inferredType === 'text') {
        const text = asString(d.text);
        if (!text) return null;
        return {
          type: 'message.sent',
          data: {
            messageId,
            messageType: 'text',
            toPhone,
            templateName: null,
            templateLanguage: null,
            text,
            sentAt,
            raw: d,
          },
        };
      }
      if (inferredType !== 'template') return null;

      const templateName = asString(d.template_name);
      const templateLanguage = asString(d.template_language);
      if (!templateName || !templateLanguage) return null;
      return {
        type: 'message.sent',
        data: {
          messageId,
          messageType: 'template',
          toPhone,
          templateName,
          templateLanguage,
          text: null,
          sentAt,
          raw: d,
        },
      };
    }
    case 'message.delivered': {
      const messageId = asId(d.message_id);
      const deliveredAt = asString(d.delivered_at);
      if (!messageId || !deliveredAt) return null;
      return { type: 'message.delivered', data: { messageId, ...statusIds(d), deliveredAt, raw: d } };
    }
    case 'message.read': {
      const messageId = asId(d.message_id);
      const readAt = asString(d.read_at);
      if (!messageId || !readAt) return null;
      return { type: 'message.read', data: { messageId, ...statusIds(d), readAt, raw: d } };
    }
    case 'message.failed': {
      const messageId = asId(d.message_id);
      const failedAt = asString(d.failed_at);
      if (!messageId || !failedAt) return null;
      return {
        type: 'message.failed',
        data: { messageId, ...statusIds(d), failedAt, error: parseFailedError(d.error), raw: d },
      };
    }
    case 'inbound.message': {
      const from = asString(d.from) ?? asString(d.from_phone);
      const messageType = asString(d.type);
      if (!from || !messageType) return null;
      const data: {
        from: string;
        messageType: string;
        messageId: string | null;
        text?: string;
        timestamp?: string;
        raw: Record<string, unknown>;
      } = {
        from,
        messageType,
        messageId: asId(d.message_id) ?? null,
        raw: d,
      };
      const text = asString(d.text);
      if (text !== undefined) data.text = text;
      const timestamp = asString(d.timestamp);
      if (timestamp !== undefined) data.timestamp = timestamp;
      return { type: 'inbound.message', data };
    }
    default:
      return null;
  }
};

interface NarrowedDelivery {
  eventType: string | null;
  event: WebhookEvent;
}

/** Type a parsed, correctly signed body. Never rejects: falls back to `unknown`. */
const narrowDelivery = (parsed: unknown): NarrowedDelivery => {
  const env = asObject(parsed);
  if (!env) return { eventType: null, event: unknownEvent({}) };

  // Live envelope `{ event, tenant_id, data }`; legacy `{ event_type, payload }`.
  const eventType = asString(env.event) ?? asString(env.event_type) ?? null;
  const data = asObject(env.data) ?? asObject(env.payload);
  if (eventType === null || !data) return { eventType, event: unknownEvent(data ?? {}) };

  // The console's "Send test event" delivery, whatever event name it uses.
  if (data.test === true) {
    const message = asObject(data.message);
    const text = message ? asObject(message.text) : undefined;
    return {
      eventType,
      event: {
        type: 'test',
        data: {
          test: true,
          from: asString(data.from) ?? null,
          text: (text ? asString(text.body) : undefined) ?? null,
          raw: data,
        },
      },
    };
  }

  return { eventType, event: narrowKnownEvent(eventType, data) ?? unknownEvent(data) };
};

const invalid = (reason: WebhookInvalidReason): WebhookVerifyResult => ({
  valid: false,
  signatureValid: false,
  recognized: false,
  reason,
});

/**
 * Verify an `X-Sanad-Signature: sha256=<hex>` header against `rawBody` using
 * the webhook secret. Returns a discriminated result; never throws.
 *
 * `valid` is true exactly when the signature matches. Answer 401 only when
 * it is false. A signed delivery the SDK cannot type comes back as
 * `valid: true, recognized: false` with an `unknown` event (its `data` under
 * `event.data.raw`, the whole body under `envelope`); the console's test
 * delivery comes back as a `test` event. Answer 2xx for both.
 */
export const verifyWebhook = (input: WebhookVerifyInput): WebhookVerifyResult => {
  try {
    if (!input || typeof input !== 'object') return invalid('invalid_input');
    const { rawBody, signature, secret } = input;

    if (typeof secret !== 'string' || secret.length === 0) return invalid('invalid_secret');
    if (rawBody == null) return invalid('missing_body');
    if (typeof signature !== 'string' || signature.length === 0) return invalid('malformed_signature');
    if (!signature.startsWith('sha256=')) return invalid('malformed_signature');
    const provided = signature.slice('sha256='.length);
    if (provided.length === 0) return invalid('empty_signature');

    const bodyBuf =
      typeof rawBody === 'string'
        ? Buffer.from(rawBody, 'utf8')
        : Buffer.from(rawBody);

    const expected = createHmac('sha256', secret).update(bodyBuf).digest('hex');

    // Compare byte lengths: a non-ASCII header can have the same number of
    // characters as the digest and still be longer in bytes.
    const providedBuf = Buffer.from(provided, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (providedBuf.length !== expectedBuf.length) return invalid('signature_length_mismatch');
    if (!timingSafeEqual(providedBuf, expectedBuf)) return invalid('signature_mismatch');

    // Signature OK: from here on the result is always valid.
    let envelope: unknown = null;
    let narrowed: NarrowedDelivery = { eventType: null, event: unknownEvent({}) };
    try {
      envelope = JSON.parse(bodyBuf.toString('utf8'));
      narrowed = narrowDelivery(envelope);
    } catch {
      // Not JSON: keep the unknown event with an empty `raw`.
    }
    return {
      valid: true,
      signatureValid: true,
      recognized: narrowed.event.type !== 'unknown',
      eventType: narrowed.eventType,
      envelope,
      event: narrowed.event,
    };
  } catch {
    return invalid('verification_error');
  }
};
