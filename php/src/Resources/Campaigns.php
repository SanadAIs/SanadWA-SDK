<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Resources;

use Psr\Http\Message\ResponseInterface;
use Sanadwa\WhatsApp\Dto\Campaign;
use Sanadwa\WhatsApp\Dto\CampaignAudience;
use Sanadwa\WhatsApp\Dto\CampaignClicks;
use Sanadwa\WhatsApp\Dto\CampaignCounts;
use Sanadwa\WhatsApp\Dto\CampaignTemplate;
use Sanadwa\WhatsApp\Dto\CampaignTemplateVariable;
use Sanadwa\WhatsApp\Dto\CreateCampaignOptions;
use Sanadwa\WhatsApp\Dto\CreatedCampaign;
use Sanadwa\WhatsApp\Dto\Page;
use Sanadwa\WhatsApp\Exceptions\ValidationError;
use Sanadwa\WhatsApp\Http\Requester;
use Sanadwa\WhatsApp\Http\ResponseValidator;
use Sanadwa\WhatsApp\Resources\Support\ResourceSupport;

final class Campaigns
{
    public function __construct(private readonly Requester $requester)
    {
    }

    /**
     * Creates a WhatsApp campaign for the contacts that carry the given tags.
     * It starts now, or at `sendAt` when set.
     *
     * `idempotencyKey` is required and is never generated here: the API keeps
     * it with the campaign as its lasting duplicate guard. Store the value and
     * send the same one when you retry; a repeat with the same key and the
     * same input returns the first campaign with `replayed` true instead of
     * creating (and charging for) a second one.
     *
     * The API allows 5 creates per minute per key on top of the general limit.
     */
    public function create(CreateCampaignOptions $options): CreatedCampaign
    {
        if ($options->idempotencyKey === '') {
            throw new ValidationError(
                message: '`idempotencyKey` is required to create a campaign. Use a unique value '
                    . 'per campaign (for example a UUID) and send the same value when you retry.',
                code: 'idempotency_key_required',
                status: 0,
            );
        }
        ResourceSupport::validateIdempotencyKey($options->idempotencyKey);

        // The API refuses any key it does not know, so the idempotency key
        // travels in the header only and unset options are left out.
        $body = [
            'name' => $options->name,
            'phone_number_id' => $options->phoneNumberId,
            'template' => [
                'name' => $options->templateName,
                'language' => $options->templateLanguage,
            ],
            'audience' => ['tags' => array_values($options->audienceTags)],
        ];
        if ($options->templateVariables !== null) {
            $body['template_variables'] = array_map(
                self::variableItem(...),
                array_values($options->templateVariables),
            );
        }
        if ($options->headerMediaUrl !== null) {
            $body['header_media_url'] = $options->headerMediaUrl;
        }
        if ($options->trackedDestinationUrl !== null) {
            $body['tracked_destination_url'] = $options->trackedDestinationUrl;
        }
        if ($options->sendAt !== null) {
            $body['send_at'] = $options->sendAt instanceof \DateTimeInterface
                ? $options->sendAt->format(DATE_ATOM)
                : $options->sendAt;
        }

        $replayed = false;
        $raw = $this->requester->request(
            method: 'POST',
            path: '/campaigns',
            body: $body,
            idempotent: true,
            onHeaders: static function (ResponseInterface $response) use (&$replayed): void {
                $replayed = ResourceSupport::isIdempotentReplay($response);
            },
            idempotencyKey: $options->idempotencyKey,
        );

        return new CreatedCampaign(
            campaign: self::mapCampaign(ResourceSupport::dataObject($raw), 'data'),
            replayed: $replayed,
        );
    }

    /**
     * Lists the account's WhatsApp campaigns, newest first.
     *
     * `page` is 1-based (default 1); `limit` defaults to 50 and the API caps
     * it at 200. The returned `page` / `limit` are the values the server used.
     * There is no total: the last page is reached when it holds fewer rows
     * than `limit`. Rows of this list carry no `clicks` (it is null); read a
     * single campaign with `get()` for them.
     *
     * @return Page Page whose `data` is `list<Campaign>`.
     */
    public function list(?int $page = null, ?int $limit = null): Page
    {
        $raw = $this->requester->request(
            'GET',
            '/campaigns',
            ResourceSupport::pageQuery($page, $limit),
        );

        return ResourceSupport::page($raw, self::mapCampaign(...));
    }

    public function get(string|int $id): Campaign
    {
        $raw = $this->requester->request('GET', '/campaigns/' . ResourceSupport::pathId($id));

        return self::mapCampaign(ResourceSupport::dataObject($raw), 'data');
    }

    /**
     * Pauses an active campaign. While another change to the same campaign is
     * running the API answers 409 `campaign_busy`, which is not retried here.
     */
    public function pause(string|int $id, ?string $idempotencyKey = null): Campaign
    {
        return $this->transition($id, 'pause', $idempotencyKey);
    }

    /**
     * Resumes a paused campaign. The API answers 402 when the account lacks
     * the credits for the remaining messages.
     */
    public function resume(string|int $id, ?string $idempotencyKey = null): Campaign
    {
        return $this->transition($id, 'resume', $idempotencyKey);
    }

    private function transition(string|int $id, string $action, ?string $idempotencyKey): Campaign
    {
        $pathId = ResourceSupport::pathId($id);
        ResourceSupport::validateIdempotencyKey($idempotencyKey);

        $raw = $this->requester->request(
            method: 'POST',
            path: '/campaigns/' . $pathId . '/' . $action,
            idempotent: true,
            idempotencyKey: $idempotencyKey,
        );

        return self::mapCampaign(ResourceSupport::dataObject($raw), 'data');
    }

    /**
     * @return array{index: int, source: string, value?: string}
     */
    private static function variableItem(CampaignTemplateVariable $variable): array
    {
        $item = ['index' => $variable->index, 'source' => $variable->source];
        if ($variable->value !== null) {
            $item['value'] = $variable->value;
        }

        return $item;
    }

    private static function mapCampaign(array $row, string $field): Campaign
    {
        $template = ResourceSupport::nullableObject($row, 'template', $field . '.template');
        $audience = ResourceSupport::nullableObject($row, 'audience', $field . '.audience');
        $clicks = ResourceSupport::nullableObject($row, 'clicks', $field . '.clicks');
        $counts = ResponseValidator::requiredArray($row, 'counts', $field . '.counts');
        $count = static fn (string $key): int => ResourceSupport::int(
            $counts,
            $key,
            $field . '.counts.' . $key,
        );

        return new Campaign(
            id: ResponseValidator::requiredStringOrNumber($row, 'id', $field . '.id'),
            name: ResponseValidator::requiredString($row, 'name', $field . '.name'),
            status: ResponseValidator::requiredString($row, 'status', $field . '.status'),
            pauseReason: ResourceSupport::nullableString($row, 'pause_reason', $field . '.pause_reason'),
            phoneNumberId: ResourceSupport::nullableId(
                $row,
                'phone_number_id',
                $field . '.phone_number_id',
            ),
            template: $template === null ? null : new CampaignTemplate(
                name: ResponseValidator::requiredString($template, 'name', $field . '.template.name'),
                language: ResourceSupport::nullableString(
                    $template,
                    'language',
                    $field . '.template.language',
                ),
            ),
            audience: $audience === null ? null : new CampaignAudience(
                type: ResponseValidator::requiredString($audience, 'type', $field . '.audience.type'),
                tags: ResourceSupport::optionalStringList(
                    $audience,
                    'tags',
                    $field . '.audience.tags',
                ),
            ),
            startAt: ResourceSupport::nullableString($row, 'start_at', $field . '.start_at'),
            createdAt: ResourceSupport::nullableString($row, 'created_at', $field . '.created_at'),
            updatedAt: ResourceSupport::nullableString($row, 'updated_at', $field . '.updated_at'),
            createdVia: ResponseValidator::requiredString($row, 'created_via', $field . '.created_via'),
            counts: new CampaignCounts(
                total: $count('total'),
                queued: $count('queued'),
                sending: $count('sending'),
                sent: $count('sent'),
                delivered: $count('delivered'),
                read: $count('read'),
                failed: $count('failed'),
                canceled: $count('canceled'),
            ),
            clicks: $clicks === null ? null : new CampaignClicks(
                tracked: ResourceSupport::int($clicks, 'tracked', $field . '.clicks.tracked'),
                clicked: ResourceSupport::int($clicks, 'clicked', $field . '.clicks.clicked'),
            ),
        );
    }
}
