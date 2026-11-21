<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class Template
{
    /**
     * @param string|null $category Null when the API has no category for the template.
     * @param string|null $wabaId The WhatsApp Business Account the template belongs to
     *     (`waba_id`). A phone number can only send its own account's templates.
     */
    public function __construct(
        public readonly string $name,
        public readonly string $language,
        public readonly ?string $category,
        public readonly string $status,
        public readonly mixed $components = null,
        public readonly ?string $wabaId = null,
    ) {
    }
}
