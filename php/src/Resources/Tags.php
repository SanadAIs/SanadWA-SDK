<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Resources;

use Sanadwa\WhatsApp\Dto\DeletedResource;
use Sanadwa\WhatsApp\Dto\Page;
use Sanadwa\WhatsApp\Dto\Tag;
use Sanadwa\WhatsApp\Http\Requester;
use Sanadwa\WhatsApp\Http\ResponseValidator;
use Sanadwa\WhatsApp\Resources\Support\ResourceSupport;

final class Tags
{
    public function __construct(private readonly Requester $requester)
    {
    }

    /**
     * Lists the account's tags, ordered by id ascending.
     *
     * `page` is 1-based (default 1); `limit` defaults to 50 and the API caps
     * it at 200. The returned `page` / `limit` are the values the server used.
     * There is no total: the last page is reached when it holds fewer rows
     * than `limit`.
     *
     * @return Page Page whose `data` is `list<Tag>`.
     */
    public function list(?int $page = null, ?int $limit = null): Page
    {
        $raw = $this->requester->request(
            'GET',
            '/tags',
            ResourceSupport::pageQuery($page, $limit),
        );

        return ResourceSupport::page($raw, self::mapTag(...));
    }

    /**
     * Creates a tag.
     *
     * `name` is 1 to 100 characters and may not contain `,` or `;`;
     * `description` is at most 500 characters. A name that already exists
     * (compared without regard to case) is refused with 409
     * `tag_already_exists`.
     */
    public function create(
        string $name,
        ?string $description = null,
        ?string $idempotencyKey = null,
    ): Tag {
        ResourceSupport::validateIdempotencyKey($idempotencyKey);

        $body = ['name' => $name];
        if ($description !== null) {
            $body['description'] = $description;
        }

        $raw = $this->requester->request(
            method: 'POST',
            path: '/tags',
            body: $body,
            idempotent: true,
            idempotencyKey: $idempotencyKey,
        );

        return self::mapTag(ResourceSupport::dataObject($raw), 'data');
    }

    /**
     * Deletes a tag from the tag list. Contacts that carry the name keep it.
     */
    public function delete(string|int $id, ?string $idempotencyKey = null): DeletedResource
    {
        $pathId = ResourceSupport::pathId($id);
        ResourceSupport::validateIdempotencyKey($idempotencyKey);

        $raw = $this->requester->request(
            method: 'DELETE',
            path: '/tags/' . $pathId,
            idempotent: true,
            idempotencyKey: $idempotencyKey,
        );

        return ResourceSupport::deletedResource($raw);
    }

    private static function mapTag(array $row, string $field): Tag
    {
        return new Tag(
            id: ResponseValidator::requiredStringOrNumber($row, 'id', $field . '.id'),
            name: ResponseValidator::requiredString($row, 'name', $field . '.name'),
            description: ResourceSupport::nullableString(
                $row,
                'description',
                $field . '.description',
            ),
            createdAt: ResourceSupport::nullableString($row, 'created_at', $field . '.created_at'),
        );
    }
}
