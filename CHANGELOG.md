# Changelog

## 0.4.0 — 2026-11-21

Added:

- `sdk.phoneNumbers.list()`, `sdk.balance.get()`, `sdk.tags.list/create/delete()`,
  `sdk.contacts.list/upsert/delete/import()`, `sdk.campaigns.create/list/get/pause/resume()`.
  The SDK now covers 19 of the 20 public API operations (all except the OpenAPI document).
- `templates.list()` accepts `phoneNumberId` and `wabaId`; `Template.wabaId`.
- `SendFailedError` (`upstreamStatus`, `upstreamCode`, `metaError`).
- `RateLimitedError.limit` and `.remaining` (from `X-RateLimit-Limit` / `X-RateLimit-Remaining`).
- `timeoutMs` client option (default 30000 ms per attempt; `0` disables it). A fraction is rounded
  up, and a value above 2147483647 is lowered to that.
- `contacts.import()` gets at least 300 s per attempt, because the API answers only when every row
  is handled, and accepts its own `timeoutMs`.
- Webhooks: `signatureValid`, `recognized`, `eventType`, `envelope` on the verify result; `test` and
  `unknown` events; `providerMsgId` and `toPhone` on delivered/read/failed events; `errorData`,
  `details`, `errorUserMsg` on the failed-event error; fixtures `createTestEventFixture` and
  `createUnknownEventFixture`; `createTextMessageSentFixture` (the text variant of `message.sent`);
  `recognized` and `eventType` on every fixture.
- Every write of the new resources sends an `Idempotency-Key`; `campaigns.create()` requires one
  from the caller.
- The resource classes and their types are exported from the package entry.
- The new resources throw `SanadApiError` with code `malformed_response` for a 2xx answer without
  its required parts (`data`, `page`, `limit`, a row's id, `deleted`, `billing_type`,
  `created_via`). An unknown `billing_type` or `created_via` value is passed through as sent.
- `npm run typecheck` also type-checks the test files (`tsconfig.test.json`).
- `package.json`: `repository`, `homepage` and `bugs` links; separate type declarations for
  `import` and `require`.

Changed (behaviour changes — read before upgrading):

- An API answer with code `send_failed` now throws `SendFailedError` whatever the HTTP status.
  It used to throw `AuthError` (401/403), `NotFoundError` (404), `ValidationError` (400/409),
  `RateLimitedError` (429) or `ServerError` (5xx). `SendFailedError` extends `SanadApiError` only,
  so an `instanceof AuthError` or `instanceof ServerError` check no longer matches it.
- `send_failed` is never retried automatically, so the original WhatsApp error reaches the caller.
  It used to be retried on 429 and 5xx, and the retry was answered `409 send_failed`.
- `verifyWebhook` reports a correctly signed delivery it cannot type as `valid: true,
  recognized: false` with an `unknown` event instead of `valid: false`
  (`reason: 'unknown_event_type'` is no longer returned). Answer 401 only when `valid` is false.
- The console's "Send test event" delivery now verifies and is returned as a `test` event. It
  used to be rejected.
- `WebhookEvent` has two new members, `test` and `unknown`. An exhaustive `switch` needs both.
- A valid verify result has four more fields. A `toEqual({ valid: true, event })` assertion on the
  whole result fails; use `toMatchObject`.
- An invalid verify result also has `signatureValid: false` and `recognized: false`. A
  `toEqual({ valid: false, reason })` assertion on the whole result fails; use `toMatchObject`.
- A correctly signed body that is not JSON is now `valid: true` with an `unknown` event and
  `envelope: null` (was `valid: false`, `reason: 'verification_error'`).
- A 2xx answer whose body is not JSON now throws `SanadApiError` with code `malformed_response`
  (was a plain `SyntaxError`).
- `retries`: a fraction is rounded down, and the constructor throws for a value that is not a
  finite number (`NaN` used to make every call fail without a request).
- Default base URL is `https://api.sanadwa.com/v1`. The old
  `https://api.sanadwa.com/api/public/v1` still works when passed as `baseUrl`.
- A server `Retry-After` is honoured up to 60 s (was 30 s); computed backoff is still capped at 30 s.
- HTTP 422 now throws `ValidationError` (was the base `SanadApiError`).
- Every attempt now has a 30 s timeout (300 s for `contacts.import()`). A call that used to wait
  longer for an answer is now retried, and ends with `ServerError` code `timeout`, or with
  `RateLimitedError` code `idempotency_in_progress` when it is a write the API is still working
  on.
- Types: `Template.category`, `Message.status`, `Message.sentAt`, `Message.toPhone`,
  `Message.channel`, `Message.provider` and the `message.sent` event's `messageId` can be `null`.
- Default user agent is `@sanadwa/whatsapp-sdk/0.4.0`.

Fixed:

- Requests can no longer hang forever: every attempt has a timeout.
- A fractional `timeoutMs`, or one above the platform maximum, no longer makes every call throw a
  `RangeError`.
- A signature header with the right number of characters but more bytes (non-ASCII) is reported
  as `signature_length_mismatch` (was `verification_error`). It was and is rejected.
- `Message.id` is always a string, also when the API sends a number.
- The webhook test suite no longer imports a file from another repository (fixed signature vectors).
- Removed two outdated package tarballs from the repository.
- README: the install section leads with the GitHub release install and marks the registry
  command "once published"; the error and retry sections match the code.
- README: after a `send_failed` whose result is not known (5xx, 408, 429, or the API's own 409 or
  503), do not send again with a new idempotency key. The earlier text advised a new key.

## 0.3.0 — 2026-07-21

Added:

- `sdk.messages.sendText()` for free-form customer-service text replies through
  `POST /messages/text`, with `sdk.messages.reply()` retained as an alias and
  the same automatic idempotency behavior as template sends.
- `message.sent` webhook narrowing now supports both template sends and text
  replies through the `messageType` discriminator.
- Message lookup exposes `templateName: null` for free-form text replies.

## 0.2.2 — 2026-07-21

Fixed:

- Caller-supplied idempotency keys are restricted to 1–120 visible ASCII
  characters and sent as the authoritative `Idempotency-Key` header, while
  retaining the JSON body field for backward compatibility. Invalid keys fail
  before HTTP work; generated and caller-supplied keys remain stable on retries.
- Numeric `/health` `tenant_id` values are coerced to the public string type.
- `Retry-After` sleep is capped at 30 seconds while `RateLimitedError` retains
  the server's uncapped retry guidance.
- All HTTP error subclasses preserve `message_ar`, `details`, `upstream_code`,
  and the decoded raw response body.

## 0.2.1 — 2026-06-28

Fixed (webhook envelope reconciliation):

- **`verifyWebhook` now parses the LIVE webhook envelope `{ event, tenant_id,
  data }`.** Prior versions expected `{ event_type, payload }`, so every real
  delivery from the Public API narrowed to `unknown_event_type`. The legacy
  `{ event_type, payload }` envelope is still accepted for backward-compat.
- **`message.failed` `error` is now the structured object `{ code, title,
  message }`** (new `WebhookFailedError` type), matching the live payload — it
  was previously typed/validated as a bare string and would not narrow.
- **`inbound.message` reads the live `from` field** (was `from_phone`), and now
  exposes `messageId`, `timestamp`, and the full unmapped `raw` payload (so
  `media`/`button` are reachable).
- **Numeric `message_id` is coerced to a string id** — status events
  (`message.delivered`/`read`/`failed`) emit the numeric DB row id, which the
  string-only check previously rejected.
- Every `WebhookEvent` member now carries `raw: Record<string, unknown>` — the
  complete unmapped `data` object — so adopters never lose fields the SDK does
  not explicitly surface.
- `__testFixtures` updated to the live envelope; added
  `createMessageSentFixture` and `createMessageFailedFixture`.
- Repaired the cross-validation test import (`SANAD_API` → `SanadWA-API`).

The HMAC signature algorithm is unchanged (`sha256=<hex>` over raw body bytes).

## 0.2.0 — 2026-05-10

Added (Phase 60 OPS-V2-03 / OPS-V2-04 / SEC-06 documentation refresh):

- **`__testFixtures` export** — three wire-format webhook fixtures
  (`createMessageDeliveredFixture`, `createMessageReadFixture`,
  `createInboundMessageFixture`) returning
  `{ rawBody, signature, secret, expectedEvent }`. Lets adopters write
  webhook handler unit tests without reaching into SDK internals or hand-
  computing HMACs.
- **`verifyWebhook` standalone re-export** from the package root, so
  adopters who only need verification (no API client) can
  `import { verifyWebhook } from '@sanadwa/whatsapp-sdk'` without
  constructing `SanadWhatsApp`.
- **`WebhookFixture` type** exported for adopters using TypeScript.

Documented:

- **HMAC algorithm** explicitly spelled out in README:
  `X-Sanad-Signature: sha256=<hex>` where
  `hex = HMAC-SHA256(secret, raw_body_bytes)`.
- **`X-Sanad-Delivery-Id` header** documented as the canonical dedupe key.
  The matching server change (Phase 60 SEC-06) also removes `delivery_id`
  from the SIGNED body — receivers MUST rely on the header for dedupe.

No breaking changes — purely additive surface area.

## 0.1.0 — 2026-05-10

Initial release.

- `SanadWhatsApp` client with `.health()`, `.templates.list()`, `.messages.send()`, `.messages.get()`, `.webhooks.verify()`
- Typed error hierarchy: `SanadApiError`, `RateLimitedError`, `ValidationError`, `AuthError`, `NotFoundError`, `ServerError` + `isSanadApiError` type guard
- Automatic 429 + 5xx retry with exponential backoff (250ms × 2^n, capped 30s) and `Retry-After` honor
- Built-in idempotency UUID generation per `messages.send()` call (reused on retries — at-most-once semantics)
- Pure HMAC SHA256 webhook verifier with discriminated `WebhookEvent` union (5 event types)
- Dual ESM + CJS build via `tsup`, declarations included
- Zero runtime dependencies; Node ≥20

Operator: actual `npm publish` is performed out-of-band by the SANAD ops team after npm scope creation and GitHub repo provisioning. This package is published manually for v0.1.0; automation lands in a later release.
