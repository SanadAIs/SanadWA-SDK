<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class Tag
{
    public function __construct(
        public readonly string $id,
        public readonly string $name,
        public readonly ?string $description,
        public readonly ?string $createdAt,
    ) {
    }
}
