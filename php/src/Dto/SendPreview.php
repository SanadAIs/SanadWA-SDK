<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * What a send would do, from `messages()->preview()` or `campaigns()->preview()`.
 * Nothing is sent, charged or written. The balance can change before the real
 * call, which stays the authority.
 *
 * `kind` is `template`, `text` or `campaign`. `wouldSend` is true when the
 * real call would be accepted (`refusal` is then null). A refusal is data, not
 * an exception. `template` is null for a text reply. `recipients`, `credits`
 * and `balance` are null when a refusal stopped the preview before the
 * audience was resolved. `asOf` is when the balance was read (ISO 8601).
 */
final class SendPreview
{
    public function __construct(
        public readonly string $kind,
        public readonly bool $wouldSend,
        public readonly ?SendPreviewRefusal $refusal,
        public readonly ?SendPreviewTemplate $template,
        public readonly ?SendPreviewRecipients $recipients,
        public readonly ?SendPreviewCredits $credits,
        public readonly ?SendPreviewBalance $balance,
        public readonly string $asOf,
    ) {
    }
}
