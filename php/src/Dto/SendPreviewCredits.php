<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * What a previewed send would charge.
 *
 * `billingType` is `prepaid` or `postpaid`. `chargeCategory` is `marketing`,
 * `utility`, `authentication` or `service` (a text reply). `estimated` is
 * `perMessage × eligible`, or 0 under a covering subscription; it equals
 * `fromFreeAllowance + fromPaidBalance`. For a campaign that starts now it is
 * an upper bound (failed messages are not charged). For a scheduled campaign
 * it is computed now and is not a bound: the audience, coverage and credits
 * are checked again when the campaign starts.
 */
final class SendPreviewCredits
{
    public function __construct(
        public readonly string $billingType,
        public readonly string $chargeCategory,
        public readonly int $perMessage,
        public readonly int $estimated,
        public readonly int $fromFreeAllowance,
        public readonly int $fromPaidBalance,
        public readonly bool $coveredBySubscription,
    ) {
    }
}
