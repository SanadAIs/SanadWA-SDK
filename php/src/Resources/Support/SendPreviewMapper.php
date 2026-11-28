<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Resources\Support;

use Sanadwa\WhatsApp\Dto\SendPreview;
use Sanadwa\WhatsApp\Dto\SendPreviewBalance;
use Sanadwa\WhatsApp\Dto\SendPreviewCredits;
use Sanadwa\WhatsApp\Dto\SendPreviewRecipients;
use Sanadwa\WhatsApp\Dto\SendPreviewRefusal;
use Sanadwa\WhatsApp\Dto\SendPreviewTemplate;
use Sanadwa\WhatsApp\Http\ResponseValidator;

/**
 * Reads the `{ success, data }` answer of `POST /messages/preview` and
 * `POST /campaigns/preview`. A missing or mistyped field throws
 * `malformed_response` naming its wire path (`data.recipients.opted_out`).
 *
 * @internal Not part of the public API; it may change in any release.
 */
final class SendPreviewMapper
{
    private const KINDS = ['template', 'text', 'campaign'];
    private const BILLING_TYPES = ['prepaid', 'postpaid'];

    private function __construct()
    {
    }

    public static function map(mixed $raw): SendPreview
    {
        $data = ResourceSupport::dataObject($raw);

        return new SendPreview(
            kind: self::oneOf($data, 'kind', self::KINDS, 'data.kind'),
            wouldSend: ResourceSupport::bool($data, 'would_send', 'data.would_send'),
            refusal: self::refusal(ResourceSupport::nullableObject($data, 'refusal', 'data.refusal'), 'data.refusal'),
            template: self::template(ResourceSupport::nullableObject($data, 'template', 'data.template'), 'data.template'),
            recipients: self::recipients(
                ResourceSupport::nullableObject($data, 'recipients', 'data.recipients'),
                'data.recipients',
            ),
            credits: self::credits(ResourceSupport::nullableObject($data, 'credits', 'data.credits'), 'data.credits'),
            balance: self::balance(ResourceSupport::nullableObject($data, 'balance', 'data.balance'), 'data.balance'),
            asOf: ResponseValidator::requiredString($data, 'as_of', 'data.as_of'),
        );
    }

    private static function refusal(?array $refusal, string $field): ?SendPreviewRefusal
    {
        if ($refusal === null) {
            return null;
        }

        return new SendPreviewRefusal(
            status: ResourceSupport::int($refusal, 'status', $field . '.status'),
            code: ResponseValidator::requiredString($refusal, 'code', $field . '.code'),
            message: ResponseValidator::requiredString($refusal, 'message', $field . '.message'),
            messageAr: ResponseValidator::requiredString($refusal, 'message_ar', $field . '.message_ar'),
            details: ResourceSupport::nullableObject($refusal, 'details', $field . '.details'),
        );
    }

    private static function template(?array $template, string $field): ?SendPreviewTemplate
    {
        if ($template === null) {
            return null;
        }

        return new SendPreviewTemplate(
            name: ResponseValidator::requiredString($template, 'name', $field . '.name'),
            language: ResourceSupport::nullableString($template, 'language', $field . '.language'),
            category: ResourceSupport::nullableString($template, 'category', $field . '.category'),
        );
    }

    private static function recipients(?array $recipients, string $field): ?SendPreviewRecipients
    {
        if ($recipients === null) {
            return null;
        }
        $count = static fn (string $key): int => ResourceSupport::int($recipients, $key, $field . '.' . $key);

        return new SendPreviewRecipients(
            requested: $count('requested'),
            optedOut: $count('opted_out'),
            suppressed: $count('suppressed'),
            invalidPhone: $count('invalid_phone'),
            duplicate: $count('duplicate'),
            allowlistBlocked: $count('allowlist_blocked'),
            eligible: $count('eligible'),
        );
    }

    private static function credits(?array $credits, string $field): ?SendPreviewCredits
    {
        if ($credits === null) {
            return null;
        }
        $count = static fn (string $key): int => ResourceSupport::int($credits, $key, $field . '.' . $key);

        return new SendPreviewCredits(
            billingType: self::oneOf($credits, 'billing_type', self::BILLING_TYPES, $field . '.billing_type'),
            chargeCategory: ResponseValidator::requiredString($credits, 'charge_category', $field . '.charge_category'),
            perMessage: $count('per_message'),
            estimated: $count('estimated'),
            fromFreeAllowance: $count('from_free_allowance'),
            fromPaidBalance: $count('from_paid_balance'),
            coveredBySubscription: ResourceSupport::bool(
                $credits,
                'covered_by_subscription',
                $field . '.covered_by_subscription',
            ),
        );
    }

    private static function balance(?array $balance, string $field): ?SendPreviewBalance
    {
        if ($balance === null) {
            return null;
        }

        return new SendPreviewBalance(
            availableCredits: ResourceSupport::nullableNumber(
                $balance,
                'available_credits',
                $field . '.available_credits',
            ),
            // May be negative: the send is short by that much.
            afterSend: ResourceSupport::nullableNumber($balance, 'after_send', $field . '.after_send'),
            unlimited: ResourceSupport::bool($balance, 'unlimited', $field . '.unlimited'),
        );
    }

    /**
     * @param list<string> $allowed
     */
    private static function oneOf(array $source, string $key, array $allowed, string $field): string
    {
        $value = ResponseValidator::requiredString($source, $key, $field);
        if (!in_array($value, $allowed, true)) {
            ResourceSupport::malformed($field, 'must be one of ' . implode(', ', $allowed));
        }

        return $value;
    }
}
