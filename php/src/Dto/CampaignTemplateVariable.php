<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * Fills one template variable. `source` is one of contact.first_name,
 * contact.last_name, contact.phone, contact.email or custom. `value` is required
 * when `source` is `custom` and must be left null otherwise.
 */
final class CampaignTemplateVariable
{
    public function __construct(
        public readonly int $index,
        public readonly string $source,
        public readonly ?string $value = null,
    ) {
    }
}
