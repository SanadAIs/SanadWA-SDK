<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * Input for `campaigns()->create()`.
 *
 * `idempotencyKey` is required: use a unique value per campaign (for example a
 * UUID) and send the same value when you retry. `templateLanguage` is required
 * (there is no default language for campaigns). `headerMediaUrl` is an https
 * link, required when the template has a media header. Leave `sendAt` null to
 * start now; otherwise pass an ISO 8601 string with a time zone or a
 * DateTimeInterface, in the future and at most 30 days ahead.
 */
final class CreateCampaignOptions
{
    public function __construct(
        public readonly string $name,
        public readonly string $phoneNumberId,
        public readonly string $templateName,
        public readonly string $templateLanguage,
        /** @var list<string> 1 to 20 tag names. */
        public readonly array $audienceTags,
        public readonly string $idempotencyKey,
        /** @var list<CampaignTemplateVariable>|null */
        public readonly ?array $templateVariables = null,
        public readonly ?string $headerMediaUrl = null,
        public readonly ?string $trackedDestinationUrl = null,
        public readonly \DateTimeInterface|string|null $sendAt = null,
    ) {
    }
}
