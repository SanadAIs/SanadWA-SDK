/**
 * Private helpers shared by the resources. Not exported from the package.
 */

import { SanadApiError, ValidationError } from '../errors.js';
import type { DeletedResource, ListOptions, Page } from '../resource-types.js';

export type WireRecord = Record<string, unknown>;

export type QueryValue = string | number | boolean | undefined;

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]+$/;
const IDEMPOTENCY_KEY_MAX_LENGTH = 120;

/** Throws `invalid_idempotency_key` unless the key is absent or 1 to 120 visible ASCII characters. */
export const assertIdempotencyKey = (idempotencyKey: string | undefined): void => {
  if (idempotencyKey === undefined) return;
  if (
    typeof idempotencyKey !== 'string'
    || idempotencyKey.length === 0
    || idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH
    || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
  ) {
    throw new ValidationError({
      message: '`idempotencyKey` must contain 1 to 120 visible ASCII characters.',
      code: 'invalid_idempotency_key',
      status: 0,
    });
  }
};

/**
 * Request options every non-GET call spreads in: the requester sends one
 * `Idempotency-Key` header (the caller's value, or a UUID it generates) and
 * reuses it on retries.
 */
export const writeOptions = (
  idempotencyKey: string | undefined,
): { idempotent: true; idempotencyKey?: string } => {
  assertIdempotencyKey(idempotencyKey);
  return idempotencyKey === undefined ? { idempotent: true } : { idempotent: true, idempotencyKey };
};

/** True when the response says it repeats an earlier call made with the same `Idempotency-Key`. */
export const isIdempotentReplay = (headers: Headers): boolean =>
  headers.get('x-idempotent-replay')?.trim().toLowerCase() === 'true';

/** Validates a path id and returns it as an encoded path segment. */
export const idSegment = (id: string): string => {
  const value: unknown = id;
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  if (text.length === 0) {
    throw new ValidationError({
      message: '`id` must not be empty.',
      code: 'invalid_id',
      status: 0,
    });
  }
  return encodeURIComponent(text);
};

/**
 * Builds the query of a paged call. Values are passed through as given (the
 * API replaces bad ones); returns `undefined` when nothing is set.
 */
export const pageQuery = (
  opts: ListOptions = {},
  extra: Record<string, QueryValue> = {},
): Record<string, QueryValue> | undefined => {
  const query: Record<string, QueryValue> = {};
  if (opts.page !== undefined) query.page = opts.page;
  if (opts.limit !== undefined) query.limit = opts.limit;
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) query[key] = value;
  }
  return Object.keys(query).length > 0 ? query : undefined;
};

// ── Wire readers ────────────────────────────────────────────────────────────
//
// Every field is read with the same rule as the PHP SDK: a required field
// that is missing or mistyped, or a nullable field that is mistyped, throws
// `malformed_response`. A missing or null nullable field reads as `null`.
// `field` is the path the error names, written like PHP's (`data[0].name`).

/** Throws the error for a 2xx answer the SDK cannot read. */
export const malformed = (field: string, reason: string): never => {
  throw new SanadApiError({
    message: `Malformed response: field \`${field}\` ${reason}.`,
    code: 'malformed_response',
    status: 0,
  });
};

const isRecord = (value: unknown): value is WireRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isAbsent = (value: unknown): value is null | undefined => value === undefined || value === null;

const refuse = (value: unknown, field: string, reason: string): never =>
  malformed(field, value === undefined ? 'is missing' : reason);

/** A required object. */
export const toRecord = (value: unknown, field: string): WireRecord =>
  isRecord(value) ? value : refuse(value, field, 'must be an object');

/** A nested object; missing or null gives `null`. */
export const toRecordOrNull = (value: unknown, field: string): WireRecord | null =>
  isAbsent(value) ? null : toRecord(value, field);

/** A required array of objects, each mapped with its own path (`field[i]`). */
export const toRecordList = <T>(
  value: unknown,
  field: string,
  mapRow: (row: WireRecord, rowField: string) => T,
): T[] => {
  if (!Array.isArray(value)) return refuse(value, field, 'must be an array');
  return value.map((row, index) => {
    const rowField = `${field}[${index}]`;
    return mapRow(toRecord(row, rowField), rowField);
  });
};

/** A required integer. */
export const toInteger = (value: unknown, field: string): number =>
  typeof value === 'number' && Number.isInteger(value) ? value : refuse(value, field, 'must be an integer');

/** A required finite number. Numeric strings are refused, as in PHP. */
export const toNumber = (value: unknown, field: string): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : refuse(value, field, 'must be a number');

/** A finite number; missing or null gives `null`. */
export const toNullableNumber = (value: unknown, field: string): number | null =>
  isAbsent(value) ? null : typeof value === 'number' && Number.isFinite(value)
    ? value
    : malformed(field, 'must be a number or null');

export const toBoolean = (value: unknown, field: string): boolean =>
  typeof value === 'boolean' ? value : refuse(value, field, 'must be a boolean');

/** A required string that is passed through as sent. */
export const toRequiredString = (value: unknown, field: string): string =>
  typeof value === 'string' ? value : refuse(value, field, 'must be a string');

/** A string; missing or null gives `null`. */
export const toNullableString = (value: unknown, field: string): string | null =>
  isAbsent(value) ? null : typeof value === 'string' ? value : malformed(field, 'must be a string or null');

const isWireNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A required id. Ids arrive as strings of digits or as numbers; the SDK exposes strings. */
export const toId = (value: unknown, field = 'id'): string =>
  typeof value === 'string' || isWireNumber(value)
    ? String(value)
    : refuse(value, field, 'must be a string or number');

/** An id; missing or null gives `null`. */
export const toNullableId = (value: unknown, field: string): string | null =>
  isAbsent(value) ? null : typeof value === 'string' || isWireNumber(value)
    ? String(value)
    : malformed(field, 'must be a string, a number or null');

/** A required array of strings. */
export const toStringList = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value)) return refuse(value, field, 'must be an array of strings');
  return value.map((item, index) =>
    typeof item === 'string' ? item : malformed(`${field}[${index}]`, 'must be a string'));
};

/** Like `toStringList`, but missing or null gives `[]`. */
export const toOptionalStringList = (value: unknown, field: string): string[] =>
  isAbsent(value) ? [] : toStringList(value, field);

const toBody = (raw: unknown): WireRecord => toRecord(raw, 'body');

/** The `data` object of a `{ success, data: { ... } }` answer. */
export const toDataRecord = (raw: unknown): WireRecord => toRecord(toBody(raw).data, 'data');

/** The `data` array of a `{ success, data: [ ... ] }` answer, each row mapped with its path. */
export const toDataList = <T>(raw: unknown, mapRow: (row: WireRecord, rowField: string) => T): T[] =>
  toRecordList(toBody(raw).data, 'data', mapRow);

/** Maps `{ page, limit, data: [...] }`; `page` and `limit` are the values the server used. */
export const toPage = <T>(raw: unknown, mapRow: (row: WireRecord, rowField: string) => T): Page<T> => {
  const body = toBody(raw);
  const data = toRecordList(body.data, 'data', mapRow);
  return {
    page: toInteger(body.page, 'page'),
    limit: toInteger(body.limit, 'limit'),
    data,
  };
};

/** Maps `{ data: { id, deleted } }`. */
export const toDeletedResource = (raw: unknown): DeletedResource => {
  const data = toDataRecord(raw);
  return { id: toId(data.id, 'data.id'), deleted: toBoolean(data.deleted, 'data.deleted') };
};
