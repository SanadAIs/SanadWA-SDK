<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Http;

use Sanadwa\WhatsApp\Exceptions\SanadApiError;

final class ResponseValidator
{
    public static function body(mixed $value): array
    {
        return self::arrayValue($value, 'body');
    }

    public static function requiredArray(array $source, string $key, ?string $field = null): array
    {
        $path = $field ?? $key;

        return self::arrayValue(self::required($source, $key, $path), $path);
    }

    public static function requiredString(array $source, string $key, ?string $field = null): string
    {
        $path = $field ?? $key;
        $value = self::required($source, $key, $path);
        if (!is_string($value)) {
            self::malformed($path, 'must be a string');
        }

        return $value;
    }

    public static function requiredNullableString(
        array $source,
        string $key,
        ?string $field = null,
    ): ?string {
        $path = $field ?? $key;
        $value = self::required($source, $key, $path);
        if ($value !== null && !is_string($value)) {
            self::malformed($path, 'must be a string or null');
        }

        return $value;
    }

    public static function optionalNullableString(
        array $source,
        string $key,
        ?string $field = null,
    ): ?string {
        if (!array_key_exists($key, $source) || $source[$key] === null) {
            return null;
        }

        $path = $field ?? $key;
        if (!is_string($source[$key])) {
            self::malformed($path, 'must be a string or null');
        }

        return $source[$key];
    }

    public static function requiredInt(array $source, string $key, ?string $field = null): int
    {
        $path = $field ?? $key;
        $value = self::required($source, $key, $path);
        if (!is_int($value)) {
            self::malformed($path, 'must be an integer');
        }

        return $value;
    }

    public static function requiredStringOrNumber(
        array $source,
        string $key,
        ?string $field = null,
    ): string {
        $path = $field ?? $key;
        $value = self::required($source, $key, $path);
        if (is_string($value) || is_int($value)) {
            return (string) $value;
        }
        if (is_float($value) && is_finite($value)) {
            return (string) $value;
        }

        self::malformed($path, 'must be a string or number');
    }

    /**
     * A missing key or JSON `null` gives null; a string or number gives its string form.
     */
    public static function optionalNullableStringOrNumber(
        array $source,
        string $key,
        ?string $field = null,
    ): ?string {
        if (!array_key_exists($key, $source) || $source[$key] === null) {
            return null;
        }

        $value = $source[$key];
        if (is_string($value) || is_int($value)) {
            return (string) $value;
        }
        if (is_float($value) && is_finite($value)) {
            return (string) $value;
        }

        self::malformed($field ?? $key, 'must be a string, a number or null');
    }

    public static function arrayValue(mixed $value, string $field): array
    {
        if (!is_array($value)) {
            self::malformed($field, 'must be an object or array');
        }

        return $value;
    }

    private static function required(array $source, string $key, string $field): mixed
    {
        if (!array_key_exists($key, $source)) {
            self::malformed($field, 'is missing');
        }

        return $source[$key];
    }

    private static function malformed(string $field, string $reason): never
    {
        throw new SanadApiError(
            message: sprintf('Malformed response: field `%s` %s.', $field, $reason),
            code: 'malformed_response',
            status: 0,
        );
    }
}
