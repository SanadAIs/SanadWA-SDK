<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Dto\Template;
use Sanadwa\WhatsApp\Exceptions\SanadApiError;
use Sanadwa\WhatsApp\SanadWhatsApp;
use Sanadwa\WhatsApp\Tests\Support\FakeHttpClient;

final class HealthTemplatesTest extends TestCase
{
    public function testHealthMapsSnakeCaseResponse(): void
    {
        $client = new FakeHttpClient([
            new Response(200, [], json_encode([
                'success' => true,
                'tenant_id' => 7,
                'scope' => 'messages:send templates:read',
                'server_time' => '2026-05-10T12:00:00.000Z',
            ], JSON_THROW_ON_ERROR)),
        ]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test', 'httpClient' => $client]);

        $health = $sdk->health();

        self::assertSame('7', $health->tenantId);
        self::assertSame('messages:send templates:read', $health->scope);
        self::assertSame('2026-05-10T12:00:00.000Z', $health->serverTime);
        self::assertSame('/v1/health', $client->requests[0]->getUri()->getPath());
        self::assertSame('', $client->requests[0]->getUri()->getQuery());
        self::assertFalse($client->requests[0]->hasHeader('Idempotency-Key'));
        self::assertFalse($client->requests[0]->hasHeader('Content-Type'));
    }

    public function testTemplatesWithoutOptionsHasNoQueryAndMapsDtos(): void
    {
        $client = new FakeHttpClient([$this->templatesResponse()]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test', 'httpClient' => $client]);

        $response = $sdk->templates()->list();

        self::assertSame('', $client->requests[0]->getUri()->getQuery());
        self::assertSame(1, $response->page);
        self::assertSame(20, $response->limit);
        self::assertCount(1, $response->data);
        self::assertEquals(
            new Template('hello_world', 'en', 'UTILITY', 'APPROVED', [['type' => 'BODY']]),
            $response->data[0],
        );
        self::assertFalse($client->requests[0]->hasHeader('Idempotency-Key'));
        self::assertFalse($client->requests[0]->hasHeader('Content-Type'));
    }

    public function testTemplatesQueryUsesPageLimitQInsertionOrder(): void
    {
        $client = new FakeHttpClient([$this->templatesResponse()]);
        $sdk = new SanadWhatsApp([
            'apiKey' => 'pk_test',
            'baseUrl' => 'https://example.test/api/',
            'httpClient' => $client,
        ]);

        $sdk->templates()->list(page: 2, limit: 10, q: 'hello world');

        self::assertSame(
            'https://example.test/api/templates?page=2&limit=10&q=hello+world',
            (string) $client->requests[0]->getUri(),
        );
        self::assertFalse($client->requests[0]->hasHeader('Idempotency-Key'));
        self::assertFalse($client->requests[0]->hasHeader('Content-Type'));
    }

    public function testNullSuccessBodyIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([new Response(204)]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test', 'httpClient' => $client]);

        try {
            $sdk->health();
            self::fail('Expected SanadApiError.');
        } catch (SanadApiError $error) {
            self::assertSame('malformed_response', $error->code);
            self::assertStringContainsString('body', $error->getMessage());
        }
    }

    public function testMissingHealthFieldIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([
            new Response(200, [], json_encode([
                'success' => true,
                'tenant_id' => 7,
                'server_time' => '2026-05-10T12:00:00.000Z',
            ], JSON_THROW_ON_ERROR)),
        ]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test', 'httpClient' => $client]);

        try {
            $sdk->health();
            self::fail('Expected SanadApiError.');
        } catch (SanadApiError $error) {
            self::assertSame('malformed_response', $error->code);
            self::assertStringContainsString('scope', $error->getMessage());
        }
    }

    public function testMissingTemplatesDataIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([
            new Response(200, [], json_encode([
                'success' => true,
                'page' => 1,
                'limit' => 20,
            ], JSON_THROW_ON_ERROR)),
        ]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test', 'httpClient' => $client]);

        try {
            $sdk->templates()->list();
            self::fail('Expected SanadApiError.');
        } catch (SanadApiError $error) {
            self::assertSame('malformed_response', $error->code);
            self::assertStringContainsString('data', $error->getMessage());
        }
    }

    public function testInvalidSuccessJsonIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([
            new Response(200, ['x-request-id' => 'req_bad_json'], '{bad json'),
        ]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test', 'httpClient' => $client]);

        try {
            $sdk->health();
            self::fail('Expected SanadApiError.');
        } catch (SanadApiError $error) {
            self::assertSame('malformed_response', $error->code);
            self::assertSame(200, $error->status);
            self::assertSame('req_bad_json', $error->requestId);
            self::assertStringContainsString('body', $error->getMessage());
            self::assertInstanceOf(\JsonException::class, $error->getPrevious());
        }
    }

    private function templatesResponse(): Response
    {
        return new Response(200, [], json_encode([
            'success' => true,
            'page' => 1,
            'limit' => 20,
            'data' => [[
                'name' => 'hello_world',
                'language' => 'en',
                'category' => 'UTILITY',
                'status' => 'APPROVED',
                'components' => [['type' => 'BODY']],
            ]],
        ], JSON_THROW_ON_ERROR));
    }
}
