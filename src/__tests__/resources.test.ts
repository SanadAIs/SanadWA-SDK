import { describe, it, expect, vi } from 'vitest';
import { health } from '../resources/health.js';
import { listTemplates } from '../resources/templates.js';
import { sendMessage, sendTextReply, getMessage } from '../resources/messages.js';
import { NotFoundError, ValidationError } from '../errors.js';
import type { Requester, RequestOptions } from '../request.js';

const mkRequester = (impl: <T>(opts: RequestOptions) => Promise<T>): Requester => impl;

describe('health resource', () => {
  it('GET /health and maps server_time → serverTime', async () => {
    const calls: RequestOptions[] = [];
    const req = mkRequester(async <T>(opts: RequestOptions) => {
      calls.push(opts);
      return { success: true, tenant_id: 't_1', scope: 'send', server_time: '2026-05-10T00:00:00Z' } as unknown as T;
    });
    const out = await health(req);
    expect(out).toEqual({ tenantId: 't_1', scope: 'send', serverTime: '2026-05-10T00:00:00Z' });
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/health' });
  });

  it('coerces a numeric tenant_id from the live response to a string', async () => {
    const req = mkRequester(async <T>() => ({
      success: true,
      tenant_id: 7,
      scope: 'send',
      server_time: '2026-05-10T00:00:00Z',
    }) as unknown as T);

    const out = await health(req);

    expect(out.tenantId).toBe('7');
  });
});

describe('templates resource', () => {
  it('builds query for {page,limit,q}', async () => {
    const calls: RequestOptions[] = [];
    const req = mkRequester(async <T>(opts: RequestOptions) => {
      calls.push(opts);
      return { success: true, page: 2, limit: 25, data: [] } as unknown as T;
    });
    await listTemplates(req, { page: 2, limit: 25, q: 'hi' });
    expect(calls[0]!.query).toEqual({ page: 2, limit: 25, q: 'hi' });
  });

  it('omits query when no opts given', async () => {
    const calls: RequestOptions[] = [];
    const req = mkRequester(async <T>(opts: RequestOptions) => {
      calls.push(opts);
      return { success: true, page: 1, limit: 50, data: [] } as unknown as T;
    });
    await listTemplates(req);
    expect(calls[0]!.query).toBeUndefined();
  });
});

describe('messages.send', () => {
  it('POSTs snake_case body, idempotent:true, captures replayed from header', async () => {
    const calls: RequestOptions[] = [];
    const req = mkRequester(async <T>(opts: RequestOptions) => {
      calls.push(opts);
      // Simulate the request layer firing onHeaders with X-Idempotent-Replay
      if (opts.onHeaders) {
        opts.onHeaders(new Headers({ 'x-idempotent-replay': 'true' }));
      }
      return {
        success: true,
        message_id: 'msg_1',
        accepted_at: '2026-05-10T00:00:00Z',
        upstream: { messaging_product: 'whatsapp', contacts: [], messages: [] },
      } as unknown as T;
    });

    const out = await sendMessage(req, {
      phoneNumberId: 'PNID',
      toPhone: '+962790000000',
      templateName: 'hello_world',
      templateLanguage: 'en',
      templateParams: ['Alice'],
    });

    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.path).toBe('/messages/template');
    expect(calls[0]!.idempotent).toBe(true);
    expect(calls[0]!.body).toEqual({
      phone_number_id: 'PNID',
      to_phone: '+962790000000',
      template_name: 'hello_world',
      template_language: 'en',
      template_params: ['Alice'],
    });
    expect(out.messageId).toBe('msg_1');
    expect(out.replayed).toBe(true);
    expect(out.upstream.messagingProduct).toBe('whatsapp');
  });

  it('replayed=false when header absent', async () => {
    const req = mkRequester(async <T>(opts: RequestOptions) => {
      if (opts.onHeaders) opts.onHeaders(new Headers());
      return { success: true, message_id: 'm', accepted_at: 'now' } as unknown as T;
    });
    const out = await sendMessage(req, { phoneNumberId: 'p', toPhone: '+1', templateName: 't' });
    expect(out.replayed).toBe(false);
  });

  it('passes a caller idempotency key to both the header layer and legacy body field', async () => {
    const calls: RequestOptions[] = [];
    const req = mkRequester(async <T>(opts: RequestOptions) => {
      calls.push(opts);
      return { success: true, message_id: 'm', accepted_at: 'now' } as unknown as T;
    });
    await sendMessage(req, { phoneNumberId: 'p', toPhone: '+1', templateName: 't', idempotencyKey: 'custom_key' });
    expect(calls[0]!.idempotencyKey).toBe('custom_key');
    expect((calls[0]!.body as Record<string, unknown>).idempotency_key).toBe('custom_key');
  });

  it.each([
    { idempotencyKey: '', description: 'empty' },
    { idempotencyKey: 'k'.repeat(121), description: 'longer than 120 characters' },
    { idempotencyKey: '   ', description: 'whitespace-only' },
    { idempotencyKey: 'key with space', description: 'contains a space' },
    { idempotencyKey: 'key\tvalue', description: 'contains a tab' },
    { idempotencyKey: 'abc\r\nX-Evil: 1', description: 'contains CR/LF' },
    { idempotencyKey: 'key\x7F', description: 'contains DEL' },
    { idempotencyKey: 'مفتاح', description: 'contains non-ASCII characters' },
  ])('rejects an idempotency key that is $description', async ({ idempotencyKey }) => {
    const req = vi.fn();

    const error = await sendMessage(req as unknown as Requester, {
      phoneNumberId: 'p',
      toPhone: '+1',
      templateName: 't',
      idempotencyKey,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).code).toBe('invalid_idempotency_key');
    expect(req).not.toHaveBeenCalled();
  });
});

describe('messages.reply', () => {
  it('POSTs free-form text to /messages/text with idempotency', async () => {
    const calls: RequestOptions[] = [];
    const req = mkRequester(async <T>(opts: RequestOptions) => {
      calls.push(opts);
      if (opts.onHeaders) {
        opts.onHeaders(new Headers({ 'x-idempotent-replay': 'true' }));
      }
      return {
        success: true,
        message_id: 'wamid.TEXT',
        message_type: 'text',
        accepted_at: '2026-07-21T12:00:00Z',
        upstream: { messaging_product: 'whatsapp', contacts: [], messages: [] },
      } as unknown as T;
    });

    const out = await sendTextReply(req, {
      phoneNumberId: 'PNID',
      toPhone: '+966500000000',
      text: 'How can we help?',
      previewUrl: false,
      idempotencyKey: 'reply_001',
    });

    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/messages/text',
      idempotent: true,
      idempotencyKey: 'reply_001',
      body: {
        phone_number_id: 'PNID',
        to_phone: '+966500000000',
        text: 'How can we help?',
        preview_url: false,
        idempotency_key: 'reply_001',
      },
    });
    expect(out.messageId).toBe('wamid.TEXT');
    expect(out.messageType).toBe('text');
    expect(out.replayed).toBe(true);
  });

  it('rejects an unsafe idempotency key before invoking the requester', async () => {
    const req = vi.fn();
    const error = await sendTextReply(req as unknown as Requester, {
      phoneNumberId: 'PNID',
      toPhone: '+966500000000',
      text: 'Hello',
      idempotencyKey: 'bad key',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect(req).not.toHaveBeenCalled();
  });
});

describe('messages.get', () => {
  it('URL-encodes id and maps response data', async () => {
    const calls: RequestOptions[] = [];
    const req = mkRequester(async <T>(opts: RequestOptions) => {
      calls.push(opts);
      return {
        success: true,
        data: {
          id: 'msg_1', provider_msg_id: 'wa_x', status: 'sent', sent_at: '2026-05-10T00:00:00Z',
          template_name: 'hello', to_phone: '+1', channel: 'whatsapp', provider: 'meta',
          error: null, delivered_at: null, read_at: null, failed_at: null, last_status: 'sent',
        },
      } as unknown as T;
    });
    const out = await getMessage(req, 'msg/with spaces');
    expect(calls[0]!.path).toBe(`/messages/${encodeURIComponent('msg/with spaces')}`);
    expect(out.id).toBe('msg_1');
    expect(out.providerMsgId).toBe('wa_x');
    expect(out.lastStatus).toBe('sent');
  });

  it('propagates NotFoundError from request layer', async () => {
    const req = mkRequester(async () => {
      throw new NotFoundError({ message: 'not found', code: 'message_not_found', status: 404 });
    });
    await expect(getMessage(req, 'missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});
