<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Exception\RequestException;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Dto\SendMessageOptions;
use Sanadwa\WhatsApp\Exceptions\RateLimitedError;
use Sanadwa\WhatsApp\Exceptions\SanadApiError;
use Sanadwa\WhatsApp\Exceptions\SendFailedError;
use Sanadwa\WhatsApp\Exceptions\ServerError;
use Sanadwa\WhatsApp\Exceptions\ValidationError;
use Sanadwa\WhatsApp\SanadWhatsApp;
use Sanadwa\WhatsApp\Tests\Support\FakeHttpClient;
use Sanadwa\WhatsApp\Tests\Support\FakeNetworkException;

final class RetryTest extends TestCase
{
    #[DataProvider('retryableResponseProvider')]
    public function testRetryableResponseIsRetried(int $status, string $code): void
    {
        $client = new FakeHttpClient([
            $this->errorResponse($status, $code),
            $this->healthResponse(),
        ]);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps);

        $health = $sdk->health();

        self::assertSame('tenant-1', $health->tenantId);
        self::assertCount(2, $client->requests);
        self::assertSame([250], $sleeps);
    }

    public static function retryableResponseProvider(): iterable
    {
        yield '429' => [429, 'rate_limited'];
        yield '500' => [500, 'server_error'];
        yield '503' => [503, 'balance_check_failed'];
        yield '409 in progress' => [409, 'idempotency_in_progress'];
    }

    public function testNonRetryableConflictIsNotRetried(): void
    {
        $client = new FakeHttpClient([
            $this->errorResponse(409, 'idempotency_conflict'),
            $this->healthResponse(),
        ]);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps);

        try {
            $sdk->health();
            self::fail('Expected ValidationError.');
        } catch (ValidationError) {
            self::assertCount(1, $client->requests);
            self::assertSame([], $sleeps);
        }
    }

    public function testIdempotencyKeyIsStableAcrossSendRetry(): void
    {
        $client = new FakeHttpClient([
            $this->errorResponse(500, 'server_error'),
            new Response(200, [], json_encode([
                'success' => true,
                'message_id' => 'msg-1',
                'accepted_at' => '2026-05-10T12:00:00.000Z',
            ], JSON_THROW_ON_ERROR)),
        ]);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps);

        $sdk->messages()->send(new SendMessageOptions('phone-id', '+966500000000', 'hello_world'));

        self::assertCount(2, $client->requests);
        $first = $client->requests[0]->getHeaderLine('Idempotency-Key');
        $second = $client->requests[1]->getHeaderLine('Idempotency-Key');
        self::assertNotSame('', $first);
        self::assertSame($first, $second);
    }

    public function testCallerIdempotencyKeyIsExactAndStableAcrossSendRetry(): void
    {
        $client = new FakeHttpClient([
            $this->errorResponse(500, 'server_error'),
            new Response(200, [], json_encode([
                'success' => true,
                'message_id' => 'msg-1',
                'accepted_at' => '2026-05-10T12:00:00.000Z',
            ], JSON_THROW_ON_ERROR)),
        ]);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps);

        $sdk->messages()->send(new SendMessageOptions(
            'phone-id',
            '+966500000000',
            'hello_world',
            idempotencyKey: 'caller-key-123',
        ));

        self::assertCount(2, $client->requests);
        self::assertSame(
            'caller-key-123',
            $client->requests[0]->getHeaderLine('Idempotency-Key'),
        );
        self::assertSame(
            'caller-key-123',
            $client->requests[1]->getHeaderLine('Idempotency-Key'),
        );
    }

    public function testRetryAfterOverridesBackoff(): void
    {
        $client = new FakeHttpClient([
            $this->errorResponse(429, 'rate_limited', ['Retry-After' => '3']),
            $this->healthResponse(),
        ]);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps);

        $sdk->health();

        self::assertSame([3000], $sleeps);
    }

    public function testRetryAfterBelowTheCapIsHonoured(): void
    {
        $client = new FakeHttpClient([
            $this->errorResponse(429, 'rate_limited', ['Retry-After' => '45']),
            $this->healthResponse(),
        ]);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps);

        $sdk->health();

        self::assertSame([45000], $sleeps);
    }

    public function testRetryAfterSleepIsCappedAtSixtySeconds(): void
    {
        $client = new FakeHttpClient([
            $this->errorResponse(429, 'rate_limited', ['Retry-After' => '120']),
            $this->errorResponse(429, 'rate_limited', ['Retry-After' => '120']),
        ]);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps);

        try {
            $sdk->health();
            self::fail('Expected RateLimitedError.');
        } catch (RateLimitedError $error) {
            self::assertSame([60000], $sleeps);
            self::assertSame(120, $error->retryAfterSec);
        }
    }

    public function testRetryAfterIsHonouredOnServerErrors(): void
    {
        $client = new FakeHttpClient([
            $this->errorResponse(503, 'campaign_create_timeout', ['Retry-After' => '60']),
            $this->healthResponse(),
        ]);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps);

        $sdk->health();

        self::assertSame([60000], $sleeps);
    }

    public function testComputedBackoffIsStillCappedAtThirtySeconds(): void
    {
        $responses = [];
        for ($i = 0; $i < 9; $i++) {
            $responses[] = $this->errorResponse(500, 'server_error');
        }
        $responses[] = $this->healthResponse();
        $client = new FakeHttpClient($responses);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps, 10);

        $sdk->health();

        self::assertSame(
            [250, 500, 1000, 2000, 4000, 8000, 16000, 30000, 30000],
            $sleeps,
        );
    }

    #[DataProvider('sendFailedStatusProvider')]
    public function testSendFailedIsNeverRetried(int $status): void
    {
        $client = new FakeHttpClient([
            $this->errorResponse($status, 'send_failed', ['Retry-After' => '1']),
            $this->healthResponse(),
        ]);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps, 5);

        try {
            $sdk->health();
            self::fail('Expected SendFailedError.');
        } catch (SendFailedError $error) {
            self::assertSame($status, $error->status);
            self::assertCount(1, $client->requests);
            self::assertSame([], $sleeps);
        }
    }

    public static function sendFailedStatusProvider(): iterable
    {
        yield '500' => [500];
        yield '503' => [503];
        yield '429' => [429];
        yield '409' => [409];
    }

    #[DataProvider('neverRetriedProvider')]
    public function testNonRetryableStatusIsNotRetried(int $status, string $code): void
    {
        $client = new FakeHttpClient([
            $this->errorResponse($status, $code),
            $this->healthResponse(),
        ]);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps, 5);

        try {
            $sdk->health();
            self::fail('Expected SanadApiError.');
        } catch (SanadApiError $error) {
            self::assertSame($code, $error->code);
            self::assertCount(1, $client->requests);
            self::assertSame([], $sleeps);
        }
    }

    public static function neverRetriedProvider(): iterable
    {
        yield '400' => [400, 'validation_error'];
        yield '401' => [401, 'unauthorized'];
        yield '402' => [402, 'insufficient_credits'];
        yield '403' => [403, 'kyc_required'];
        yield '404' => [404, 'tag_not_found'];
        yield '409 campaign_busy' => [409, 'campaign_busy'];
        yield '413' => [413, 'PAYLOAD_TOO_LARGE'];
        yield '415' => [415, 'import_file_not_csv'];
        yield '422' => [422, 'audience_empty'];
    }

    public function testNetworkFailureIsRetriedThenSucceeds(): void
    {
        $client = new FakeHttpClient([
            new FakeNetworkException(new Request('GET', 'https://example.test')),
            $this->healthResponse(),
        ]);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps);

        self::assertSame('tenant-1', $sdk->health()->tenantId);
        self::assertCount(2, $client->requests);
        self::assertSame([250], $sleeps);
    }

    public function testGuzzleTimeoutIsRetriedThenSucceeds(): void
    {
        $client = new FakeHttpClient([
            $this->timeoutException(),
            $this->healthResponse(),
        ]);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps);

        self::assertSame('tenant-1', $sdk->health()->tenantId);
        self::assertSame([250], $sleeps);
    }

    public function testGuzzleTimeoutExhaustsAttemptsWithTimeoutCode(): void
    {
        $client = new FakeHttpClient([
            $this->timeoutException(),
            $this->timeoutException(),
        ]);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps);

        try {
            $sdk->health();
            self::fail('Expected ServerError.');
        } catch (ServerError $error) {
            self::assertSame('timeout', $error->code);
            self::assertSame(0, $error->status);
            self::assertInstanceOf(ConnectException::class, $error->getPrevious());
            self::assertCount(2, $client->requests);
            self::assertSame([250], $sleeps);
        }
    }

    public function testGuzzleRequestExceptionWithTimeoutErrnoIsTimeout(): void
    {
        $request = new Request('GET', 'https://example.test');
        $client = new FakeHttpClient([
            new RequestException('Operation timed out', $request, null, null, ['errno' => 28]),
        ]);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps, 1);

        try {
            $sdk->health();
            self::fail('Expected ServerError.');
        } catch (ServerError $error) {
            self::assertSame('timeout', $error->code);
        }
    }

    public function testGuzzleConnectFailureWithOtherErrnoIsNetworkError(): void
    {
        $request = new Request('GET', 'https://example.test');
        $client = new FakeHttpClient([
            new ConnectException('Could not resolve host', $request, null, ['errno' => 6]),
        ]);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps, 1);

        try {
            $sdk->health();
            self::fail('Expected ServerError.');
        } catch (ServerError $error) {
            self::assertSame('network_error', $error->code);
            self::assertSame(0, $error->status);
        }
    }

    #[DataProvider('retryableWriteProvider')]
    public function testIdempotencyKeyIsIdenticalAcrossEveryRetriedAttempt(
        int|string $failure,
        string $code,
    ): void {
        $first = is_int($failure)
            ? $this->errorResponse($failure, $code)
            : new FakeNetworkException(new Request('POST', 'https://example.test'));
        $client = new FakeHttpClient([
            $first,
            new Response(200, [], json_encode([
                'success' => true,
                'message_id' => 'wamid.FAKE_RETRY_0001',
                'accepted_at' => '2026-11-21T10:00:00.000Z',
            ], JSON_THROW_ON_ERROR)),
        ]);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps);

        $sdk->messages()->send(new SendMessageOptions(
            '123456789',
            '+12025550123',
            'hello_world',
        ));

        self::assertCount(2, $client->requests);
        $key = $client->requests[0]->getHeaderLine('Idempotency-Key');
        self::assertNotSame('', $key);
        self::assertSame($key, $client->requests[1]->getHeaderLine('Idempotency-Key'));
    }

    public static function retryableWriteProvider(): iterable
    {
        yield '429' => [429, 'rate_limited'];
        yield '409 in progress' => [409, 'idempotency_in_progress'];
        yield '500' => [500, 'server_error'];
        yield '503' => [503, 'server_busy'];
        yield 'network failure' => ['network', ''];
    }

    public function testHttpDateRetryAfterOverridesBackoff(): void
    {
        $client = new FakeHttpClient([
            $this->errorResponse(429, 'rate_limited', [
                'Retry-After' => gmdate('D, d M Y H:i:s \\G\\M\\T', time() + 3),
            ]),
            $this->healthResponse(),
        ]);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps);

        @$sdk->health();

        self::assertCount(1, $sleeps);
        self::assertGreaterThanOrEqual(1500, $sleeps[0]);
        self::assertLessThanOrEqual(3500, $sleeps[0]);
    }

    public function testNetworkFailureExhaustsAttempts(): void
    {
        $dummyRequest = new Request('GET', 'https://example.test');
        $client = new FakeHttpClient([
            new FakeNetworkException($dummyRequest),
            new FakeNetworkException($dummyRequest),
            new FakeNetworkException($dummyRequest),
        ]);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps, 3);

        try {
            $sdk->health();
            self::fail('Expected ServerError.');
        } catch (ServerError $error) {
            self::assertSame('network_error', $error->code);
            self::assertSame(0, $error->status);
            self::assertSame('Network error', $error->getMessage());
            self::assertInstanceOf(FakeNetworkException::class, $error->getPrevious());
            self::assertCount(3, $client->requests);
            self::assertSame([250, 500], $sleeps);
        }
    }

    private function timeoutException(): ConnectException
    {
        return new ConnectException(
            'cURL error 28: Operation timed out',
            new Request('GET', 'https://example.test'),
            null,
            ['errno' => 28],
        );
    }

    private function sdk(FakeHttpClient $client, array &$sleeps, int $retries = 2): SanadWhatsApp
    {
        return new SanadWhatsApp([
            'apiKey' => 'pk_test',
            'retries' => $retries,
            'httpClient' => $client,
            'sleeper' => static function (int $milliseconds) use (&$sleeps): void {
                $sleeps[] = $milliseconds;
            },
        ]);
    }

    private function errorResponse(int $status, string $code, array $headers = []): Response
    {
        return new Response($status, $headers, json_encode([
            'success' => false,
            'code' => $code,
            'message' => 'Retry test error',
        ], JSON_THROW_ON_ERROR));
    }

    private function healthResponse(): Response
    {
        return new Response(200, [], json_encode([
            'success' => true,
            'tenant_id' => 'tenant-1',
            'scope' => 'messages:send',
            'server_time' => '2026-05-10T12:00:00.000Z',
        ], JSON_THROW_ON_ERROR));
    }
}
