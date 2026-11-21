<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class SendMessageOptions
{
    /**
     * @param string|null $templateLanguage Optional. When omitted the API sends the template
     *     in Arabic (`ar`).
     */
    public function __construct(
        public readonly string $phoneNumberId,
        public readonly string $toPhone,
        public readonly string $templateName,
        public readonly ?string $templateLanguage = null,
        public readonly ?array $templateParams = null,
        public readonly ?array $templateComponents = null,
        public readonly ?string $idempotencyKey = null,
    ) {
    }
}
