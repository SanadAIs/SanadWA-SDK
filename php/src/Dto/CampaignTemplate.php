<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class CampaignTemplate
{
    public function __construct(
        public readonly string $name,
        public readonly ?string $language,
    ) {
    }
}
