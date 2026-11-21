<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * Result of `Webhooks::verify()`.
 *
 * Answer 401 only when `$valid` is false. Otherwise answer 2xx, also for `unknown` and `test`
 * events, and act only on the event types you handle.
 */
final class WebhookVerifyResult
{
    /**
     * @param bool $valid The signature matches the raw body. Nothing else can make it false.
     * @param WebhookEvent|null $event Non-null whenever `$valid` is true.
     * @param string|null $reason Non-null only when `$valid` is false: `invalid_input`,
     *     `invalid_secret`, `missing_body`, `malformed_signature`, `empty_signature`,
     *     `signature_length_mismatch`, `signature_mismatch` or `verification_error`
     *     (an unexpected internal exception).
     * @param bool $signatureValid Always equal to `$valid`.
     * @param bool $recognized True when `$event->type` is one of the known events or `test`;
     *     false when it is `unknown`.
     * @param string|null $eventType The wire event name (`event`, or legacy `event_type`) when
     *     it is a non-empty string.
     * @param mixed $envelope The decoded JSON body; null when the body is not valid JSON.
     */
    private function __construct(
        public readonly bool $valid,
        public readonly ?WebhookEvent $event,
        public readonly ?string $reason,
        public readonly bool $signatureValid,
        public readonly bool $recognized,
        public readonly ?string $eventType,
        public readonly mixed $envelope,
    ) {
    }

    public static function valid(
        WebhookEvent $event,
        bool $recognized = true,
        ?string $eventType = null,
        mixed $envelope = null,
    ): self {
        return new self(true, $event, null, true, $recognized, $eventType, $envelope);
    }

    public static function invalid(string $reason): self
    {
        return new self(false, null, $reason, false, false, null, null);
    }
}
