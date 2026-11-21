/**
 * Private helpers shared by the resources. Not exported from the package.
 */

import { ValidationError } from '../errors.js';
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

export const toRecord = (value: unknown): WireRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as WireRecord) : {};

export const toRecordOrNull = (value: unknown): WireRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as WireRecord) : null;

export const toRecordList = (value: unknown): WireRecord[] =>
  Array.isArray(value) ? value.map(toRecord) : [];

/** Ids arrive as strings of digits or as numbers; the SDK exposes strings. */
export const toId = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

export const toNullableId = (value: unknown): string | null =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : null;

export const toText = (value: unknown): string => (typeof value === 'string' ? value : '');

export const toNullableString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

export const toNullableNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const toNumber = (value: unknown): number => toNullableNumber(value) ?? 0;

export const toStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** Maps `{ page, limit, data: [...] }`; `page` and `limit` are the values the server used. */
export const toPage = <T>(raw: unknown, mapRow: (row: WireRecord) => T): Page<T> => {
  const body = toRecord(raw);
  return {
    page: toNumber(body.page),
    limit: toNumber(body.limit),
    data: toRecordList(body.data).map(mapRow),
  };
};

/** Maps `{ data: { id, deleted } }`. */
export const toDeletedResource = (raw: unknown): DeletedResource => {
  const data = toRecord(toRecord(raw).data);
  return { id: toId(data.id), deleted: data.deleted === true };
};
