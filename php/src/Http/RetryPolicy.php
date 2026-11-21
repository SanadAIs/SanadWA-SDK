<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Http;

use DateTimeImmutable;
use DateTimeZone;

final class RetryPolicy
{
    private const MAX_COMPUTED_BACKOFF_MS = 30000;
    private const MAX_RETRY_AFTER_MS = 60000;

    public static function parseRetryAfter(?string $header): ?int
    {
        if ($header === null || $header === '') {
            return null;
        }

        $trimmed = trim($header);
        if ($trimmed === '') {
            return null;
        }

        if (preg_match('/^-?\d+$/', $trimmed) === 1) {
            $seconds = (int) $trimmed;
            if ($seconds < 0) {
                return null;
            }
            if ($seconds > intdiv(PHP_INT_MAX, 1000)) {
                return PHP_INT_MAX;
            }

            return $seconds * 1000;
        }

        $date = DateTimeImmutable::createFromFormat(
            DATE_RFC7231,
            $trimmed,
            new DateTimeZone('UTC'),
        );
        $dateErrors = DateTimeImmutable::getLastErrors();
        if (
            $date === false
            || ($dateErrors !== false
                && ($dateErrors['warning_count'] > 0 || $dateErrors['error_count'] > 0))
        ) {
            return null;
        }

        $delta = ($date->getTimestamp() * 1000) - (int) floor(microtime(true) * 1000);

        return $delta < 0 ? null : $delta;
    }

    public static function computeBackoff(int $attempt, ?int $retryAfterMs): int
    {
        if ($retryAfterMs !== null) {
            return min(self::MAX_RETRY_AFTER_MS, $retryAfterMs);
        }

        $exponential = 250 * (2 ** ($attempt - 1));

        return (int) min(self::MAX_COMPUTED_BACKOFF_MS, $exponential);
    }

    public static function isRetryable(int $status, string $code): bool
    {
        // After a WhatsApp failure the API marks the send "uncertain"; a repeat with the same key
        // is answered 409 `send_failed` and the original error is lost. Never retry it.
        if ($code === 'send_failed') {
            return false;
        }

        return $status === 429
            || ($status >= 500 && $status < 600)
            || ($status === 409 && $code === 'idempotency_in_progress');
    }
}
