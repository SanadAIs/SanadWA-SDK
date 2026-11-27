import { describe, it, expect, vi } from 'vitest';
import { CampaignsResource } from '../resources/campaigns.js';
import { NotFoundError, ValidationError } from '../errors.js';
import type { Requester, RequestOptions } from '../request.js';
import type { CreateCampaignInput } from '../resource-types.js';

const fakeRequester = (response: unknown, responseHeaders: Record<string, string> = {}) => {
  const calls: RequestOptions[] = [];
  const fn = vi.fn(async (opts: RequestOptions) => {
    calls.push(opts);
    opts.onHeaders?.(new Headers(responseHeaders));
    return response;
  });
  return { req: fn as unknown as Requester, calls, fn };
};

/** The call as sent, without the header callback (a function, not comparable). */
const sent = (opts: RequestOptions): Omit<RequestOptions, 'onHeaders'> => {
  const { onHeaders: _onHeaders, ...rest } = opts;
  return rest;
};

const campaignWire = {
  id: '9001',
  name: 'November offer',
  status: 'active',
  pause_reason: null,
  phone_number_id: '100000000000001',
  template: { name: 'november_offer', language: 'ar' },
  audience: { type: 'tags', tags: ['vip', 'riyadh'] },
  start_at: '2026-11-21T10:00:00.000Z',
  created_at: '2026-11-21T09:59:00.000Z',
  updated_at: '2026-11-21T10:01:00.000Z',
  created_via: 'api',
  counts: { total: 10, queued: 1, sending: 2, sent: 3, delivered: 2, read: 1, failed: 1, canceled: 0 },
  clicks: { tracked: 4, clicked: 2 },
};

const campaignSdk = {
  id: '9001',
  name: 'November offer',
  status: 'active',
  pauseReason: null,
  phoneNumberId: '100000000000001',
  template: { name: 'november_offer', language: 'ar' },
  audience: { type: 'tags', tags: ['vip', 'riyadh'] },
  startAt: '2026-11-21T10:00:00.000Z',
  createdAt: '2026-11-21T09:59:00.000Z',
  updatedAt: '2026-11-21T10:01:00.000Z',
  createdVia: 'api',
  counts: { total: 10, queued: 1, sending: 2, sent: 3, delivered: 2, read: 1, failed: 1, canceled: 0 },
  clicks: { tracked: 4, clicked: 2 },
};

const zeroCounts = { total: 0, queued: 0, sending: 0, sent: 0, delivered: 0, read: 0, failed: 0, canceled: 0 };

const one = { success: true, data: campaignWire };
const emptyPage = { success: true, page: 1, limit: 50, data: [] };

const minimalInput: CreateCampaignInput = {
  name: 'November offer',
  phoneNumberId: '100000000000001',
  template: { name: 'november_offer', language: 'ar' },
  audience: { tags: ['vip'] },
  idempotencyKey: 'campaign-0001',
};

const minimalBody = {
  name: 'November offer',
  phone_number_id: '100000000000001',
  template: { name: 'november_offer', language: 'ar' },
  audience: { tags: ['vip'] },
};

describe('campaigns.create', () => {
  it('POSTs /campaigns with the caller key as the Idempotency-Key and only the required body keys', async () => {
    const { req, calls } = fakeRequester(one);
    await new CampaignsResource(req).create(minimalInput);
    expect(calls).toHaveLength(1);
    expect(sent(calls[0]!)).toEqual({
      method: 'POST',
      path: '/campaigns',
      body: minimalBody,
      idempotent: true,
      idempotencyKey: 'campaign-0001',
    });
  });

  it('never puts the key in the body', async () => {
    const { req, calls } = fakeRequester(one);
    await new CampaignsResource(req).create(minimalInput);
    expect(calls[0]!.body).not.toHaveProperty('idempotency_key');
    expect(calls[0]!.body).not.toHaveProperty('idempotencyKey');
  });

  it('sends every optional key when set, with exactly the documented names', async () => {
    const { req, calls } = fakeRequester(one);
    await new CampaignsResource(req).create({
      ...minimalInput,
      audience: { tags: ['vip', 'riyadh'] },
      templateVariables: [
        { index: 1, source: 'contact.first_name' },
        { index: 2, source: 'custom', value: '20%' },
      ],
      headerMediaUrl: 'https://cdn.example.test/offer.jpg',
      trackedDestinationUrl: 'https://shop.example.test/offer',
      sendAt: '2026-12-01T09:00:00+03:00',
    });
    expect(calls[0]!.body).toEqual({
      name: 'November offer',
      phone_number_id: '100000000000001',
      template: { name: 'november_offer', language: 'ar' },
      audience: { tags: ['vip', 'riyadh'] },
      template_variables: [
        { index: 1, source: 'contact.first_name' },
        { index: 2, source: 'custom', value: '20%' },
      ],
      header_media_url: 'https://cdn.example.test/offer.jpg',
      tracked_destination_url: 'https://shop.example.test/offer',
      send_at: '2026-12-01T09:00:00+03:00',
    });
  });

  it('drops keys the API does not accept from template, audience and variables', async () => {
    const { req, calls } = fakeRequester(one);
    const noisy = {
      ...minimalInput,
      template: { name: 'november_offer', language: 'ar', category: 'MARKETING' },
      audience: { tags: ['vip'], type: 'tags' },
      templateVariables: [{ index: 1, source: 'contact.phone', value: undefined, label: 'x' }],
      extra: true,
    } as unknown as CreateCampaignInput;
    await new CampaignsResource(req).create(noisy);
    expect(calls[0]!.body).toEqual({ ...minimalBody, template_variables: [{ index: 1, source: 'contact.phone' }] });
    const variable = (calls[0]!.body as { template_variables: object[] }).template_variables[0]!;
    expect(Object.keys(variable)).toEqual(['index', 'source']);
  });

  it('serialises a Date sendAt with toISOString and passes a string unchanged', async () => {
    const { req, calls } = fakeRequester(one);
    const campaigns = new CampaignsResource(req);
    await campaigns.create({ ...minimalInput, sendAt: new Date('2026-12-01T09:00:00+03:00') });
    await campaigns.create({ ...minimalInput, sendAt: '2026-12-01T09:00+03:00' });
    expect((calls[0]!.body as { send_at: string }).send_at).toBe('2026-12-01T06:00:00.000Z');
    expect((calls[1]!.body as { send_at: string }).send_at).toBe('2026-12-01T09:00+03:00');
  });

  it('maps the 201 response; replayed is false without the replay header', async () => {
    const { req } = fakeRequester(one);
    expect(await new CampaignsResource(req).create(minimalInput)).toEqual({ campaign: campaignSdk, replayed: false });
  });

  it('reports replayed only for X-Idempotent-Replay: true', async () => {
    const replayedWith = async (headers: Record<string, string>) =>
      (await new CampaignsResource(fakeRequester(one, headers).req).create(minimalInput)).replayed;
    expect(await replayedWith({ 'X-Idempotent-Replay': 'true' })).toBe(true);
    expect(await replayedWith({ 'x-idempotent-replay': 'TRUE' })).toBe(true);
    expect(await replayedWith({ 'X-Idempotent-Replay': 'false' })).toBe(false);
    expect(await replayedWith({})).toBe(false);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['null', null],
    ['a number', 12345],
    ['an object', { key: 'campaign-0001' }],
  ])('rejects a key that is %s with idempotency_key_required before any HTTP', async (_label, key) => {
    const { req, fn } = fakeRequester(one);
    const input = { ...minimalInput, idempotencyKey: key } as unknown as CreateCampaignInput;
    const promise = new CampaignsResource(req).create(input);
    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    await expect(promise).rejects.toMatchObject({
      code: 'idempotency_key_required',
      status: 0,
      message: '`idempotencyKey` is required to create a campaign. Use a unique value per campaign (for example a UUID) and send the same value when you retry.',
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects a key property that is absent altogether', async () => {
    const { req, fn } = fakeRequester(one);
    const { idempotencyKey: _key, ...withoutKey } = minimalInput;
    await expect(new CampaignsResource(req).create(withoutKey as CreateCampaignInput))
      .rejects.toMatchObject({ code: 'idempotency_key_required', status: 0 });
    expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    ['contains a space', 'bad key'],
    ['is longer than 120 characters', 'k'.repeat(121)],
    ['is not ASCII', 'حملة-1'],
  ])('rejects a key that %s with invalid_idempotency_key before any HTTP', async (_label, key) => {
    const { req, fn } = fakeRequester(one);
    const promise = new CampaignsResource(req).create({ ...minimalInput, idempotencyKey: key });
    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    await expect(promise).rejects.toMatchObject({ code: 'invalid_idempotency_key', status: 0 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('accepts a key of exactly 120 characters', async () => {
    const { req, calls } = fakeRequester(one);
    const key = 'k'.repeat(120);
    await new CampaignsResource(req).create({ ...minimalInput, idempotencyKey: key });
    expect(calls[0]!.idempotencyKey).toBe(key);
  });

  it('rethrows the requester error unchanged', async () => {
    const failure = new ValidationError({ message: 'no audience', code: 'audience_empty', status: 422 });
    const req = vi.fn(async () => { throw failure; }) as unknown as Requester;
    await expect(new CampaignsResource(req).create(minimalInput)).rejects.toBe(failure);
  });
});

describe('campaigns.list', () => {
  it('GETs /campaigns with no query and no Idempotency-Key when no options are given', async () => {
    const { req, calls } = fakeRequester(emptyPage);
    const campaigns = new CampaignsResource(req);
    await campaigns.list();
    await campaigns.list({});
    expect(calls).toEqual([{ method: 'GET', path: '/campaigns' }, { method: 'GET', path: '/campaigns' }]);
  });

  it('passes page and limit through verbatim', async () => {
    const { req, calls } = fakeRequester(emptyPage);
    await new CampaignsResource(req).list({ page: 3, limit: 200 });
    expect(calls[0]).toEqual({ method: 'GET', path: '/campaigns', query: { page: 3, limit: 200 } });
  });

  it('does not clamp the limit, and reports the page and limit the server used', async () => {
    const { req, calls } = fakeRequester({ success: true, page: 1, limit: 200, data: [] });
    const out = await new CampaignsResource(req).list({ limit: 500 });
    expect(calls[0]!.query).toEqual({ limit: 500 });
    expect(out).toEqual({ page: 1, limit: 200, data: [] });
  });

  it('maps rows; clicks is null because the list endpoint omits it', async () => {
    const { clicks: _clicks, ...listRow } = campaignWire;
    const { req } = fakeRequester({ success: true, page: 2, limit: 1, data: [listRow] });
    expect(await new CampaignsResource(req).list({ page: 2, limit: 1 })).toEqual({
      page: 2,
      limit: 1,
      data: [{ ...campaignSdk, clicks: null }],
    });
  });

  it('rethrows the requester error unchanged', async () => {
    const failure = new NotFoundError({ message: 'gone', code: 'campaign_not_found', status: 404 });
    const req = vi.fn(async () => { throw failure; }) as unknown as Requester;
    await expect(new CampaignsResource(req).list()).rejects.toBe(failure);
  });
});

describe('campaigns.get', () => {
  it('GETs /campaigns/{id} with no Idempotency-Key and maps the campaign with clicks', async () => {
    const { req, calls } = fakeRequester(one);
    const out = await new CampaignsResource(req).get('9001');
    expect(calls).toEqual([{ method: 'GET', path: '/campaigns/9001' }]);
    expect(out).toEqual(campaignSdk);
  });

  it('maps null template, audience, phone number, pause reason and start time', async () => {
    const { req } = fakeRequester({
      success: true,
      data: {
        id: 9002,
        name: 'Draft',
        status: 'draft',
        pause_reason: null,
        phone_number_id: null,
        template: null,
        audience: null,
        start_at: null,
        created_at: null,
        updated_at: null,
        created_via: 'console',
        counts: zeroCounts,
      },
    });
    expect(await new CampaignsResource(req).get('9002')).toEqual({
      id: '9002',
      name: 'Draft',
      status: 'draft',
      pauseReason: null,
      phoneNumberId: null,
      template: null,
      audience: null,
      startAt: null,
      createdAt: null,
      updatedAt: null,
      createdVia: 'console',
      counts: zeroCounts,
      clicks: null,
    });
  });

  it('maps missing nullable keys the same way as nulls', async () => {
    const { req } = fakeRequester({ success: true, data: { id: '9003', name: 'Bare', status: 'draft', created_via: 'console', counts: zeroCounts } });
    expect(await new CampaignsResource(req).get('9003')).toEqual({
      id: '9003',
      name: 'Bare',
      status: 'draft',
      pauseReason: null,
      phoneNumberId: null,
      template: null,
      audience: null,
      startAt: null,
      createdAt: null,
      updatedAt: null,
      createdVia: 'console',
      counts: zeroCounts,
      clicks: null,
    });
  });

  it('maps an audience without tags to tags: [] and a template without language to null', async () => {
    const { req } = fakeRequester({
      success: true,
      data: { ...campaignWire, audience: { type: 'all_contacts' }, template: { name: 'november_offer', language: null } },
    });
    const out = await new CampaignsResource(req).get('9001');
    expect(out.audience).toEqual({ type: 'all_contacts', tags: [] });
    expect(out.template).toEqual({ name: 'november_offer', language: null });
  });

  it('passes an unknown status through, and a pause reason', async () => {
    const { req } = fakeRequester({
      success: true,
      data: { ...campaignWire, status: 'archiving', pause_reason: 'insufficient_credits' },
    });
    const out = await new CampaignsResource(req).get('9001');
    expect(out.status).toBe('archiving');
    expect(out.pauseReason).toBe('insufficient_credits');
  });

  it('coerces a numeric phone_number_id to a string', async () => {
    const { req } = fakeRequester({ success: true, data: { ...campaignWire, phone_number_id: 100000000000001 } });
    expect((await new CampaignsResource(req).get('9001')).phoneNumberId).toBe('100000000000001');
  });

  it('encodes the id', async () => {
    const { req, calls } = fakeRequester(one);
    await new CampaignsResource(req).get('a/b c');
    expect(calls[0]!.path).toBe('/campaigns/a%2Fb%20c');
  });

  it('rejects an empty id before any HTTP', async () => {
    const { req, fn } = fakeRequester(one);
    const promise = new CampaignsResource(req).get('');
    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    await expect(promise).rejects.toMatchObject({ code: 'invalid_id', status: 0 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('rethrows the requester error unchanged', async () => {
    const failure = new NotFoundError({ message: 'no campaign', code: 'campaign_not_found', status: 404 });
    const req = vi.fn(async () => { throw failure; }) as unknown as Requester;
    await expect(new CampaignsResource(req).get('9001')).rejects.toBe(failure);
  });
});

describe.each(['pause', 'resume'] as const)('campaigns.%s', (action) => {
  it(`POSTs /campaigns/{id}/${action} with an Idempotency-Key and no body`, async () => {
    const { req, calls } = fakeRequester(one);
    const out = await new CampaignsResource(req)[action]('9001');
    expect(calls).toEqual([{ method: 'POST', path: `/campaigns/9001/${action}`, idempotent: true }]);
    expect(calls[0]).not.toHaveProperty('body');
    expect(out).toEqual(campaignSdk);
  });

  it('passes the caller key', async () => {
    const { req, calls } = fakeRequester(one);
    await new CampaignsResource(req)[action]('9001', { idempotencyKey: `${action}-0001` });
    expect(calls[0]).toEqual({
      method: 'POST',
      path: `/campaigns/9001/${action}`,
      idempotent: true,
      idempotencyKey: `${action}-0001`,
    });
  });

  it('rejects an empty id before any HTTP', async () => {
    const { req, fn } = fakeRequester(one);
    await expect(new CampaignsResource(req)[action]('')).rejects.toMatchObject({ code: 'invalid_id', status: 0 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects an invalid caller key before any HTTP', async () => {
    const { req, fn } = fakeRequester(one);
    await expect(new CampaignsResource(req)[action]('9001', { idempotencyKey: 'bad key' }))
      .rejects.toMatchObject({ code: 'invalid_idempotency_key', status: 0 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('rethrows the requester error unchanged', async () => {
    const failure = new ValidationError({ message: 'busy', code: 'campaign_busy', status: 409 });
    const req = vi.fn(async () => { throw failure; }) as unknown as Requester;
    await expect(new CampaignsResource(req)[action]('9001')).rejects.toBe(failure);
  });

  it('works when detached', async () => {
    const { req, calls } = fakeRequester(one);
    const { [action]: change } = new CampaignsResource(req);
    await change('9001');
    expect(calls[0]!.path).toBe(`/campaigns/9001/${action}`);
  });
});

describe('campaigns — answers the SDK cannot read', () => {
  it('passes an unknown created_via through', async () => {
    const { req } = fakeRequester({ success: true, data: { id: '9004', name: 'X', status: 'draft', created_via: 'import', counts: zeroCounts } });
    expect((await new CampaignsResource(req).get('9004')).createdVia).toBe('import');
  });

  it.each([
    ['no data object', { success: true }],
    ['no id', { success: true, data: { name: 'X', status: 'draft', created_via: 'api' } }],
    ['no created_via', { success: true, data: { id: '9005', name: 'X', status: 'draft' } }],
  ])('get: %s throws malformed_response', async (_name, body) => {
    const { req } = fakeRequester(body);
    await expect(new CampaignsResource(req).get('9005'))
      .rejects.toMatchObject({ code: 'malformed_response', status: 0 });
  });

  it('list: a body without page, limit and data throws malformed_response', async () => {
    const { req } = fakeRequester({ success: true });
    await expect(new CampaignsResource(req).list())
      .rejects.toMatchObject({ code: 'malformed_response', status: 0 });
  });
});

describe('campaigns.preview', () => {
  const campaignPreviewWire = {
    kind: 'campaign',
    would_send: true,
    refusal: null,
    template: { name: 'november_offer', language: 'ar', category: 'MARKETING' },
    recipients: { requested: 5, opted_out: 1, suppressed: 1, invalid_phone: 0, duplicate: 0, allowlist_blocked: 0, eligible: 3 },
    credits: { billing_type: 'prepaid', charge_category: 'marketing', per_message: 1, estimated: 3, from_free_allowance: 3, from_paid_balance: 0, covered_by_subscription: false },
    balance: { available_credits: 10, after_send: 7, unlimited: false },
    as_of: '2026-11-27T10:00:00.000Z',
  };
  const { idempotencyKey: _key, ...minimalInputWithoutKey } = minimalInput;

  it('preview posts the create body to /campaigns/preview with no key', async () => {
    const { req, calls } = fakeRequester({ success: true, data: campaignPreviewWire });
    const result = await new CampaignsResource(req).preview({ ...minimalInputWithoutKey, sendAt: new Date('2026-12-01T06:00:00.000Z') });
    expect(sent(calls[0]!)).toEqual({ method: 'POST', path: '/campaigns/preview', body: { ...minimalBody, send_at: '2026-12-01T06:00:00.000Z' }, idempotent: false });
    expect(result.kind).toBe('campaign');
    expect(result.recipients?.optedOut).toBe(1);
    expect(result.credits?.estimated).toBe(3);
    expect(result.balance?.afterSend).toBe(7);
    expect(result.template?.category).toBe('MARKETING');
  });

  it('preview does not require idempotencyKey and never sends one it is given', async () => {
    const { req, calls } = fakeRequester({ success: true, data: campaignPreviewWire });
    await expect(new CampaignsResource(req).preview(minimalInputWithoutKey)).resolves.toMatchObject({ wouldSend: true });
    await new CampaignsResource(req).preview(minimalInput);
    for (const call of calls) {
      expect(call.idempotencyKey).toBeUndefined();
      expect(call.idempotent).toBe(false);
      expect(call.body).not.toHaveProperty('idempotency_key');
    }
  });

  it('a refusal comes back as data', async () => {
    const refused = {
      ...campaignPreviewWire,
      would_send: false,
      refusal: {
        status: 402, code: 'insufficient_credits',
        message: 'Your account does not have enough credits for this audience, so the campaign was not created.',
        message_ar: 'رصيد حسابك لا يكفي لهذا الجمهور، فلم تُنشأ الحملة.',
        details: { needed: 3, remaining: 1, shortfall: 2 },
      },
      balance: { available_credits: 1, after_send: -2, unlimited: false },
    };
    const { req } = fakeRequester({ success: true, data: refused });
    const result = await new CampaignsResource(req).preview(minimalInputWithoutKey);
    expect(result.wouldSend).toBe(false);
    expect(result.refusal).toEqual({
      status: 402, code: 'insufficient_credits', message: refused.refusal.message,
      messageAr: refused.refusal.message_ar, details: { needed: 3, remaining: 1, shortfall: 2 },
    });
    expect(result.balance?.afterSend).toBe(-2);
  });

  it('a stopped preview has null counts', async () => {
    const stopped = { ...campaignPreviewWire, would_send: false, recipients: null, credits: null, balance: null,
      refusal: { status: 403, code: 'kyc_required', message: 'Verify.', message_ar: 'وثّق حسابك.', details: null } };
    const { req } = fakeRequester({ success: true, data: stopped });
    const result = await new CampaignsResource(req).preview(minimalInputWithoutKey);
    expect(result).toMatchObject({ recipients: null, credits: null, balance: null, refusal: { code: 'kyc_required' } });
  });
});
