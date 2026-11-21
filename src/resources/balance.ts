import type { Requester } from '../request.js';
import type { CreditBalance } from '../resource-types.js';
import {
  toBoolean,
  toDataRecord,
  toNullableNumber,
  toNullableString,
  toNumber,
  toRecord,
  toRequiredString,
} from './resource-helpers.js';

export class BalanceResource {
  readonly #req: Requester;

  constructor(req: Requester) {
    this.#req = req;
  }

  /**
   * GET /balance — the account's credit balance and this month's usage.
   *
   * `availableCredits` and `paidCreditsRemaining` are `null` for accounts
   * without a prepaid balance.
   */
  readonly get = async (): Promise<CreditBalance> => {
    const raw = await this.#req<unknown>({ method: 'GET', path: '/balance' });
    const data = toDataRecord(raw);
    const usage = toRecord(data.usage_this_month, 'data.usage_this_month');
    const usageField = (key: string): number => toNumber(usage[key], `data.usage_this_month.${key}`);
    return {
      billingType: toRequiredString(data.billing_type, 'data.billing_type'),
      availableCredits: toNullableNumber(data.available_credits, 'data.available_credits'),
      paidCreditsRemaining: toNullableNumber(data.paid_credits_remaining, 'data.paid_credits_remaining'),
      freeCreditsRemaining: toNumber(data.free_credits_remaining, 'data.free_credits_remaining'),
      unlimited: toBoolean(data.unlimited, 'data.unlimited'),
      unlimitedUntil: toNullableString(data.unlimited_until, 'data.unlimited_until'),
      usageThisMonth: {
        periodStart: toNullableString(usage.period_start, 'data.usage_this_month.period_start'),
        creditsUsed: usageField('credits_used'),
        marketing: usageField('marketing'),
        utility: usageField('utility'),
        authentication: usageField('authentication'),
        service: usageField('service'),
      },
      asOf: toNullableString(data.as_of, 'data.as_of'),
    };
  };
}
