<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class ListTemplatesResponse
{
    public function __construct(
        public readonly int $page,
        public readonly int $limit,
        public readonly array $data,
    ) {
    }
}
