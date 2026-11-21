import type { Requester } from '../request.js';
import type { CreditBalance } from '../resource-types.js';
import { toNullableNumber, toNullableString, toNumber, toRecord } from './resource-helpers.js';

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
    const data = toRecord(toRecord(raw).data);
    const usage = toRecord(data.usage_this_month);
    return {
      billingType: data.billing_type === 'postpaid' ? 'postpaid' : 'prepaid',
      availableCredits: toNullableNumber(data.available_credits),
      paidCreditsRemaining: toNullableNumber(data.paid_credits_remaining),
      freeCreditsRemaining: toNumber(data.free_credits_remaining),
      unlimited: data.unlimited === true,
      unlimitedUntil: toNullableString(data.unlimited_until),
      usageThisMonth: {
        periodStart: toNullableString(usage.period_start),
        creditsUsed: toNumber(usage.credits_used),
        marketing: toNumber(usage.marketing),
        utility: toNumber(usage.utility),
        authentication: toNumber(usage.authentication),
        service: toNumber(usage.service),
      },
      asOf: toNullableString(data.as_of),
    };
  };
}
