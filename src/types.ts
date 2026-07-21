/**
 * Public types for `@sanadwa/whatsapp-sdk`.
 *
 * Wire format is snake_case; the SDK exposes camelCase. Resource modules
 * handle the mapping.
 */

export interface ClientOptions {
  /** Tenant API key (e.g. `pk_live_…`). Required. */
  apiKey: string;
  /** Override base URL (default: `https://api.sanadwa.com/api/public/v1`). */
  baseUrl?: string;
  /** Total attempts including the first request (default: 5). */
  retries?: number;
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
  category: string;
  status: string;
  components: unknown | null;
}

export interface ListTemplatesOptions {
  page?: number;
  limit?: number;
  q?: string;
}

export interface ListTemplatesResponse {
  page: number;
  limit: number;
  data: Template[];
}

export interface SendMessageOptions {
  phoneNumberId: string;
  toPhone: string;
  templateName: string;
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
  id: string;
  providerMsgId: string | null;
  status: string;
  sentAt: string;
  /** Null for free-form text replies. */
  templateName: string | null;
  toPhone: string;
  channel: string;
  provider: string;
  error: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  lastStatus: string | null;
}

/**
 * Structured failure reason on a `message.failed` event. Mirrors the live API
 * `data.error` object (`{ code, title, message }`) — NOT a bare string.
 */
export interface WebhookFailedError {
  code: number | null;
  title: string | null;
  message: string | null;
}

/**
 * Discriminated union covering all webhook event types currently emitted by
 * the SANAD WhatsApp Public API. Narrow on `type` for exhaustive handling.
 *
 * The live wire envelope is `{ event, tenant_id, data }` (snake_case payload
 * under `data`); the SDK narrows on `event` and maps the core `data` fields to
 * camelCase. Every member also exposes `raw` — the full unmapped `data` object —
 * so adopters can read fields the SDK does not surface (e.g. `provider_msg_id`,
 * inbound `media`/`button`) without the SDK silently dropping them.
 */
export type MessageSentWebhookData =
  | {
      messageId: string;
      messageType: 'template';
      toPhone: string;
      templateName: string;
      templateLanguage: string;
      text: null;
      sentAt: string;
      raw: Record<string, unknown>;
    }
  | {
      messageId: string;
      messageType: 'text';
      toPhone: string;
      templateName: null;
      templateLanguage: null;
      text: string;
      sentAt: string;
      raw: Record<string, unknown>;
    };

export type WebhookEvent =
  | { type: 'message.sent'; data: MessageSentWebhookData }
  | { type: 'message.delivered'; data: { messageId: string; deliveredAt: string; raw: Record<string, unknown> } }
  | { type: 'message.read'; data: { messageId: string; readAt: string; raw: Record<string, unknown> } }
  | { type: 'message.failed'; data: { messageId: string; failedAt: string; error: WebhookFailedError; raw: Record<string, unknown> } }
  | { type: 'inbound.message'; data: { from: string; messageType: string; messageId: string | null; text?: string; timestamp?: string; raw: Record<string, unknown> } };

export interface WebhookVerifyInput {
  rawBody: string | Uint8Array;
  signature: string;
  secret: string;
}

export type WebhookVerifyResult =
  | { valid: true; event: WebhookEvent }
  | { valid: false; reason: string };
