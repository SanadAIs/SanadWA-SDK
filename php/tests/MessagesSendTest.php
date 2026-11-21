<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Dto\SendMessageOptions;
use Sanadwa\WhatsApp\Dto\SendTextOptions;
use Sanadwa\WhatsApp\Dto\SendTextReplyOptions;
use Sanadwa\WhatsApp\Exceptions\SanadApiError;
use Sanadwa\WhatsApp\Exceptions\ValidationError;
use Sanadwa\WhatsApp\Http\Requester;
use Sanadwa\WhatsApp\SanadWhatsApp;
use Sanadwa\WhatsApp\Tests\Support\FakeHttpClient;

final class MessagesSendTest extends TestCase
{
    public function testSendMapsRequestAndReplayResponse(): void
    {
        $client = new FakeHttpClient([
            new Response(200, ['x-idempotent-replay' => 'true'], json_encode([
                'success' => true,
                'message_id' => 'msg-123',
                'accepted_at' => '2026-05-10T12:00:00.000Z',
                'upstream' => [
                    'messaging_product' => 'whatsapp',
                    'contacts' => [['wa_id' => '966500000000']],
                    'messages' => [['id' => 'wamid.123']],
                ],
            ], JSON_THROW_ON_ERROR)),
        ]);
        $sdk = new SanadWhatsApp([
            'apiKey' => 'pk_test',
            'httpClient' => $client,
        ]);

        $response = $sdk->messages()->send(new SendMessageOptions(
            phoneNumberId: 'phone-number-id',
            toPhone: '+966500000000',
            templateName: 'hello_world',
            templateLanguage: 'en',
            templateParams: ['Alice'],
            templateComponents: [['type' => 'body']],
            idempotencyKey: 'caller-key-123',
        ));

        self::assertCount(1, $client->requests);
        $request = $client->requests[0];
        self::assertSame('POST', $request->getMethod());
        self::assertSame(
            'https://api.sanadwa.com/api/public/v1/messages/template',
            (string) $request->getUri(),
        );
        self::assertSame('application/json', $request->getHeaderLine('Content-Type'));
        self::assertSame('Bearer pk_test', $request->getHeaderLine('Authorization'));
        self::assertSame('application/json', $request->getHeaderLine('Accept'));
        self::assertSame(
            '@sanadwa/whatsapp-sdk-php/0.3.0',
            $request->getHeaderLine('User-Agent'),
        );
        self::assertSame('caller-key-123', $request->getHeaderLine('Idempotency-Key'));
        self::assertSame([
            'phone_number_id' => 'phone-number-id',
            'to_phone' => '+966500000000',
            'template_name' => 'hello_world',
            'template_language' => 'en',
            'template_params' => ['Alice'],
            'template_components' => [['type' => 'body']],
            'idempotency_key' => 'caller-key-123',
        ], json_decode((string) $request->getBody(), true, 512, JSON_THROW_ON_ERROR));

        self::assertSame('msg-123', $response->messageId);
        self::assertSame('2026-05-10T12:00:00.000Z', $response->acceptedAt);
        self::assertTrue($response->replayed);
        self::assertSame([['wa_id' => '966500000000']], $response->upstream->contacts);
        self::assertSame([['id' => 'wamid.123']], $response->upstream->messages);
    }

    public function testSendUsesUpstreamDefaultsAndOmitsOptionalBodyKeys(): void
    {
        $client = new FakeHttpClient([
            new Response(200, [], json_encode([
                'success' => true,
                'message_id' => null,
                'accepted_at' => '2026-05-10T12:00:00.000Z',
            ], JSON_THROW_ON_ERROR)),
        ]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test', 'httpClient' => $client]);

        $response = $sdk->messages()->send(
            new SendMessageOptions('phone-id', '+966500000000', 'hello_world'),
        );

        self::assertSame([
            'phone_number_id' => 'phone-id',
            'to_phone' => '+966500000000',
            'template_name' => 'hello_world',
        ], json_decode(
            (string) $client->requests[0]->getBody(),
            true,
            512,
            JSON_THROW_ON_ERROR,
        ));
        self::assertNull($response->messageId);
        self::assertFalse($response->replayed);
        self::assertSame('whatsapp', $response->upstream->messagingProduct);
        self::assertSame([], $response->upstream->contacts);
        self::assertSame([], $response->upstream->messages);
        self::assertMatchesRegularExpression(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/',
            $client->requests[0]->getHeaderLine('Idempotency-Key'),
        );
    }

    public function testSendTextMapsFreeFormTextRequestAndResponse(): void
    {
        $client = new FakeHttpClient([
            new Response(200, ['x-idempotent-replay' => 'true'], json_encode([
                'success' => true,
                'message_id' => 'wamid.TEXT',
                'message_type' => 'text',
                'accepted_at' => '2026-07-21T12:00:00.000Z',
                'upstream' => [
                    'messaging_product' => 'whatsapp',
                    'contacts' => [['wa_id' => '966500000000']],
                    'messages' => [['id' => 'wamid.TEXT']],
                ],
            ], JSON_THROW_ON_ERROR)),
        ]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test', 'httpClient' => $client]);

        $response = $sdk->messages()->sendText(new SendTextOptions(
            phoneNumberId: 'phone-number-id',
            toPhone: '+966500000000',
            text: 'How can we help?',
            previewUrl: false,
            idempotencyKey: 'reply-key-123',
        ));

        self::assertCount(1, $client->requests);
        $request = $client->requests[0];
        self::assertSame('POST', $request->getMethod());
        self::assertSame(
            'https://api.sanadwa.com/api/public/v1/messages/text',
            (string) $request->getUri(),
        );
        self::assertSame('reply-key-123', $request->getHeaderLine('Idempotency-Key'));
        self::assertSame([
            'phone_number_id' => 'phone-number-id',
            'to_phone' => '+966500000000',
            'text' => 'How can we help?',
            'preview_url' => false,
            'idempotency_key' => 'reply-key-123',
        ], json_decode((string) $request->getBody(), true, 512, JSON_THROW_ON_ERROR));
        self::assertSame('wamid.TEXT', $response->messageId);
        self::assertSame('text', $response->messageType);
        self::assertTrue($response->replayed);
    }

    public function testSendTextOmitsOptionalFieldsAndGeneratesIdempotencyKey(): void
    {
        $client = new FakeHttpClient([
            new Response(200, [], json_encode([
                'success' => true,
                'message_id' => null,
                'accepted_at' => '2026-07-21T12:00:00.000Z',
            ], JSON_THROW_ON_ERROR)),
        ]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test', 'httpClient' => $client]);

        $response = $sdk->messages()->sendText(
            new SendTextOptions('phone-id', '+966500000000', 'Hello'),
        );

        self::assertSame([
            'phone_number_id' => 'phone-id',
            'to_phone' => '+966500000000',
            'text' => 'Hello',
        ], json_decode(
            (string) $client->requests[0]->getBody(),
            true,
            512,
            JSON_THROW_ON_ERROR,
        ));
        self::assertMatchesRegularExpression(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/',
            $client->requests[0]->getHeaderLine('Idempotency-Key'),
        );
        self::assertNull($response->messageId);
        self::assertFalse($response->replayed);
    }

    public function testReplyIsAnAliasForSendText(): void
    {
        $client = new FakeHttpClient([
            new Response(200, [], json_encode([
                'success' => true,
                'message_id' => 'wamid.ALIAS',
                'accepted_at' => '2026-07-21T12:00:00.000Z',
            ], JSON_THROW_ON_ERROR)),
        ]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test', 'httpClient' => $client]);

        $response = $sdk->messages()->reply(
            new SendTextReplyOptions('phone-id', '+966500000000', 'Hello'),
        );

        self::assertSame('wamid.ALIAS', $response->messageId);
        self::assertSame('/api/public/v1/messages/text', $client->requests[0]->getUri()->getPath());
    }

    public function testSendTextRejectsInvalidIdempotencyKey(): void
    {
        $client = new FakeHttpClient([]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test', 'httpClient' => $client]);

        try {
            $sdk->messages()->sendText(new SendTextOptions(
                'phone-id',
                '+966500000000',
                'Hello',
                idempotencyKey: 'bad key',
            ));
            self::fail('Expected ValidationError.');
        } catch (ValidationError $error) {
            self::assertSame('invalid_idempotency_key', $error->code);
            self::assertCount(0, $client->requests);
        }
    }

    #[DataProvider('invalidIdempotencyKeyProvider')]
    public function testSendRejectsInvalidIdempotencyKey(string $idempotencyKey): void
    {
        $client = new FakeHttpClient([]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test', 'httpClient' => $client]);

        try {
            $sdk->messages()->send(new SendMessageOptions(
                'phone-id',
                '+966500000000',
                'hello_world',
                idempotencyKey: $idempotencyKey,
            ));
            self::fail('Expected ValidationError.');
        } catch (ValidationError $error) {
            self::assertSame('invalid_idempotency_key', $error->code);
            self::assertCount(0, $client->requests);
        }
    }

    public static function invalidIdempotencyKeyProvider(): iterable
    {
        yield 'empty' => [''];
        yield 'over server limit' => [str_repeat('k', 121)];
        yield 'whitespace-only' => ['   '];
        yield 'embedded space' => ['key with space'];
        yield 'tab' => ["key\tvalue"];
        yield 'CRLF injection' => ["abc\r\nX-Evil: 1"];
        yield 'DEL' => ["key\x7F"];
        yield 'non-ASCII' => ['مفتاح'];
    }

    public function testOutgoingJsonEncodingFailureIsValidationError(): void
    {
        $client = new FakeHttpClient([]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test', 'httpClient' => $client]);

        try {
            $sdk->messages()->send(new SendMessageOptions(
                'phone-id',
                '+966500000000',
                'hello_world',
                templateParams: ["\xB1\x31"],
            ));
            self::fail('Expected ValidationError.');
        } catch (ValidationError $error) {
            self::assertSame('invalid_request_body', $error->code);
            self::assertSame(0, $error->status);
            self::assertInstanceOf(\JsonException::class, $error->getPrevious());
            self::assertCount(0, $client->requests);
        }
    }

    public function testMissingAcceptedAtIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([
            new Response(200, [], json_encode([
                'success' => true,
                'message_id' => 'msg-123',
            ], JSON_THROW_ON_ERROR)),
        ]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test', 'httpClient' => $client]);

        try {
            $sdk->messages()->send(
                new SendMessageOptions('phone-id', '+966500000000', 'hello_world'),
            );
            self::fail('Expected SanadApiError.');
        } catch (SanadApiError $error) {
            self::assertSame('malformed_response', $error->code);
            self::assertStringContainsString('accepted_at', $error->getMessage());
        }
    }

    public function testMultipartRequestSendsBoundaryHeaderAndEveryPart(): void
    {
        $client = new FakeHttpClient([
            new Response(200, [], json_encode(['success' => true], JSON_THROW_ON_ERROR)),
        ]);
        $requester = $this->requester($client);

        $result = $requester->request(
            method: 'POST',
            path: '/contacts/import',
            idempotent: true,
            idempotencyKey: 'import-key-0001',
            multipart: $this->importParts(),
        );

        self::assertSame(['success' => true], $result);
        $request = $client->requests[0];
        self::assertSame('POST', $request->getMethod());
        self::assertSame('/v1/contacts/import', $request->getUri()->getPath());
        self::assertSame('import-key-0001', $request->getHeaderLine('Idempotency-Key'));
        self::assertSame('Bearer pk_test_fake_key', $request->getHeaderLine('Authorization'));
        self::assertMatchesRegularExpression(
            '~\Amultipart/form-data; boundary=([A-Za-z0-9]+)\z~',
            $request->getHeaderLine('Content-Type'),
        );
        $boundary = substr(
            $request->getHeaderLine('Content-Type'),
            strlen('multipart/form-data; boundary='),
        );
        $body = (string) $request->getBody();
        self::assertStringContainsString('--' . $boundary . "\r\n", $body);
        self::assertStringEndsWith('--' . $boundary . "--\r\n", $body);
        self::assertStringContainsString('name="file"; filename="contacts.csv"', $body);
        self::assertStringContainsString('Content-Type: text/csv', $body);
        self::assertStringContainsString("phone,first_name\n+12025550123,Test", $body);
        self::assertStringContainsString('name="tags"', $body);
        self::assertStringContainsString("\r\n\r\nvip,newsletter\r\n", $body);
        self::assertStringNotContainsString('application/json', $body);
    }

    public function testMultipartBodyIsRebuiltAndCompleteOnRetry(): void
    {
        $client = new FakeHttpClient([
            new Response(500, [], json_encode([
                'success' => false,
                'code' => 'contacts_import_failed',
                'message' => 'Try again',
            ], JSON_THROW_ON_ERROR)),
            new Response(200, [], json_encode(['success' => true], JSON_THROW_ON_ERROR)),
        ]);
        $requester = $this->requester($client, 2);

        $requester->request(
            method: 'POST',
            path: '/contacts/import',
            idempotent: true,
            multipart: $this->importParts(),
        );

        self::assertCount(2, $client->requests);
        foreach ($client->requests as $request) {
            $request->getBody()->rewind();
            $body = $request->getBody()->getContents();
            self::assertStringStartsWith(
                'multipart/form-data; boundary=',
                $request->getHeaderLine('Content-Type'),
            );
            self::assertStringContainsString("phone,first_name\n+12025550123,Test", $body);
            self::assertStringContainsString('vip,newsletter', $body);
        }
        self::assertSame(
            $client->requests[0]->getHeaderLine('Idempotency-Key'),
            $client->requests[1]->getHeaderLine('Idempotency-Key'),
        );
    }

    public function testBodyAndMultipartTogetherAreRejected(): void
    {
        $client = new FakeHttpClient([]);
        $requester = $this->requester($client);

        try {
            $requester->request(
                method: 'POST',
                path: '/contacts/import',
                body: ['contacts' => []],
                multipart: $this->importParts(),
            );
            self::fail('Expected InvalidArgumentException.');
        } catch (\InvalidArgumentException) {
            self::assertCount(0, $client->requests);
        }
    }

    public function testDeleteWithoutBodySendsNoContentType(): void
    {
        $client = new FakeHttpClient([
            new Response(200, [], json_encode(['success' => true], JSON_THROW_ON_ERROR)),
        ]);
        $requester = $this->requester($client);

        $requester->request(method: 'DELETE', path: '/tags/42', idempotent: true);

        $request = $client->requests[0];
        self::assertSame('DELETE', $request->getMethod());
        self::assertFalse($request->hasHeader('Content-Type'));
        self::assertSame('', (string) $request->getBody());
        self::assertMatchesRegularExpression(
            '/\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/',
            $request->getHeaderLine('Idempotency-Key'),
        );
    }

    private function importParts(): array
    {
        return [
            [
                'name' => 'file',
                'contents' => "phone,first_name\n+12025550123,Test\n",
                'filename' => 'contacts.csv',
                'headers' => ['Content-Type' => 'text/csv'],
            ],
            ['name' => 'tags', 'contents' => 'vip,newsletter'],
        ];
    }

    private function requester(FakeHttpClient $client, int $retries = 1): Requester
    {
        return new Requester(
            apiKey: 'pk_test_fake_key',
            baseUrl: 'https://api.example.test/v1',
            retries: $retries,
            httpClient: $client,
            userAgent: 'test',
            sleeper: static fn (int $milliseconds) => null,
        );
    }
}
