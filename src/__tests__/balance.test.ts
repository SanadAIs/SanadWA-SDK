import { describe, it, expect, vi } from 'vitest';
import { BalanceResource } from '../resources/balance.js';
import { ServerError } from '../errors.js';
import type { Requester, RequestOptions } from '../request.js';

const fakeRequester = (response: unknown) => {
  const calls: RequestOptions[] = [];
  const fn = vi.fn(async (opts: RequestOptions) => {
    calls.push(opts);
    return response;
  });
  return { req: fn as unknown as Requester, calls };
};

describe('balance.get', () => {
  it('GETs /balance with no query, no body and no Idempotency-Key', async () => {
    const { req, calls } = fakeRequester({ success: true, data: {} });
    await new BalanceResource(req).get();
    expect(calls).toEqual([{ method: 'GET', path: '/balance' }]);
  });

  it('maps every field', async () => {
    const { req } = fakeRequester({
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
    });
    expect(await new BalanceResource(req).get()).toEqual({
      billingType: 'prepaid',
      availableCredits: 1250.5,
      paidCreditsRemaining: 1000,
      freeCreditsRemaining: 250.5,
      unlimited: false,
      unlimitedUntil: null,
      usageThisMonth: {
        periodStart: '2026-11-01',
        creditsUsed: 42,
        marketing: 30,
        utility: 8,
        authentication: 3,
        service: 1,
      },
      asOf: '2026-11-21T10:00:00.000Z',
    });
  });

  it('maps the nullable fields as null', async () => {
    const { req } = fakeRequester({
      success: true,
      data: {
        billing_type: 'postpaid',
        available_credits: null,
        paid_credits_remaining: null,
        free_credits_remaining: 0,
        unlimited: false,
        unlimited_until: null,
        usage_this_month: { period_start: null, credits_used: 0, marketing: 0, utility: 0, authentication: 0, service: 0 },
        as_of: null,
      },
    });
    const out = await new BalanceResource(req).get();
    expect(out.billingType).toBe('postpaid');
    expect(out.availableCredits).toBeNull();
    expect(out.paidCreditsRemaining).toBeNull();
    expect(out.unlimitedUntil).toBeNull();
    expect(out.asOf).toBeNull();
    expect(out.usageThisMonth.periodStart).toBeNull();
  });

  it('maps missing nullable keys to null', async () => {
    const { req } = fakeRequester({
      success: true,
      data: {
        billing_type: 'prepaid',
        free_credits_remaining: 5,
        unlimited: false,
        usage_this_month: { credits_used: 1, marketing: 1, utility: 0, authentication: 0, service: 0 },
      },
    });
    const out = await new BalanceResource(req).get();
    expect(out).toMatchObject({
      availableCredits: null,
      paidCreditsRemaining: null,
      unlimitedUntil: null,
      asOf: null,
      usageThisMonth: { periodStart: null, creditsUsed: 1 },
    });
  });

  it('maps unlimited: true with a date', async () => {
    const { req } = fakeRequester({
      success: true,
      data: {
        billing_type: 'prepaid',
        available_credits: 0,
        paid_credits_remaining: 0,
        free_credits_remaining: 0,
        unlimited: true,
        unlimited_until: '2026-12-31T20:59:59.000Z',
        usage_this_month: { period_start: '2026-11-01', credits_used: 0, marketing: 0, utility: 0, authentication: 0, service: 0 },
        as_of: '2026-11-21T10:00:00.000Z',
      },
    });
    const out = await new BalanceResource(req).get();
    expect(out.unlimited).toBe(true);
    expect(out.unlimitedUntil).toBe('2026-12-31T20:59:59.000Z');
    expect(out.availableCredits).toBe(0);
  });

  it('rethrows the requester error unchanged', async () => {
    const failure = new ServerError({ message: 'lookup failed', code: 'balance_lookup_failed', status: 500 });
    const req = vi.fn(async () => { throw failure; }) as unknown as Requester;
    await expect(new BalanceResource(req).get()).rejects.toBe(failure);
  });

  it('works when detached', async () => {
    const { req, calls } = fakeRequester({ success: true, data: {} });
    const { get } = new BalanceResource(req);
    await get();
    expect(calls[0]!.path).toBe('/balance');
  });
});
