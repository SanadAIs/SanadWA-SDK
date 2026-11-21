<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class Message
{
    /**
     * @param string $id SanadWA's row id. It is not the id `Messages::get()` takes.
     * @param string|null $providerMsgId The WhatsApp message id (`wamid.…`).
     * @param string|null $status Known values: `sent`, `delivered`, `read`, `failed`. Other
     *     values (for example `queued`, `received`) are possible for rows that were not sent
     *     through this API; treat an unknown or null status as not final.
     */
    public function __construct(
        public readonly string $id,
        public readonly ?string $providerMsgId,
        public readonly ?string $status,
        public readonly ?string $sentAt,
        public readonly ?string $templateName,
        public readonly ?string $toPhone,
        public readonly ?string $channel,
        public readonly ?string $provider,
        public readonly ?string $error,
        public readonly ?string $deliveredAt,
        public readonly ?string $readAt,
        public readonly ?string $failedAt,
        public readonly ?string $lastStatus,
    ) {
    }
}
