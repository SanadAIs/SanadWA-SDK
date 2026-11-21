<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Dto\WebhookEvent;
use Sanadwa\WhatsApp\Dto\WebhookFailedError;
use Sanadwa\WhatsApp\Dto\WebhookVerifyResult;
use Sanadwa\WhatsApp\Resources\Webhooks;
use Sanadwa\WhatsApp\TestFixtures;

final class WebhookVerifyTest extends TestCase
{
    private const VECTOR_SECRET = 'whsec_fixed_vector_secret_do_not_use';

    private const VECTOR_TEST_EVENT_BODY = '{"event":"inbound.message","tenant_id":1,"data":{"test":true,"from":"+966500000000","message":{"type":"text","text":{"body":"SanadWA test event."}}}}';
    private const VECTOR_TEST_EVENT_HEX = '7a85c34eb3ab5888638f1796670354afcc964a0e6ab22d63e6c9bd3d2e1e3f9a';

    private const VECTOR_UNKNOWN_EVENT_BODY = '{"event":"campaign.completed","tenant_id":1,"data":{"campaign_id":"42","completed_at":"2026-11-21T10:00:00.000Z"}}';
    private const VECTOR_UNKNOWN_EVENT_HEX = '8462f769b32da3ac6237f6b672bd7f9397aa64e19420cfc946a36ce6f7498d0f';

    private const VECTOR_FAILED_BODY = '{"event":"message.failed","tenant_id":1,"data":{"message_id":"4244","provider_msg_id":"wamid.FAKE_FAILED_0001","to_phone":"+966500000000","failed_at":"2026-11-21T10:02:00.000Z","error":{"code":131049,"title":"Message failed to send","message":"This message was not delivered to maintain healthy ecosystem engagement.","error_data":{"details":"In order to maintain a healthy ecosystem engagement, the message failed to be delivered."},"details":"In order to maintain a healthy ecosystem engagement, the message failed to be delivered.","error_user_msg":null}}}';
    private const VECTOR_FAILED_HEX = '32b4b65bcff32d87fc91bfa96faa160a9aab9d38cd213537eea0f5d4f2dfec7d';

    private const VECTOR_SENT_NULL_ID_BODY = '{"event":"message.sent","tenant_id":1,"data":{"message_id":null,"to_phone":"+966500000000","template_name":"hello_world","template_language":"en","sent_at":"2026-11-21T10:00:00.000Z"}}';
    private const VECTOR_SENT_NULL_ID_HEX = '40f8ffbd12683d011e4a1d7af31bd92cac05704a51a16d3682388cf021a09973';

    private const ENGAGEMENT_DETAILS = 'In order to maintain a healthy ecosystem engagement, the message failed to be delivered.';

    #[DataProvider('fixtureProvider')]
    public function testFixtureRoundTrips(array $fixture): void
    {
        $result = Webhooks::verify(
            $fixture['rawBody'],
            $fixture['signature'],
            $fixture['secret'],
        );

        self::assertTrue($result->valid);
        self::assertTrue($result->signatureValid);
        self::assertNull($result->reason);
        self::assertSame($fixture['recognized'], $result->recognized);
        self::assertSame($fixture['eventType'], $result->eventType);
        self::assertEquals($fixture['expectedEvent'], $result->event);
        self::assertSame(
            json_decode($fixture['rawBody'], true, 512, JSON_THROW_ON_ERROR),
            $result->envelope,
        );
    }

    #[DataProvider('fixtureProvider')]
    public function testFixtureVerifiesThroughVerifyInput(array $fixture): void
    {
        $result = Webhooks::verifyInput($fixture);

        self::assertTrue($result->valid);
        self::assertEquals($fixture['expectedEvent'], $result->event);
    }

    #[DataProvider('fixtureProvider')]
    public function testTamperedFixtureIsInvalid(array $fixture): void
    {
        $tamperedBody = Webhooks::verify(
            $fixture['rawBody'] . ' ',
            $fixture['signature'],
            $fixture['secret'],
        );
        $tamperedSignature = Webhooks::verify(
            $fixture['rawBody'],
            self::flipLastHexDigit($fixture['signature']),
            $fixture['secret'],
        );
        $tamperedSecret = Webhooks::verify(
            $fixture['rawBody'],
            $fixture['signature'],
            $fixture['secret'] . '_other',
        );

        foreach ([$tamperedBody, $tamperedSignature, $tamperedSecret] as $result) {
            self::assertFalse($result->valid);
            self::assertFalse($result->signatureValid);
            self::assertFalse($result->recognized);
            self::assertSame('signature_mismatch', $result->reason);
            self::assertNull($result->event);
            self::assertNull($result->eventType);
            self::assertNull($result->envelope);
        }
    }

    public static function fixtureProvider(): iterable
    {
        yield 'message sent' => [TestFixtures::createMessageSentFixture()];
        yield 'text message sent' => [TestFixtures::createTextMessageSentFixture()];
        yield 'message delivered' => [TestFixtures::createMessageDeliveredFixture()];
        yield 'message read' => [TestFixtures::createMessageReadFixture()];
        yield 'message failed' => [TestFixtures::createMessageFailedFixture()];
        yield 'inbound message' => [TestFixtures::createInboundMessageFixture()];
        yield 'test event' => [TestFixtures::createTestEventFixture()];
        yield 'unknown event' => [TestFixtures::createUnknownEventFixture()];
        yield 'unknown event with overrides' => [TestFixtures::createUnknownEventFixture([
            'eventType' => 'contact.updated',
            'data' => ['contact_id' => '7'],
            'secret' => 'whsec_other_fake_secret',
        ])];
        yield 'failed with overrides' => [TestFixtures::createMessageFailedFixture([
            'providerMsgId' => 'wamid.FAKE_OVERRIDE_0001',
            'toPhone' => '+12025550123',
            'errorData' => ['details' => 'Override details'],
            'details' => 'Override details',
            'errorUserMsg' => 'Shown to the user',
        ])];
        yield 'delivered with overrides' => [TestFixtures::createMessageDeliveredFixture([
            'providerMsgId' => 'wamid.FAKE_OVERRIDE_0002',
            'toPhone' => '+12025550124',
        ])];
        yield 'read with overrides' => [TestFixtures::createMessageReadFixture([
            'providerMsgId' => 'wamid.FAKE_OVERRIDE_0003',
            'toPhone' => '+12025550124',
        ])];
    }

    public function testFixturesCarryRecognizedAndEventType(): void
    {
        self::assertSame('message.sent', TestFixtures::createMessageSentFixture()['eventType']);
        self::assertSame('message.sent', TestFixtures::createTextMessageSentFixture()['eventType']);
        self::assertSame(
            'message.delivered',
            TestFixtures::createMessageDeliveredFixture()['eventType'],
        );
        self::assertSame('message.read', TestFixtures::createMessageReadFixture()['eventType']);
        self::assertSame('message.failed', TestFixtures::createMessageFailedFixture()['eventType']);
        self::assertSame('inbound.message', TestFixtures::createInboundMessageFixture()['eventType']);
        self::assertTrue(TestFixtures::createInboundMessageFixture()['recognized']);

        $test = TestFixtures::createTestEventFixture();
        self::assertSame('inbound.message', $test['eventType']);
        self::assertTrue($test['recognized']);
        self::assertSame('test', $test['expectedEvent']->type);

        $unknown = TestFixtures::createUnknownEventFixture();
        self::assertSame('campaign.completed', $unknown['eventType']);
        self::assertFalse($unknown['recognized']);
        self::assertEquals(
            new WebhookEvent('unknown', ['raw' => [
                'campaign_id' => '42',
                'completed_at' => '2026-11-21T10:00:00.000Z',
            ]]),
            $unknown['expectedEvent'],
        );
    }

    public function testFailedFixtureDefaultsToTheSixKeyError(): void
    {
        $fixture = TestFixtures::createMessageFailedFixture();
        $wire = json_decode($fixture['rawBody'], true, 512, JSON_THROW_ON_ERROR);

        self::assertSame(
            ['code', 'title', 'message', 'error_data', 'details', 'error_user_msg'],
            array_keys($wire['data']['error']),
        );
        self::assertSame(['details' => self::ENGAGEMENT_DETAILS], $wire['data']['error']['error_data']);
        self::assertSame(self::ENGAGEMENT_DETAILS, $wire['data']['error']['details']);
        self::assertNull($wire['data']['error']['error_user_msg']);

        $data = $fixture['expectedEvent']->data;
        self::assertSame($wire['data']['provider_msg_id'], $data['providerMsgId']);
        self::assertSame('+966500000000', $data['toPhone']);
        self::assertEquals(
            new WebhookFailedError(
                131049,
                'Message failed to send',
                'This message was not delivered to maintain healthy ecosystem engagement.',
                ['details' => self::ENGAGEMENT_DETAILS],
                self::ENGAGEMENT_DETAILS,
                null,
            ),
            $data['error'],
        );
    }

    public function testTestEventFixtureMatchesTheProductionTestPayload(): void
    {
        $fixture = TestFixtures::createTestEventFixture();

        self::assertSame(self::VECTOR_TEST_EVENT_BODY, $fixture['rawBody']);
        self::assertEquals(
            new WebhookEvent('test', [
                'test' => true,
                'from' => '+966500000000',
                'text' => 'SanadWA test event.',
                'raw' => [
                    'test' => true,
                    'from' => '+966500000000',
                    'message' => ['type' => 'text', 'text' => ['body' => 'SanadWA test event.']],
                ],
            ]),
            $fixture['expectedEvent'],
        );
        self::assertSame(
            'whsec_other_fake_secret',
            TestFixtures::createTestEventFixture(['secret' => 'whsec_other_fake_secret'])['secret'],
        );
    }

    public function testVectorBodiesHaveTheDocumentedByteLengths(): void
    {
        self::assertSame(149, strlen(self::VECTOR_TEST_EVENT_BODY));
        self::assertSame(114, strlen(self::VECTOR_UNKNOWN_EVENT_BODY));
        self::assertSame(559, strlen(self::VECTOR_FAILED_BODY));
        self::assertSame(184, strlen(self::VECTOR_SENT_NULL_ID_BODY));
    }

    public function testVectorTestEventIsATestEvent(): void
    {
        $result = Webhooks::verify(
            self::VECTOR_TEST_EVENT_BODY,
            'sha256=' . self::VECTOR_TEST_EVENT_HEX,
            self::VECTOR_SECRET,
        );

        self::assertTrue($result->valid);
        self::assertTrue($result->signatureValid);
        self::assertTrue($result->recognized);
        self::assertSame('inbound.message', $result->eventType);
        self::assertSame('test', $result->event?->type);
        self::assertTrue($result->event->data['test']);
        self::assertSame('+966500000000', $result->event->data['from']);
        self::assertSame('SanadWA test event.', $result->event->data['text']);
        self::assertTrue($result->event->data['raw']['test']);
    }

    public function testVectorUnknownEventIsValidButNotRecognized(): void
    {
        $result = Webhooks::verify(
            self::VECTOR_UNKNOWN_EVENT_BODY,
            'sha256=' . self::VECTOR_UNKNOWN_EVENT_HEX,
            self::VECTOR_SECRET,
        );

        self::assertTrue($result->valid);
        self::assertTrue($result->signatureValid);
        self::assertFalse($result->recognized);
        self::assertNull($result->reason);
        self::assertSame('campaign.completed', $result->eventType);
        self::assertSame('unknown', $result->event?->type);
        self::assertSame('42', $result->event->data['raw']['campaign_id']);
        self::assertSame(['raw'], array_keys($result->event->data));
        self::assertSame('campaign.completed', $result->envelope['event']);
        self::assertSame(1, $result->envelope['tenant_id']);
        self::assertSame('42', $result->envelope['data']['campaign_id']);
    }

    public function testVectorFailedEventExposesAllSixErrorFields(): void
    {
        $result = Webhooks::verify(
            self::VECTOR_FAILED_BODY,
            'sha256=' . self::VECTOR_FAILED_HEX,
            self::VECTOR_SECRET,
        );

        self::assertTrue($result->valid);
        self::assertTrue($result->recognized);
        self::assertSame('message.failed', $result->eventType);
        self::assertSame('message.failed', $result->event?->type);
        $data = $result->event->data;
        self::assertSame('4244', $data['messageId']);
        self::assertSame('wamid.FAKE_FAILED_0001', $data['providerMsgId']);
        self::assertSame('+966500000000', $data['toPhone']);
        self::assertSame('2026-11-21T10:02:00.000Z', $data['failedAt']);
        $error = $data['error'];
        self::assertInstanceOf(WebhookFailedError::class, $error);
        self::assertSame(131049, $error->code);
        self::assertSame('Message failed to send', $error->title);
        self::assertSame(
            'This message was not delivered to maintain healthy ecosystem engagement.',
            $error->message,
        );
        self::assertSame(['details' => self::ENGAGEMENT_DETAILS], $error->errorData);
        self::assertSame(self::ENGAGEMENT_DETAILS, $error->details);
        self::assertNull($error->errorUserMsg);
    }

    public function testVectorSentWithNullIdHasNullMessageId(): void
    {
        $result = Webhooks::verify(
            self::VECTOR_SENT_NULL_ID_BODY,
            'sha256=' . self::VECTOR_SENT_NULL_ID_HEX,
            self::VECTOR_SECRET,
        );

        self::assertTrue($result->valid);
        self::assertTrue($result->recognized);
        self::assertSame('message.sent', $result->event?->type);
        self::assertNull($result->event->data['messageId']);
        self::assertSame('template', $result->event->data['messageType']);
        self::assertSame('hello_world', $result->event->data['templateName']);
    }

    #[DataProvider('vectorProvider')]
    public function testVectorWithOneHexDigitChangedIsSignatureMismatch(
        string $body,
        string $hex,
    ): void {
        self::assertSame($hex, hash_hmac('sha256', $body, self::VECTOR_SECRET));

        foreach ([0, 31, 63] as $position) {
            $changed = $hex;
            $changed[$position] = $hex[$position] === '0' ? '1' : '0';
            $result = Webhooks::verify($body, 'sha256=' . $changed, self::VECTOR_SECRET);

            self::assertFalse($result->valid);
            self::assertFalse($result->signatureValid);
            self::assertFalse($result->recognized);
            self::assertNull($result->event);
            self::assertSame('signature_mismatch', $result->reason);
        }
    }

    public static function vectorProvider(): iterable
    {
        yield 'V1 test event' => [self::VECTOR_TEST_EVENT_BODY, self::VECTOR_TEST_EVENT_HEX];
        yield 'V2 unknown event' => [
            self::VECTOR_UNKNOWN_EVENT_BODY,
            self::VECTOR_UNKNOWN_EVENT_HEX,
        ];
        yield 'V3 six-key failed' => [self::VECTOR_FAILED_BODY, self::VECTOR_FAILED_HEX];
        yield 'V4 sent, null id' => [
            self::VECTOR_SENT_NULL_ID_BODY,
            self::VECTOR_SENT_NULL_ID_HEX,
        ];
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

    #[DataProvider('signedNonJsonBodyProvider')]
    public function testSignedNonJsonBodyIsValidUnknownWithNullEnvelope(string $body): void
    {
        $result = Webhooks::verify($body, self::sign($body), 'secret');

        self::assertTrue($result->valid);
        self::assertTrue($result->signatureValid);
        self::assertFalse($result->recognized);
        self::assertNull($result->reason);
        self::assertNull($result->eventType);
        self::assertNull($result->envelope);
        self::assertEquals(new WebhookEvent('unknown', ['raw' => []]), $result->event);
    }

    public static function signedNonJsonBodyProvider(): iterable
    {
        yield 'broken json' => ['{bad json'];
        yield 'empty body' => [''];
        yield 'plain text' => ['hello'];
    }

    #[DataProvider('signedUnusableEnvelopeProvider')]
    public function testSignedJsonWithoutUsableEnvelopeIsValidUnknown(
        string $body,
        ?string $expectedEventType,
        array $expectedRaw,
    ): void {
        $result = Webhooks::verify($body, self::sign($body), 'secret');

        self::assertTrue($result->valid);
        self::assertFalse($result->recognized);
        self::assertNull($result->reason);
        self::assertSame($expectedEventType, $result->eventType);
        self::assertSame(json_decode($body, true), $result->envelope);
        self::assertEquals(new WebhookEvent('unknown', ['raw' => $expectedRaw]), $result->event);
    }

    public static function signedUnusableEnvelopeProvider(): iterable
    {
        yield 'json null' => ['null', null, []];
        yield 'json number' => ['42', null, []];
        yield 'json string' => ['"message.sent"', null, []];
        yield 'json list' => ['["message.sent"]', null, []];
        yield 'empty object' => ['{}', null, []];
        yield 'event without data' => ['{"event":"message.sent"}', 'message.sent', []];
        yield 'data is a string' => ['{"event":"message.sent","data":"x"}', 'message.sent', []];
        yield 'data is a list' => ['{"event":"message.sent","data":[1,2]}', 'message.sent', []];
        yield 'event name missing' => ['{"data":{"campaign_id":"42"}}', null, ['campaign_id' => '42']];
        yield 'event name empty' => [
            '{"event":"","data":{"campaign_id":"42"}}',
            null,
            ['campaign_id' => '42'],
        ];
        yield 'event name not a string' => [
            '{"event":7,"data":{"campaign_id":"42"}}',
            null,
            ['campaign_id' => '42'],
        ];
    }

    public function testUnknownEventNameIsValidUnknownWithRawAndEnvelope(): void
    {
        $body = json_encode(
            ['event' => 'message.unknown', 'tenant_id' => 1, 'data' => ['some_key' => 'value']],
            JSON_THROW_ON_ERROR,
        );

        $result = Webhooks::verify($body, self::sign($body), 'secret');

        self::assertTrue($result->valid);
        self::assertFalse($result->recognized);
        self::assertNull($result->reason);
        self::assertSame('message.unknown', $result->eventType);
        self::assertEquals(
            new WebhookEvent('unknown', ['raw' => ['some_key' => 'value']]),
            $result->event,
        );
        self::assertSame(
            ['event' => 'message.unknown', 'tenant_id' => 1, 'data' => ['some_key' => 'value']],
            $result->envelope,
        );
    }

    public function testUnknownEventTypeReasonIsNeverReturned(): void
    {
        $bodies = [
            '{"event":"message.unknown","tenant_id":1,"data":{}}',
            '{"event":"message.sent","data":{}}',
            '{bad json',
            'null',
        ];

        foreach ($bodies as $body) {
            $result = Webhooks::verify($body, self::sign($body), 'secret');

            self::assertTrue($result->valid);
            self::assertNull($result->reason);
        }
    }

    public function testLegacyEventTypeNameIsReportedAsEventType(): void
    {
        $body = '{"event_type":"campaign.completed","payload":{"campaign_id":"42"}}';

        $result = Webhooks::verify($body, self::sign($body), 'secret');

        self::assertTrue($result->valid);
        self::assertFalse($result->recognized);
        self::assertSame('campaign.completed', $result->eventType);
        self::assertSame(['campaign_id' => '42'], $result->event?->data['raw']);
    }

    #[DataProvider('flaggedAsTestProvider')]
    public function testAnyEventFlaggedAsTestIsATestEvent(
        string $eventName,
        array $data,
        ?string $expectedFrom,
        ?string $expectedText,
    ): void {
        $body = json_encode(['event' => $eventName, 'tenant_id' => 1, 'data' => $data], JSON_THROW_ON_ERROR);

        $result = Webhooks::verify($body, self::sign($body), 'secret');

        self::assertTrue($result->valid);
        self::assertTrue($result->recognized);
        self::assertSame($eventName, $result->eventType);
        self::assertEquals(
            new WebhookEvent('test', [
                'test' => true,
                'from' => $expectedFrom,
                'text' => $expectedText,
                'raw' => $data,
            ]),
            $result->event,
        );
    }

    public static function flaggedAsTestProvider(): iterable
    {
        yield 'bare flag' => ['inbound.message', ['test' => true], null, null];
        yield 'on another event name' => [
            'message.delivered',
            ['test' => true, 'message_id' => 1, 'delivered_at' => '2026-11-21T10:00:00.000Z'],
            null,
            null,
        ];
        yield 'on an unknown event name' => [
            'campaign.completed',
            ['test' => true, 'from' => '+966500000000'],
            '+966500000000',
            null,
        ];
        yield 'empty from and mistyped text' => [
            'inbound.message',
            ['test' => true, 'from' => '', 'message' => ['text' => ['body' => 7]]],
            null,
            null,
        ];
        yield 'message is not an object' => [
            'inbound.message',
            ['test' => true, 'from' => '+966500000000', 'message' => 'hi'],
            '+966500000000',
            null,
        ];
    }

    #[DataProvider('notATestFlagProvider')]
    public function testOnlyBooleanTrueMarksATestEvent(mixed $flag): void
    {
        $body = json_encode([
            'event' => 'inbound.message',
            'data' => ['test' => $flag, 'from' => '+966500000000', 'type' => 'text'],
        ], JSON_THROW_ON_ERROR);

        $result = Webhooks::verify($body, self::sign($body), 'secret');

        self::assertTrue($result->valid);
        self::assertSame('inbound.message', $result->event?->type);
    }

    public static function notATestFlagProvider(): iterable
    {
        yield 'false' => [false];
        yield 'string' => ['true'];
        yield 'one' => [1];
        yield 'null' => [null];
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
            new WebhookFailedError(null, null, 'Legacy provider failure', null, null, null),
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

    #[DataProvider('knownEventMissingFieldProvider')]
    public function testKnownEventMissingRequiredFieldIsValidUnknown(
        string $eventName,
        array $data,
    ): void {
        $body = json_encode(['event' => $eventName, 'data' => $data], JSON_THROW_ON_ERROR);

        $result = Webhooks::verify($body, self::sign($body), 'secret');

        self::assertTrue($result->valid);
        self::assertTrue($result->signatureValid);
        self::assertFalse($result->recognized);
        self::assertNull($result->reason);
        self::assertSame($eventName, $result->eventType);
        self::assertEquals(new WebhookEvent('unknown', ['raw' => $data]), $result->event);
        self::assertSame(['event' => $eventName, 'data' => $data], $result->envelope);
    }

    public static function knownEventMissingFieldProvider(): iterable
    {
        $at = '2026-11-21T10:00:00.000Z';

        yield 'sent without to_phone' => ['message.sent', [
            'message_id' => 'wamid.FAKE_SENT_0001',
            'template_name' => 'hello_world',
            'template_language' => 'en',
            'sent_at' => $at,
        ]];
        yield 'sent without sent_at' => ['message.sent', [
            'message_id' => 'wamid.FAKE_SENT_0001',
            'to_phone' => '+966500000000',
            'template_name' => 'hello_world',
            'template_language' => 'en',
        ]];
        yield 'sent template without language' => ['message.sent', [
            'to_phone' => '+966500000000',
            'template_name' => 'hello_world',
            'sent_at' => $at,
        ]];
        yield 'sent text without text' => ['message.sent', [
            'message_type' => 'text',
            'to_phone' => '+966500000000',
            'sent_at' => $at,
        ]];
        yield 'sent with unknown message type' => ['message.sent', [
            'message_type' => 'image',
            'to_phone' => '+966500000000',
            'sent_at' => $at,
        ]];
        yield 'delivered without message_id' => ['message.delivered', ['delivered_at' => $at]];
        yield 'delivered with null message_id' => ['message.delivered', [
            'message_id' => null,
            'delivered_at' => $at,
        ]];
        yield 'delivered without timestamp' => ['message.delivered', ['message_id' => 4242]];
        yield 'read without timestamp' => ['message.read', ['message_id' => 4243]];
        yield 'failed without timestamp' => ['message.failed', ['message_id' => 4244]];
        yield 'inbound without from' => ['inbound.message', ['type' => 'text']];
        yield 'inbound without type' => ['inbound.message', ['from' => '+966500000000']];
    }

    #[DataProvider('sentMessageIdProvider')]
    public function testMessageSentAcceptsStringNumericAndAbsentIds(
        array $idField,
        ?string $expected,
    ): void {
        $body = json_encode([
            'event' => 'message.sent',
            'data' => $idField + [
                'to_phone' => '+966500000000',
                'template_name' => 'hello_world',
                'template_language' => 'en',
                'sent_at' => '2026-11-21T10:00:00.000Z',
            ],
        ], JSON_THROW_ON_ERROR);

        $result = Webhooks::verify($body, self::sign($body), 'secret');

        self::assertTrue($result->valid);
        self::assertTrue($result->recognized);
        self::assertSame('message.sent', $result->event?->type);
        self::assertSame($expected, $result->event->data['messageId']);
    }

    public static function sentMessageIdProvider(): iterable
    {
        yield 'string' => [['message_id' => 'wamid.FAKE_SENT_0001'], 'wamid.FAKE_SENT_0001'];
        yield 'number' => [['message_id' => 4242], '4242'];
        yield 'null' => [['message_id' => null], null];
        yield 'absent' => [[], null];
    }

    public function testTextMessageSentAcceptsNullId(): void
    {
        $body = json_encode([
            'event' => 'message.sent',
            'data' => [
                'message_id' => null,
                'to_phone' => '+966500000000',
                'text' => 'A free-form reply',
                'sent_at' => '2026-11-21T10:00:00.000Z',
            ],
        ], JSON_THROW_ON_ERROR);

        $result = Webhooks::verify($body, self::sign($body), 'secret');

        self::assertTrue($result->recognized);
        self::assertNull($result->event?->data['messageId']);
        self::assertSame('text', $result->event->data['messageType']);
        self::assertSame('A free-form reply', $result->event->data['text']);
    }

    #[DataProvider('statusEventProvider')]
    public function testStatusEventsExposeProviderMsgIdAndToPhone(
        string $eventName,
        string $wireTimestampKey,
        string $timestampKey,
    ): void {
        $body = json_encode([
            'event' => $eventName,
            'tenant_id' => 1,
            'data' => [
                'message_id' => 4242,
                'provider_msg_id' => 'wamid.FAKE_STATUS_0001',
                'to_phone' => '+966500000000',
                $wireTimestampKey => '2026-11-21T10:00:00.000Z',
            ],
        ], JSON_THROW_ON_ERROR);

        $result = Webhooks::verify($body, self::sign($body), 'secret');

        self::assertTrue($result->valid);
        self::assertTrue($result->recognized);
        self::assertSame($eventName, $result->event?->type);
        self::assertSame('4242', $result->event->data['messageId']);
        self::assertSame('wamid.FAKE_STATUS_0001', $result->event->data['providerMsgId']);
        self::assertSame('+966500000000', $result->event->data['toPhone']);
        self::assertSame('2026-11-21T10:00:00.000Z', $result->event->data[$timestampKey]);
    }

    #[DataProvider('statusEventProvider')]
    public function testStatusEventsWithoutProviderMsgIdAndToPhoneGiveNull(
        string $eventName,
        string $wireTimestampKey,
    ): void {
        foreach ([[], ['provider_msg_id' => null, 'to_phone' => null], ['provider_msg_id' => '', 'to_phone' => 7]] as $extra) {
            $body = json_encode([
                'event' => $eventName,
                'data' => $extra + [
                    'message_id' => '4242',
                    $wireTimestampKey => '2026-11-21T10:00:00.000Z',
                ],
            ], JSON_THROW_ON_ERROR);

            $result = Webhooks::verify($body, self::sign($body), 'secret');

            self::assertTrue($result->recognized);
            self::assertArrayHasKey('providerMsgId', $result->event?->data ?? []);
            self::assertArrayHasKey('toPhone', $result->event->data);
            self::assertNull($result->event->data['providerMsgId']);
            self::assertNull($result->event->data['toPhone']);
        }
    }

    public static function statusEventProvider(): iterable
    {
        yield 'delivered' => ['message.delivered', 'delivered_at', 'deliveredAt'];
        yield 'read' => ['message.read', 'read_at', 'readAt'];
        yield 'failed' => ['message.failed', 'failed_at', 'failedAt'];
    }

    public function testLegacyThreeKeyErrorGivesNullForTheNewFields(): void
    {
        $result = $this->verifyFailedWithError([
            'code' => 131049,
            'title' => 'Message failed to send',
            'message' => 'Not delivered',
        ]);

        self::assertEquals(
            new WebhookFailedError(131049, 'Message failed to send', 'Not delivered', null, null, null),
            $result->event?->data['error'],
        );
    }

    public function testMistypedErrorFieldsGiveNull(): void
    {
        $result = $this->verifyFailedWithError([
            'code' => '131049',
            'title' => '',
            'message' => 7,
            'error_data' => 'not an object',
            'details' => ['nested'],
            'error_user_msg' => '',
        ]);

        self::assertEquals(
            new WebhookFailedError(null, null, null, null, null, null),
            $result->event?->data['error'],
        );
    }

    public function testErrorDataListIsNotAnObject(): void
    {
        $result = $this->verifyFailedWithError(['code' => 1.0, 'error_data' => ['a', 'b']]);

        $error = $result->event?->data['error'];
        self::assertSame(1, $error->code);
        self::assertNull($error->errorData);
    }

    public function testErrorUserMsgIsMapped(): void
    {
        $result = $this->verifyFailedWithError([
            'code' => 131042,
            'error_user_msg' => 'Payment issue on the account',
        ]);

        self::assertSame('Payment issue on the account', $result->event?->data['error']->errorUserMsg);
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

    private function verifyFailedWithError(mixed $error): WebhookVerifyResult
    {
        $body = json_encode([
            'event' => 'message.failed',
            'data' => [
                'message_id' => 4244,
                'failed_at' => '2026-11-21T10:02:00.000Z',
                'error' => $error,
            ],
        ], JSON_THROW_ON_ERROR);

        $result = Webhooks::verify($body, self::sign($body), 'secret');
        self::assertTrue($result->valid);
        self::assertSame('message.failed', $result->event?->type);

        return $result;
    }

    public function testInvalidResultFactoryHasNoEventFields(): void
    {
        $result = WebhookVerifyResult::invalid('signature_mismatch');

        self::assertFalse($result->valid);
        self::assertFalse($result->signatureValid);
        self::assertFalse($result->recognized);
        self::assertNull($result->eventType);
        self::assertNull($result->envelope);
        self::assertNull($result->event);
        self::assertSame('signature_mismatch', $result->reason);
    }

    public function testValidResultFactoryKeepsItsOneArgumentForm(): void
    {
        $event = new WebhookEvent('message.read', ['messageId' => '1']);

        $result = WebhookVerifyResult::valid($event);

        self::assertTrue($result->valid);
        self::assertTrue($result->signatureValid);
        self::assertTrue($result->recognized);
        self::assertNull($result->eventType);
        self::assertNull($result->envelope);
        self::assertSame($event, $result->event);
        self::assertNull($result->reason);
    }

    #[DataProvider('hostileInputProvider')]
    public function testVerifierNeverThrows(mixed $input): void
    {
        $result = Webhooks::verifyInput($input);

        self::assertFalse($result->valid);
        self::assertNotNull($result->reason);
    }

    public static function hostileInputProvider(): iterable
    {
        yield 'null' => [null];
        yield 'object' => [new \stdClass()];
        yield 'empty array' => [[]];
        yield 'array body' => [['rawBody' => ['x'], 'signature' => 'sha256=abc', 'secret' => 'secret']];
        yield 'object body' => [[
            'rawBody' => new \stdClass(),
            'signature' => 'sha256=' . str_repeat('0', 64),
            'secret' => 'secret',
        ]];
        yield 'array secret' => [['rawBody' => '{}', 'signature' => 'sha256=abc', 'secret' => ['x']]];
    }

    private static function flipLastHexDigit(string $signature): string
    {
        $last = substr($signature, -1);

        return substr($signature, 0, -1) . ($last === '0' ? '1' : '0');
    }

    private static function sign(string $body): string
    {
        return 'sha256=' . hash_hmac('sha256', $body, 'secret');
    }
}
