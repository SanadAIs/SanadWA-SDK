# @sanadwa/whatsapp-sdk

Official TypeScript SDK for the SANAD WhatsApp Public API. Zero runtime dependencies. Dual ESM/CJS. Node ≥20.

## Install

```sh
npm install @sanadwa/whatsapp-sdk
```

## Quickstart (5 minutes)

```ts
import { SanadWhatsApp } from '@sanadwa/whatsapp-sdk';

const sdk = new SanadWhatsApp({ apiKey: process.env.SANAD_API_KEY! });

// 1. Verify your key
const me = await sdk.health();
console.log(me); // { tenantId, scope, serverTime }

// 2. List approved templates
const { data: templates } = await sdk.templates.list();

// 3. Send a template message
const result = await sdk.messages.send({
  phoneNumberId: 'YOUR_PHONE_NUMBER_ID',
  toPhone: '+962790000000',
  templateName: 'hello_world',
  templateLanguage: 'en',
  templateParams: ['Alice'],
});
console.log(result.messageId);

// 4. Check delivery status
const msg = await sdk.messages.get(result.messageId!);
console.log(msg.status); // 'sent' | 'delivered' | 'read' | 'failed'
```

## Webhooks

### Signature contract

SANAD signs every outbound webhook with HMAC-SHA256 over the **exact raw
request body bytes** using the per-webhook shared secret:

```
X-Sanad-Signature: sha256=<hex>
hex = HMAC-SHA256(secret, raw_body_bytes)
```

The `sha256=` prefix is literal; everything after the `=` is lowercase hex.
Always use `express.raw({ type: 'application/json' })` (or your framework's
equivalent) so re-serialization doesn't shuffle key order and break the
signature.

Each delivery also carries a `X-Sanad-Delivery-Id` header. **This header is
the canonical dedupe key** (use it as your idempotency token in your handler).
Phase 60 (v0.2.0) intentionally removed `delivery_id` from the signed body to
keep payload identity and retry identity cleanly separated; rely on the
header, not the payload, for at-most-once handling.

### Example

```ts
import { SanadWhatsApp } from '@sanadwa/whatsapp-sdk';
import express from 'express';

const sdk = new SanadWhatsApp({ apiKey: process.env.SANAD_API_KEY! });
const app = express();

// IMPORTANT: use raw body parser to preserve exact bytes for signature verification.
app.post('/webhooks/sanad', express.raw({ type: 'application/json' }), (req, res) => {
  const result = sdk.webhooks.verify({
    rawBody: req.body,                                // Buffer
    signature: req.header('X-Sanad-Signature') || '', // 'sha256=<hex>'
    secret: process.env.SANAD_WEBHOOK_SECRET!,
  });

  if (!result.valid) return res.status(401).send(result.reason);

  switch (result.event.type) {
    case 'message.sent':      /* ... */ break;
    case 'message.delivered': /* ... */ break;
    case 'message.read':      /* ... */ break;
    case 'message.failed':    /* ... */ break;
    case 'inbound.message':   /* ... */ break;
  }
  res.sendStatus(204);
});
```

### Testing your webhook handler

The SDK ships canonical wire-format fixtures so you can unit-test handlers
without standing up SANAD or hand-computing HMACs:

```ts
import { __testFixtures, verifyWebhook } from '@sanadwa/whatsapp-sdk';

const f = __testFixtures.createMessageDeliveredFixture();
const result = verifyWebhook({
  rawBody: f.rawBody,
  signature: f.signature,
  secret: f.secret,
});
// result === { valid: true, event: f.expectedEvent }
```

Available fixtures (each accepts overrides like `{ messageId, secret, ... }`):

- `__testFixtures.createMessageDeliveredFixture()`
- `__testFixtures.createMessageReadFixture()`
- `__testFixtures.createInboundMessageFixture()`

The `__` prefix is intentional — these are a TESTING surface, not the
supported runtime API.

## Errors

All HTTP errors subclass `SanadApiError`:

- `RateLimitedError` (429) — exposes `retryAfterSec`
- `ValidationError` (400, 409 `idempotency_conflict`)
- `AuthError` (401/403)
- `NotFoundError` (404)
- `ServerError` (5xx, network failures)

Every error also exposes the upstream detail the server forwarded: optional
`messageAr`, `details`, `upstreamCode` (e.g. Meta error codes on `send_failed`),
and the raw error body via `rawBody` — on every status, not just 5xx.

```ts
import { SanadApiError, RateLimitedError } from '@sanadwa/whatsapp-sdk';

try {
  await sdk.messages.send({ /* ... */ });
} catch (e) {
  if (e instanceof RateLimitedError) {
    console.log('retry after', e.retryAfterSec, 'sec');
  } else if (e instanceof SanadApiError) {
    console.log(e.code, e.status, e.requestId);
  } else {
    throw e;
  }
}
```

## Retry & Idempotency

Built-in: 429 and 5xx responses are retried with exponential backoff (250ms × 2^n, capped at 30s, max 5 attempts). When the server returns `Retry-After`, that value is honored instead of the backoff math (the actual sleep is clamped to 30s; `RateLimitedError.retryAfterSec` still reports the raw server value). Override via `new SanadWhatsApp({ retries: 3 })`.

Every `messages.send()` call generates a UUID `Idempotency-Key` automatically. The same UUID is reused across all retries of one logical call, so the server caches and replays the response — your message is sent at most once. Pass your own via `idempotencyKey` if you prefer. Caller-supplied keys must contain 1–120 visible ASCII characters (`!` through `~`); invalid keys throw `ValidationError` before any HTTP request.

## Configuration

| Option       | Default                                        | Notes                                   |
| ------------ | ---------------------------------------------- | --------------------------------------- |
| `apiKey`     | required                                       | `pk_live_…` from your SANAD dashboard   |
| `baseUrl`    | `https://api.sanadwa.com/api/public/v1`       | Override for staging                    |
| `retries`    | `5`                                            | Total attempts including the first      |
| `fetch`      | `globalThis.fetch`                             | Inject for testing                      |
| `userAgent`  | `@sanadwa/whatsapp-sdk/0.2.2`                 | Override for diagnostics                |

## License

MIT
