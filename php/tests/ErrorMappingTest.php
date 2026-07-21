<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Exceptions\AuthError;
use Sanadwa\WhatsApp\Exceptions\NotFoundError;
use Sanadwa\WhatsApp\Exceptions\RateLimitedError;
use Sanadwa\WhatsApp\Exceptions\SanadApiError;
use Sanadwa\WhatsApp\Exceptions\ServerError;
use Sanadwa\WhatsApp\Exceptions\ValidationError;
use Sanadwa\WhatsApp\SanadWhatsApp;
use Sanadwa\WhatsApp\Tests\Support\FakeHttpClient;

final class ErrorMappingTest extends TestCase
{
    #[DataProvider('errorProvider')]
    public function testHttpStatusMapsToExpectedError(
        int $status,
        string $code,
        string $expectedClass,
        array $headers = [],
        ?string $upstreamCode = null,
    ): void {
        $headers['x-request-id'] = 'req_test_123';
        $body = ['success' => false, 'code' => $code, 'message' => 'Wire message'];
        if ($upstreamCode !== null) {
            $body['upstream_code'] = $upstreamCode;
        }
        $client = new FakeHttpClient([
            new Response($status, $headers, json_encode($body, JSON_THROW_ON_ERROR)),
        ]);
        $sdk = new SanadWhatsApp([
            'apiKey' => 'pk_test',
            'retries' => 1,
            'httpClient' => $client,
        ]);

        try {
            $sdk->health();
            self::fail('Expected a Sanad API error.');
        } catch (SanadApiError $error) {
            if ($expectedClass === SanadApiError::class) {
                self::assertSame(SanadApiError::class, $error::class);
            } else {
                self::assertInstanceOf($expectedClass, $error);
            }
            self::assertSame($code, $error->code);
            self::assertSame($status, $error->status);
            self::assertSame('req_test_123', $error->requestId);
            self::assertSame('Wire message', $error->getMessage());
            self::assertSame(0, $error->getCode());
            self::assertNull($error->messageAr);
            self::assertSame([], $error->details);
            self::assertSame($upstreamCode, $error->upstreamCode);
            self::assertSame($body, $error->rawBody);

            if ($error instanceof RateLimitedError) {
                self::assertSame($status === 429 ? 2 : null, $error->retryAfterSec);
            }
        }
    }

    public static function errorProvider(): iterable
    {
        yield '400' => [400, 'invalid_request', ValidationError::class];
        yield '401' => [401, 'unauthorized', AuthError::class];
        yield '403' => [403, 'forbidden', AuthError::class];
        yield '404' => [404, 'not_found', NotFoundError::class];
        yield '409 in progress' => [409, 'idempotency_in_progress', RateLimitedError::class];
        yield '409 conflict' => [409, 'idempotency_conflict', ValidationError::class];
        yield '429' => [429, 'rate_limited', RateLimitedError::class, ['Retry-After' => '2']];
        yield '500' => [500, 'upstream_failure', ServerError::class, [], 'META_131000'];
        yield '418 fallback' => [418, 'teapot', SanadApiError::class];
    }

    public function testMissingErrorFieldsUseDefaults(): void
    {
        $client = new FakeHttpClient([
            new Response(418, [], '{}'),
        ]);
        $sdk = new SanadWhatsApp([
            'apiKey' => 'pk_test',
            'retries' => 1,
            'httpClient' => $client,
        ]);

        try {
            $sdk->health();
            self::fail('Expected a Sanad API error.');
        } catch (SanadApiError $error) {
            self::assertSame('unknown_error', $error->code);
            self::assertSame('Request failed with status 418', $error->getMessage());
            self::assertNull($error->requestId);
            self::assertTrue(SanadApiError::is($error));
        }
    }

    public function testIdempotencyInProgressIncludesRetryAfter(): void
    {
        $client = new FakeHttpClient([
            new Response(409, ['Retry-After' => '2'], json_encode([
                'success' => false,
                'code' => 'idempotency_in_progress',
                'message' => 'Still processing',
            ], JSON_THROW_ON_ERROR)),
        ]);
        $sdk = new SanadWhatsApp([
            'apiKey' => 'pk_test',
            'retries' => 1,
            'httpClient' => $client,
        ]);

        try {
            $sdk->health();
            self::fail('Expected RateLimitedError.');
        } catch (RateLimitedError $error) {
            self::assertSame(2, $error->retryAfterSec);
        }
    }

    public function testLivePrepaidCapErrorPreservesAllDetails(): void
    {
        $body = [
            'success' => false,
            'code' => 'prepaid_cap_exceeded',
            'message' => 'Prepaid messaging cap exceeded',
            'message_ar' => 'تم تجاوز حد الرسائل المدفوعة مسبقاً',
            'details' => [
                'cap_sar' => 100,
                'spent_sar' => 100,
                'required_sar' => 0.25,
            ],
        ];
        $client = new FakeHttpClient([
            new Response(402, ['x-request-id' => 'req_cap'], json_encode(
                $body,
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE,
            )),
        ]);
        $sdk = new SanadWhatsApp([
            'apiKey' => 'pk_test',
            'retries' => 1,
            'httpClient' => $client,
        ]);

        try {
            $sdk->health();
            self::fail('Expected SanadApiError.');
        } catch (SanadApiError $error) {
            self::assertSame(SanadApiError::class, $error::class);
            self::assertSame('prepaid_cap_exceeded', $error->code);
            self::assertSame('تم تجاوز حد الرسائل المدفوعة مسبقاً', $error->messageAr);
            self::assertSame($body['details'], $error->details);
            self::assertNull($error->upstreamCode);
            self::assertSame($body, $error->rawBody);
        }
    }

    public function testSendFailedValidationErrorPreservesUpstreamCode(): void
    {
        $body = [
            'success' => false,
            'code' => 'send_failed',
            'message' => 'Meta rejected the message',
            'message_ar' => 'رفضت ميتا الرسالة',
            'details' => ['phone_number_id' => '123456789'],
            'upstream_code' => 'META_131047',
        ];
        $client = new FakeHttpClient([
            new Response(400, [], json_encode(
                $body,
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE,
            )),
        ]);
        $sdk = new SanadWhatsApp([
            'apiKey' => 'pk_test',
            'retries' => 1,
            'httpClient' => $client,
        ]);

        try {
            $sdk->health();
            self::fail('Expected ValidationError.');
        } catch (ValidationError $error) {
            self::assertSame('send_failed', $error->code);
            self::assertSame('META_131047', $error->upstreamCode);
            self::assertSame('رفضت ميتا الرسالة', $error->messageAr);
            self::assertSame($body['details'], $error->details);
            self::assertSame($body, $error->rawBody);
        }
    }

    public function testRateLimitReportsUncappedRawRetryAfter(): void
    {
        $client = new FakeHttpClient([
            new Response(429, ['Retry-After' => '3600'], json_encode([
                'success' => false,
                'code' => 'rate_limited',
                'message' => 'Slow down',
            ], JSON_THROW_ON_ERROR)),
        ]);
        $sdk = new SanadWhatsApp([
            'apiKey' => 'pk_test',
            'retries' => 1,
            'httpClient' => $client,
        ]);

        try {
            $sdk->health();
            self::fail('Expected RateLimitedError.');
        } catch (RateLimitedError $error) {
            self::assertSame(3600, $error->retryAfterSec);
        }
    }

    #[DataProvider('nonJsonErrorBodyProvider')]
    public function testNonJsonErrorBodyUsesServerErrorDefaults(
        int $status,
        string $body,
        string $expectedMessage,
    ): void {
        $client = new FakeHttpClient([new Response($status, [], $body)]);
        $sdk = new SanadWhatsApp([
            'apiKey' => 'pk_test',
            'retries' => 1,
            'httpClient' => $client,
        ]);

        try {
            $sdk->health();
            self::fail('Expected ServerError.');
        } catch (ServerError $error) {
            self::assertSame('unknown_error', $error->code);
            self::assertSame($expectedMessage, $error->getMessage());
        }
    }

    public static function nonJsonErrorBodyProvider(): iterable
    {
        yield 'HTML gateway response' => [
            502,
            '<html>Bad Gateway</html>',
            'Request failed with status 502',
        ];
        yield 'JSON scalar response' => [500, '"oops"', 'Request failed with status 500'];
    }
}
