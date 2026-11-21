<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class Contact
{
    public function __construct(
        public readonly string $id,
        public readonly ?string $phone,
        public readonly ?string $firstName,
        public readonly ?string $lastName,
        public readonly ?string $email,
        /** @var list<string> Tag names. */
        public readonly array $tags,
        public readonly ?string $createdAt,
        public readonly ?string $updatedAt,
    ) {
    }
}
