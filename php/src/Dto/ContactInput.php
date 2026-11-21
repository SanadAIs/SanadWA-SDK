<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * One contact for `contacts()->upsert()`.
 *
 * `phone` is required, in international format (for example +12025550123).
 * Fields left null are not sent. `tags` holds at most 10 names, each of which
 * must already exist in the account's tag list.
 */
final class ContactInput
{
    public function __construct(
        public readonly string $phone,
        public readonly ?string $firstName = null,
        public readonly ?string $lastName = null,
        public readonly ?string $email = null,
        /** @var list<string>|null */
        public readonly ?array $tags = null,
    ) {
    }
}
