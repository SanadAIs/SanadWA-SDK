<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * One CSV row that was not imported. `row` is the CSV line (the header is line 1);
 * `status` is `rejected` or `failed`.
 */
final class ContactImportError
{
    public function __construct(
        public readonly int $row,
        public readonly string $status,
        public readonly string $code,
        public readonly string $message,
    ) {
    }
}
