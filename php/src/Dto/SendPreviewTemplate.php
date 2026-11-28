<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * The template a preview would send. `category` (`MARKETING`, `UTILITY` or
 * `AUTHENTICATION`) is null when the template is not in the synced list; such
 * a send is charged and consent-checked as marketing.
 */
final class SendPreviewTemplate
{
    public function __construct(
        public readonly string $name,
        public readonly ?string $language,
        public readonly ?string $category,
    ) {
    }
}
