<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * The balance before and after a previewed send.
 *
 * `availableCredits` is what `balance()->get()` reports as available.
 * `afterSend` is `availableCredits − estimated`; a negative value means the
 * send is short by that much. Both are null on postpaid billing.
 */
final class SendPreviewBalance
{
    public function __construct(
        public readonly int|float|null $availableCredits,
        public readonly int|float|null $afterSend,
        public readonly bool $unlimited,
    ) {
    }
}
