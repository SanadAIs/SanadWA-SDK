<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class SendTextReplyOptions
{
    public function __construct(
        public readonly string $phoneNumberId,
        public readonly string $toPhone,
        public readonly string $text,
        public readonly ?bool $previewUrl = null,
        public readonly ?string $idempotencyKey = null,
    ) {
    }
}
