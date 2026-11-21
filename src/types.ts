/**
 * Public types for `@sanadwa/whatsapp-sdk`.
 *
 * Wire format is snake_case; the SDK exposes camelCase. Resource modules
 * handle the mapping.
 */

import type { Page } from './resource-types.js';

export interface ClientOptions {
  /** Tenant API key (e.g. `pk_live_…`). Required. */
  apiKey: string;
  /**
   * Override base URL (default: `https://api.sanadwa.com/v1`). The older
   * `https://api.sanadwa.com/api/public/v1` serves the same routes and is
   * used unchanged when passed here.
   */
  baseUrl?: string;
  /** Total attempts including the first request (default: 5). */
  retries?: number;
  /**
   * Timeout for each attempt in milliseconds (default: 30000). A timed-out
   * attempt is retried like a network failure. `0` disables the timeout.
   */
  timeoutMs?: number;
  /** Inject a custom `fetch` implementation for testing. */
  fetch?: typeof fetch;
  /** Override the User-Agent header. */
  userAgent?: string;
}

export interface HealthResponse {
  tenantId: string;
  scope: string;
  serverTime: string;
}

export interface Template {
  name: string;
  language: string;
  category: string | null;
  status: string;
  /** WhatsApp Business Account the template belongs to. */
  wabaId: string | null;
  components: unknown | null;
}

export interface ListTemplatesOptions {
  /** 1-based page (default 1). */
  page?: number;
  /** Page size (default 50, maximum 200). */
  limit?: number;
  /** Search text matched against the template name. */
  q?: string;
  /**
   * Only templates the given sender can use (a number can only send its own
   * WhatsApp account's templates). Wins over `wabaId` when both are set. An
   * unknown id is answered 404 `phone_not_found` (`NotFoundError`).
   */
  phoneNumberId?: string;
  /** Only templates of this WhatsApp Business Account. */
  wabaId?: string;
}

/** One page of templates: the same `Page` shape every paged list returns. */
export interface ListTemplatesResponse extends Page<Template> {}

export interface SendMessageOptions {
  phoneNumberId: string;
  toPhone: string;
  templateName: string;
  /** Optional. When omitted the API sends the template in Arabic (`ar`). */
  templateLanguage?: string;
  templateParams?: string[];
  templateComponents?: unknown[];
  /**
   * Exact `Idempotency-Key` header value: 1–120 visible ASCII characters.
   * The body copy is retained only for backward compatibility.
   */
  idempotencyKey?: string;
}

export interface SendMessageResponse {
  messageId: string | null;
  acceptedAt: string;
  /** True when the server returned a cached response for an existing idempotency key. */
  replayed: boolean;
  upstream: {
    messagingProduct: string;
    contacts: unknown[];
    messages: unknown[];
  };
}

export interface SendTextReplyOptions {
  phoneNumberId: string;
  toPhone: string;
  /** Free-form reply body. WhatsApp allows this only during an active customer-service window. */
  text: string;
  /** Ask WhatsApp to render a link preview (default: false). */
  previewUrl?: boolean;
  /** Exact `Idempotency-Key` header value: 1–120 visible ASCII characters. */
  idempotencyKey?: string;
}

export interface SendTextReplyResponse extends SendMessageResponse {
  messageType: 'text';
}

export interface Message {
  /** SanadWA's row id. Not accepted by `messages.get()`; use `providerMsgId`. */
  id: string;
  /** The WhatsApp message id (`wamid.…`). */
  providerMsgId: string | null;
  /**
   * Known values: `sent`, `delivered`, `read`, `failed`. Other values
   * (`queued`, `received`) are possible for rows not sent through this API;
   * treat an unknown value as not final.
   */
  status: string | null;
  sentAt: string | null;
  /** Null for free-form text replies. */
  templateName: string | null;
  toPhone: string | null;
  channel: string | null;
  provider: string | null;
  error: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  lastStatus: string | null;
}

/**
 * Structured failure reason on a `message.failed` event. Mirrors the API's
 * `data.error` object, which always carries these six keys (`null` when
 * WhatsApp gave no value).
 */
export interface WebhookFailedError {
  /** WhatsApp error code, e.g. `131049`. */
  code: number | null;
  title: string | null;
  message: string | null;
  /** `error_data`: WhatsApp's structured detail object, unchanged. */
  errorData: Record<string, unknown> | null;
  /** `details`: the human-readable reason, usually more specific than `title`. */
  details: string | null;
  /** `error_user_msg`: a message WhatsApp suggests showing to the user. */
  errorUserMsg: string | null;
}

/**
 * Data of a `message.sent` event. `messageId` is the WhatsApp message id
 * (`wamid.…`) and is `null` when WhatsApp returned none.
 */
export type MessageSentWebhookData =
  | {
      messageId: string | null;
      messageType: 'template';
      toPhone: string;
      templateName: string;
      templateLanguage: string;
      text: null;
      sentAt: string;
      raw: Record<string, unknown>;
    }
  | {
      messageId: string | null;
      messageType: 'text';
      toPhone: string;
      templateName: null;
      templateLanguage: null;
      text: string;
      sentAt: string;
      raw: Record<string, unknown>;
    };

/**
 * `message.delivered` data.
 *
 * `messageId` is SanadWA's row id. `providerMsgId` is the WhatsApp message id
 * (`wamid.…`): match on it against the `messageId` a send returned, and pass
 * it to `messages.get()`.
 */
export interface MessageDeliveredWebhookData {
  messageId: string;
  providerMsgId: string | null;
  toPhone: string | null;
  deliveredAt: string;
  raw: Record<string, unknown>;
}

/**
 * `message.read` data.
 *
 * `messageId` is SanadWA's row id. `providerMsgId` is the WhatsApp message id
 * (`wamid.…`): match on it against the `messageId` a send returned, and pass
 * it to `messages.get()`.
 */
export interface MessageReadWebhookData {
  messageId: string;
  providerMsgId: string | null;
  toPhone: string | null;
  readAt: string;
  raw: Record<string, unknown>;
}

/**
 * `message.failed` data.
 *
 * `messageId` is SanadWA's row id. `providerMsgId` is the WhatsApp message id
 * (`wamid.…`): match on it against the `messageId` a send returned, and pass
 * it to `messages.get()`.
 */
export interface MessageFailedWebhookData {
  messageId: string;
  providerMsgId: string | null;
  toPhone: string | null;
  failedAt: string;
  error: WebhookFailedError;
  raw: Record<string, unknown>;
}

/**
 * Discriminated union of webhook events. Narrow on `type`.
 *
 * The wire envelope is `{ event, tenant_id, data }` (snake_case under
 * `data`); the SDK maps the core fields to camelCase. Every member also
 * exposes `raw`, the full unmapped `data` object, so fields the SDK does not
 * surface stay readable.
 *
 * Two members are not message events:
 * - `test`: the console's "Send test event" delivery (any delivery whose
 *   `data.test` is `true`). Answer 2xx and ignore it.
 * - `unknown`: a correctly signed delivery the SDK cannot type (a newer event
 *   name, or a known one with missing fields). Answer 2xx; read `raw` if you
 *   want to handle it.
 */
export type WebhookEvent =
  | { type: 'message.sent'; data: MessageSentWebhookData }
  | { type: 'message.delivered'; data: MessageDeliveredWebhookData }
  | { type: 'message.read'; data: MessageReadWebhookData }
  | { type: 'message.failed'; data: MessageFailedWebhookData }
  | { type: 'inbound.message'; data: { from: string; messageType: string; messageId: string | null; text?: string; timestamp?: string; raw: Record<string, unknown> } }
  | { type: 'test'; data: { test: true; from: string | null; text: string | null; raw: Record<string, unknown> } }
  | { type: 'unknown'; data: { raw: Record<string, unknown> } };

export interface WebhookVerifyInput {
  /** The request body exactly as received (not re-serialized). */
  rawBody: string | Uint8Array;
  /** The `X-Sanad-Signature` header value (`sha256=<hex>`). */
  signature: string;
  /** The webhook secret. */
  secret: string;
}

/** Why a delivery failed verification. */
export type WebhookInvalidReason =
  | 'invalid_input'
  | 'invalid_secret'
  | 'missing_body'
  | 'malformed_signature'
  | 'empty_signature'
  | 'signature_length_mismatch'
  | 'signature_mismatch'
  /** An unexpected internal exception. */
  | 'verification_error';

/**
 * Result of `verifyWebhook`.
 *
 * `valid` (same value as `signatureValid`) is true exactly when the signature
 * matches the raw body; nothing else can make it false. Answer 401 only when
 * it is false. Otherwise answer 2xx and act only on the event types you
 * handle.
 */
export type WebhookVerifyResult =
  | {
      valid: true;
      signatureValid: true;
      /** False when `event.type` is `unknown`. */
      recognized: boolean;
      /** The wire event name, or `null` when the body carries none. */
      eventType: string | null;
      /** The parsed JSON body, or `null` when the body is not valid JSON. */
      envelope: unknown;
      event: WebhookEvent;
    }
  | {
      valid: false;
      signatureValid: false;
      recognized: false;
      reason: WebhookInvalidReason;
    };
