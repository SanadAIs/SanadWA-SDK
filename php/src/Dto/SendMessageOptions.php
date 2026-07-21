<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class SendMessageOptions
{
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
