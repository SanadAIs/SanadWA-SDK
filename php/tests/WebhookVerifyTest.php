<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Dto\WebhookFailedError;
use Sanadwa\WhatsApp\Resources\Webhooks;
use Sanadwa\WhatsApp\TestFixtures;

final class WebhookVerifyTest extends TestCase
{
    #[DataProvider('fixtureProvider')]
    public function testCanonicalFixtureVerifies(array $fixture): void
    {
        $result = Webhooks::verify(
            $fixture['rawBody'],
            $fixture['signature'],
            $fixture['secret'],
        );

        self::assertTrue($result->valid);
        self::assertNull($result->reason);
        self::assertEquals($fixture['expectedEvent'], $result->event);
    }

    public static function fixtureProvider(): iterable
    {
        yield 'message sent' => [TestFixtures::createMessageSentFixture()];
        yield 'text message sent' => [TestFixtures::createTextMessageSentFixture()];
        yield 'message delivered' => [TestFixtures::createMessageDeliveredFixture()];
        yield 'message read' => [TestFixtures::createMessageReadFixture()];
        yield 'message failed' => [TestFixtures::createMessageFailedFixture()];
        yield 'inbound message' => [TestFixtures::createInboundMessageFixture()];
    }

    public function testInvalidInputReason(): void
    {
        self::assertSame('invalid_input', Webhooks::verifyInput('not-an-array')->reason);
    }

    public function testInvalidSecretWinsBeforeMissingBody(): void
    {
        $result = Webhooks::verifyInput([
            'rawBody' => null,
            'signature' => '',
            'secret' => '',
        ]);

        self::assertSame('invalid_secret', $result->reason);
    }

    public function testMissingBodyReason(): void
    {
        $result = Webhooks::verifyInput([
            'rawBody' => null,
            'signature' => 'sha256=abc',
            'secret' => 'secret',
        ]);

        self::assertSame('missing_body', $result->reason);
    }

    #[DataProvider('malformedSignatureProvider')]
    public function testMalformedSignatureReason(mixed $signature): void
    {
        $result = Webhooks::verifyInput([
            'rawBody' => '{}',
            'signature' => $signature,
            'secret' => 'secret',
        ]);

        self::assertSame('malformed_signature', $result->reason);
    }

    public static function malformedSignatureProvider(): iterable
    {
        yield 'empty' => [''];
        yield 'missing prefix' => ['abc'];
        yield 'not a string' => [123];
    }

    public function testEmptySignatureReason(): void
    {
        self::assertSame(
            'empty_signature',
            Webhooks::verify('{}', 'sha256=', 'secret')->reason,
        );
    }

    public function testSignatureLengthMismatchReason(): void
    {
        self::assertSame(
            'signature_length_mismatch',
            Webhooks::verify('{}', 'sha256=abc', 'secret')->reason,
        );
    }

    public function testNonHexSignatureIsSignatureMismatch(): void
    {
        self::assertSame(
            'signature_mismatch',
            Webhooks::verify('{}', 'sha256=' . str_repeat('g', 64), 'secret')->reason,
        );
    }

    public function testMultibyteNonHexSignatureHasByteLengthMismatch(): void
    {
        self::assertSame(
            'signature_length_mismatch',
            Webhooks::verify(
                '{}',
                'sha256=' . str_repeat('a', 63) . 'é',
                'secret',
            )->reason,
        );
    }

    public function testSignatureMismatchReason(): void
    {
        self::assertSame(
            'signature_mismatch',
            Webhooks::verify('{}', 'sha256=' . str_repeat('0', 64), 'secret')->reason,
        );
    }

    public function testInvalidJsonAfterValidSignatureIsVerificationError(): void
    {
        $body = '{bad json';

        self::assertSame(
            'verification_error',
            Webhooks::verify($body, self::sign($body), 'secret')->reason,
        );
    }

    public function testEmptyBodyIsNotTreatedAsMissing(): void
    {
        self::assertSame(
            'verification_error',
            Webhooks::verify('', self::sign(''), 'secret')->reason,
        );
    }

    public function testUnknownEventTypeReason(): void
    {
        $body = json_encode(
            ['event' => 'message.unknown', 'tenant_id' => 1, 'data' => []],
            JSON_THROW_ON_ERROR,
        );

        self::assertSame(
            'unknown_event_type',
            Webhooks::verify($body, self::sign($body), 'secret')->reason,
        );
    }

    public function testLegacyEnvelopeAndBareStringFailedError(): void
    {
        $body = json_encode([
            'event_type' => 'message.failed',
            'payload' => [
                'message_id' => 'legacy-id',
                'failed_at' => '2026-05-10T12:02:00.000Z',
                'error' => 'Legacy provider failure',
            ],
        ], JSON_THROW_ON_ERROR);

        $result = Webhooks::verify($body, self::sign($body), 'secret');

        self::assertTrue($result->valid);
        self::assertSame('message.failed', $result->event?->type);
        self::assertEquals(
            new WebhookFailedError(null, null, 'Legacy provider failure'),
            $result->event?->data['error'],
        );
    }

    public function testInboundMessageOmitsAbsentOptionalFields(): void
    {
        $body = json_encode([
            'event' => 'inbound.message',
            'data' => ['from' => '+966500000000', 'type' => 'image'],
        ], JSON_THROW_ON_ERROR);

        $result = Webhooks::verify($body, self::sign($body), 'secret');

        self::assertTrue($result->valid);
        self::assertNotNull($result->event);
        self::assertFalse(array_key_exists('text', $result->event->data));
        self::assertFalse(array_key_exists('timestamp', $result->event->data));
    }

    public function testKnownEventMissingRequiredFieldIsUnknownEventType(): void
    {
        $body = json_encode([
            'event' => 'message.sent',
            'data' => [
                'message_id' => 'msg-missing-to',
                'template_name' => 'hello_world',
                'template_language' => 'en',
                'sent_at' => '2026-05-10T12:00:00.000Z',
            ],
        ], JSON_THROW_ON_ERROR);

        self::assertSame(
            'unknown_event_type',
            Webhooks::verify($body, self::sign($body), 'secret')->reason,
        );
    }

    public function testInboundMessageAcceptsLegacyFromPhone(): void
    {
        $body = json_encode([
            'event' => 'inbound.message',
            'data' => ['from_phone' => '+966511111111', 'type' => 'text'],
        ], JSON_THROW_ON_ERROR);

        $result = Webhooks::verify($body, self::sign($body), 'secret');

        self::assertTrue($result->valid);
        self::assertSame('+966511111111', $result->event?->data['from']);
    }

    public function testMessageFailedWithoutErrorUsesEmptyErrorDto(): void
    {
        $body = json_encode([
            'event' => 'message.failed',
            'data' => [
                'message_id' => 'msg-no-error',
                'failed_at' => '2026-05-10T12:02:00.000Z',
            ],
        ], JSON_THROW_ON_ERROR);

        $result = Webhooks::verify($body, self::sign($body), 'secret');

        self::assertTrue($result->valid);
        self::assertEquals(
            new WebhookFailedError(null, null, null),
            $result->event?->data['error'],
        );
    }

    public function testNumericMessageIdIsCoercedToString(): void
    {
        $body = json_encode([
            'event' => 'message.delivered',
            'tenant_id' => 1,
            'data' => [
                'message_id' => 4242,
                'delivered_at' => '2026-05-10T12:00:00.000Z',
            ],
        ], JSON_THROW_ON_ERROR);

        $result = Webhooks::verify($body, self::sign($body), 'secret');

        self::assertTrue($result->valid);
        self::assertSame('4242', $result->event?->data['messageId']);
    }

    private static function sign(string $body): string
    {
        return 'sha256=' . hash_hmac('sha256', $body, 'secret');
    }
}
