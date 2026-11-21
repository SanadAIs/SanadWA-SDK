<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Dto\Template;
use Sanadwa\WhatsApp\Exceptions\NotFoundError;
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

    public function testTemplatesQueryAddsPhoneNumberIdAndWabaIdInOrder(): void
    {
        $client = new FakeHttpClient([$this->templatesResponse()]);
        $sdk = new SanadWhatsApp([
            'apiKey' => 'pk_test_fake_key',
            'baseUrl' => 'https://api.example.test/v1',
            'httpClient' => $client,
        ]);

        $sdk->templates()->list(
            wabaId: '200000000000002',
            phoneNumberId: '100000000000001',
            q: 'hello',
            limit: 10,
            page: 2,
        );

        self::assertSame(
            'page=2&limit=10&q=hello&phone_number_id=100000000000001&waba_id=200000000000002',
            $client->requests[0]->getUri()->getQuery(),
        );
    }

    public function testTemplatesFiltersAreSentAloneWhenOnlyTheyAreSet(): void
    {
        $client = new FakeHttpClient([$this->templatesResponse(), $this->templatesResponse()]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test_fake_key', 'httpClient' => $client]);

        $sdk->templates()->list(phoneNumberId: '100000000000001');
        $sdk->templates()->list(null, null, null, null, '200000000000002');

        self::assertSame(
            'phone_number_id=100000000000001',
            $client->requests[0]->getUri()->getQuery(),
        );
        self::assertSame('waba_id=200000000000002', $client->requests[1]->getUri()->getQuery());
    }

    public function testTemplateRowMapsWabaId(): void
    {
        $client = new FakeHttpClient([$this->templatesResponseWithRows([[
            'name' => 'hello_world',
            'language' => 'en',
            'category' => 'UTILITY',
            'status' => 'APPROVED',
            'waba_id' => '200000000000002',
            'components' => [['type' => 'BODY']],
        ]])]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test_fake_key', 'httpClient' => $client]);

        $template = $sdk->templates()->list()->data[0];

        self::assertSame('200000000000002', $template->wabaId);
        self::assertSame('UTILITY', $template->category);
        self::assertSame([['type' => 'BODY']], $template->components);
    }

    public function testTemplateNumericWabaIdIsCoercedToString(): void
    {
        $client = new FakeHttpClient([$this->templatesResponseWithRows([[
            'name' => 'hello_world',
            'language' => 'en',
            'category' => 'UTILITY',
            'status' => 'APPROVED',
            'waba_id' => 200000000000002,
        ]])]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test_fake_key', 'httpClient' => $client]);

        self::assertSame('200000000000002', $sdk->templates()->list()->data[0]->wabaId);
    }

    public function testTemplateNullCategoryAndMissingWabaIdAreAccepted(): void
    {
        $client = new FakeHttpClient([$this->templatesResponseWithRows([
            ['name' => 'no_category', 'language' => 'ar', 'category' => null, 'status' => 'APPROVED'],
            ['name' => 'missing_category', 'language' => 'ar', 'status' => 'APPROVED', 'waba_id' => null],
        ])]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test_fake_key', 'httpClient' => $client]);

        $templates = $sdk->templates()->list()->data;

        self::assertCount(2, $templates);
        self::assertNull($templates[0]->category);
        self::assertNull($templates[0]->wabaId);
        self::assertNull($templates[0]->components);
        self::assertNull($templates[1]->category);
        self::assertNull($templates[1]->wabaId);
    }

    public function testTemplateMistypedCategoryIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([$this->templatesResponseWithRows([
            ['name' => 'bad', 'language' => 'ar', 'category' => 7, 'status' => 'APPROVED'],
        ])]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test_fake_key', 'httpClient' => $client]);

        try {
            $sdk->templates()->list();
            self::fail('Expected SanadApiError.');
        } catch (SanadApiError $error) {
            self::assertSame('malformed_response', $error->code);
            self::assertStringContainsString('data[0].category', $error->getMessage());
        }
    }

    public function testTemplateDtoKeepsPositionalCompatibility(): void
    {
        $template = new Template('hello_world', 'en', null, 'APPROVED');

        self::assertNull($template->category);
        self::assertNull($template->components);
        self::assertNull($template->wabaId);
    }

    public function testTemplatesUnknownPhoneNumberIsNotFoundError(): void
    {
        $client = new FakeHttpClient([
            new Response(404, ['x-request-id' => 'req_phone_missing'], json_encode([
                'success' => false,
                'code' => 'phone_not_found',
                'message' => 'Phone number not found',
            ], JSON_THROW_ON_ERROR)),
        ]);
        $sdk = new SanadWhatsApp([
            'apiKey' => 'pk_test_fake_key',
            'retries' => 1,
            'httpClient' => $client,
        ]);

        try {
            $sdk->templates()->list(phoneNumberId: '100000000000009');
            self::fail('Expected NotFoundError.');
        } catch (NotFoundError $error) {
            self::assertSame('phone_not_found', $error->code);
            self::assertSame(404, $error->status);
            self::assertSame('req_phone_missing', $error->requestId);
        }
        self::assertCount(1, $client->requests);
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
        return $this->templatesResponseWithRows([[
            'name' => 'hello_world',
            'language' => 'en',
            'category' => 'UTILITY',
            'status' => 'APPROVED',
            'components' => [['type' => 'BODY']],
        ]]);
    }

    private function templatesResponseWithRows(array $rows): Response
    {
        return new Response(200, [], json_encode([
            'success' => true,
            'page' => 1,
            'limit' => 20,
            'data' => $rows,
        ], JSON_THROW_ON_ERROR));
    }
}
