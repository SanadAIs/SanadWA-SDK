<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class DeletedResource
{
    public function __construct(
        public readonly string $id,
        public readonly bool $deleted,
    ) {
    }
}
