# SanadWA WhatsApp SDK for PHP

Official PHP 8.1+ and Laravel SDK for the SANAD WhatsApp Public API. The core client is framework-agnostic; Laravel integration is optional.

## Install

Install `0.3.0` directly from the official GitHub repository:

```sh
composer config repositories.sanadwa-sdk vcs https://github.com/x0bdr/sanad-whatsapp-sdk
composer require sanadwa/whatsapp-sdk-php:^0.3
```

After Packagist publication, only the require command is needed:

```sh
composer require sanadwa/whatsapp-sdk-php
```

## Plain PHP quickstart

```php
<?php

use Sanadwa\WhatsApp\Dto\SendMessageOptions;
use Sanadwa\WhatsApp\SanadWhatsApp;

$sdk = new SanadWhatsApp([
    'apiKey' => $_ENV['SANAD_API_KEY'],
]);

// 1. Verify the API key.
$health = $sdk->health();
echo $health->tenantId;

// 2. List approved templates.
$templates = $sdk->templates()->list();

// 3. Send an approved template message.
$result = $sdk->messages()->send(new SendMessageOptions(
    phoneNumberId: 'YOUR_PHONE_NUMBER_ID',
    toPhone: '+962790000000',
    templateName: 'hello_world',
    templateLanguage: 'en',
    templateParams: ['Alice'],
));

// 4. Check delivery status.
if ($result->messageId !== null) {
    $message = $sdk->messages()->get($result->messageId);
    echo $message->status;
}
```

## Laravel

The package is auto-discovered. Publish its configuration:

```sh
php artisan vendor:publish --tag=sanadwa-config
```

Configure the application environment:

```dotenv
SANAD_API_KEY=pk_live_your_key
SANAD_API_BASE_URL=https://api.sanadwa.com/api/public/v1
SANAD_API_RETRIES=5
SANAD_TIMEOUT=30
SANAD_CONNECT_TIMEOUT=10
SANAD_WEBHOOK_SECRET=your_webhook_secret
```

Use the facade anywhere Laravel facades are available:

```php
<?php

use Sanadwa\WhatsApp\Dto\SendMessageOptions;
use Sanadwa\WhatsApp\Laravel\Facades\SanadWhatsApp;

$health = SanadWhatsApp::health();
$templates = SanadWhatsApp::templates()->list(page: 1, limit: 20);
$sent = SanadWhatsApp::messages()->send(new SendMessageOptions(
    phoneNumberId: 'YOUR_PHONE_NUMBER_ID',
    toPhone: '+962790000000',
    templateName: 'hello_world',
    templateLanguage: 'en',
));
```

## Free-form customer replies

After the customer sends an inbound message, reply through SANAD without
configuring a second Meta access token:

```php
<?php

use Sanadwa\WhatsApp\Dto\SendTextOptions;
use Sanadwa\WhatsApp\Laravel\Facades\SanadWhatsApp;

$reply = SanadWhatsApp::messages()->sendText(new SendTextOptions(
    phoneNumberId: config('services.whatsapp.phone_number_id'),
    toPhone: '+966500000000',
    text: 'Thank you — how can we help?',
    previewUrl: false,
));
```

`messages()->reply()` remains available as a compatibility alias. An
application's `sendText()` provider method should call `messages()->sendText()`
as shown above. Do not route free-form replies directly
to Meta and do not wrap them in a passthrough template. SANAD returns
`409 customer_service_window_closed` when the recipient has no active
customer-service window; send an approved template in that case.

## Webhooks

SANAD signs the exact raw request body bytes with HMAC-SHA256:

```text
X-Sanad-Signature: sha256=<lowercase-hex>
hex = HMAC-SHA256(secret, raw_body_bytes)
```

Do not decode and re-encode the body before verification. Each request also includes `X-Sanad-Delivery-Id`; this header is the canonical dedupe key for at-most-once handler processing.

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Sanadwa\WhatsApp\Laravel\Facades\SanadWhatsApp;

final class SanadWebhookController
{
    public function __invoke(Request $request): Response
    {
        $result = SanadWhatsApp::webhooks()->verify(
            $request->getContent(),
            $request->header('X-Sanad-Signature', ''),
            (string) config('sanadwa.webhook_secret'),
        );

        if (!$result->valid) {
            return response($result->reason, 401);
        }

        // Persist this before side effects and reject an already-seen value.
        $deliveryId = $request->header('X-Sanad-Delivery-Id');

        switch ($result->event->type) {
            case 'message.sent':
                break;
            case 'message.delivered':
                break;
            case 'message.read':
                break;
            case 'message.failed':
                break;
            case 'inbound.message':
                break;
        }

        return response('', 204);
    }
}
```

Verification is local and never makes an HTTP call. It is also available without constructing a client:

```php
use Sanadwa\WhatsApp\Resources\Webhooks;

$result = Webhooks::verify($rawBody, $signature, $secret);
```

Webhook payload nesting is intentionally capped at 512 levels as DoS protection; deeper signed payloads return `verification_error`.

`Sanadwa\WhatsApp\TestFixtures` provides stable fixtures for all five supported webhook event types.

## Errors

All HTTP errors extend `Sanadwa\WhatsApp\Exceptions\SanadApiError`:

- `RateLimitedError` for 429 and an exhausted `idempotency_in_progress` response; exposes `retryAfterSec`.
- `ValidationError` for 400 and non-retryable 409 responses.
- `AuthError` for 401 and 403.
- `NotFoundError` for 404.
- `ServerError` for 5xx and network failures.

Every API error exposes `status`, `requestId`, `messageAr`, `details`, `upstreamCode`, and `rawBody`. Read the API error code through the `code` property; PHP's inherited `getCode()` returns `0`.

```php
use Sanadwa\WhatsApp\Exceptions\RateLimitedError;
use Sanadwa\WhatsApp\Exceptions\SanadApiError;

try {
    $sdk->messages()->send($options);
} catch (RateLimitedError $error) {
    echo "Retry after {$error->retryAfterSec} seconds";
} catch (SanadApiError $error) {
    echo "{$error->code} ({$error->status}), request {$error->requestId}";
}
```

## Retry and idempotency

HTTP 429, 5xx, `409 idempotency_in_progress`, and transport failures are retried with exponential backoff: 250 ms, 500 ms, 1 s, up to 30 s. `retries` means total attempts, including the first request; the default is five. A valid `Retry-After` integer-seconds or HTTP-date header overrides exponential backoff, with actual sleep capped at 30 seconds.

Every `messages()->send()` call uses one `Idempotency-Key` header across every retry of that logical call. The SDK generates a UUID v4 when no key is supplied. When `SendMessageOptions::idempotencyKey` is supplied, that exact value becomes the header; the header is authoritative for server-side deduplication. Caller-supplied keys must contain 1–120 visible ASCII characters (`!` through `~`); invalid keys throw `ValidationError` before any HTTP request. The JSON body field is retained for backward compatibility.

## Configuration

| Option | Default | Notes |
| --- | --- | --- |
| `apiKey` | required | Tenant API key |
| `baseUrl` | `https://api.sanadwa.com/api/public/v1` | Override for staging |
| `retries` | `5` | Total attempts, including the first |
| `timeout` | `30.0` | Total request timeout in seconds for the default client |
| `connectTimeout` | `10.0` | Connection timeout in seconds for the default client |
| `httpClient` | `GuzzleHttp\Client` | Any injectable PSR-18 client; caller-supplied clients are used untouched |
| `userAgent` | `@sanadwa/whatsapp-sdk-php/0.3.0` | Override for diagnostics |

## License

MIT
