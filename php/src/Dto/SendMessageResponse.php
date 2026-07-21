<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class SendMessageResponse
{
    public function __construct(
        public readonly ?string $messageId,
        public readonly string $acceptedAt,
        public readonly bool $replayed,
        public readonly Upstream $upstream,
    ) {
    }
}
