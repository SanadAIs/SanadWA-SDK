import { describe, it, expect, vi } from 'vitest';
import { TagsResource } from '../resources/tags.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { createRequester } from '../request.js';
import type { Requester, RequestOptions } from '../request.js';

const fakeRequester = (response: unknown) => {
  const calls: RequestOptions[] = [];
  const fn = vi.fn(async (opts: RequestOptions) => {
    calls.push(opts);
    return response;
  });
  return { req: fn as unknown as Requester, calls, fn };
};

const tagWire = { id: '7', name: 'vip', description: 'Top customers', created_at: '2026-11-21T10:00:00.000Z' };

describe('tags.list', () => {
  it('GETs /tags with no query when no options are given', async () => {
    const { req, calls } = fakeRequester({ success: true, page: 1, limit: 50, data: [] });
    await new TagsResource(req).list();
    expect(calls).toEqual([{ method: 'GET', path: '/tags' }]);
  });

  it('sends no query for an empty options object', async () => {
    const { req, calls } = fakeRequester({ success: true, page: 1, limit: 50, data: [] });
    await new TagsResource(req).list({});
    expect(calls[0]).toEqual({ method: 'GET', path: '/tags' });
  });

  it('passes page and limit through verbatim', async () => {
    const { req, calls } = fakeRequester({ success: true, page: 3, limit: 200, data: [] });
    await new TagsResource(req).list({ page: 3, limit: 200 });
    expect(calls[0]!.query).toEqual({ page: 3, limit: 200 });
  });

  it('does not clamp the limit, and reports the page and limit the server used', async () => {
    const { req, calls } = fakeRequester({ success: true, page: 1, limit: 200, data: [] });
    const out = await new TagsResource(req).list({ limit: 500 });
    expect(calls[0]!.query).toEqual({ limit: 500 });
    expect(out).toEqual({ page: 1, limit: 200, data: [] });
  });

  it('maps the page and each tag', async () => {
    const { req } = fakeRequester({
      success: true,
      page: 2,
      limit: 2,
      data: [tagWire, { id: 8, name: 'new', description: null, created_at: null }, { id: '9', name: 'bare' }],
    });
    expect(await new TagsResource(req).list({ page: 2, limit: 2 })).toEqual({
      page: 2,
      limit: 2,
      data: [
        { id: '7', name: 'vip', description: 'Top customers', createdAt: '2026-11-21T10:00:00.000Z' },
        { id: '8', name: 'new', description: null, createdAt: null },
        { id: '9', name: 'bare', description: null, createdAt: null },
      ],
    });
  });

  it('works when detached', async () => {
    const { req, calls } = fakeRequester({ success: true, page: 1, limit: 50, data: [] });
    const { list } = new TagsResource(req);
    await list({ page: 2 });
    expect(calls[0]).toEqual({ method: 'GET', path: '/tags', query: { page: 2 } });
  });
});

describe('tags.create', () => {
  it('POSTs /tags with body {name} and asks for a generated Idempotency-Key', async () => {
    const { req, calls } = fakeRequester({ success: true, data: tagWire });
    await new TagsResource(req).create({ name: 'vip' });
    expect(calls).toEqual([{ method: 'POST', path: '/tags', body: { name: 'vip' }, idempotent: true }]);
  });

  it('sends description when set, and null as null', async () => {
    const { req, calls } = fakeRequester({ success: true, data: tagWire });
    const tags = new TagsResource(req);
    await tags.create({ name: 'vip', description: 'Top customers' });
    await tags.create({ name: 'vip', description: null });
    expect(calls[0]!.body).toEqual({ name: 'vip', description: 'Top customers' });
    expect(calls[1]!.body).toEqual({ name: 'vip', description: null });
  });

  it('passes the caller key as the header value and never in the body', async () => {
    const { req, calls } = fakeRequester({ success: true, data: tagWire });
    await new TagsResource(req).create({ name: 'vip', idempotencyKey: 'tag-create-0001' });
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/tags',
      body: { name: 'vip' },
      idempotent: true,
      idempotencyKey: 'tag-create-0001',
    });
    expect(calls[0]!.body).not.toHaveProperty('idempotency_key');
    expect(calls[0]!.body).not.toHaveProperty('idempotencyKey');
  });

  it('maps the 201 response', async () => {
    const { req } = fakeRequester({ success: true, data: tagWire });
    expect(await new TagsResource(req).create({ name: 'vip' })).toEqual({
      id: '7',
      name: 'vip',
      description: 'Top customers',
      createdAt: '2026-11-21T10:00:00.000Z',
    });
  });

  it('rejects an invalid caller key before any HTTP', async () => {
    const { req, fn } = fakeRequester({ success: true, data: tagWire });
    const promise = new TagsResource(req).create({ name: 'vip', idempotencyKey: 'bad key' });
    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    await expect(promise).rejects.toMatchObject({ code: 'invalid_idempotency_key', status: 0 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('rethrows the requester error unchanged', async () => {
    const failure = new ValidationError({ message: 'exists', code: 'tag_already_exists', status: 409 });
    const req = vi.fn(async () => { throw failure; }) as unknown as Requester;
    await expect(new TagsResource(req).create({ name: 'vip' })).rejects.toBe(failure);
  });
});

describe('tags.delete', () => {
  it('DELETEs /tags/42 with no body and an Idempotency-Key', async () => {
    const { req, calls } = fakeRequester({ success: true, data: { id: '42', deleted: true } });
    const out = await new TagsResource(req).delete('42');
    expect(calls).toEqual([{ method: 'DELETE', path: '/tags/42', idempotent: true }]);
    expect(out).toEqual({ id: '42', deleted: true });
  });

  it('passes the caller key', async () => {
    const { req, calls } = fakeRequester({ success: true, data: { id: '42', deleted: true } });
    await new TagsResource(req).delete('42', { idempotencyKey: 'tag-delete-0001' });
    expect(calls[0]).toEqual({ method: 'DELETE', path: '/tags/42', idempotent: true, idempotencyKey: 'tag-delete-0001' });
  });

  it('encodes the id', async () => {
    const { req, calls } = fakeRequester({ success: true, data: { id: '42', deleted: true } });
    await new TagsResource(req).delete('4/2');
    expect(calls[0]!.path).toBe('/tags/4%2F2');
  });

  it('rejects an empty id before any HTTP', async () => {
    const { req, fn } = fakeRequester({});
    const promise = new TagsResource(req).delete('');
    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    await expect(promise).rejects.toMatchObject({ code: 'invalid_id', status: 0 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects an invalid caller key before any HTTP', async () => {
    const { req, fn } = fakeRequester({});
    await expect(new TagsResource(req).delete('42', { idempotencyKey: '' }))
      .rejects.toMatchObject({ code: 'invalid_idempotency_key', status: 0 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('rethrows the requester error unchanged', async () => {
    const failure = new NotFoundError({ message: 'no tag', code: 'tag_not_found', status: 404 });
    const req = vi.fn(async () => { throw failure; }) as unknown as Requester;
    await expect(new TagsResource(req).delete('42')).rejects.toBe(failure);
  });
});

describe('tags writes through the real requester', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  const realRequester = (status: number, json: unknown) => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } }));
    const req = createRequester({
      apiKey: 'pk_test_fake_key',
      baseUrl: 'https://api.example.test/v1',
      retries: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      userAgent: 'test',
    });
    const sent = () => {
      const [url, init] = fetchImpl.mock.calls[0]!;
      return { url: String(url), init: init!, headers: init!.headers as Record<string, string> };
    };
    return { req, sent };
  };

  it('create sends a generated UUID v4 Idempotency-Key header and a body without the key', async () => {
    const { req, sent } = realRequester(201, { success: true, data: tagWire });
    const tag = await new TagsResource(req).create({ name: 'vip' });
    expect(tag.id).toBe('7');
    expect(sent().url).toBe('https://api.example.test/v1/tags');
    expect(sent().init.method).toBe('POST');
    expect(sent().headers['Idempotency-Key']).toMatch(UUID_V4);
    expect(JSON.parse(String(sent().init.body))).toEqual({ name: 'vip' });
  });

  it('create sends the exact caller key', async () => {
    const { req, sent } = realRequester(201, { success: true, data: tagWire });
    await new TagsResource(req).create({ name: 'vip', idempotencyKey: 'tag-create-0001' });
    expect(sent().headers['Idempotency-Key']).toBe('tag-create-0001');
    expect(JSON.parse(String(sent().init.body))).toEqual({ name: 'vip' });
  });

  it('delete sends an Idempotency-Key header and no body', async () => {
    const { req, sent } = realRequester(200, { success: true, data: { id: '42', deleted: true } });
    await new TagsResource(req).delete('42');
    expect(sent().url).toBe('https://api.example.test/v1/tags/42');
    expect(sent().init.method).toBe('DELETE');
    expect(sent().headers['Idempotency-Key']).toMatch(UUID_V4);
    expect(sent().init.body).toBeUndefined();
    expect(sent().headers['Content-Type']).toBeUndefined();
  });

  it('list sends no Idempotency-Key header', async () => {
    const { req, sent } = realRequester(200, { success: true, page: 1, limit: 50, data: [] });
    await new TagsResource(req).list({ page: 2, limit: 10 });
    expect(sent().url).toBe('https://api.example.test/v1/tags?page=2&limit=10');
    expect(sent().headers['Idempotency-Key']).toBeUndefined();
  });

  it('a 404 from the API surfaces as NotFoundError with the API code', async () => {
    const { req } = realRequester(404, { success: false, code: 'tag_not_found', message: 'No tag with this id exists in your account.' });
    const promise = new TagsResource(req).delete('42');
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    await expect(promise).rejects.toMatchObject({ code: 'tag_not_found', status: 404 });
  });
});
