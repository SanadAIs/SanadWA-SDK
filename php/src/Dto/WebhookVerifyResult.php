<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class WebhookVerifyResult
{
    private function __construct(
        public readonly bool $valid,
        public readonly ?WebhookEvent $event,
        public readonly ?string $reason,
    ) {
    }

    public static function valid(WebhookEvent $event): self
    {
        return new self(true, $event, null);
    }

    public static function invalid(string $reason): self
    {
        return new self(false, null, $reason);
    }
}
