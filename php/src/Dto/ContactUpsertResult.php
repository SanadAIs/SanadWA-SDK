<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class ContactUpsertResult
{
    public function __construct(
        public readonly ContactUpsertSummary $summary,
        /** @var list<ContactUpsertItem> One per input, in the same order. */
        public readonly array $results,
    ) {
    }
}
