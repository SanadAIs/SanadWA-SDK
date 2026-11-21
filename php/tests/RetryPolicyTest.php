<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Http\RetryPolicy;

final class RetryPolicyTest extends TestCase
{
    #[DataProvider('retryAfterProvider')]
    public function testParseRetryAfter(?string $header, ?int $expected): void
    {
        self::assertSame($expected, @RetryPolicy::parseRetryAfter($header));
    }

    public static function retryAfterProvider(): iterable
    {
        yield 'zero' => ['0', 0];
        yield 'seconds' => ['5', 5000];
        yield 'trimmed seconds' => [' 10 ', 10000];
        yield 'past HTTP date' => [gmdate('D, d M Y H:i:s \\G\\M\\T', time() - 60), null];
        yield 'invalid date' => ['not-a-date', null];
        yield 'null' => [null, null];
        yield 'empty' => ['', null];
        yield 'negative integer' => ['-5', null];
        yield 'relative date text' => ['tomorrow', null];
        yield 'fractional seconds' => ['1.5', null];
        yield 'overflowing seconds' => ['99999999999999999999', PHP_INT_MAX];
    }

    public function testParseRetryAfterAcceptsFutureHttpDate(): void
    {
        $milliseconds = @RetryPolicy::parseRetryAfter(
            gmdate('D, d M Y H:i:s \\G\\M\\T', time() + 3),
        );

        self::assertNotNull($milliseconds);
        self::assertGreaterThanOrEqual(1500, $milliseconds);
        self::assertLessThanOrEqual(3500, $milliseconds);
    }

    #[DataProvider('backoffProvider')]
    public function testComputeBackoff(int $attempt, ?int $retryAfterMs, int $expected): void
    {
        self::assertSame($expected, RetryPolicy::computeBackoff($attempt, $retryAfterMs));
    }

    public static function backoffProvider(): iterable
    {
        yield 'attempt 1' => [1, null, 250];
        yield 'attempt 2' => [2, null, 500];
        yield 'attempt 3' => [3, null, 1000];
        yield 'attempt 8 cap' => [8, null, 30000];
        yield 'attempt 20 cap' => [20, null, 30000];
        yield 'retry-after override' => [1, 5000, 5000];
        yield 'small retry-after override' => [7, 100, 100];
        yield 'retry-after below the cap' => [1, 45000, 45000];
        yield 'retry-after at the cap' => [1, 60000, 60000];
        yield 'retry-after cap' => [1, 3600000, 60000];
        yield 'retry-after 120s cap' => [3, 120000, 60000];
    }

    #[DataProvider('retryableProvider')]
    public function testIsRetryable(int $status, string $code, bool $expected): void
    {
        self::assertSame($expected, RetryPolicy::isRetryable($status, $code));
    }

    public static function retryableProvider(): iterable
    {
        yield '429 rate_limited' => [429, 'rate_limited', true];
        yield '409 in progress' => [409, 'idempotency_in_progress', true];
        yield '409 conflict' => [409, 'idempotency_conflict', false];
        yield '409 campaign_busy' => [409, 'campaign_busy', false];
        yield '500' => [500, 'server_error', true];
        yield '503' => [503, 'balance_check_failed', true];
        yield '599' => [599, 'unknown_error', true];
        yield '400' => [400, 'validation_error', false];
        yield '401' => [401, 'unauthorized', false];
        yield '402' => [402, 'insufficient_credits', false];
        yield '403' => [403, 'forbidden', false];
        yield '404' => [404, 'not_found', false];
        yield '413' => [413, 'PAYLOAD_TOO_LARGE', false];
        yield '415' => [415, 'import_file_not_csv', false];
        yield '422' => [422, 'audience_empty', false];
        yield 'send_failed 429' => [429, 'send_failed', false];
        yield 'send_failed 500' => [500, 'send_failed', false];
        yield 'send_failed 503' => [503, 'send_failed', false];
        yield 'send_failed 409' => [409, 'send_failed', false];
    }
}
