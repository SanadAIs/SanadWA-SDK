import { describe, it, expect, vi } from 'vitest';
import { ContactsResource } from '../resources/contacts.js';
import { NotFoundError, ValidationError } from '../errors.js';
import type { Requester, RequestOptions } from '../request.js';
import type { ContactInput } from '../resource-types.js';

type SentOptions = RequestOptions & { formData?: FormData };

const fakeRequester = (response: unknown) => {
  const calls: SentOptions[] = [];
  const fn = vi.fn(async (opts: SentOptions) => {
    calls.push(opts);
    return response;
  });
  return { req: fn as unknown as Requester, calls, fn };
};

const contactWire = {
  id: '501',
  phone: '+12025550123',
  first_name: 'Sara',
  last_name: 'Test',
  email: 'sara@example.test',
  tags: ['vip', 'riyadh'],
  created_at: '2026-11-20T08:00:00.000Z',
  updated_at: '2026-11-21T10:00:00.000Z',
};

const contactSdk = {
  id: '501',
  phone: '+12025550123',
  firstName: 'Sara',
  lastName: 'Test',
  email: 'sara@example.test',
  tags: ['vip', 'riyadh'],
  createdAt: '2026-11-20T08:00:00.000Z',
  updatedAt: '2026-11-21T10:00:00.000Z',
};

const emptyPage = { success: true, page: 1, limit: 50, data: [] };
const upsertOk = { success: true, data: { summary: { created: 0, updated: 0, rejected: 0, failed: 0 }, results: [] } };
const importOk = { success: true, data: { summary: { rows: 0, created: 0, updated: 0, rejected: 0, failed: 0 }, errors: [] } };

describe('contacts.list', () => {
  it('GETs /contacts with no query when no options are given', async () => {
    const { req, calls } = fakeRequester(emptyPage);
    await new ContactsResource(req).list();
    expect(calls).toEqual([{ method: 'GET', path: '/contacts' }]);
  });

  it('passes tag as the query key tag, with page and limit', async () => {
    const { req, calls } = fakeRequester(emptyPage);
    await new ContactsResource(req).list({ page: 3, limit: 200, tag: 'vip' });
    expect(calls[0]!.query).toEqual({ page: 3, limit: 200, tag: 'vip' });
  });

  it('omits tag when unset', async () => {
    const { req, calls } = fakeRequester(emptyPage);
    await new ContactsResource(req).list({ page: 2 });
    expect(calls[0]!.query).toEqual({ page: 2 });
  });

  it('does not clamp the limit, and reports the page and limit the server used', async () => {
    const { req, calls } = fakeRequester({ success: true, page: 1, limit: 200, data: [] });
    const out = await new ContactsResource(req).list({ limit: 500 });
    expect(calls[0]!.query).toEqual({ limit: 500 });
    expect(out).toEqual({ page: 1, limit: 200, data: [] });
  });

  it('maps contacts, nullable fields and the tags array', async () => {
    const { req } = fakeRequester({
      success: true,
      page: 1,
      limit: 50,
      data: [
        contactWire,
        { id: 502, phone: null, first_name: null, last_name: null, email: null, tags: [], created_at: null, updated_at: null },
        { id: '503' },
      ],
    });
    const out = await new ContactsResource(req).list();
    const nulls = { phone: null, firstName: null, lastName: null, email: null, tags: [], createdAt: null, updatedAt: null };
    expect(out.data).toEqual([contactSdk, { id: '502', ...nulls }, { id: '503', ...nulls }]);
  });

  it('rethrows the requester error unchanged', async () => {
    const failure = new ValidationError({ message: 'tag too long', code: 'validation_error', status: 400 });
    const req = vi.fn(async () => { throw failure; }) as unknown as Requester;
    await expect(new ContactsResource(req).list({ tag: 'x' })).rejects.toBe(failure);
  });

  it('works when detached', async () => {
    const { req, calls } = fakeRequester(emptyPage);
    const { list } = new ContactsResource(req);
    await list({ tag: 'vip' });
    expect(calls[0]).toEqual({ method: 'GET', path: '/contacts', query: { tag: 'vip' } });
  });
});

describe('contacts.upsert', () => {
  it('wraps a single input as {contacts:[one]} and asks for an Idempotency-Key', async () => {
    const { req, calls } = fakeRequester(upsertOk);
    await new ContactsResource(req).upsert({ phone: '+12025550123' });
    expect(calls).toEqual([{
      method: 'POST',
      path: '/contacts',
      body: { contacts: [{ phone: '+12025550123' }] },
      idempotent: true,
    }]);
  });

  it('keeps the order of a batch', async () => {
    const { req, calls } = fakeRequester(upsertOk);
    await new ContactsResource(req).upsert([{ phone: '+12025550123' }, { phone: '+12025550124' }, { phone: '+966500000000' }]);
    expect(calls[0]!.body).toEqual({
      contacts: [{ phone: '+12025550123' }, { phone: '+12025550124' }, { phone: '+966500000000' }],
    });
  });

  it('sends only the five allowed snake_case keys and omits unset ones', async () => {
    const { req, calls } = fakeRequester(upsertOk);
    const full = {
      phone: '+12025550123',
      firstName: 'Sara',
      lastName: 'Test',
      email: 'sara@example.test',
      tags: ['vip'],
      id: '999',
      tenantId: 't_1',
    } as ContactInput;
    await new ContactsResource(req).upsert([full, { phone: '+12025550124', firstName: 'Omar' }]);
    expect(calls[0]!.body).toEqual({
      contacts: [
        { phone: '+12025550123', first_name: 'Sara', last_name: 'Test', email: 'sara@example.test', tags: ['vip'] },
        { phone: '+12025550124', first_name: 'Omar' },
      ],
    });
  });

  it('sends null for firstName, lastName and email as null', async () => {
    const { req, calls } = fakeRequester(upsertOk);
    await new ContactsResource(req).upsert({ phone: '+12025550123', firstName: null, lastName: null, email: null });
    expect(calls[0]!.body).toEqual({
      contacts: [{ phone: '+12025550123', first_name: null, last_name: null, email: null }],
    });
  });

  it('passes the caller key as the header value and never in the body', async () => {
    const { req, calls } = fakeRequester(upsertOk);
    await new ContactsResource(req).upsert({ phone: '+12025550123' }, { idempotencyKey: 'contacts-0001' });
    expect(calls[0]!.idempotent).toBe(true);
    expect(calls[0]!.idempotencyKey).toBe('contacts-0001');
    expect(calls[0]!.body).toEqual({ contacts: [{ phone: '+12025550123' }] });
  });

  it('maps a mixed result and does not throw for item errors', async () => {
    const { req } = fakeRequester({
      success: true,
      data: {
        summary: { created: 1, updated: 1, rejected: 1, failed: 1 },
        results: [
          { index: 0, status: 'created', contact: contactWire, error: null },
          { index: 1, status: 'updated', contact: { ...contactWire, id: 502 }, error: null },
          { index: 2, status: 'rejected', contact: null, error: { code: 'tag_not_found', message: 'These tags are not in your account\'s tag list: nope.' } },
          { index: 3, status: 'failed', contact: null, error: { code: 'contact_write_failed', message: 'This contact could not be saved. Retry it.' } },
        ],
      },
    });
    const out = await new ContactsResource(req).upsert([
      { phone: '+12025550123' }, { phone: '+12025550124' }, { phone: '+966500000000', tags: ['nope'] }, { phone: '+12025550125' },
    ]);
    expect(out).toEqual({
      summary: { created: 1, updated: 1, rejected: 1, failed: 1 },
      results: [
        { index: 0, status: 'created', contact: contactSdk, error: null },
        { index: 1, status: 'updated', contact: { ...contactSdk, id: '502' }, error: null },
        { index: 2, status: 'rejected', contact: null, error: { code: 'tag_not_found', message: 'These tags are not in your account\'s tag list: nope.' } },
        { index: 3, status: 'failed', contact: null, error: { code: 'contact_write_failed', message: 'This contact could not be saved. Retry it.' } },
      ],
    });
  });

  it('rejects 0 items before any HTTP', async () => {
    const { req, fn } = fakeRequester(upsertOk);
    const promise = new ContactsResource(req).upsert([]);
    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    await expect(promise).rejects.toMatchObject({ code: 'invalid_contacts', status: 0 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects 101 items before any HTTP', async () => {
    const { req, fn } = fakeRequester(upsertOk);
    const many = Array.from({ length: 101 }, () => ({ phone: '+12025550123' }));
    await expect(new ContactsResource(req).upsert(many)).rejects.toMatchObject({ code: 'invalid_contacts', status: 0 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('sends exactly 100 items', async () => {
    const { req, calls } = fakeRequester(upsertOk);
    const many = Array.from({ length: 100 }, () => ({ phone: '+12025550123' }));
    await new ContactsResource(req).upsert(many);
    expect((calls[0]!.body as { contacts: unknown[] }).contacts).toHaveLength(100);
  });

  it('rejects an invalid caller key before any HTTP', async () => {
    const { req, fn } = fakeRequester(upsertOk);
    await expect(new ContactsResource(req).upsert({ phone: '+12025550123' }, { idempotencyKey: 'bad key' }))
      .rejects.toMatchObject({ code: 'invalid_idempotency_key', status: 0 });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('contacts.delete', () => {
  it('DELETEs /contacts/{id} with no body and an Idempotency-Key, and maps {id, deleted}', async () => {
    const { req, calls } = fakeRequester({ success: true, data: { id: '501', deleted: true } });
    const out = await new ContactsResource(req).delete('501');
    expect(calls).toEqual([{ method: 'DELETE', path: '/contacts/501', idempotent: true }]);
    expect(out).toEqual({ id: '501', deleted: true });
  });

  it('passes the caller key', async () => {
    const { req, calls } = fakeRequester({ success: true, data: { id: '501', deleted: true } });
    await new ContactsResource(req).delete('501', { idempotencyKey: 'contact-delete-0001' });
    expect(calls[0]!.idempotencyKey).toBe('contact-delete-0001');
  });

  it('rejects an empty id before any HTTP', async () => {
    const { req, fn } = fakeRequester({});
    await expect(new ContactsResource(req).delete('')).rejects.toMatchObject({ code: 'invalid_id', status: 0 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('rethrows the requester error unchanged', async () => {
    const failure = new NotFoundError({ message: 'no contact', code: 'contact_not_found', status: 404 });
    const req = vi.fn(async () => { throw failure; }) as unknown as Requester;
    await expect(new ContactsResource(req).delete('501')).rejects.toBe(failure);
  });
});

describe('contacts.import', () => {
  const CSV = 'phone,first_name\n+12025550123,Sara\n';
  const MAX_BYTES = 5_242_880;

  const filePart = (opts: SentOptions): File => opts.formData!.get('file') as File;
  const partNames = (opts: SentOptions): string[] => {
    const names: string[] = [];
    opts.formData!.forEach((_value, name) => names.push(name));
    return names;
  };

  it('POSTs /contacts/import as multipart with an Idempotency-Key and no JSON body', async () => {
    const { req, calls } = fakeRequester(importOk);
    await new ContactsResource(req).import({ file: CSV });
    expect(calls).toHaveLength(1);
    const sent = calls[0]!;
    expect(sent.method).toBe('POST');
    expect(sent.path).toBe('/contacts/import');
    expect(sent.idempotent).toBe(true);
    expect(sent).not.toHaveProperty('idempotencyKey');
    expect(sent).not.toHaveProperty('body');
    expect(sent.formData).toBeInstanceOf(FormData);
  });

  it('sends the file part as text/csv with the default filename', async () => {
    const { req, calls } = fakeRequester(importOk);
    await new ContactsResource(req).import({ file: CSV });
    const file = filePart(calls[0]!);
    expect(file.name).toBe('contacts.csv');
    expect(file.type).toBe('text/csv');
    expect(await file.text()).toBe(CSV);
  });

  it('honours a given filename', async () => {
    const { req, calls } = fakeRequester(importOk);
    await new ContactsResource(req).import({ file: CSV, filename: 'november-leads.csv' });
    expect(filePart(calls[0]!).name).toBe('november-leads.csv');
  });

  it('sends the tags part joined with a comma', async () => {
    const { req, calls } = fakeRequester(importOk);
    await new ContactsResource(req).import({ file: CSV, tags: ['vip', 'riyadh'] });
    expect(calls[0]!.formData!.get('tags')).toBe('vip,riyadh');
    expect(partNames(calls[0]!)).toEqual(['file', 'tags']);
  });

  it('sends no tags part when there are none', async () => {
    const { req, calls } = fakeRequester(importOk);
    const contacts = new ContactsResource(req);
    await contacts.import({ file: CSV });
    await contacts.import({ file: CSV, tags: [] });
    expect(partNames(calls[0]!)).toEqual(['file']);
    expect(partNames(calls[1]!)).toEqual(['file']);
  });

  it('accepts a Uint8Array', async () => {
    const { req, calls } = fakeRequester(importOk);
    await new ContactsResource(req).import({ file: new TextEncoder().encode(CSV) });
    const file = filePart(calls[0]!);
    expect(file.type).toBe('text/csv');
    expect(await file.text()).toBe(CSV);
  });

  it('accepts a Blob and sends it as text/csv whatever its own type', async () => {
    const { req, calls } = fakeRequester(importOk);
    await new ContactsResource(req).import({ file: new Blob([CSV], { type: 'application/octet-stream' }) });
    const file = filePart(calls[0]!);
    expect(file.type).toBe('text/csv');
    expect(await file.text()).toBe(CSV);
  });

  it('sends a string as UTF-8', async () => {
    const { req, calls } = fakeRequester(importOk);
    const arabic = 'phone,first_name\n+966500000000,سارة\n';
    await new ContactsResource(req).import({ file: arabic });
    const bytes = new Uint8Array(await filePart(calls[0]!).arrayBuffer());
    expect(bytes).toEqual(new TextEncoder().encode(arabic));
  });

  it('passes the caller key', async () => {
    const { req, calls } = fakeRequester(importOk);
    await new ContactsResource(req).import({ file: CSV, idempotencyKey: 'import-0001' });
    expect(calls[0]!.idempotent).toBe(true);
    expect(calls[0]!.idempotencyKey).toBe('import-0001');
  });

  it('maps summary.rows and errors[] and does not throw for row errors', async () => {
    const { req } = fakeRequester({
      success: true,
      data: {
        summary: { rows: 4, created: 2, updated: 0, rejected: 1, failed: 1 },
        errors: [
          { row: 3, status: 'rejected', code: 'validation_error', message: '"phone" is required.' },
          { row: 5, status: 'failed', code: 'contact_write_failed', message: 'This contact could not be saved. Retry it.' },
        ],
      },
    });
    expect(await new ContactsResource(req).import({ file: CSV })).toEqual({
      summary: { rows: 4, created: 2, updated: 0, rejected: 1, failed: 1 },
      errors: [
        { row: 3, status: 'rejected', code: 'validation_error', message: '"phone" is required.' },
        { row: 5, status: 'failed', code: 'contact_write_failed', message: 'This contact could not be saved. Retry it.' },
      ],
    });
  });

  it('rejects a file of 5 242 881 bytes before any HTTP', async () => {
    const { req, fn } = fakeRequester(importOk);
    const promise = new ContactsResource(req).import({ file: new Uint8Array(MAX_BYTES + 1) });
    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    await expect(promise).rejects.toMatchObject({ code: 'import_file_too_large', status: 0 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('sends a file of exactly 5 242 880 bytes', async () => {
    const { req, calls } = fakeRequester(importOk);
    await new ContactsResource(req).import({ file: new Uint8Array(MAX_BYTES) });
    expect(filePart(calls[0]!).size).toBe(MAX_BYTES);
  });

  it('measures a string in UTF-8 bytes, not characters', async () => {
    const { req, fn } = fakeRequester(importOk);
    // Each of these characters is two bytes in UTF-8.
    const text = 'س'.repeat(MAX_BYTES / 2 + 1);
    await expect(new ContactsResource(req).import({ file: text }))
      .rejects.toMatchObject({ code: 'import_file_too_large', status: 0 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects a tag containing a comma before any HTTP', async () => {
    const { req, fn } = fakeRequester(importOk);
    const promise = new ContactsResource(req).import({ file: CSV, tags: ['vip', 'a,b'] });
    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    await expect(promise).rejects.toMatchObject({ code: 'invalid_import_tags', status: 0 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects an invalid caller key before any HTTP', async () => {
    const { req, fn } = fakeRequester(importOk);
    await expect(new ContactsResource(req).import({ file: CSV, idempotencyKey: 'bad key' }))
      .rejects.toMatchObject({ code: 'invalid_idempotency_key', status: 0 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('rethrows the requester error unchanged', async () => {
    const failure = new NotFoundError({ message: 'no tag', code: 'tag_not_found', status: 404, details: { tags: ['nope'] } });
    const req = vi.fn(async () => { throw failure; }) as unknown as Requester;
    await expect(new ContactsResource(req).import({ file: CSV, tags: ['nope'] })).rejects.toBe(failure);
  });
});
