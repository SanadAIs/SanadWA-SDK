# Changelog

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
