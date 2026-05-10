# @sanadais/whatsapp-sdk

Official TypeScript SDK for the SANAD WhatsApp Public API. Zero runtime dependencies. Dual ESM/CJS. Node ≥20.

## Install

```sh
npm install @sanadais/whatsapp-sdk
```

## Quickstart (5 minutes)

```ts
import { SanadWhatsApp } from '@sanadais/whatsapp-sdk';

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

```ts
import { SanadWhatsApp } from '@sanadais/whatsapp-sdk';
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

## Errors

All HTTP errors subclass `SanadApiError`:

- `RateLimitedError` (429) — exposes `retryAfterSec`
- `ValidationError` (400, 409 `idempotency_conflict`)
- `AuthError` (401/403)
- `NotFoundError` (404)
- `ServerError` (5xx, network failures) — exposes optional `upstreamCode`

```ts
import { SanadApiError, RateLimitedError } from '@sanadais/whatsapp-sdk';

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

Built-in: 429 and 5xx responses are retried with exponential backoff (250ms × 2^n, capped at 30s, max 5 attempts). When the server returns `Retry-After`, that value is honored instead of the backoff math. Override via `new SanadWhatsApp({ retries: 3 })`.

Every `messages.send()` call generates a UUID `Idempotency-Key` automatically. The same UUID is reused across all retries of one logical call, so the server caches and replays the response — your message is sent at most once. Pass your own via `idempotencyKey` if you prefer.

## Configuration

| Option       | Default                                        | Notes                                   |
| ------------ | ---------------------------------------------- | --------------------------------------- |
| `apiKey`     | required                                       | `pk_live_…` from your SANAD dashboard   |
| `baseUrl`    | `https://api.sanadais.com/api/public/v1`       | Override for staging                    |
| `retries`    | `5`                                            | Total attempts including the first      |
| `fetch`      | `globalThis.fetch`                             | Inject for testing                      |
| `userAgent`  | `@sanadais/whatsapp-sdk/0.1.0`                 | Override for diagnostics                |

## License

MIT
