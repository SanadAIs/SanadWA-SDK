<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class Message
{
    public function __construct(
        public readonly string $id,
        public readonly ?string $providerMsgId,
        public readonly string $status,
        public readonly ?string $sentAt,
        public readonly string $templateName,
        public readonly string $toPhone,
        public readonly string $channel,
        public readonly string $provider,
        public readonly ?string $error,
        public readonly ?string $deliveredAt,
        public readonly ?string $readAt,
        public readonly ?string $failedAt,
        public readonly ?string $lastStatus,
    ) {
    }
}
