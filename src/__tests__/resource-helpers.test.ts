import { describe, it, expect } from 'vitest';
import {
  assertIdempotencyKey,
  idSegment,
  pageQuery,
  writeOptions,
  toPage,
  toRecord,
  toRecordOrNull,
  toId,
  toNullableId,
  toNullableString,
  toInteger,
  toNumber,
  toNullableNumber,
  toBoolean,
  toStringList,
  toOptionalStringList,
  toDeletedResource,
  toDataRecord,
  toDataList,
  toRequiredString,
} from '../resources/resource-helpers.js';
import { ValidationError } from '../errors.js';

const caught = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
};

describe('assertIdempotencyKey', () => {
  it('accepts undefined and 1 to 120 visible ASCII characters', () => {
    expect(() => assertIdempotencyKey(undefined)).not.toThrow();
    expect(() => assertIdempotencyKey('a')).not.toThrow();
    expect(() => assertIdempotencyKey('order-42_retry.1~!')).not.toThrow();
    expect(() => assertIdempotencyKey('k'.repeat(120))).not.toThrow();
  });

  it.each([
    ['empty', ''],
    ['121 characters', 'k'.repeat(121)],
    ['a space', 'has space'],
    ['a newline', 'line\nbreak'],
    ['non-ASCII', 'مفتاح'],
    ['not a string', 42 as unknown as string],
  ])('rejects %s with invalid_idempotency_key, status 0', (_label, key) => {
    const err = caught(() => assertIdempotencyKey(key));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toMatchObject({
      code: 'invalid_idempotency_key',
      status: 0,
      message: '`idempotencyKey` must contain 1 to 120 visible ASCII characters.',
    });
  });
});

describe('idSegment', () => {
  it('returns the id as an encoded path segment', () => {
    expect(idSegment('42')).toBe('42');
    expect(idSegment('a/b c')).toBe('a%2Fb%20c');
  });

  it('converts a number passed from plain JavaScript', () => {
    expect(idSegment(42 as unknown as string)).toBe('42');
  });

  it.each([
    ['empty string', ''],
    ['undefined', undefined],
    ['null', null],
    ['an object', {}],
  ])('rejects %s with invalid_id, status 0', (_label, id) => {
    const err = caught(() => idSegment(id as unknown as string));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toMatchObject({ code: 'invalid_id', status: 0 });
  });
});

describe('pageQuery', () => {
  it('returns undefined when nothing is set', () => {
    expect(pageQuery()).toBeUndefined();
    expect(pageQuery({})).toBeUndefined();
  });

  it('passes page and limit through without clamping', () => {
    expect(pageQuery({ page: 3, limit: 200 })).toEqual({ page: 3, limit: 200 });
    expect(pageQuery({ limit: 500 })).toEqual({ limit: 500 });
    expect(pageQuery({ page: 0 })).toEqual({ page: 0 });
  });

  it('adds extra keys only when they are set', () => {
    expect(pageQuery({ page: 2 }, { tag: 'vip' })).toEqual({ page: 2, tag: 'vip' });
    expect(pageQuery({}, { tag: undefined })).toBeUndefined();
  });
});

describe('writeOptions', () => {
  it('asks the requester for an Idempotency-Key and adds the caller value only when given', () => {
    expect(writeOptions(undefined)).toEqual({ idempotent: true });
    expect(writeOptions('caller-key-1')).toEqual({ idempotent: true, idempotencyKey: 'caller-key-1' });
  });

  it('validates the caller value', () => {
    expect(caught(() => writeOptions('bad key'))).toMatchObject({ code: 'invalid_idempotency_key' });
  });
});

describe('wire readers', () => {
  it('toRecord requires an object; toRecordOrNull also takes missing and null', () => {
    expect(toRecord({ a: 1 }, 'f')).toEqual({ a: 1 });
    expect(caught(() => toRecord(undefined, 'f'))).toMatchObject({ message: 'Malformed response: field `f` is missing.' });
    expect(caught(() => toRecord(null, 'f'))).toMatchObject({ message: 'Malformed response: field `f` must be an object.' });
    expect(caught(() => toRecord([1], 'f'))).toMatchObject({ code: 'malformed_response' });
    expect(toRecordOrNull(undefined, 'f')).toBeNull();
    expect(toRecordOrNull(null, 'f')).toBeNull();
    expect(caught(() => toRecordOrNull('x', 'f'))).toMatchObject({ code: 'malformed_response' });
  });

  it('toId coerces strings and numbers', () => {
    expect(toId('7')).toBe('7');
    expect(toId(7)).toBe('7');
  });

  it('toId throws malformed_response for a missing or mistyped id', () => {
    expect(caught(() => toId(undefined))).toMatchObject({
      code: 'malformed_response',
      status: 0,
      message: 'Malformed response: field `id` is missing.',
    });
    expect(caught(() => toId(null, 'data.id'))).toMatchObject({
      code: 'malformed_response',
      message: 'Malformed response: field `data.id` must be a string or number.',
    });
  });

  it('toNullableString and toNullableId map missing and null to null and refuse other types', () => {
    expect(toNullableString('x', 'f')).toBe('x');
    expect(toNullableString(null, 'f')).toBeNull();
    expect(toNullableString(undefined, 'f')).toBeNull();
    expect(caught(() => toNullableString(5, 'f')))
      .toMatchObject({ code: 'malformed_response', message: 'Malformed response: field `f` must be a string or null.' });
    expect(toNullableId(7, 'f')).toBe('7');
    expect(toNullableId(undefined, 'f')).toBeNull();
    expect(caught(() => toNullableId(true, 'f'))).toMatchObject({ code: 'malformed_response' });
  });

  it('toInteger, toNumber and toNullableNumber refuse numeric strings, as the PHP SDK does', () => {
    expect(toInteger(3, 'f')).toBe(3);
    expect(caught(() => toInteger(1.5, 'f'))).toMatchObject({ message: 'Malformed response: field `f` must be an integer.' });
    expect(caught(() => toInteger('3', 'f'))).toMatchObject({ code: 'malformed_response' });
    expect(toNumber(1.5, 'f')).toBe(1.5);
    expect(caught(() => toNumber('3', 'f'))).toMatchObject({ message: 'Malformed response: field `f` must be a number.' });
    expect(caught(() => toNumber(undefined, 'f'))).toMatchObject({ message: 'Malformed response: field `f` is missing.' });
    expect(toNullableNumber(0, 'f')).toBe(0);
    expect(toNullableNumber(null, 'f')).toBeNull();
    expect(toNullableNumber(undefined, 'f')).toBeNull();
    expect(caught(() => toNullableNumber('', 'f'))).toMatchObject({ code: 'malformed_response' });
  });

  it('toBoolean accepts only booleans', () => {
    expect(toBoolean(false, 'f')).toBe(false);
    expect(caught(() => toBoolean(1, 'f'))).toMatchObject({ message: 'Malformed response: field `f` must be a boolean.' });
  });

  it('toStringList requires an array of strings; toOptionalStringList also takes missing and null', () => {
    expect(toStringList(['a', 'b'], 'f')).toEqual(['a', 'b']);
    expect(caught(() => toStringList(['a', 1], 'f'))).toMatchObject({ message: 'Malformed response: field `f[1]` must be a string.' });
    expect(caught(() => toStringList(undefined, 'f'))).toMatchObject({ message: 'Malformed response: field `f` is missing.' });
    expect(toOptionalStringList(undefined, 'f')).toEqual([]);
    expect(toOptionalStringList(null, 'f')).toEqual([]);
    expect(caught(() => toOptionalStringList('a', 'f'))).toMatchObject({ code: 'malformed_response' });
  });

  it('toPage takes page and limit from the response and maps each row with its path', () => {
    const page = toPage(
      { success: true, page: 2, limit: 10, data: [{ n: 1 }, { n: 2 }] },
      (row, field) => `${field}:${toInteger(row.n, `${field}.n`) * 10}`,
    );
    expect(page).toEqual({ page: 2, limit: 10, data: ['data[0]:10', 'data[1]:20'] });
  });

  it.each([
    ['a missing data array', { page: 1, limit: 50 }, 'data'],
    ['data that is not an array', { page: 1, limit: 50, data: {} }, 'data'],
    ['a row that is not an object', { page: 1, limit: 50, data: ['x'] }, 'data[0]'],
    ['a missing page', { limit: 50, data: [] }, 'page'],
    ['a missing limit', { page: 1, data: [] }, 'limit'],
    ['a limit that is not a number', { page: 1, limit: '50', data: [] }, 'limit'],
    ['a body that is not an object', 'ok', 'body'],
  ])('toPage throws malformed_response for %s', (_name, body, field) => {
    const err = caught(() => toPage(body, (row) => row));
    expect(err).toMatchObject({ code: 'malformed_response', status: 0 });
    expect((err as Error).message).toContain(`\`${field}\``);
  });

  it('toPage never returns the 0/0/[] page that would loop a paging caller forever', () => {
    expect(caught(() => toPage({ success: true }, (row) => row))).toMatchObject({ code: 'malformed_response' });
  });

  it('toDataRecord and toDataList read the data envelope strictly', () => {
    expect(toDataRecord({ success: true, data: { a: 1 } })).toEqual({ a: 1 });
    expect(toDataList({ success: true, data: [{ a: 1 }] }, (row) => row)).toEqual([{ a: 1 }]);
    expect(caught(() => toDataRecord({ success: true }))).toMatchObject({ code: 'malformed_response' });
    expect(caught(() => toDataRecord({ data: [] }))).toMatchObject({ code: 'malformed_response' });
    expect(caught(() => toDataList({ data: {} }, (row) => row))).toMatchObject({ code: 'malformed_response' });
  });

  it('toRequiredString passes any string through and refuses the rest', () => {
    expect(toRequiredString('trial', 'data.billing_type')).toBe('trial');
    expect(caught(() => toRequiredString(undefined, 'data.billing_type'))).toMatchObject({
      code: 'malformed_response',
      message: 'Malformed response: field `data.billing_type` is missing.',
    });
  });

  it('toDeletedResource reads data.id and data.deleted', () => {
    expect(toDeletedResource({ success: true, data: { id: 42, deleted: true } })).toEqual({ id: '42', deleted: true });
    expect(toDeletedResource({ success: true, data: { id: '42', deleted: false } })).toEqual({ id: '42', deleted: false });
    expect(caught(() => toDeletedResource({ success: true, data: { id: '42' } })))
      .toMatchObject({ code: 'malformed_response' });
    expect(caught(() => toDeletedResource({ success: true })))
      .toMatchObject({ code: 'malformed_response' });
  });
});
