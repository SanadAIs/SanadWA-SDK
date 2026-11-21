# Changelog

## 0.4.0 — 2026-11-21

Added:

- `phoneNumbers()->list()`, `balance()->get()`, `tags()->list/create/delete()`,
  `contacts()->list/upsert/delete/import()`, `campaigns()->create/list/get/pause/resume()`, with
  their DTOs. The SDK now covers 19 of the 20 public API operations (all except the OpenAPI
  document).
- `templates()->list()` accepts `$phoneNumberId` and `$wabaId`; `Template::$wabaId`.
- `SendFailedError` (`$upstreamStatus`, `$upstreamCode`, `$metaError`).
- `RateLimitedError::$limit` and `::$remaining` (from `X-RateLimit-Limit` /
  `X-RateLimit-Remaining`).
- Webhooks: `$signatureValid`, `$recognized`, `$eventType`, `$envelope` on the verify result; `test`
  and `unknown` events; `providerMsgId` and `toPhone` on delivered/read/failed events;
  `WebhookFailedError::$errorData`, `::$details`, `::$errorUserMsg`; fixtures
  `createTestEventFixture()` and `createUnknownEventFixture()`; `recognized` and `eventType` keys
  on every fixture.
- Laravel: `SANADWA_API_KEY` is read when `SANAD_API_KEY` is not set. The facade has the new
  resource methods.
- Every write of the new resources sends an `Idempotency-Key`; `campaigns()->create()` requires one
  from the caller.
- `composer.json`: `homepage` and `support` links.
- `contacts()->import()` gets at least 300 s per attempt with the default Guzzle client
  (`Config::IMPORT_MIN_TIMEOUT`), because the API answers only when every row is handled. A
  client passed as `httpClient` keeps its own timeout.

Changed (behaviour changes — read before upgrading):

- An API answer with code `send_failed` now throws `SendFailedError` whatever the HTTP status
  (was `AuthError`, `NotFoundError`, `ValidationError`, `RateLimitedError` or `ServerError`).
  `SendFailedError` extends `SanadApiError` only, so a `catch (AuthError)` or `catch (ServerError)`
  block no longer receives it.
- `send_failed` is never retried automatically, so the original WhatsApp error reaches the caller.
  It used to be retried on 429 and 5xx.
- `Webhooks::verify()` reports a correctly signed delivery it cannot type as valid with
  `$recognized === false` and an `unknown` event instead of invalid; the reason
  `unknown_event_type` is no longer returned. This includes a signed body that is not JSON or is
  nested deeper than 512 levels (was `verification_error`). Answer 401 only when `$valid` is false.
- The console's "Send test event" delivery now verifies and is returned as a `test` event. It
  used to be rejected.
- Default base URL is `https://api.sanadwa.com/v1` (`Config::DEFAULT_BASE_URL`, the Laravel config
  default). The old `https://api.sanadwa.com/api/public/v1` still works when configured
  explicitly.
- A server `Retry-After` is honoured up to 60 s (was 30 s); computed backoff is still capped at 30 s.
- HTTP 422 now throws `ValidationError` (was the base `SanadApiError`).
- A timed-out request ends with code `timeout` when the Guzzle client reports it (was
  `network_error`).
- `Template::$category`, `Message::$status`, `::$toPhone`, `::$channel`, `::$provider` are nullable.

Fixed:

- `templates()->list()` no longer throws on a template whose category is null.
- `messages()->get()` no longer throws when status, to_phone, channel or provider is null, or when
  the id arrives as a number.
- Set the SDK user agent to `@sanadwa/whatsapp-sdk-php/0.4.0`.
- Webhooks: legacy `payload` is used whenever `data` is not an object (was: only when `data` was
  null or absent), and an empty bare-string `error` gives a `null` message (was `''`). Both now
  match the TypeScript SDK.
- Fixtures: a `null` override for `providerMsgId` or `toPhone` is kept (was replaced by the
  default), and the failed fixture takes `details` and `errorUserMsg` from `errorData` when they
  are not overridden.
- README: the install section leads with the Composer command for the GitHub repository and says
  when it resolves; the error and retry sections match the code.
- README: after a `send_failed` whose result is not known (5xx, 408, 429, or the API's own 409 or
  503), do not send again with a new idempotency key. The earlier text advised a new key.

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
