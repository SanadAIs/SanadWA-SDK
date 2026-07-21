# Changelog

## 0.3.0

- Add `messages()->sendText()` for free-form customer-service replies through
  `POST /messages/text`, retaining `messages()->reply()` as an alias.
- Add `SendTextOptions` and `SendTextReplyResponse` DTOs, retaining
  `SendTextReplyOptions` as a compatibility alias.
- Support template and text variants of `message.sent` webhooks through the
  `messageType` discriminator.
- Allow `Message::$templateName` to be `null` for free-form replies.
- Set the SDK user agent to `@sanadwa/whatsapp-sdk-php/0.3.0`.

## 0.2.2

- Harden response hydration and JSON error handling.
- Honor caller-supplied idempotency keys in the authoritative header, rejecting
  values outside 1–120 visible ASCII characters before HTTP work.
- Add default request and connection timeouts.
- Cap retry sleeps while retaining the server's raw retry guidance.
- Preserve Arabic messages, details, upstream codes, and raw API error bodies.
- Align webhook verification failure reasons with the TypeScript SDK.

## 0.2.1

- Initial PHP and Laravel SDK port.
