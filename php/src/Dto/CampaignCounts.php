<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class CampaignCounts
{
    public function __construct(
        public readonly int $total,
        public readonly int $queued,
        public readonly int $sending,
        public readonly int $sent,
        public readonly int $delivered,
        public readonly int $read,
        public readonly int $failed,
        public readonly int $canceled,
    ) {
    }
}
