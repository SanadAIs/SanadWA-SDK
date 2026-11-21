<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Resources;

use Sanadwa\WhatsApp\Dto\ListTemplatesResponse;
use Sanadwa\WhatsApp\Dto\Template;
use Sanadwa\WhatsApp\Http\Requester;
use Sanadwa\WhatsApp\Http\ResponseValidator;

final class Templates
{
    public function __construct(private readonly Requester $requester)
    {
    }

    /**
     * Lists the account's APPROVED templates.
     *
     * @param string|null $phoneNumberId Only the templates this phone number can send
     *     (`phone_number_id`). An unknown id is answered 404 `phone_not_found`.
     * @param string|null $wabaId Only the templates of this WhatsApp Business Account
     *     (`waba_id`). Ignored by the API when `$phoneNumberId` is also sent.
     */
    public function list(
        ?int $page = null,
        ?int $limit = null,
        ?string $q = null,
        ?string $phoneNumberId = null,
        ?string $wabaId = null,
    ): ListTemplatesResponse {
        $query = [];
        if ($page !== null) {
            $query['page'] = $page;
        }
        if ($limit !== null) {
            $query['limit'] = $limit;
        }
        if ($q !== null) {
            $query['q'] = $q;
        }
        if ($phoneNumberId !== null) {
            $query['phone_number_id'] = $phoneNumberId;
        }
        if ($wabaId !== null) {
            $query['waba_id'] = $wabaId;
        }

        $raw = ResponseValidator::body(
            $this->requester->request(
                'GET',
                '/templates',
                $query === [] ? null : $query,
            ),
        );

        $templates = [];
        foreach (ResponseValidator::requiredArray($raw, 'data') as $index => $value) {
            $field = sprintf('data[%s]', (string) $index);
            $template = ResponseValidator::arrayValue($value, $field);
            $templates[] = new Template(
                name: ResponseValidator::requiredString($template, 'name', $field . '.name'),
                language: ResponseValidator::requiredString(
                    $template,
                    'language',
                    $field . '.language',
                ),
                category: ResponseValidator::optionalNullableString(
                    $template,
                    'category',
                    $field . '.category',
                ),
                status: ResponseValidator::requiredString($template, 'status', $field . '.status'),
                components: $template['components'] ?? null,
                wabaId: ResponseValidator::optionalNullableStringOrNumber(
                    $template,
                    'waba_id',
                    $field . '.waba_id',
                ),
            );
        }

        return new ListTemplatesResponse(
            page: ResponseValidator::requiredInt($raw, 'page'),
            limit: ResponseValidator::requiredInt($raw, 'limit'),
            data: $templates,
        );
    }
}
