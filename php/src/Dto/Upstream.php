<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class Upstream
{
    public function __construct(
        public readonly string $messagingProduct = 'whatsapp',
        public readonly array $contacts = [],
        public readonly array $messages = [],
    ) {
    }
}
