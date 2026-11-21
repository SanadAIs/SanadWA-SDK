<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * An active sending number. `phoneNumberId` is the id `messages()->send()` needs.
 */
final class PhoneNumber
{
    public function __construct(
        public readonly string $phoneNumberId,
        public readonly ?string $displayPhoneNumber,
        public readonly ?string $verifiedName,
        public readonly ?string $nameStatus,
        public readonly ?string $newNameStatus,
        public readonly string $wabaId,
        public readonly ?string $qualityRating,
        public readonly ?string $status,
    ) {
    }
}
