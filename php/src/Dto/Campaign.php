<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * A WhatsApp campaign.
 *
 * `status` known values: draft, scheduled, delayed, start_failed, active, paused,
 * completed, failed; treat any other value as not final. `pauseReason` is null
 * unless `status` is `paused` (known values: paused_by_user, insufficient_credits,
 * balance_check_failed, start_failed, event_cancelled). `createdVia` is `api` or
 * `console`. `clicks` is null on `campaigns()->list()` (the list endpoint omits
 * it) and set on create / get / pause / resume.
 */
final class Campaign
{
    public function __construct(
        public readonly string $id,
        public readonly string $name,
        public readonly string $status,
        public readonly ?string $pauseReason,
        public readonly ?string $phoneNumberId,
        public readonly ?CampaignTemplate $template,
        public readonly ?CampaignAudience $audience,
        public readonly ?string $startAt,
        public readonly ?string $createdAt,
        public readonly ?string $updatedAt,
        public readonly string $createdVia,
        public readonly CampaignCounts $counts,
        public readonly ?CampaignClicks $clicks = null,
    ) {
    }
}
