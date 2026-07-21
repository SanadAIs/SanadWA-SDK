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

    public function list(?int $page = null, ?int $limit = null, ?string $q = null): ListTemplatesResponse
    {
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
                category: ResponseValidator::requiredString(
                    $template,
                    'category',
                    $field . '.category',
                ),
                status: ResponseValidator::requiredString($template, 'status', $field . '.status'),
                components: $template['components'] ?? null,
            );
        }

        return new ListTemplatesResponse(
            page: ResponseValidator::requiredInt($raw, 'page'),
            limit: ResponseValidator::requiredInt($raw, 'limit'),
            data: $templates,
        );
    }
}
