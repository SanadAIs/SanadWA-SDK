<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Resources;

use Sanadwa\WhatsApp\Dto\CreditBalance;
use Sanadwa\WhatsApp\Dto\CreditUsage;
use Sanadwa\WhatsApp\Http\Requester;
use Sanadwa\WhatsApp\Http\ResponseValidator;
use Sanadwa\WhatsApp\Resources\Support\ResourceSupport;

final class Balance
{
    public function __construct(private readonly Requester $requester)
    {
    }

    /**
     * Reads the account's current credit balance and this month's usage.
     */
    public function get(): CreditBalance
    {
        $data = ResourceSupport::dataObject($this->requester->request('GET', '/balance'));
        $usage = ResponseValidator::requiredArray(
            $data,
            'usage_this_month',
            'data.usage_this_month',
        );

        return new CreditBalance(
            billingType: ResponseValidator::requiredString(
                $data,
                'billing_type',
                'data.billing_type',
            ),
            availableCredits: ResourceSupport::nullableNumber(
                $data,
                'available_credits',
                'data.available_credits',
            ),
            paidCreditsRemaining: ResourceSupport::nullableNumber(
                $data,
                'paid_credits_remaining',
                'data.paid_credits_remaining',
            ),
            freeCreditsRemaining: ResourceSupport::number(
                $data,
                'free_credits_remaining',
                'data.free_credits_remaining',
            ),
            unlimited: ResourceSupport::bool($data, 'unlimited', 'data.unlimited'),
            unlimitedUntil: ResourceSupport::nullableString(
                $data,
                'unlimited_until',
                'data.unlimited_until',
            ),
            usageThisMonth: new CreditUsage(
                periodStart: ResourceSupport::nullableString(
                    $usage,
                    'period_start',
                    'data.usage_this_month.period_start',
                ),
                creditsUsed: ResourceSupport::number(
                    $usage,
                    'credits_used',
                    'data.usage_this_month.credits_used',
                ),
                marketing: ResourceSupport::number(
                    $usage,
                    'marketing',
                    'data.usage_this_month.marketing',
                ),
                utility: ResourceSupport::number(
                    $usage,
                    'utility',
                    'data.usage_this_month.utility',
                ),
                authentication: ResourceSupport::number(
                    $usage,
                    'authentication',
                    'data.usage_this_month.authentication',
                ),
                service: ResourceSupport::number(
                    $usage,
                    'service',
                    'data.usage_this_month.service',
                ),
            ),
            asOf: ResourceSupport::nullableString($data, 'as_of', 'data.as_of'),
        );
    }
}
