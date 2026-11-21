<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * The account's credit balance.
 *
 * `billingType` is `prepaid` or `postpaid`. `availableCredits` and
 * `paidCreditsRemaining` are null for accounts without a prepaid balance;
 * `unlimitedUntil` is null when `unlimited` is false.
 */
final class CreditBalance
{
    public function __construct(
        public readonly string $billingType,
        public readonly int|float|null $availableCredits,
        public readonly int|float|null $paidCreditsRemaining,
        public readonly int|float $freeCreditsRemaining,
        public readonly bool $unlimited,
        public readonly ?string $unlimitedUntil,
        public readonly CreditUsage $usageThisMonth,
        public readonly ?string $asOf,
    ) {
    }
}
