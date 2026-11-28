<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * The refusal the real call would answer, returned as data by a preview.
 *
 * `status` is the HTTP status the real call would use. `code` is that call's
 * own code, spelled as it answers it (for example `PREPAID_CREDIT_CAP_REACHED`
 * on a message or `insufficient_credits` on a campaign). `messageAr` is the
 * same message in Arabic. `details` is null when the real call has none.
 */
final class SendPreviewRefusal
{
    public function __construct(
        public readonly int $status,
        public readonly string $code,
        public readonly string $message,
        public readonly string $messageAr,
        public readonly ?array $details,
    ) {
    }
}
