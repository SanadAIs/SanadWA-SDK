<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * `type` is `tags`, `all_contacts`, `uploaded_list`, `event` or `retarget`.
 */
final class CampaignAudience
{
    public function __construct(
        public readonly string $type,
        /** @var list<string> Empty unless `type` is `tags`. */
        public readonly array $tags,
    ) {
    }
}
