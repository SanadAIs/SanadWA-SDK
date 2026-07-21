<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Resources;

use Sanadwa\WhatsApp\Dto\WebhookEvent;
use Sanadwa\WhatsApp\Dto\WebhookFailedError;
use Sanadwa\WhatsApp\Dto\WebhookVerifyResult;

final class Webhooks
{
    public static function verify(
        string $rawBody,
        string $signature,
        string $secret,
    ): WebhookVerifyResult {
        return self::verifyValues($rawBody, $signature, $secret);
    }

    public static function verifyInput(mixed $input): WebhookVerifyResult
    {
        if (!is_array($input)) {
            return WebhookVerifyResult::invalid('invalid_input');
        }

        return self::verifyValues(
            $input['rawBody'] ?? null,
            $input['signature'] ?? null,
            $input['secret'] ?? null,
        );
    }

    private static function verifyValues(
        mixed $rawBody,
        mixed $signature,
        mixed $secret,
    ): WebhookVerifyResult {
        try {
            if (!is_string($secret) || $secret === '') {
                return WebhookVerifyResult::invalid('invalid_secret');
            }
            if ($rawBody === null) {
                return WebhookVerifyResult::invalid('missing_body');
            }
            if (!is_string($signature) || $signature === '') {
                return WebhookVerifyResult::invalid('malformed_signature');
            }
            if (!str_starts_with($signature, 'sha256=')) {
                return WebhookVerifyResult::invalid('malformed_signature');
            }

            $provided = substr($signature, strlen('sha256='));
            if ($provided === '') {
                return WebhookVerifyResult::invalid('empty_signature');
            }
            $expected = hash_hmac('sha256', $rawBody, $secret);
            if (strlen($provided) !== strlen($expected)) {
                return WebhookVerifyResult::invalid('signature_length_mismatch');
            }
            if (!hash_equals($expected, $provided)) {
                return WebhookVerifyResult::invalid('signature_mismatch');
            }

            try {
                // Intentional TS deviation: cap payload depth at 512 to reduce JSON nesting DoS risk.
                $parsed = json_decode($rawBody, true, 512, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                return WebhookVerifyResult::invalid('verification_error');
            }

            $event = self::narrowWebhookEvent($parsed);
            if ($event === null) {
                return WebhookVerifyResult::invalid('unknown_event_type');
            }

            return WebhookVerifyResult::valid($event);
        } catch (\Throwable) {
            return WebhookVerifyResult::invalid('verification_error');
        }
    }

    private static function narrowWebhookEvent(mixed $parsed): ?WebhookEvent
    {
        if (!is_array($parsed)) {
            return null;
        }

        $type = $parsed['event'] ?? $parsed['event_type'] ?? null;
        $rawData = $parsed['data'] ?? $parsed['payload'] ?? null;
        if (!is_string($type)) {
            return null;
        }
        if (!is_array($rawData)) {
            return null;
        }

        switch ($type) {
            case 'message.sent':
                $messageId = self::asId($rawData['message_id'] ?? null);
                $toPhone = self::asString($rawData['to_phone'] ?? null);
                $sentAt = self::asString($rawData['sent_at'] ?? null);
                if ($messageId === null || $toPhone === null || $sentAt === null) {
                    return null;
                }

                $declaredType = self::asString($rawData['message_type'] ?? null);
                $inferredType = $declaredType
                    ?? (self::asString($rawData['text'] ?? null) !== null ? 'text' : 'template');
                if ($inferredType === 'text') {
                    $text = self::asString($rawData['text'] ?? null);
                    if ($text === null) {
                        return null;
                    }

                    return new WebhookEvent('message.sent', [
                        'messageId' => $messageId,
                        'messageType' => 'text',
                        'toPhone' => $toPhone,
                        'templateName' => null,
                        'templateLanguage' => null,
                        'text' => $text,
                        'sentAt' => $sentAt,
                        'raw' => $rawData,
                    ]);
                }
                if ($inferredType !== 'template') {
                    return null;
                }

                $templateName = self::asString($rawData['template_name'] ?? null);
                $templateLanguage = self::asString($rawData['template_language'] ?? null);
                if ($templateName === null || $templateLanguage === null) {
                    return null;
                }

                return new WebhookEvent('message.sent', [
                    'messageId' => $messageId,
                    'messageType' => 'template',
                    'toPhone' => $toPhone,
                    'templateName' => $templateName,
                    'templateLanguage' => $templateLanguage,
                    'text' => null,
                    'sentAt' => $sentAt,
                    'raw' => $rawData,
                ]);

            case 'message.delivered':
                $messageId = self::asId($rawData['message_id'] ?? null);
                $deliveredAt = self::asString($rawData['delivered_at'] ?? null);
                if ($messageId === null || $deliveredAt === null) {
                    return null;
                }

                return new WebhookEvent('message.delivered', [
                    'messageId' => $messageId,
                    'deliveredAt' => $deliveredAt,
                    'raw' => $rawData,
                ]);

            case 'message.read':
                $messageId = self::asId($rawData['message_id'] ?? null);
                $readAt = self::asString($rawData['read_at'] ?? null);
                if ($messageId === null || $readAt === null) {
                    return null;
                }

                return new WebhookEvent('message.read', [
                    'messageId' => $messageId,
                    'readAt' => $readAt,
                    'raw' => $rawData,
                ]);

            case 'message.failed':
                $messageId = self::asId($rawData['message_id'] ?? null);
                $failedAt = self::asString($rawData['failed_at'] ?? null);
                if ($messageId === null || $failedAt === null) {
                    return null;
                }

                return new WebhookEvent('message.failed', [
                    'messageId' => $messageId,
                    'failedAt' => $failedAt,
                    'error' => self::parseFailedError($rawData['error'] ?? null),
                    'raw' => $rawData,
                ]);

            case 'inbound.message':
                $from = self::asString($rawData['from'] ?? null)
                    ?? self::asString($rawData['from_phone'] ?? null);
                $messageType = self::asString($rawData['type'] ?? null);
                if ($from === null || $messageType === null) {
                    return null;
                }

                $data = [
                    'from' => $from,
                    'messageType' => $messageType,
                    'messageId' => self::asId($rawData['message_id'] ?? null),
                    'raw' => $rawData,
                ];
                $text = self::asString($rawData['text'] ?? null);
                if ($text !== null) {
                    $data['text'] = $text;
                }
                $timestamp = self::asString($rawData['timestamp'] ?? null);
                if ($timestamp !== null) {
                    $data['timestamp'] = $timestamp;
                }

                return new WebhookEvent('inbound.message', $data);

            default:
                return null;
        }
    }

    private static function asString(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }

    private static function asId(mixed $value): ?string
    {
        if (is_string($value) && $value !== '') {
            return $value;
        }
        if (is_int($value)) {
            return (string) $value;
        }
        // Intentional TS deviation: reject non-integral floats instead of preserving their JS number form.
        if (is_float($value) && is_finite($value) && floor($value) === $value) {
            return (string) (int) $value;
        }

        return null;
    }

    private static function parseFailedError(mixed $raw): WebhookFailedError
    {
        if (is_array($raw)) {
            $rawCode = $raw['code'] ?? null;
            $code = is_int($rawCode) ? $rawCode : null;
            if (is_float($rawCode) && is_finite($rawCode) && floor($rawCode) === $rawCode) {
                $code = (int) $rawCode;
            }

            return new WebhookFailedError(
                code: $code,
                title: self::asString($raw['title'] ?? null),
                message: self::asString($raw['message'] ?? null),
            );
        }
        if (is_string($raw)) {
            return new WebhookFailedError(null, null, $raw);
        }

        return new WebhookFailedError(null, null, null);
    }
}
