<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * Input for `campaigns()->preview()`: the fields of `CreateCampaignOptions`
 * without the idempotency key, which a preview does not use.
 * `campaigns()->preview()` also accepts a `CreateCampaignOptions` (its key is
 * ignored), so the exact input of a later `create()` can be previewed.
 */
final class PreviewCampaignOptions
{
    public function __construct(
        public readonly string $name,
        public readonly string $phoneNumberId,
        public readonly string $templateName,
        public readonly string $templateLanguage,
        /** @var list<string> 1 to 20 tag names. */
        public readonly array $audienceTags,
        /** @var list<CampaignTemplateVariable>|null */
        public readonly ?array $templateVariables = null,
        public readonly ?string $headerMediaUrl = null,
        public readonly ?string $trackedDestinationUrl = null,
        public readonly \DateTimeInterface|string|null $sendAt = null,
    ) {
    }
}
