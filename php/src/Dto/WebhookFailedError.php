<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class WebhookFailedError
{
    public function __construct(
        public readonly ?int $code,
        public readonly ?string $title,
        public readonly ?string $message,
    ) {
    }
}
