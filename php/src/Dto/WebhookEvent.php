<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * A verified webhook delivery. `$data` uses camelCase keys and always has `raw`, the wire
 * `data` object unchanged.
 *
 * | `$type`             | `$data` keys |
 * |---------------------|--------------|
 * | `message.sent`      | `messageId` (string or null), `messageType` (`template` or `text`), `toPhone`, `templateName`, `templateLanguage`, `text`, `sentAt`, `raw` |
 * | `message.delivered` | `messageId`, `providerMsgId`, `toPhone`, `deliveredAt`, `raw` |
 * | `message.read`      | `messageId`, `providerMsgId`, `toPhone`, `readAt`, `raw` |
 * | `message.failed`    | `messageId`, `providerMsgId`, `toPhone`, `failedAt`, `error` (`WebhookFailedError`), `raw` |
 * | `inbound.message`   | `from`, `messageType`, `messageId` (string or null), optional `text`, optional `timestamp`, `raw` |
 * | `test`              | `test` (true), `from` (string or null), `text` (string or null), `raw` |
 * | `unknown`           | `raw` |
 *
 * On `message.delivered`, `message.read` and `message.failed`: `messageId` is SanadWA's row
 * id. `providerMsgId` is the WhatsApp message id (`wamid.…`): match on it against the
 * `messageId` a send returned, and pass it to `messages()->get()`.
 *
 * `test` is the console's "Send test event" delivery (any event whose `data.test` is true);
 * ignore it. `unknown` is a correctly signed delivery this SDK version cannot type; answer
 * 2xx and ignore it unless you handle it yourself from `raw`.
 */
final class WebhookEvent
{
    public function __construct(
        public readonly string $type,
        public readonly array $data,
    ) {
    }
}
