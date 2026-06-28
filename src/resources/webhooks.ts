/**
 * Server-only HMAC webhook verifier.
 *
 * Mirrors the canonical `verifyHmac` implementation in
 * `SANAD_API/scripts/lib/webhook-verify.mjs` (Phase 47). Same algorithm
 * (HMAC SHA256, hex, timing-safe equality), same handling of malformed
 * input (always returns `{valid:false, ...}`, never throws).
 *
 * Node ≥20 only — relies on `node:crypto`. For browser webhook
 * verification, use SubtleCrypto manually.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  WebhookEvent,
  WebhookFailedError,
  WebhookVerifyInput,
  WebhookVerifyResult,
} from '../types.js';

interface RawEnvelope {
  // Live wire envelope (authoritative): { event, tenant_id, data }.
  event?: string;
  tenant_id?: number;
  data?: Record<string, unknown>;
  // Legacy envelope tolerated for backward-compat: { event_type, payload }.
  event_type?: string;
  payload?: Record<string, unknown>;
}

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

// `message_id` arrives as the numeric DB row id on status events and as a
// string WA id on send/inbound events — coerce both to a string id.
const asId = (v: unknown): string | undefined => {
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
};

// Live `data.error` is `{ code, title, message }`. Tolerate a bare string
// (legacy) by surfacing it as `message`.
const parseFailedError = (raw: unknown): WebhookFailedError => {
  if (raw && typeof raw === 'object') {
    const e = raw as Record<string, unknown>;
    return {
      code: typeof e.code === 'number' ? e.code : null,
      title: asString(e.title) ?? null,
      message: asString(e.message) ?? null,
    };
  }
  if (typeof raw === 'string') return { code: null, title: null, message: raw };
  return { code: null, title: null, message: null };
};

const narrowWebhookEvent = (parsed: unknown): WebhookEvent | null => {
  if (!parsed || typeof parsed !== 'object') return null;
  const env = parsed as RawEnvelope;
  const t = env.event ?? env.event_type;
  const rawData = env.data ?? env.payload;
  if (!t || !rawData || typeof rawData !== 'object') return null;
  const d = rawData as Record<string, unknown>;

  switch (t) {
    case 'message.sent': {
      const messageId = asId(d.message_id);
      const toPhone = asString(d.to_phone);
      const templateName = asString(d.template_name);
      const templateLanguage = asString(d.template_language);
      const sentAt = asString(d.sent_at);
      if (!messageId || !toPhone || !templateName || !templateLanguage || !sentAt) return null;
      return { type: 'message.sent', data: { messageId, toPhone, templateName, templateLanguage, sentAt, raw: d } };
    }
    case 'message.delivered': {
      const messageId = asId(d.message_id);
      const deliveredAt = asString(d.delivered_at);
      if (!messageId || !deliveredAt) return null;
      return { type: 'message.delivered', data: { messageId, deliveredAt, raw: d } };
    }
    case 'message.read': {
      const messageId = asId(d.message_id);
      const readAt = asString(d.read_at);
      if (!messageId || !readAt) return null;
      return { type: 'message.read', data: { messageId, readAt, raw: d } };
    }
    case 'message.failed': {
      const messageId = asId(d.message_id);
      const failedAt = asString(d.failed_at);
      if (!messageId || !failedAt) return null;
      return { type: 'message.failed', data: { messageId, failedAt, error: parseFailedError(d.error), raw: d } };
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

/**
 * Verify a `X-Sanad-Signature: sha256=<hex>` header against `rawBody` using
 * the shared webhook secret. Returns a discriminated result; never throws.
 *
 * On success, the parsed body is narrowed to the typed `WebhookEvent` union.
 * If the signature matches but the payload shape is unrecognized, the result
 * is `{ valid: false, reason: 'unknown_event_type' }` — adopters should
 * inspect the raw body separately if they want to handle untyped events.
 */
export const verifyWebhook = (input: WebhookVerifyInput): WebhookVerifyResult => {
  try {
    if (!input || typeof input !== 'object') return { valid: false, reason: 'invalid_input' };
    const { rawBody, signature, secret } = input;

    if (typeof secret !== 'string' || secret.length === 0) {
      return { valid: false, reason: 'invalid_secret' };
    }
    if (rawBody == null) return { valid: false, reason: 'missing_body' };
    if (typeof signature !== 'string' || signature.length === 0) {
      return { valid: false, reason: 'malformed_signature' };
    }
    if (!signature.startsWith('sha256=')) {
      return { valid: false, reason: 'malformed_signature' };
    }
    const provided = signature.slice('sha256='.length);
    if (provided.length === 0) return { valid: false, reason: 'empty_signature' };

    const bodyBuf =
      typeof rawBody === 'string'
        ? Buffer.from(rawBody, 'utf8')
        : Buffer.from(rawBody);

    const expected = createHmac('sha256', secret).update(bodyBuf).digest('hex');

    if (provided.length !== expected.length) {
      return { valid: false, reason: 'signature_length_mismatch' };
    }
    if (!timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'))) {
      return { valid: false, reason: 'signature_mismatch' };
    }

    // Signature OK — parse + narrow.
    const text =
      typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody).toString('utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { valid: false, reason: 'verification_error' };
    }
    const event = narrowWebhookEvent(parsed);
    if (!event) return { valid: false, reason: 'unknown_event_type' };
    return { valid: true, event };
  } catch {
    return { valid: false, reason: 'verification_error' };
  }
};
