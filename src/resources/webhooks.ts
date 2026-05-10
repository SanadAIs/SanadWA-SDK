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
  WebhookVerifyInput,
  WebhookVerifyResult,
} from '../types.js';

interface RawEnvelope {
  event_type?: string;
  payload?: Record<string, unknown>;
  sent_at?: string;
}

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;

const narrowWebhookEvent = (parsed: unknown): WebhookEvent | null => {
  if (!parsed || typeof parsed !== 'object') return null;
  const env = parsed as RawEnvelope;
  const t = env.event_type;
  const p = env.payload ?? {};
  if (!t || typeof p !== 'object') return null;

  switch (t) {
    case 'message.sent': {
      const messageId = asString(p.message_id);
      const toPhone = asString(p.to_phone);
      const templateName = asString(p.template_name);
      const templateLanguage = asString(p.template_language);
      const sentAt = asString(p.sent_at);
      if (!messageId || !toPhone || !templateName || !templateLanguage || !sentAt) return null;
      return { type: 'message.sent', data: { messageId, toPhone, templateName, templateLanguage, sentAt } };
    }
    case 'message.delivered': {
      const messageId = asString(p.message_id);
      const deliveredAt = asString(p.delivered_at);
      if (!messageId || !deliveredAt) return null;
      return { type: 'message.delivered', data: { messageId, deliveredAt } };
    }
    case 'message.read': {
      const messageId = asString(p.message_id);
      const readAt = asString(p.read_at);
      if (!messageId || !readAt) return null;
      return { type: 'message.read', data: { messageId, readAt } };
    }
    case 'message.failed': {
      const messageId = asString(p.message_id);
      const error = asString(p.error);
      const failedAt = asString(p.failed_at);
      if (!messageId || error === undefined || !failedAt) return null;
      return { type: 'message.failed', data: { messageId, error, failedAt } };
    }
    case 'inbound.message': {
      const fromPhone = asString(p.from_phone);
      const messageType = asString(p.type);
      if (!fromPhone || !messageType) return null;
      const text = asString(p.text);
      const data: { fromPhone: string; text?: string; messageType: string; raw: unknown } = {
        fromPhone,
        messageType,
        raw: p.raw,
      };
      if (text !== undefined) data.text = text;
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
