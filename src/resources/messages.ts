import type { Requester } from '../request.js';
import type {
  Message,
  SendMessageOptions,
  SendMessageResponse,
  SendTextReplyOptions,
  SendTextReplyResponse,
} from '../types.js';
import { ValidationError } from '../errors.js';

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
    id: string;
    provider_msg_id: string | null;
    status: string;
    sent_at: string;
    template_name: string;
    to_phone: string;
    channel: string;
    provider: string;
    error: string | null;
    delivered_at: string | null;
    read_at: string | null;
    failed_at: string | null;
    last_status: string | null;
  };
}

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]+$/;

const validateIdempotencyKey = (idempotencyKey: string | undefined): void => {
  if (
    idempotencyKey !== undefined
    && (typeof idempotencyKey !== 'string'
      || idempotencyKey.length === 0
      || idempotencyKey.length > 120
      || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey))
  ) {
    throw new ValidationError({
      message: '`idempotencyKey` must contain 1 to 120 visible ASCII characters.',
      code: 'invalid_idempotency_key',
      status: 0,
    });
  }
};

const postMessage = async (
  req: Requester,
  path: '/messages/template' | '/messages/text',
  body: Record<string, unknown>,
  idempotencyKey: string | undefined,
): Promise<SendMessageResponse> => {
  validateIdempotencyKey(idempotencyKey);
  if (idempotencyKey !== undefined) body.idempotency_key = idempotencyKey;

  let replayed = false;
  const raw = await req<SendWire>({
    method: 'POST',
    path,
    body,
    idempotent: true,
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    onHeaders: (h) => {
      replayed = h.get('x-idempotent-replay') === 'true';
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
 * GET /messages/:id — fetch a previously sent message by id.
 *
 * Bubbles up `NotFoundError` for unknown ids.
 */
export const getMessage = async (req: Requester, id: string): Promise<Message> => {
  const raw = await req<MessageWire>({
    method: 'GET',
    path: `/messages/${encodeURIComponent(id)}`,
  });
  const d = raw.data;
  return {
    id: d.id,
    providerMsgId: d.provider_msg_id,
    status: d.status,
    sentAt: d.sent_at,
    templateName: d.template_name,
    toPhone: d.to_phone,
    channel: d.channel,
    provider: d.provider,
    error: d.error,
    deliveredAt: d.delivered_at,
    readAt: d.read_at,
    failedAt: d.failed_at,
    lastStatus: d.last_status,
  };
};
