<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Resources;

use Sanadwa\WhatsApp\Dto\WebhookEvent;
use Sanadwa\WhatsApp\Dto\WebhookFailedError;
use Sanadwa\WhatsApp\Dto\WebhookVerifyResult;

final class Webhooks
{
    /**
     * Checks `X-Sanad-Signature` against the raw request body and types the delivery.
     * Never throws.
     *
     * `$valid` is false only when the signature does not match: answer 401 then. For every
     * valid result answer 2xx, including `unknown` events (a correctly signed delivery this
     * SDK version cannot type, `$recognized === false`) and `test` events (the console's
     * "Send test event"), and act only on the event types you handle.
     *
     * On `message.delivered`, `message.read` and `message.failed`: `messageId` is SanadWA's
     * row id. `providerMsgId` is the WhatsApp message id (`wamid.…`): match on it against the
     * `messageId` a send returned, and pass it to `messages()->get()`.
     *
     * @param string $rawBody The request body exactly as received, before any JSON decoding.
     */
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
        } catch (\Throwable) {
            return WebhookVerifyResult::invalid('verification_error');
        }

        // The signature matched: from here on the result is always valid.
        try {
            return self::describeSignedBody($rawBody);
        } catch (\Throwable) {
            return self::unknownResult(null, null, []);
        }
    }

    private static function describeSignedBody(string $rawBody): WebhookVerifyResult
    {
        try {
            // Intentional TS deviation: cap payload depth at 512 to reduce JSON nesting DoS risk.
            $envelope = json_decode($rawBody, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return self::unknownResult(null, null, []);
        }

        if (!self::isJsonObject($envelope)) {
            return self::unknownResult(null, $envelope, []);
        }

        $eventType = self::asString($envelope['event'] ?? null)
            ?? self::asString($envelope['event_type'] ?? null);
        $rawData = $envelope['data'] ?? $envelope['payload'] ?? null;
        if (!self::isJsonObject($rawData)) {
            return self::unknownResult($eventType, $envelope, []);
        }
        if ($eventType === null) {
            return self::unknownResult(null, $envelope, $rawData);
        }

        $event = self::narrowWebhookEvent($eventType, $rawData);
        if ($event === null) {
            return self::unknownResult($eventType, $envelope, $rawData);
        }

        return WebhookVerifyResult::valid($event, true, $eventType, $envelope);
    }

    private static function unknownResult(
        ?string $eventType,
        mixed $envelope,
        array $raw,
    ): WebhookVerifyResult {
        return WebhookVerifyResult::valid(
            new WebhookEvent('unknown', ['raw' => $raw]),
            false,
            $eventType,
            $envelope,
        );
    }

    private static function narrowWebhookEvent(string $type, array $rawData): ?WebhookEvent
    {
        // The console's "Send test event" delivery. Checked before the event name so that a
        // flagged delivery is never typed as a real event.
        if (($rawData['test'] ?? null) === true) {
            $message = $rawData['message'] ?? null;
            $text = is_array($message) && is_array($message['text'] ?? null)
                ? self::asString($message['text']['body'] ?? null)
                : null;

            return new WebhookEvent('test', [
                'test' => true,
                'from' => self::asString($rawData['from'] ?? null),
                'text' => $text,
                'raw' => $rawData,
            ]);
        }

        switch ($type) {
            case 'message.sent':
                // The API sends `message_id: null` when WhatsApp returned no id.
                $messageId = self::asId($rawData['message_id'] ?? null);
                $toPhone = self::asString($rawData['to_phone'] ?? null);
                $sentAt = self::asString($rawData['sent_at'] ?? null);
                if ($toPhone === null || $sentAt === null) {
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
                    'providerMsgId' => self::asString($rawData['provider_msg_id'] ?? null),
                    'toPhone' => self::asString($rawData['to_phone'] ?? null),
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
                    'providerMsgId' => self::asString($rawData['provider_msg_id'] ?? null),
                    'toPhone' => self::asString($rawData['to_phone'] ?? null),
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
                    'providerMsgId' => self::asString($rawData['provider_msg_id'] ?? null),
                    'toPhone' => self::asString($rawData['to_phone'] ?? null),
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

    private static function isJsonObject(mixed $value): bool
    {
        return is_array($value) && ($value === [] || !array_is_list($value));
    }

    private static function parseFailedError(mixed $raw): WebhookFailedError
    {
        if (is_array($raw)) {
            $rawCode = $raw['code'] ?? null;
            $code = is_int($rawCode) ? $rawCode : null;
            if (is_float($rawCode) && is_finite($rawCode) && floor($rawCode) === $rawCode) {
                $code = (int) $rawCode;
            }
            $errorData = $raw['error_data'] ?? null;

            return new WebhookFailedError(
                code: $code,
                title: self::asString($raw['title'] ?? null),
                message: self::asString($raw['message'] ?? null),
                errorData: self::isJsonObject($errorData) ? $errorData : null,
                details: self::asString($raw['details'] ?? null),
                errorUserMsg: self::asString($raw['error_user_msg'] ?? null),
            );
        }
        if (is_string($raw)) {
            return new WebhookFailedError(null, null, $raw);
        }

        return new WebhookFailedError(null, null, null);
    }
}
