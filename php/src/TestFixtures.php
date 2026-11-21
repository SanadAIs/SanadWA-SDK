<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp;

use Sanadwa\WhatsApp\Dto\WebhookEvent;
use Sanadwa\WhatsApp\Dto\WebhookFailedError;

final class TestFixtures
{
    public const DEFAULT_SECRET = 'whsec_test_fixture_secret_do_not_use_in_prod';
    public const DEFAULT_TENANT_ID = 1;

    public static function createMessageSentFixture(array $overrides = []): array
    {
        $messageId = $overrides['messageId'] ?? 'wamid.HBgMOTY2NTAwMDAwMDAw_SENT';
        $toPhone = $overrides['toPhone'] ?? '+966500000000';
        $templateName = $overrides['templateName'] ?? 'hello_world';
        $templateLanguage = $overrides['templateLanguage'] ?? 'en';
        $sentAt = $overrides['sentAt'] ?? '2026-05-10T12:00:00.000Z';
        $data = [
            'message_id' => $messageId,
            'to_phone' => $toPhone,
            'template_name' => $templateName,
            'template_language' => $templateLanguage,
            'sent_at' => $sentAt,
        ];

        return self::buildFixture(
            'message.sent',
            $data,
            new WebhookEvent('message.sent', [
                'messageId' => $messageId,
                'messageType' => 'template',
                'toPhone' => $toPhone,
                'templateName' => $templateName,
                'templateLanguage' => $templateLanguage,
                'text' => null,
                'sentAt' => $sentAt,
                'raw' => $data,
            ]),
            $overrides['secret'] ?? self::DEFAULT_SECRET,
        );
    }

    public static function createTextMessageSentFixture(array $overrides = []): array
    {
        $messageId = $overrides['messageId'] ?? 'wamid.HBgMOTY2NTAwMDAwMDAw_TEXT';
        $toPhone = $overrides['toPhone'] ?? '+966500000000';
        $text = $overrides['text'] ?? 'A free-form reply';
        $sentAt = $overrides['sentAt'] ?? '2026-07-21T12:00:00.000Z';
        $data = [
            'message_id' => $messageId,
            'message_type' => 'text',
            'to_phone' => $toPhone,
            'text' => $text,
            'template_name' => null,
            'template_language' => null,
            'sent_at' => $sentAt,
        ];

        return self::buildFixture(
            'message.sent',
            $data,
            new WebhookEvent('message.sent', [
                'messageId' => $messageId,
                'messageType' => 'text',
                'toPhone' => $toPhone,
                'templateName' => null,
                'templateLanguage' => null,
                'text' => $text,
                'sentAt' => $sentAt,
                'raw' => $data,
            ]),
            $overrides['secret'] ?? self::DEFAULT_SECRET,
        );
    }

    public static function createMessageDeliveredFixture(array $overrides = []): array
    {
        $messageId = $overrides['messageId'] ?? '4242';
        $deliveredAt = $overrides['deliveredAt'] ?? '2026-05-10T12:00:00.000Z';
        $providerMsgId = $overrides['providerMsgId'] ?? 'wamid.HBgMOTY2NTAwMDAwMDAw_DELIVERED';
        $toPhone = $overrides['toPhone'] ?? '+966500000000';
        $data = [
            'message_id' => $messageId,
            'provider_msg_id' => $providerMsgId,
            'to_phone' => $toPhone,
            'delivered_at' => $deliveredAt,
        ];

        return self::buildFixture(
            'message.delivered',
            $data,
            new WebhookEvent('message.delivered', [
                'messageId' => $messageId,
                'providerMsgId' => $providerMsgId,
                'toPhone' => $toPhone,
                'deliveredAt' => $deliveredAt,
                'raw' => $data,
            ]),
            $overrides['secret'] ?? self::DEFAULT_SECRET,
        );
    }

    public static function createMessageReadFixture(array $overrides = []): array
    {
        $messageId = $overrides['messageId'] ?? '4243';
        $readAt = $overrides['readAt'] ?? '2026-05-10T12:01:00.000Z';
        $providerMsgId = $overrides['providerMsgId'] ?? 'wamid.HBgMOTY2NTAwMDAwMDAw_READ';
        $toPhone = $overrides['toPhone'] ?? '+966500000000';
        $data = [
            'message_id' => $messageId,
            'provider_msg_id' => $providerMsgId,
            'to_phone' => $toPhone,
            'read_at' => $readAt,
        ];

        return self::buildFixture(
            'message.read',
            $data,
            new WebhookEvent('message.read', [
                'messageId' => $messageId,
                'providerMsgId' => $providerMsgId,
                'toPhone' => $toPhone,
                'readAt' => $readAt,
                'raw' => $data,
            ]),
            $overrides['secret'] ?? self::DEFAULT_SECRET,
        );
    }

    public static function createMessageFailedFixture(array $overrides = []): array
    {
        $messageId = $overrides['messageId'] ?? '4244';
        $failedAt = $overrides['failedAt'] ?? '2026-05-10T12:02:00.000Z';
        $code = $overrides['errorCode'] ?? 131049;
        $title = $overrides['errorTitle'] ?? 'Message failed to send';
        $message = $overrides['errorMessage']
            ?? 'This message was not delivered to maintain healthy ecosystem engagement.';
        $engagementDetails = 'In order to maintain a healthy ecosystem engagement, '
            . 'the message failed to be delivered.';
        // array_key_exists, not `??`: an explicit null override must stay null.
        $errorData = array_key_exists('errorData', $overrides)
            ? $overrides['errorData']
            : ['details' => $engagementDetails];
        $details = array_key_exists('details', $overrides)
            ? $overrides['details']
            : $engagementDetails;
        $errorUserMsg = $overrides['errorUserMsg'] ?? null;
        $providerMsgId = $overrides['providerMsgId'] ?? 'wamid.HBgMOTY2NTAwMDAwMDAw_FAILED';
        $toPhone = $overrides['toPhone'] ?? '+966500000000';
        // Production always sends all six keys, null when absent.
        $error = [
            'code' => $code,
            'title' => $title,
            'message' => $message,
            'error_data' => $errorData,
            'details' => $details,
            'error_user_msg' => $errorUserMsg,
        ];
        $data = [
            'message_id' => $messageId,
            'provider_msg_id' => $providerMsgId,
            'to_phone' => $toPhone,
            'failed_at' => $failedAt,
            'error' => $error,
        ];

        return self::buildFixture(
            'message.failed',
            $data,
            new WebhookEvent('message.failed', [
                'messageId' => $messageId,
                'providerMsgId' => $providerMsgId,
                'toPhone' => $toPhone,
                'failedAt' => $failedAt,
                'error' => new WebhookFailedError(
                    $code,
                    $title,
                    $message,
                    $errorData,
                    $details,
                    $errorUserMsg,
                ),
                'raw' => $data,
            ]),
            $overrides['secret'] ?? self::DEFAULT_SECRET,
        );
    }

    public static function createInboundMessageFixture(array $overrides = []): array
    {
        $from = $overrides['from'] ?? $overrides['fromPhone'] ?? '+966500000000';
        $text = $overrides['text'] ?? 'Hello from a test fixture';
        $messageType = $overrides['messageType'] ?? 'text';
        $messageId = $overrides['messageId'] ?? 'wamid.HBgMOTY2NTAwMDAwMDAw_INBOUND';
        $timestamp = $overrides['timestamp'] ?? '2026-05-10T12:03:00.000Z';
        $data = [
            'message_id' => $messageId,
            'from' => $from,
            'type' => $messageType,
            'timestamp' => $timestamp,
            'text' => $text,
        ];

        return self::buildFixture(
            'inbound.message',
            $data,
            new WebhookEvent('inbound.message', [
                'from' => $from,
                'messageType' => $messageType,
                'messageId' => $messageId,
                'text' => $text,
                'timestamp' => $timestamp,
                'raw' => $data,
            ]),
            $overrides['secret'] ?? self::DEFAULT_SECRET,
        );
    }

    /**
     * The console's "Send test event" delivery: an `inbound.message` whose data is flagged
     * `test: true`. It verifies as a `test` event, which handlers should ignore.
     *
     * @param array{secret?: string} $overrides
     */
    public static function createTestEventFixture(array $overrides = []): array
    {
        $data = [
            'test' => true,
            'from' => '+966500000000',
            'message' => ['type' => 'text', 'text' => ['body' => 'SanadWA test event.']],
        ];

        return self::buildFixture(
            'inbound.message',
            $data,
            new WebhookEvent('test', [
                'test' => true,
                'from' => '+966500000000',
                'text' => 'SanadWA test event.',
                'raw' => $data,
            ]),
            $overrides['secret'] ?? self::DEFAULT_SECRET,
        );
    }

    /**
     * A correctly signed delivery this SDK version cannot type. It verifies as valid with
     * `recognized === false` and an `unknown` event; answer 2xx and ignore it.
     *
     * @param array{eventType?: string, data?: array<string, mixed>, secret?: string} $overrides
     */
    public static function createUnknownEventFixture(array $overrides = []): array
    {
        $data = $overrides['data'] ?? [
            'campaign_id' => '42',
            'completed_at' => '2026-11-21T10:00:00.000Z',
        ];

        return self::buildFixture(
            $overrides['eventType'] ?? 'campaign.completed',
            $data,
            new WebhookEvent('unknown', ['raw' => $data]),
            $overrides['secret'] ?? self::DEFAULT_SECRET,
            false,
        );
    }

    private static function buildFixture(
        string $event,
        array $data,
        WebhookEvent $expectedEvent,
        string $secret,
        bool $recognized = true,
    ): array {
        $rawBody = json_encode(
            ['event' => $event, 'tenant_id' => self::DEFAULT_TENANT_ID, 'data' => $data],
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
        );

        return [
            'rawBody' => $rawBody,
            'signature' => 'sha256=' . hash_hmac('sha256', $rawBody, $secret),
            'secret' => $secret,
            'expectedEvent' => $expectedEvent,
            'recognized' => $recognized,
            'eventType' => $event,
        ];
    }
}
