# Changelog

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
