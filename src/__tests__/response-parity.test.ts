/**
 * Every response field of the new resources is read with the same rule as the
 * PHP SDK (`php/src/Resources/*.php`): a missing or mistyped required field,
 * or a mistyped nullable one, throws `SanadApiError` `malformed_response`
 * with status 0 and the PHP field path; a missing or null nullable field is
 * accepted.
 */
import { describe, it, expect, vi } from 'vitest';
import { SanadApiError, SanadWhatsApp } from '../index.js';
import { PhoneNumbersResource } from '../resources/phone-numbers.js';
import { BalanceResource } from '../resources/balance.js';
import { TagsResource } from '../resources/tags.js';
import { ContactsResource } from '../resources/contacts.js';
import { CampaignsResource } from '../resources/campaigns.js';
import type { Requester } from '../request.js';

type Kind =
  | 'string' | 'nullableString'
  | 'id' | 'nullableId'
  | 'int' | 'number' | 'nullableNumber' | 'bool'
  | 'object' | 'nullableObject' | 'list'
  | 'stringList' | 'optionalStringList';

type Path = (string | number)[];

interface FieldCase { path: Path; kind: Kind }

const NULLABLE: ReadonlySet<Kind> = new Set<Kind>([
  'nullableString', 'nullableId', 'nullableNumber', 'nullableObject', 'optionalStringList',
]);

const WRONG_TYPE: Record<Kind, unknown> = {
  string: 7,
  nullableString: 7,
  id: true,
  nullableId: true,
  int: '1',
  number: '1',
  nullableNumber: '1',
  bool: 1,
  object: 'x',
  nullableObject: 'x',
  list: 'x',
  stringList: 'vip',
  optionalStringList: 'vip',
};

/**
 * Extra values per kind beyond "missing", "wrong type" and null:
 * [name, value, accepted, suffix of the field the error names].
 */
const EXTRA: Partial<Record<Kind, [string, unknown, boolean, string?][]>> = {
  id: [['a number', 42, true]],
  nullableId: [['a number', 42, true]],
  int: [['a fraction', 1.5, false]],
  stringList: [['a non-string item', ['vip', 3], false, '[1]']],
  optionalStringList: [['a non-string item', ['vip', 3], false, '[1]']],
};

/** The field path as the PHP SDK writes it: `data[0].counts.total`. */
const label = (path: Path): string =>
  path.map((part, i) => (typeof part === 'number' ? `[${part}]` : i === 0 ? part : `.${part}`)).join('');

const mutate = (body: unknown, path: Path, change: { remove: true } | { value: unknown }): unknown => {
  const copy = structuredClone(body) as Record<string | number, unknown>;
  let node = copy;
  for (const part of path.slice(0, -1)) node = node[part] as Record<string | number, unknown>;
  const last = path[path.length - 1]!;
  if ('remove' in change) delete node[last];
  else node[last] = change.value;
  return copy;
};

const fakeRequester = (response: unknown) => {
  const fn = vi.fn(async () => response);
  return { req: fn as unknown as Requester, fn };
};

type Call = (req: Requester) => Promise<unknown>;

interface Variant { name: string; body: unknown; accepted: boolean; field: string }

const variants = (valid: unknown, fields: FieldCase[]): Variant[] => fields.flatMap(({ path, kind }) => {
  const field = label(path);
  const nullable = NULLABLE.has(kind);
  const out: Variant[] = [
    { name: `${field} missing`, body: mutate(valid, path, { remove: true }), accepted: nullable, field },
    { name: `${field} null`, body: mutate(valid, path, { value: null }), accepted: nullable, field },
    { name: `${field} wrong type`, body: mutate(valid, path, { value: WRONG_TYPE[kind] }), accepted: false, field },
  ];
  for (const [what, value, accepted, suffix = ''] of EXTRA[kind] ?? []) {
    out.push({ name: `${field} ${what}`, body: mutate(valid, path, { value }), accepted, field: `${field}${suffix}` });
  }
  return out;
});

const runTable = (title: string, call: Call, valid: unknown, fields: FieldCase[]): void => {
  describe(title, () => {
    it('accepts the valid answer', async () => {
      const { req } = fakeRequester(valid);
      await expect(call(req)).resolves.toBeDefined();
    });

    it.each(variants(valid, fields).map((v) => [v.name, v] as const))('%s', async (_name, variant) => {
      const { req, fn } = fakeRequester(variant.body);
      const result = await call(req).then(() => 'accepted', (e: unknown) => e);
      if (variant.accepted) {
        expect(result).toBe('accepted');
      } else {
        expect(result).toBeInstanceOf(SanadApiError);
        expect(result).toMatchObject({ code: 'malformed_response', status: 0 });
        expect((result as SanadApiError).message).toContain(`\`${variant.field}\``);
      }
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
};

const at = (prefix: Path, fields: [string, Kind][]): FieldCase[] =>
  fields.map(([key, kind]) => ({ path: [...prefix, ...key.split('.')], kind }));

// ── Phone numbers ───────────────────────────────────────────────────────────

const phoneNumberRow = {
  phone_number_id: '100000000000001',
  display_phone_number: '+12025550123',
  verified_name: 'Test Business',
  name_status: 'APPROVED',
  new_name_status: null,
  waba_id: '200000000000002',
  quality_rating: 'GREEN',
  status: 'CONNECTED',
};

runTable(
  'phoneNumbers.list',
  (req) => new PhoneNumbersResource(req).list(),
  { success: true, data: [phoneNumberRow] },
  [
    { path: ['data'], kind: 'list' },
    ...at(['data', 0], [
      ['phone_number_id', 'id'],
      ['display_phone_number', 'nullableString'],
      ['verified_name', 'nullableString'],
      ['name_status', 'nullableString'],
      ['new_name_status', 'nullableString'],
      ['waba_id', 'id'],
      ['quality_rating', 'nullableString'],
      ['status', 'nullableString'],
    ]),
  ],
);

describe('phoneNumbers.list — PHP PhoneNumbersTest cases', () => {
  it.each([
    ['data that is an object', { success: true, data: { phone_number_id: '1', waba_id: '2' } }, 'data'],
    ['an array id', { success: true, data: [{ ...phoneNumberRow, phone_number_id: ['x'] }] }, 'data[0].phone_number_id'],
  ])('%s throws malformed_response', async (_name, body, field) => {
    const err = await new PhoneNumbersResource(fakeRequester(body).req).list().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'malformed_response', status: 0 });
    expect((err as SanadApiError).message).toContain(`\`${field}\``);
  });
});

// ── Balance ─────────────────────────────────────────────────────────────────

runTable(
  'balance.get',
  (req) => new BalanceResource(req).get(),
  {
    success: true,
    data: {
      billing_type: 'prepaid',
      available_credits: 1250.5,
      paid_credits_remaining: 1000,
      free_credits_remaining: 250.5,
      unlimited: false,
      unlimited_until: null,
      usage_this_month: {
        period_start: '2026-11-01',
        credits_used: 42,
        marketing: 30,
        utility: 8,
        authentication: 3,
        service: 1,
      },
      as_of: '2026-11-21T10:00:00.000Z',
    },
  },
  [
    { path: ['data'], kind: 'object' },
    ...at(['data'], [
      ['billing_type', 'string'],
      ['available_credits', 'nullableNumber'],
      ['paid_credits_remaining', 'nullableNumber'],
      ['free_credits_remaining', 'number'],
      ['unlimited', 'bool'],
      ['unlimited_until', 'nullableString'],
      ['usage_this_month', 'object'],
      ['usage_this_month.period_start', 'nullableString'],
      ['usage_this_month.credits_used', 'number'],
      ['usage_this_month.marketing', 'number'],
      ['usage_this_month.utility', 'number'],
      ['usage_this_month.authentication', 'number'],
      ['usage_this_month.service', 'number'],
      ['as_of', 'nullableString'],
    ]),
  ],
);

// ── Tags ────────────────────────────────────────────────────────────────────

const tagRow = { id: '42', name: 'vip', description: 'Top customers', created_at: '2026-11-21T10:00:00.000Z' };
const tagFields: [string, Kind][] = [
  ['id', 'id'],
  ['name', 'string'],
  ['description', 'nullableString'],
  ['created_at', 'nullableString'],
];
const pageFields: FieldCase[] = [
  { path: ['page'], kind: 'int' },
  { path: ['limit'], kind: 'int' },
  { path: ['data'], kind: 'list' },
];
const deletedFields: FieldCase[] = [
  { path: ['data'], kind: 'object' },
  { path: ['data', 'id'], kind: 'id' },
  { path: ['data', 'deleted'], kind: 'bool' },
];

runTable(
  'tags.list',
  (req) => new TagsResource(req).list(),
  { success: true, page: 1, limit: 50, data: [tagRow] },
  [...pageFields, ...at(['data', 0], tagFields)],
);

runTable(
  'tags.create',
  (req) => new TagsResource(req).create({ name: 'vip' }),
  { success: true, data: tagRow },
  [{ path: ['data'], kind: 'object' }, ...at(['data'], tagFields)],
);

runTable(
  'tags.delete',
  (req) => new TagsResource(req).delete('42'),
  { success: true, data: { id: '42', deleted: true } },
  deletedFields,
);

// ── Contacts ────────────────────────────────────────────────────────────────

const contactRow = {
  id: '7',
  phone: '+12025550123',
  first_name: 'Sara',
  last_name: 'Ali',
  email: 'sara@example.test',
  tags: ['vip'],
  created_at: '2026-11-21T10:00:00.000Z',
  updated_at: '2026-11-21T10:05:00.000Z',
};
const contactFields: [string, Kind][] = [
  ['id', 'id'],
  ['phone', 'nullableString'],
  ['first_name', 'nullableString'],
  ['last_name', 'nullableString'],
  ['email', 'nullableString'],
  ['tags', 'stringList'],
  ['created_at', 'nullableString'],
  ['updated_at', 'nullableString'],
];

runTable(
  'contacts.list',
  (req) => new ContactsResource(req).list(),
  { success: true, page: 1, limit: 50, data: [contactRow] },
  [...pageFields, ...at(['data', 0], contactFields)],
);

runTable(
  'contacts.upsert',
  (req) => new ContactsResource(req).upsert({ phone: '+12025550123' }),
  {
    success: true,
    data: {
      summary: { created: 1, updated: 0, rejected: 1, failed: 0 },
      results: [
        { index: 0, status: 'created', contact: contactRow, error: null },
        { index: 1, status: 'rejected', contact: null, error: { code: 'tag_not_found', message: 'Create the tag first.' } },
      ],
    },
  },
  [
    { path: ['data'], kind: 'object' },
    ...at(['data'], [
      ['summary', 'object'],
      ['summary.created', 'int'],
      ['summary.updated', 'int'],
      ['summary.rejected', 'int'],
      ['summary.failed', 'int'],
      ['results', 'list'],
    ]),
    ...at(['data', 'results', 0], [
      ['index', 'int'],
      ['status', 'string'],
      ['contact', 'nullableObject'],
      ['error', 'nullableObject'],
    ]),
    ...at(['data', 'results', 0, 'contact'], contactFields),
    ...at(['data', 'results', 1], [
      ['error', 'nullableObject'],
      ['error.code', 'string'],
      ['error.message', 'string'],
    ]),
  ],
);

runTable(
  'contacts.import',
  (req) => new ContactsResource(req).import({ file: 'phone\n+12025550123\n' }),
  {
    success: true,
    data: {
      summary: { rows: 2, created: 1, updated: 0, rejected: 1, failed: 0 },
      errors: [{ row: 3, status: 'rejected', code: 'validation_error', message: 'The phone is not valid.' }],
    },
  },
  [
    { path: ['data'], kind: 'object' },
    ...at(['data'], [
      ['summary', 'object'],
      ['summary.rows', 'int'],
      ['summary.created', 'int'],
      ['summary.updated', 'int'],
      ['summary.rejected', 'int'],
      ['summary.failed', 'int'],
      ['errors', 'list'],
    ]),
    ...at(['data', 'errors', 0], [
      ['row', 'int'],
      ['status', 'string'],
      ['code', 'string'],
      ['message', 'string'],
    ]),
  ],
);

runTable(
  'contacts.delete',
  (req) => new ContactsResource(req).delete('7'),
  { success: true, data: { id: '7', deleted: true } },
  deletedFields,
);

// ── Campaigns ───────────────────────────────────────────────────────────────

const campaignRow = {
  id: '9001',
  name: 'November offer',
  status: 'active',
  pause_reason: null,
  phone_number_id: '100000000000001',
  template: { name: 'november_offer', language: 'ar' },
  audience: { type: 'tags', tags: ['vip'] },
  start_at: '2026-11-21T10:00:00.000Z',
  created_at: '2026-11-21T09:59:00.000Z',
  updated_at: '2026-11-21T10:01:00.000Z',
  created_via: 'api',
  counts: { total: 10, queued: 1, sending: 2, sent: 3, delivered: 2, read: 1, failed: 1, canceled: 0 },
  clicks: { tracked: 4, clicked: 2 },
};
const campaignFields: [string, Kind][] = [
  ['id', 'id'],
  ['name', 'string'],
  ['status', 'string'],
  ['pause_reason', 'nullableString'],
  ['phone_number_id', 'nullableId'],
  ['template', 'nullableObject'],
  ['template.name', 'string'],
  ['template.language', 'nullableString'],
  ['audience', 'nullableObject'],
  ['audience.type', 'string'],
  ['audience.tags', 'optionalStringList'],
  ['start_at', 'nullableString'],
  ['created_at', 'nullableString'],
  ['updated_at', 'nullableString'],
  ['created_via', 'string'],
  ['counts', 'object'],
  ['counts.total', 'int'],
  ['counts.queued', 'int'],
  ['counts.sending', 'int'],
  ['counts.sent', 'int'],
  ['counts.delivered', 'int'],
  ['counts.read', 'int'],
  ['counts.failed', 'int'],
  ['counts.canceled', 'int'],
  ['clicks', 'nullableObject'],
  ['clicks.tracked', 'int'],
  ['clicks.clicked', 'int'],
];

runTable(
  'campaigns.get',
  (req) => new CampaignsResource(req).get('9001'),
  { success: true, data: campaignRow },
  [{ path: ['data'], kind: 'object' }, ...at(['data'], campaignFields)],
);

runTable(
  'campaigns.list',
  (req) => new CampaignsResource(req).list(),
  { success: true, page: 1, limit: 50, data: [campaignRow] },
  [...pageFields, ...at(['data', 0], campaignFields)],
);

const campaignMethods: [string, Call][] = [
  ['create', (req) => new CampaignsResource(req).create({
    name: 'November offer',
    phoneNumberId: '100000000000001',
    template: { name: 'november_offer', language: 'ar' },
    audience: { tags: ['vip'] },
    idempotencyKey: 'campaign-key-1',
  })],
  ['pause', (req) => new CampaignsResource(req).pause('9001')],
  ['resume', (req) => new CampaignsResource(req).resume('9001')],
];

describe.each(campaignMethods)('campaigns.%s reads the campaign like get()', (_name, call) => {
  it('accepts the valid answer and refuses a mistyped count', async () => {
    await expect(call(fakeRequester({ success: true, data: campaignRow }).req)).resolves.toBeDefined();
    const bad = mutate({ success: true, data: campaignRow }, ['data', 'counts', 'sent'], { value: '3' });
    await expect(call(fakeRequester(bad).req))
      .rejects.toMatchObject({ code: 'malformed_response', status: 0, message: expect.stringContaining('`data.counts.sent`') });
  });
});

// ── Not retried, through the client ─────────────────────────────────────────

describe('a malformed field through the client', () => {
  it('throws malformed_response after one attempt, even with retries enabled', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(new Response(
      JSON.stringify({ success: true, data: { ...campaignRow, name: 7 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    const sdk = new SanadWhatsApp({ apiKey: 'pk_test_fake_key', retries: 3, fetch: fetchImpl as unknown as typeof fetch });
    await expect(sdk.campaigns.get('9001')).rejects.toMatchObject({ code: 'malformed_response', status: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
