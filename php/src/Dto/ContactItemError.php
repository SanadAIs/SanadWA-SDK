<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class ContactItemError
{
    public function __construct(
        public readonly string $code,
        public readonly string $message,
    ) {
    }
}
