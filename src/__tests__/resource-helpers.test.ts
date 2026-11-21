import { describe, it, expect } from 'vitest';
import {
  assertIdempotencyKey,
  idSegment,
  pageQuery,
  writeOptions,
  toPage,
  toRecord,
  toId,
  toNullableString,
  toNumber,
  toNullableNumber,
  toStringList,
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
  it('toRecord returns objects and {} for anything else', () => {
    expect(toRecord({ a: 1 })).toEqual({ a: 1 });
    expect(toRecord(null)).toEqual({});
    expect(toRecord([1])).toEqual({});
    expect(toRecord('x')).toEqual({});
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

  it('toNullableString maps missing and null to null', () => {
    expect(toNullableString('x')).toBe('x');
    expect(toNullableString(null)).toBeNull();
    expect(toNullableString(undefined)).toBeNull();
    expect(toNullableString(5)).toBeNull();
  });

  it('toNumber and toNullableNumber', () => {
    expect(toNumber(3)).toBe(3);
    expect(toNumber('3')).toBe(3);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber('abc')).toBe(0);
    expect(toNullableNumber(1.5)).toBe(1.5);
    expect(toNullableNumber(0)).toBe(0);
    expect(toNullableNumber(null)).toBeNull();
    expect(toNullableNumber(undefined)).toBeNull();
    expect(toNullableNumber('')).toBeNull();
  });

  it('toStringList keeps strings only and returns [] for a non-array', () => {
    expect(toStringList(['a', 'b'])).toEqual(['a', 'b']);
    expect(toStringList(['a', 1, null])).toEqual(['a']);
    expect(toStringList(undefined)).toEqual([]);
  });

  it('toPage takes page and limit from the response and maps each row', () => {
    const page = toPage({ success: true, page: 2, limit: 10, data: [{ n: 1 }, { n: 2 }] }, (row) => toNumber(row.n) * 10);
    expect(page).toEqual({ page: 2, limit: 10, data: [10, 20] });
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
    expect(toDataList({ success: true, data: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(caught(() => toDataRecord({ success: true }))).toMatchObject({ code: 'malformed_response' });
    expect(caught(() => toDataRecord({ data: [] }))).toMatchObject({ code: 'malformed_response' });
    expect(caught(() => toDataList({ data: {} }))).toMatchObject({ code: 'malformed_response' });
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
