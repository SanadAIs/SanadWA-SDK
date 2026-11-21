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
    expect('query' in calls[0]!).toBe(false);
  });

  it('sends query keys in the order page, limit, q, phone_number_id, waba_id', async () => {
    const calls: RequestOptions[] = [];
    const req = mkRequester(async <T>(opts: RequestOptions) => {
      calls.push(opts);
      return { success: true, page: 1, limit: 10, data: [] } as unknown as T;
    });
    await listTemplates(req, { wabaId: '900000000000001', phoneNumberId: '100000000000001', q: 'hi', limit: 10, page: 1 });
    expect(Object.entries(calls[0]!.query!)).toEqual([
      ['page', 1],
      ['limit', 10],
      ['q', 'hi'],
      ['phone_number_id', '100000000000001'],
      ['waba_id', '900000000000001'],
    ]);
  });

  it('sends only the filters the caller set', async () => {
    const calls: RequestOptions[] = [];
    const req = mkRequester(async <T>(opts: RequestOptions) => {
      calls.push(opts);
      return { success: true, page: 1, limit: 50, data: [] } as unknown as T;
    });
    await listTemplates(req, { phoneNumberId: '100000000000001' });
    expect(calls[0]!.query).toEqual({ phone_number_id: '100000000000001' });
    await listTemplates(req, { wabaId: '900000000000001' });
    expect(calls[1]!.query).toEqual({ waba_id: '900000000000001' });
  });

  it('maps each row explicitly, waba_id → wabaId', async () => {
    const components = [{ type: 'BODY', text: 'Hello {{1}}' }];
    const req = mkRequester(async <T>() => ({
      success: true,
      page: 1,
      limit: 50,
      data: [
        { name: 'hello_world', language: 'en', category: 'UTILITY', status: 'APPROVED', waba_id: '900000000000001', components },
        { name: 'no_category', language: 'ar', category: null, status: 'APPROVED', waba_id: '900000000000001', components: null },
        { name: 'legacy_row', language: 'ar', status: 'APPROVED' },
      ],
    }) as unknown as T);

    const out = await listTemplates(req);

    expect(out).toEqual({
      page: 1,
      limit: 50,
      data: [
        { name: 'hello_world', language: 'en', category: 'UTILITY', status: 'APPROVED', wabaId: '900000000000001', components },
        { name: 'no_category', language: 'ar', category: null, status: 'APPROVED', wabaId: '900000000000001', components: null },
        { name: 'legacy_row', language: 'ar', category: null, status: 'APPROVED', wabaId: null, components: null },
      ],
    });
    expect('waba_id' in out.data[0]!).toBe(false);
  });

  it('propagates 404 phone_not_found as NotFoundError', async () => {
    const req = mkRequester(async () => {
      throw new NotFoundError({ message: 'no', code: 'phone_not_found', status: 404 });
    });
    const error = await listTemplates(req, { phoneNumberId: '1' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).code).toBe('phone_not_found');
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
      toPhone: '+12025550123',
      templateName: 'hello_world',
      templateLanguage: 'en',
      templateParams: ['Alice'],
    });

    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.path).toBe('/messages/template');
    expect(calls[0]!.idempotent).toBe(true);
    expect(calls[0]!.body).toEqual({
      phone_number_id: 'PNID',
      to_phone: '+12025550123',
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

describe('messages.sendText resource', () => {
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

  it('maps a null template name for a free-form text reply', async () => {
    const req = mkRequester(async <T>() => ({
      success: true,
      data: {
        id: 'msg_text', provider_msg_id: 'wa_text', status: 'sent', sent_at: '2026-07-21T00:00:00Z',
        template_name: null, to_phone: '+1', channel: 'whatsapp', provider: 'meta',
        error: null, delivered_at: null, read_at: null, failed_at: null, last_status: 'sent',
      },
    }) as unknown as T);

    const out = await getMessage(req, 'wa_text');

    expect(out.templateName).toBeNull();
  });

  it('maps the five newly nullable fields as null without throwing', async () => {
    const req = mkRequester(async <T>() => ({
      success: true,
      data: {
        id: '98765', provider_msg_id: 'wamid.FAKE_0001', status: null, sent_at: null,
        template_name: null, to_phone: null, channel: null, provider: null,
        error: null, delivered_at: null, read_at: null, failed_at: null, last_status: null,
      },
    }) as unknown as T);

    const out = await getMessage(req, 'wamid.FAKE_0001');

    expect(out).toEqual({
      id: '98765', providerMsgId: 'wamid.FAKE_0001', status: null, sentAt: null,
      templateName: null, toPhone: null, channel: null, provider: null,
      error: null, deliveredAt: null, readAt: null, failedAt: null, lastStatus: null,
    });
  });

  it('maps missing nullable keys to null', async () => {
    const req = mkRequester(async <T>() => ({ success: true, data: { id: '7' } }) as unknown as T);
    const out = await getMessage(req, 'wamid.FAKE_0002');
    expect(out).toEqual({
      id: '7', providerMsgId: null, status: null, sentAt: null,
      templateName: null, toPhone: null, channel: null, provider: null,
      error: null, deliveredAt: null, readAt: null, failedAt: null, lastStatus: null,
    });
  });

  it('coerces a numeric id to a string and leaves a string id unchanged', async () => {
    const mk = (id: unknown) => mkRequester(async <T>() => ({
      success: true,
      data: { id, provider_msg_id: 'wamid.FAKE_0003', status: 'delivered' },
    }) as unknown as T);

    expect((await getMessage(mk(98765), 'wamid.FAKE_0003')).id).toBe('98765');
    expect((await getMessage(mk('98765'), 'wamid.FAKE_0003')).id).toBe('98765');
  });

  it('passes an unknown status string through', async () => {
    const req = mkRequester(async <T>() => ({
      success: true, data: { id: '1', status: 'queued' },
    }) as unknown as T);
    expect((await getMessage(req, 'wamid.FAKE_0004')).status).toBe('queued');
  });

  it('propagates NotFoundError from request layer', async () => {
    const req = mkRequester(async () => {
      throw new NotFoundError({ message: 'not found', code: 'message_not_found', status: 404 });
    });
    await expect(getMessage(req, 'missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});
