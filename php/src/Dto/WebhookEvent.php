<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class WebhookEvent
{
    public function __construct(
        public readonly string $type,
        public readonly array $data,
    ) {
    }
}
