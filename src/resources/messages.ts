import type { Requester } from '../request.js';
import type {
  Message,
  SendMessageOptions,
  SendMessageResponse,
  SendTextReplyOptions,
  SendTextReplyResponse,
} from '../types.js';
import { assertIdempotencyKey, isIdempotentReplay } from './resource-helpers.js';

interface SendWire {
  success: true;
  message_id: string | null;
  accepted_at: string;
  upstream?: {
    messaging_product?: string;
    contacts?: unknown[];
    messages?: unknown[];
  };
}

interface MessageWire {
  success: true;
  data: {
    id: string | number;
    provider_msg_id?: string | null;
    status?: string | null;
    sent_at?: string | null;
    template_name?: string | null;
    to_phone?: string | null;
    channel?: string | null;
    provider?: string | null;
    error?: string | null;
    delivered_at?: string | null;
    read_at?: string | null;
    failed_at?: string | null;
    last_status?: string | null;
  };
}

const postMessage = async (
  req: Requester,
  path: '/messages/template' | '/messages/text',
  body: Record<string, unknown>,
  idempotencyKey: string | undefined,
): Promise<SendMessageResponse> => {
  assertIdempotencyKey(idempotencyKey);
  if (idempotencyKey !== undefined) body.idempotency_key = idempotencyKey;

  let replayed = false;
  const raw = await req<SendWire>({
    method: 'POST',
    path,
    body,
    idempotent: true,
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    onHeaders: (h) => {
      replayed = isIdempotentReplay(h);
    },
  });

  return {
    messageId: raw.message_id,
    acceptedAt: raw.accepted_at,
    replayed,
    upstream: {
      messagingProduct: raw.upstream?.messaging_product ?? 'whatsapp',
      contacts: raw.upstream?.contacts ?? [],
      messages: raw.upstream?.messages ?? [],
    },
  };
};

/**
 * POST /messages/template — send an approved WhatsApp template message.
 *
 * When `templateLanguage` is omitted the API sends the template in Arabic
 * (`ar`). A WhatsApp-side failure throws `SendFailedError` and is never
 * retried automatically.
 *
 * The SDK sends the caller's `Idempotency-Key`, or generates a UUID v4 when
 * absent. The same value is reused across retries so duplicate sends are
 * impossible.
 */
export const sendMessage = async (
  req: Requester,
  opts: SendMessageOptions,
): Promise<SendMessageResponse> => {
  const body: Record<string, unknown> = {
    phone_number_id: opts.phoneNumberId,
    to_phone: opts.toPhone,
    template_name: opts.templateName,
  };
  if (opts.templateLanguage !== undefined) body.template_language = opts.templateLanguage;
  if (opts.templateParams !== undefined) body.template_params = opts.templateParams;
  if (opts.templateComponents !== undefined) body.template_components = opts.templateComponents;
  return postMessage(req, '/messages/template', body, opts.idempotencyKey);
};

/**
 * POST /messages/text — send a free-form customer-service reply.
 *
 * The recipient must have sent an inbound message to the selected sender
 * during the active WhatsApp customer-service window. Outside that window the
 * API rejects with `customer_service_window_closed`; use a template instead.
 */
export const sendTextReply = async (
  req: Requester,
  opts: SendTextReplyOptions,
): Promise<SendTextReplyResponse> => {
  const body: Record<string, unknown> = {
    phone_number_id: opts.phoneNumberId,
    to_phone: opts.toPhone,
    text: opts.text,
  };
  if (opts.previewUrl !== undefined) body.preview_url = opts.previewUrl;

  const result = await postMessage(req, '/messages/text', body, opts.idempotencyKey);
  return { ...result, messageType: 'text' };
};

/**
 * GET /messages/:id — fetch a previously sent message.
 *
 * Pass the WhatsApp message id (`wamid.…`) returned as `messageId` by
 * `send()` / `sendText()`, or a status webhook's `providerMsgId`. Do not pass
 * `Message.id` or a status webhook's `messageId`: those are SanadWA row ids
 * and the API answers 404 `message_not_found` (`NotFoundError`) for anything
 * that is not a `wamid.` id.
 *
 * `status`, `sentAt`, `toPhone`, `channel` and `provider` can be `null`.
 */
export const getMessage = async (req: Requester, id: string): Promise<Message> => {
  const raw = await req<MessageWire>({
    method: 'GET',
    path: `/messages/${encodeURIComponent(id)}`,
  });
  const d = raw.data;
  return {
    id: String(d.id),
    providerMsgId: d.provider_msg_id ?? null,
    status: d.status ?? null,
    sentAt: d.sent_at ?? null,
    templateName: d.template_name ?? null,
    toPhone: d.to_phone ?? null,
    channel: d.channel ?? null,
    provider: d.provider ?? null,
    error: d.error ?? null,
    deliveredAt: d.delivered_at ?? null,
    readAt: d.read_at ?? null,
    failedAt: d.failed_at ?? null,
    lastStatus: d.last_status ?? null,
  };
};
