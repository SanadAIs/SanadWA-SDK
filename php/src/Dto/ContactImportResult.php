<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class ContactImportResult
{
    public function __construct(
        public readonly ContactImportSummary $summary,
        /** @var list<ContactImportError> */
        public readonly array $errors,
    ) {
    }
}
