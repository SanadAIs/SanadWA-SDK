<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * `replayed` is true when the API answered from a previous request that used the
 * same idempotency key (no second campaign was created).
 */
final class CreatedCampaign
{
    public function __construct(
        public readonly Campaign $campaign,
        public readonly bool $replayed,
    ) {
    }
}
