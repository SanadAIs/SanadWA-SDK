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
        $data = [
            'message_id' => $messageId,
            'provider_msg_id' => 'wamid.HBgMOTY2NTAwMDAwMDAw_DELIVERED',
            'to_phone' => '+966500000000',
            'delivered_at' => $deliveredAt,
        ];

        return self::buildFixture(
            'message.delivered',
            $data,
            new WebhookEvent('message.delivered', [
                'messageId' => $messageId,
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
        $data = [
            'message_id' => $messageId,
            'provider_msg_id' => 'wamid.HBgMOTY2NTAwMDAwMDAw_READ',
            'to_phone' => '+966500000000',
            'read_at' => $readAt,
        ];

        return self::buildFixture(
            'message.read',
            $data,
            new WebhookEvent('message.read', [
                'messageId' => $messageId,
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
        $error = ['code' => $code, 'title' => $title, 'message' => $message];
        $data = [
            'message_id' => $messageId,
            'provider_msg_id' => 'wamid.HBgMOTY2NTAwMDAwMDAw_FAILED',
            'to_phone' => '+966500000000',
            'failed_at' => $failedAt,
            'error' => $error,
        ];

        return self::buildFixture(
            'message.failed',
            $data,
            new WebhookEvent('message.failed', [
                'messageId' => $messageId,
                'failedAt' => $failedAt,
                'error' => new WebhookFailedError($code, $title, $message),
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

    private static function buildFixture(
        string $event,
        array $data,
        WebhookEvent $expectedEvent,
        string $secret,
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
        ];
    }
}
