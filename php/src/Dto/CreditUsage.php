<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * Credits used in the current month (UTC). `periodStart` is the first day of the month.
 */
final class CreditUsage
{
    public function __construct(
        public readonly ?string $periodStart,
        public readonly int|float $creditsUsed,
        public readonly int|float $marketing,
        public readonly int|float $utility,
        public readonly int|float $authentication,
        public readonly int|float $service,
    ) {
    }
}
