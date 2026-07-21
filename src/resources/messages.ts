import type { Requester } from '../request.js';
import type {
  Message,
  SendMessageOptions,
  SendMessageResponse,
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
  if (
    opts.idempotencyKey !== undefined
    && (typeof opts.idempotencyKey !== 'string'
      || opts.idempotencyKey.length === 0
      || opts.idempotencyKey.length > 120
      || !IDEMPOTENCY_KEY_PATTERN.test(opts.idempotencyKey))
  ) {
    throw new ValidationError({
      message: '`idempotencyKey` must contain 1 to 120 visible ASCII characters.',
      code: 'invalid_idempotency_key',
      status: 0,
    });
  }

  const body: Record<string, unknown> = {
    phone_number_id: opts.phoneNumberId,
    to_phone: opts.toPhone,
    template_name: opts.templateName,
  };
  if (opts.templateLanguage !== undefined) body.template_language = opts.templateLanguage;
  if (opts.templateParams !== undefined) body.template_params = opts.templateParams;
  if (opts.templateComponents !== undefined) body.template_components = opts.templateComponents;
  if (opts.idempotencyKey !== undefined) body.idempotency_key = opts.idempotencyKey;

  let replayed = false;
  const raw = await req<SendWire>({
    method: 'POST',
    path: '/messages/template',
    body,
    idempotent: true,
    ...(opts.idempotencyKey !== undefined
      ? { idempotencyKey: opts.idempotencyKey }
      : {}),
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
