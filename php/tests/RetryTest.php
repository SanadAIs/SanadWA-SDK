<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Dto\SendMessageOptions;
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

    public function testRetryAfterSleepIsCappedAtThirtySeconds(): void
    {
        $client = new FakeHttpClient([
            $this->errorResponse(429, 'rate_limited', ['Retry-After' => '3600']),
            $this->healthResponse(),
        ]);
        $sleeps = [];
        $sdk = $this->sdk($client, $sleeps);

        $sdk->health();

        self::assertSame([30000], $sleeps);
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
