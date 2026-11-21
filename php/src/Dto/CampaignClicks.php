<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class CampaignClicks
{
    public function __construct(
        public readonly int $tracked,
        public readonly int $clicked,
    ) {
    }
}
