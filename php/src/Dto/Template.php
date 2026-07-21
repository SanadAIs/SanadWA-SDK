<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class Template
{
    public function __construct(
        public readonly string $name,
        public readonly string $language,
        public readonly string $category,
        public readonly string $status,
        public readonly mixed $components = null,
    ) {
    }
}
