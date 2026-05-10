# Changelog

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
  `import { verifyWebhook } from '@sanadais/whatsapp-sdk'` without
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
