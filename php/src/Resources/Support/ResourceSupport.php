<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Resources\Support;

use Psr\Http\Message\ResponseInterface;
use Sanadwa\WhatsApp\Dto\DeletedResource;
use Sanadwa\WhatsApp\Dto\Page;
use Sanadwa\WhatsApp\Exceptions\ValidationError;
use Sanadwa\WhatsApp\Http\ResponseValidator;

/**
 * Helpers shared by the resources: client-side checks and typed readers for
 * response fields.
 *
 * @internal Not part of the public API; it may change in any release.
 */
final class ResourceSupport
{
    private function __construct()
    {
    }

    public static function validateIdempotencyKey(?string $idempotencyKey): void
    {
        if ($idempotencyKey === null) {
            return;
        }
        if (
            $idempotencyKey === ''
            || strlen($idempotencyKey) > 120
            || preg_match('/\A[\x21-\x7E]+\z/', $idempotencyKey) !== 1
        ) {
            throw new ValidationError(
                message: '`idempotencyKey` must contain 1 to 120 visible ASCII characters.',
                code: 'invalid_idempotency_key',
                status: 0,
            );
        }
    }

    /**
     * True when the response says it repeats an earlier call made with the
     * same `Idempotency-Key`.
     */
    public static function isIdempotentReplay(ResponseInterface $response): bool
    {
        return strtolower(trim($response->getHeaderLine('X-Idempotent-Replay'))) === 'true';
    }

    /**
     * Returns the id as one encoded path segment, or refuses an empty id
     * before any HTTP call.
     */
    public static function pathId(string|int $id): string
    {
        $text = (string) $id;
        if ($text === '') {
            throw new ValidationError(
                message: '`id` must not be empty.',
                code: 'invalid_id',
                status: 0,
            );
        }

        return rawurlencode($text);
    }

    /**
     * Builds the `page` / `limit` query: only what the caller set, unclamped.
     *
     * @param array<string, scalar|null> $extra
     * @return array<string, scalar>|null
     */
    public static function pageQuery(?int $page, ?int $limit, array $extra = []): ?array
    {
        $query = [];
        if ($page !== null) {
            $query['page'] = $page;
        }
        if ($limit !== null) {
            $query['limit'] = $limit;
        }
        foreach ($extra as $key => $value) {
            if ($value !== null) {
                $query[$key] = $value;
            }
        }

        return $query === [] ? null : $query;
    }

    /**
     * The `data` object of a `{ success, data: {...} }` response.
     */
    public static function dataObject(mixed $raw): array
    {
        return ResponseValidator::requiredArray(ResponseValidator::body($raw), 'data');
    }

    /**
     * The `data` list of a `{ success, data: [...] }` response, each row
     * checked to be an object and passed to $mapRow with its field path.
     *
     * @param callable(array, string): mixed $mapRow
     * @return list<mixed>
     */
    public static function dataList(mixed $raw, callable $mapRow): array
    {
        return self::mapList(ResponseValidator::body($raw), 'data', 'data', $mapRow);
    }

    /**
     * @param callable(array, string): mixed $mapRow
     */
    public static function page(mixed $raw, callable $mapRow): Page
    {
        $body = ResponseValidator::body($raw);
        $rows = self::mapList($body, 'data', 'data', $mapRow);

        return new Page(
            page: self::int($body, 'page', 'page'),
            limit: self::int($body, 'limit', 'limit'),
            data: $rows,
        );
    }

    /**
     * The `{ success, data: { id, deleted } }` answer of a DELETE.
     */
    public static function deletedResource(mixed $raw): DeletedResource
    {
        $data = self::dataObject($raw);

        return new DeletedResource(
            id: ResponseValidator::requiredStringOrNumber($data, 'id', 'data.id'),
            deleted: self::bool($data, 'deleted', 'data.deleted'),
        );
    }

    /**
     * A required JSON array (not an object) of objects.
     *
     * @param callable(array, string): mixed $mapRow
     * @return list<mixed>
     */
    public static function mapList(array $source, string $key, string $field, callable $mapRow): array
    {
        $rows = ResponseValidator::requiredArray($source, $key, $field);
        if (!array_is_list($rows)) {
            self::malformed($field, 'must be an array');
        }

        $mapped = [];
        foreach ($rows as $index => $row) {
            $rowField = sprintf('%s[%d]', $field, $index);
            $mapped[] = $mapRow(ResponseValidator::arrayValue($row, $rowField), $rowField);
        }

        return $mapped;
    }

    public static function bool(array $source, string $key, string $field): bool
    {
        $value = self::required($source, $key, $field);
        if (!is_bool($value)) {
            self::malformed($field, 'must be a boolean');
        }

        return $value;
    }

    /**
     * A required integer. A float with no fractional part (JSON `3.0`) is
     * accepted, because JSON does not separate the two.
     */
    public static function int(array $source, string $key, string $field): int
    {
        $value = self::required($source, $key, $field);
        if (is_int($value)) {
            return $value;
        }
        if (
            is_float($value)
            && is_finite($value)
            && floor($value) === $value
            && abs($value) <= 9007199254740992.0
        ) {
            return (int) $value;
        }

        self::malformed($field, 'must be an integer');
    }

    public static function number(array $source, string $key, string $field): int|float
    {
        $value = self::required($source, $key, $field);
        if (is_int($value) || (is_float($value) && is_finite($value))) {
            return $value;
        }

        self::malformed($field, 'must be a number');
    }

    public static function nullableNumber(array $source, string $key, string $field): int|float|null
    {
        if (!array_key_exists($key, $source) || $source[$key] === null) {
            return null;
        }
        $value = $source[$key];
        if (is_int($value) || (is_float($value) && is_finite($value))) {
            return $value;
        }

        self::malformed($field, 'must be a number or null');
    }

    public static function nullableString(array $source, string $key, string $field): ?string
    {
        return ResponseValidator::optionalNullableString($source, $key, $field);
    }

    /**
     * An id the API may send as a string or a number; missing or null gives null.
     */
    public static function nullableId(array $source, string $key, string $field): ?string
    {
        if (!array_key_exists($key, $source) || $source[$key] === null) {
            return null;
        }

        return ResponseValidator::requiredStringOrNumber($source, $key, $field);
    }

    /**
     * A nested object; missing or null gives null.
     */
    public static function nullableObject(array $source, string $key, string $field): ?array
    {
        if (!array_key_exists($key, $source) || $source[$key] === null) {
            return null;
        }

        return ResponseValidator::arrayValue($source[$key], $field);
    }

    /**
     * A required JSON array of strings.
     *
     * @return list<string>
     */
    public static function stringList(array $source, string $key, string $field): array
    {
        $values = ResponseValidator::requiredArray($source, $key, $field);
        if (!array_is_list($values)) {
            self::malformed($field, 'must be an array of strings');
        }
        foreach ($values as $index => $value) {
            if (!is_string($value)) {
                self::malformed(sprintf('%s[%d]', $field, $index), 'must be a string');
            }
        }

        return $values;
    }

    /**
     * Like stringList(), but a missing or null key gives an empty list.
     *
     * @return list<string>
     */
    public static function optionalStringList(array $source, string $key, string $field): array
    {
        if (!array_key_exists($key, $source) || $source[$key] === null) {
            return [];
        }

        return self::stringList($source, $key, $field);
    }

    public static function malformed(string $field, string $reason): never
    {
        ResponseValidator::malformed($field, $reason);
    }

    private static function required(array $source, string $key, string $field): mixed
    {
        if (!array_key_exists($key, $source)) {
            self::malformed($field, 'is missing');
        }

        return $source[$key];
    }
}
