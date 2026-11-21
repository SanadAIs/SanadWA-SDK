<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Exceptions\NotFoundError;
use Sanadwa\WhatsApp\Exceptions\SanadApiError;
use Sanadwa\WhatsApp\SanadWhatsApp;
use Sanadwa\WhatsApp\Tests\Support\FakeHttpClient;

final class MessagesGetTest extends TestCase
{
    public function testGetEncodesIdAndMapsAllMessageFields(): void
    {
        $client = new FakeHttpClient([
            $this->messageResponse([
                'id' => 'msg-123',
                'provider_msg_id' => 'wamid.123',
                'status' => 'failed',
                'sent_at' => '2026-05-10T12:00:00.000Z',
                'template_name' => 'hello_world',
                'to_phone' => '+966500000000',
                'channel' => 'whatsapp',
                'provider' => 'meta',
                'error' => 'Provider rejected the message',
                'delivered_at' => '2026-05-10T12:01:00.000Z',
                'read_at' => '2026-05-10T12:02:00.000Z',
                'failed_at' => '2026-05-10T12:03:00.000Z',
                'last_status' => 'failed',
            ]),
        ]);
        $sdk = new SanadWhatsApp([
            'apiKey' => 'pk_test',
            'baseUrl' => 'https://example.test',
            'httpClient' => $client,
        ]);

        $message = $sdk->messages()->get('msg/with spaces');

        self::assertSame('/messages/msg%2Fwith%20spaces', $client->requests[0]->getUri()->getPath());
        self::assertSame('msg-123', $message->id);
        self::assertSame('wamid.123', $message->providerMsgId);
        self::assertSame('failed', $message->status);
        self::assertSame('2026-05-10T12:00:00.000Z', $message->sentAt);
        self::assertSame('hello_world', $message->templateName);
        self::assertSame('+966500000000', $message->toPhone);
        self::assertSame('whatsapp', $message->channel);
        self::assertSame('meta', $message->provider);
        self::assertSame('Provider rejected the message', $message->error);
        self::assertSame('2026-05-10T12:01:00.000Z', $message->deliveredAt);
        self::assertSame('2026-05-10T12:02:00.000Z', $message->readAt);
        self::assertSame('2026-05-10T12:03:00.000Z', $message->failedAt);
        self::assertSame('failed', $message->lastStatus);
    }

    public function testGetMapsNullableMessageFieldsFromJsonNull(): void
    {
        $client = new FakeHttpClient([
            $this->messageResponse([
                'id' => 'msg-124',
                'provider_msg_id' => null,
                'status' => 'accepted',
                'sent_at' => null,
                'template_name' => null,
                'to_phone' => '+12025550123',
                'channel' => 'whatsapp',
                'provider' => 'meta',
                'error' => null,
                'delivered_at' => null,
                'read_at' => null,
                'failed_at' => null,
                'last_status' => null,
            ]),
        ]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test', 'httpClient' => $client]);

        $message = $sdk->messages()->get('msg-124');

        self::assertNull($message->providerMsgId);
        self::assertNull($message->sentAt);
        self::assertNull($message->templateName);
        self::assertNull($message->error);
        self::assertNull($message->deliveredAt);
        self::assertNull($message->readAt);
        self::assertNull($message->failedAt);
        self::assertNull($message->lastStatus);
    }

    public function testGetAcceptsNullForEveryNewlyNullableField(): void
    {
        $client = new FakeHttpClient([
            $this->messageResponse([
                'id' => '98765',
                'provider_msg_id' => 'wamid.FAKE_LOOKUP_0001',
                'status' => null,
                'sent_at' => null,
                'template_name' => null,
                'to_phone' => null,
                'channel' => null,
                'provider' => null,
            ]),
        ]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test_fake_key', 'httpClient' => $client]);

        $message = $sdk->messages()->get('wamid.FAKE_LOOKUP_0001');

        self::assertSame('98765', $message->id);
        self::assertNull($message->status);
        self::assertNull($message->sentAt);
        self::assertNull($message->toPhone);
        self::assertNull($message->channel);
        self::assertNull($message->provider);
        self::assertNull($message->templateName);
    }

    public function testGetAcceptsMissingKeysForEveryNullableField(): void
    {
        $client = new FakeHttpClient([$this->messageResponse(['id' => '98765'])]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test_fake_key', 'httpClient' => $client]);

        $message = $sdk->messages()->get('wamid.FAKE_LOOKUP_0001');

        self::assertSame('98765', $message->id);
        self::assertNull($message->providerMsgId);
        self::assertNull($message->status);
        self::assertNull($message->sentAt);
        self::assertNull($message->templateName);
        self::assertNull($message->toPhone);
        self::assertNull($message->channel);
        self::assertNull($message->provider);
        self::assertNull($message->error);
        self::assertNull($message->deliveredAt);
        self::assertNull($message->readAt);
        self::assertNull($message->failedAt);
        self::assertNull($message->lastStatus);
    }

    public function testGetCoercesNumericIdToString(): void
    {
        $client = new FakeHttpClient([
            $this->messageResponse(['id' => 98765, 'status' => 'delivered']),
        ]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test_fake_key', 'httpClient' => $client]);

        $message = $sdk->messages()->get('wamid.FAKE_LOOKUP_0001');

        self::assertSame('98765', $message->id);
        self::assertSame('delivered', $message->status);
    }

    public function testGetPassesAnUnknownStatusThrough(): void
    {
        $client = new FakeHttpClient([
            $this->messageResponse(['id' => '98765', 'status' => 'queued']),
        ]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test_fake_key', 'httpClient' => $client]);

        self::assertSame('queued', $sdk->messages()->get('wamid.FAKE_LOOKUP_0001')->status);
    }

    #[DataProvider('malformedIdProvider')]
    public function testGetMissingOrMistypedIdIsMalformedResponse(array $data): void
    {
        $client = new FakeHttpClient([$this->messageResponse($data)]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test_fake_key', 'httpClient' => $client]);

        try {
            $sdk->messages()->get('wamid.FAKE_LOOKUP_0001');
            self::fail('Expected SanadApiError.');
        } catch (SanadApiError $error) {
            self::assertSame('malformed_response', $error->code);
            self::assertStringContainsString('data.id', $error->getMessage());
        }
    }

    public static function malformedIdProvider(): iterable
    {
        yield 'missing' => [['status' => 'sent']];
        yield 'null' => [['id' => null, 'status' => 'sent']];
        yield 'boolean' => [['id' => true, 'status' => 'sent']];
        yield 'object' => [['id' => ['value' => 1], 'status' => 'sent']];
    }

    public function testGetPropagatesNotFoundErrorWithCodeAndRequestId(): void
    {
        $client = new FakeHttpClient([
            new Response(404, ['x-request-id' => 'req_message_missing'], json_encode([
                'success' => false,
                'code' => 'message_not_found',
                'message' => 'Message not found',
            ], JSON_THROW_ON_ERROR)),
        ]);
        $sdk = new SanadWhatsApp([
            'apiKey' => 'pk_test',
            'retries' => 1,
            'httpClient' => $client,
        ]);

        try {
            $sdk->messages()->get('missing');
            self::fail('Expected NotFoundError.');
        } catch (NotFoundError $error) {
            self::assertSame('message_not_found', $error->code);
            self::assertSame('req_message_missing', $error->requestId);
        }
    }

    public function testGetMissingDataIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([
            new Response(200, [], json_encode(['success' => true], JSON_THROW_ON_ERROR)),
        ]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test', 'httpClient' => $client]);

        try {
            $sdk->messages()->get('msg-123');
            self::fail('Expected SanadApiError.');
        } catch (SanadApiError $error) {
            self::assertSame('malformed_response', $error->code);
            self::assertStringContainsString('data', $error->getMessage());
        }
    }

    public function testGetMistypedNullableFieldIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([
            $this->messageResponse([
                'id' => 'msg-123',
                'status' => 42,
                'sent_at' => null,
                'template_name' => 'hello_world',
                'to_phone' => '+966500000000',
                'channel' => 'whatsapp',
                'provider' => 'meta',
            ]),
        ]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test', 'httpClient' => $client]);

        try {
            $sdk->messages()->get('msg-123');
            self::fail('Expected SanadApiError.');
        } catch (SanadApiError $error) {
            self::assertSame('malformed_response', $error->code);
            self::assertStringContainsString('data.status', $error->getMessage());
        }
    }

    private function messageResponse(array $data): Response
    {
        return new Response(200, [], json_encode([
            'success' => true,
            'data' => $data,
        ], JSON_THROW_ON_ERROR));
    }
}
