<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * The outcome for one input of `contacts()->upsert()`.
 *
 * `status` is `created`, `updated`, `rejected` or `failed`. `contact` is set for
 * created / updated; `error` is set for rejected / failed.
 */
final class ContactUpsertItem
{
    public function __construct(
        public readonly int $index,
        public readonly string $status,
        public readonly ?Contact $contact,
        public readonly ?ContactItemError $error,
    ) {
    }
}
