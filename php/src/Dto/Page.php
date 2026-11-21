<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * One page of a paged list (`GET /tags`, `GET /contacts`, `GET /campaigns`).
 *
 * `page` and `limit` are the values the server used. The API returns no total
 * and no next link: the last page is reached when `count($data) < $limit`.
 */
final class Page
{
    public function __construct(
        public readonly int $page,
        public readonly int $limit,
        /** @var list<mixed> */
        public readonly array $data,
    ) {
    }
}
