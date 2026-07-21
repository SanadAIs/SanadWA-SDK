# Changelog

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
