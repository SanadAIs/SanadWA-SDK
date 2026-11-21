<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * The `error` of a `message.failed` webhook. Every field is null when the API did not send it.
 */
final class WebhookFailedError
{
    /**
     * @param array<string, mixed>|null $errorData WhatsApp's `error_data` object.
     * @param string|null $details WhatsApp's longer explanation (`details`).
     * @param string|null $errorUserMsg WhatsApp's user-facing message (`error_user_msg`).
     */
    public function __construct(
        public readonly ?int $code,
        public readonly ?string $title,
        public readonly ?string $message,
        public readonly ?array $errorData = null,
        public readonly ?string $details = null,
        public readonly ?string $errorUserMsg = null,
    ) {
    }
}
