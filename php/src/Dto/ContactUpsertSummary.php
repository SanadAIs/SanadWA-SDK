<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class ContactUpsertSummary
{
    public function __construct(
        public readonly int $created,
        public readonly int $updated,
        public readonly int $rejected,
        public readonly int $failed,
    ) {
    }
}
