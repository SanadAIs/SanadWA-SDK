# SanadWA WhatsApp SDK for PHP

API documentation: https://developers.sanadwa.com

PHP and Laravel SDK for the SanadWA WhatsApp Public API. PHP 8.1 or later. The client works
without a framework. The Laravel service provider and facade are optional.

For Node and TypeScript, use the [TypeScript SDK](../README.md).

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Laravel](#laravel)
- [Resources](#resources)
- [Covered endpoints](#covered-endpoints)
- [Pagination](#pagination)
- [Idempotency](#idempotency)
- [Errors](#errors)
- [Retries and timeouts](#retries-and-timeouts)
- [Webhooks](#webhooks)
- [Upgrading from 0.3.0](#upgrading-from-030)

## Install

The package is not on Packagist yet. Install it from the GitHub repository:

```sh
composer config repositories.sanadwa-sdk vcs https://github.com/x0bdr/sanad-whatsapp-sdk
composer require sanadwa/whatsapp-sdk-php:^0.4
```

`^0.4` resolves once the tag `v0.4.0` exists in the repository. If Composer reports that no
matching version was found, the release is not tagged yet.

Once the package is published to Packagist, the first command is not needed:

```sh
composer require sanadwa/whatsapp-sdk-php
```

## Quick start

```php
<?php

require __DIR__ . '/vendor/autoload.php';

use Sanadwa\WhatsApp\Dto\SendMessageOptions;
use Sanadwa\WhatsApp\SanadWhatsApp;

$sdk = new SanadWhatsApp([
    'apiKey' => (string) (getenv('SANAD_API_KEY') ?: getenv('SANADWA_API_KEY')),
]);

// 1. List your phone numbers. Every send needs a phoneNumberId.
$numbers = $sdk->phoneNumbers()->list()->data;
if ($numbers === []) {
    throw new RuntimeException('This account has no active phone number.');
}
$sender = $numbers[0];

// 2. List the approved templates this number can send.
$templates = $sdk->templates()->list(phoneNumberId: $sender->phoneNumberId);
foreach ($templates->data as $template) {
    echo "{$template->name} ({$template->language})\n";
}

// 3. Send a template message.
$sent = $sdk->messages()->send(new SendMessageOptions(
    phoneNumberId: $sender->phoneNumberId,
    toPhone: '+966500000000',
    templateName: 'hello_world',
    templateLanguage: 'en',
    templateParams: ['Alice'],
));

// 4. Look the message up with the WhatsApp message id the send returned.
if ($sent->messageId !== null) {
    $message = $sdk->messages()->get($sent->messageId);
    echo $message->status ?? 'unknown', "\n"; // sent, delivered, read, failed or null
}
```

A phone number can only send the templates of its own WhatsApp Business Account. Pass
`phoneNumberId` to `templates()->list()` to get only those.

## Configuration

Pass an array, or a `Sanadwa\WhatsApp\Config` object, to the constructor.

```php
<?php

use Sanadwa\WhatsApp\SanadWhatsApp;

$sdk = new SanadWhatsApp([
    'apiKey' => (string) getenv('SANAD_API_KEY'),
    'baseUrl' => 'https://api.sanadwa.com/v1',
    'retries' => 5,
    'timeout' => 30.0,
    'connectTimeout' => 10.0,
]);
```

| Option           | Default                           | Notes                                                        |
| ---------------- | --------------------------------- | ------------------------------------------------------------ |
| `apiKey`         | required                          | Your API key. The constructor throws when it is empty.       |
| `baseUrl`        | `https://api.sanadwa.com/v1`      | See "Base URL" below.                                        |
| `retries`        | `5`                               | Total attempts, including the first. Must be an integer.     |
| `timeout`        | `30.0`                            | Seconds for one whole attempt. Used by the default client. `contacts()->import()` gets at least 300 s. |
| `connectTimeout` | `10.0`                            | Seconds to connect. Used by the default client.              |
| `httpClient`     | `GuzzleHttp\Client`               | Any PSR-18 client. A client you pass is used as it is: `timeout` and `connectTimeout` do not apply to it. |
| `userAgent`      | `@sanadwa/whatsapp-sdk-php/0.4.0` | Sent as the `User-Agent` header.                             |
| `sleeper`        | `usleep`-based                    | A `Closure(int $milliseconds): void` that waits between retries. For tests. |

**Environment variables.** The plain PHP client reads no environment variable. You pass the key
as `apiKey`. The Laravel config reads these:

| Variable                | Config key                | Default                      |
| ----------------------- | ------------------------- | ---------------------------- |
| `SANAD_API_KEY`         | `sanadwa.api_key`         | none                         |
| `SANADWA_API_KEY`       | `sanadwa.api_key`         | Read only when `SANAD_API_KEY` is not set |
| `SANAD_API_BASE_URL`    | `sanadwa.base_url`        | `https://api.sanadwa.com/v1` |
| `SANAD_API_RETRIES`     | `sanadwa.retries`         | `5`                          |
| `SANAD_TIMEOUT`         | `sanadwa.timeout`         | `30.0`                       |
| `SANAD_CONNECT_TIMEOUT` | `sanadwa.connect_timeout` | `10.0`                       |
| `SANAD_WEBHOOK_SECRET`  | `sanadwa.webhook_secret`  | none                         |

The examples here use `SANAD_API_KEY`. The docs site uses `SANADWA_API_KEY` in its samples. The
Laravel config accepts both; `SANAD_API_KEY` wins when both are set. Only the API key has a
`SANADWA_` fallback.

**Base URL.** The default is `https://api.sanadwa.com/v1` (`Config::DEFAULT_BASE_URL`). The older
`https://api.sanadwa.com/api/public/v1` serves the same routes and still works when you set it
as `baseUrl` or `SANAD_API_BASE_URL`. Before 0.4.0 the older path was the default.

**Key scopes.** A key with scope `read` can call the GET methods. `send` is needed for sends and
for campaign create, pause and resume. `full` is needed for tag and contact writes.

## Laravel

The package is auto-discovered. Publish the config file if you want to edit it:

```sh
php artisan vendor:publish --tag=sanadwa-config
```

Set the environment:

```dotenv
SANAD_API_KEY=your_api_key
SANAD_WEBHOOK_SECRET=your_webhook_secret
```

Use the facade, or inject `Sanadwa\WhatsApp\SanadWhatsApp`:

```php
<?php

use Sanadwa\WhatsApp\Dto\SendMessageOptions;
use Sanadwa\WhatsApp\Laravel\Facades\SanadWhatsApp;

$numbers = SanadWhatsApp::phoneNumbers()->list()->data;
$templates = SanadWhatsApp::templates()->list(limit: 20, phoneNumberId: $numbers[0]->phoneNumberId);

$sent = SanadWhatsApp::messages()->send(new SendMessageOptions(
    phoneNumberId: $numbers[0]->phoneNumberId,
    toPhone: '+966500000000',
    templateName: 'hello_world',
    templateLanguage: 'en',
));
```

The facade has the same methods as the client: `health()`, `phoneNumbers()`, `templates()`,
`messages()`, `balance()`, `tags()`, `contacts()`, `campaigns()` and `webhooks()`.

## Resources

Every example below uses the `$sdk` client from the quick start.

### Health

`$sdk->health()` checks the key and returns the account it belongs to.

```php
<?php

$me = $sdk->health();
echo $me->tenantId, ' ', $me->scope, ' ', $me->serverTime, "\n";
```

### Phone numbers

`$sdk->phoneNumbers()->list()` returns the account's active numbers, oldest first. The list is
not paginated. `phoneNumberId` is the id that `messages()->send()` and `campaigns()->create()`
need.

```php
<?php

foreach ($sdk->phoneNumbers()->list()->data as $number) {
    echo $number->phoneNumberId, ' ', $number->displayPhoneNumber, ' ', $number->wabaId, "\n";
}
```

Each row is a `Dto\PhoneNumber`: `phoneNumberId`, `displayPhoneNumber`, `verifiedName`,
`nameStatus`, `newNameStatus`, `wabaId`, `qualityRating`, `status`.

### Templates

`$sdk->templates()->list(?int $page, ?int $limit, ?string $q, ?string $phoneNumberId, ?string $wabaId)`
returns one page of the account's approved templates.

| Argument         | Notes                                                                              |
| ---------------- | ---------------------------------------------------------------------------------- |
| `page`, `limit`  | See [Pagination](#pagination).                                                     |
| `q`              | Text contained in the template name or language code, without regard to case.      |
| `phoneNumberId`  | Only the templates this number can send. An unknown id throws `NotFoundError` (`phone_not_found`). Wins over `wabaId`. |
| `wabaId`         | Only the templates of this WhatsApp Business Account.                              |

```php
<?php

$page = $sdk->templates()->list(limit: 100, phoneNumberId: 'YOUR_PHONE_NUMBER_ID');
foreach ($page->data as $template) {
    echo $template->name, ' ', $template->language, ' ', $template->status, "\n";
}
```

`category` and `wabaId` can be `null`.

### Messages

| Method                                            | What it does                                         |
| ------------------------------------------------- | ---------------------------------------------------- |
| `$sdk->messages()->send(SendMessageOptions)`       | Sends an approved template message.                  |
| `$sdk->messages()->sendText(SendTextOptions)`      | Sends a free-form text reply. `reply()` is an alias. |
| `$sdk->messages()->get(string $id)`                | Looks up one message by its WhatsApp message id.     |

**Send a template**

```php
<?php

use Sanadwa\WhatsApp\Dto\SendMessageOptions;

$sent = $sdk->messages()->send(new SendMessageOptions(
    phoneNumberId: 'YOUR_PHONE_NUMBER_ID',
    toPhone: '+966500000000',
    templateName: 'order_update',
    templateLanguage: 'en',
    templateParams: ['Alice', '#1042'],
));
echo $sent->messageId, ' ', $sent->acceptedAt, "\n";
```

`templateLanguage` is optional. **When you leave it out, the API sends the template in Arabic
(`ar`).** Set it whenever the template is not Arabic.

`templateParams` fills the body variables in order. Use `templateComponents` instead when the
template needs header, button or other component parameters.

`messageId` is the WhatsApp message id (`wamid.…`). It can be `null` when WhatsApp returned none.
`replayed` is `true` when the API answered with the stored result of an earlier call that used
the same idempotency key.

**Send a free-form text reply**

```php
<?php

use Sanadwa\WhatsApp\Dto\SendTextOptions;

$reply = $sdk->messages()->sendText(new SendTextOptions(
    phoneNumberId: 'YOUR_PHONE_NUMBER_ID',
    toPhone: '+966500000000',
    text: 'Thank you. How can we help?',
    previewUrl: false,
));
echo $reply->messageId, "\n";
```

WhatsApp allows free-form text only inside the customer-service window: the customer must have
written to this number recently. Outside the window the API answers
`409 customer_service_window_closed` (`ValidationError`). Send a template in that case.

**Look up a message**

```php
<?php

$message = $sdk->messages()->get('wamid.EXAMPLE_ID_FROM_A_SEND');
echo $message->status ?? 'unknown', ' ', $message->deliveredAt ?? '-', "\n";
```

`messages()->get()` takes the **WhatsApp message id**: the `messageId` a send returned, or the
`providerMsgId` of a status webhook. Do not pass `Message::$id` or a status webhook's
`messageId`. Those are SanadWA row ids, and the API answers `404 message_not_found`
(`NotFoundError`) for anything that is not a `wamid.` id.

`status`, `sentAt`, `toPhone`, `channel` and `provider` can be `null`. The known `status` values
are `sent`, `delivered`, `read` and `failed`. Treat any other value as not final.

### Balance

`$sdk->balance()->get()` returns the credit balance and this month's usage.

```php
<?php

$balance = $sdk->balance()->get();
echo $balance->billingType, ' ', $balance->availableCredits ?? 'n/a', "\n";
echo $balance->usageThisMonth->creditsUsed, ' ', $balance->usageThisMonth->marketing, "\n";
```

Fields: `billingType` (`prepaid` or `postpaid`), `availableCredits`, `paidCreditsRemaining`,
`freeCreditsRemaining`, `unlimited`, `unlimitedUntil`, `asOf`, and `usageThisMonth`
(`periodStart`, `creditsUsed`, `marketing`, `utility`, `authentication`, `service`).
`availableCredits` and `paidCreditsRemaining` are `null` for accounts without a prepaid balance.

### Tags

| Method                                                                           | What it does                     |
| -------------------------------------------------------------------------------- | -------------------------------- |
| `$sdk->tags()->list(?int $page, ?int $limit)`                                     | One page of tags, ordered by id. |
| `$sdk->tags()->create(string $name, ?string $description, ?string $idempotencyKey)` | Creates a tag.                   |
| `$sdk->tags()->delete(string\|int $id, ?string $idempotencyKey)`                  | Removes a tag from the tag list. |

```php
<?php

$tag = $sdk->tags()->create('vip', 'Repeat customers');

foreach ($sdk->tags()->list(limit: 200)->data as $row) {
    echo $row->id, ' ', $row->name, "\n";
}

$removed = $sdk->tags()->delete($tag->id);
var_dump($removed->deleted);
```

Tag names are 1 to 100 characters and cannot contain `,` or `;`. Names are unique without regard
to case: creating `VIP` when `vip` exists answers `409 tag_already_exists` (`ValidationError`).
Deleting a tag does not remove the name from the contacts that carry it.

### Contacts

| Method                                                                                  | What it does                                 |
| --------------------------------------------------------------------------------------- | -------------------------------------------- |
| `$sdk->contacts()->list(?int $page, ?int $limit, ?string $tag)`                          | One page of contacts, ordered by phone.      |
| `$sdk->contacts()->upsert(ContactInput\|array $contacts, ?string $idempotencyKey)`       | Creates or updates 1 to 100 contacts.        |
| `$sdk->contacts()->import(string $csv, array $tags, string $filename, ?string $idempotencyKey)` | Creates or updates contacts from CSV content. |
| `$sdk->contacts()->delete(string\|int $id, ?string $idempotencyKey)`                     | Deletes one contact.                         |

**List**

```php
<?php

$page = $sdk->contacts()->list(page: 1, limit: 50, tag: 'vip');
foreach ($page->data as $contact) {
    echo $contact->id, ' ', $contact->phone, ' ', implode(',', $contact->tags), "\n";
}
```

`tag` is an exact tag name, compared without regard to case. There is no phone or text filter.

**Create or update**

```php
<?php

use Sanadwa\WhatsApp\Dto\ContactInput;

$result = $sdk->contacts()->upsert([
    new ContactInput(phone: '+966500000000', firstName: 'Alice', tags: ['vip']),
    new ContactInput(phone: '+12025550123', firstName: 'Omar', lastName: 'Haddad'),
]);

echo $result->summary->created, ' created, ', $result->summary->rejected, " rejected\n";
foreach ($result->results as $item) {
    if ($item->status === 'rejected' || $item->status === 'failed') {
        echo "contact {$item->index}: {$item->error?->code} {$item->error?->message}\n";
    }
}
```

- Pass one `ContactInput` or a list of them. The SDK always sends the list form; the API has no
  other shape.
- The phone is the key. A phone that already exists is updated: a new first name replaces the
  stored one, last name and email are filled only when empty, tags are added. Nothing is removed.
- Tags must exist first. Create them with `tags()->create()`. An unknown tag rejects that contact
  with `tag_not_found`.
- **The call succeeds (HTTP 200) even when contacts are rejected.** It does not throw for them.
  Read `$result->results[$i]->status`: `created`, `updated`, `rejected` or `failed`.
- More than 100 contacts, or none, throws `ValidationError` (`invalid_contacts`) before any
  request is made.

**Import CSV content**

```php
<?php

$csv = "phone,first_name,tags\n+966500000000,Alice,vip\n+12025550123,Omar,\n";
// From a file: $csv = file_get_contents('/path/to/contacts.csv');

$imported = $sdk->contacts()->import($csv, tags: ['vip'], filename: 'contacts.csv');

echo $imported->summary->rows, ' rows, ', $imported->summary->created, " created\n";
foreach ($imported->errors as $error) {
    echo "line {$error->row}: {$error->code} {$error->message}\n";
}
```

- `$csv` is the CSV content, not a file path.
- The CSV needs a header row with a `phone` column. `first_name`, `last_name`, `email` and `tags`
  are optional columns.
- Limits: 5 MB and 5000 rows. Content over 5 MB throws `ValidationError`
  (`import_file_too_large`) before any request is made. The SDK does not count rows: for more
  than 5000 rows the API answers `400 import_too_many_rows` (`ValidationError`) and saves
  nothing.
- `$tags` is applied to every row. The names must exist and cannot contain a comma.
- The call succeeds even when rows are rejected. Read `errors`. `row` is the CSV line number; the
  header is line 1.
- **A large import is slow.** The API answers only when every row is handled. With the default
  Guzzle client each attempt of `import()` therefore gets at least 300 s
  (`Config::IMPORT_MIN_TIMEOUT`), not the 30 s of other calls. A longer `timeout`, or `0`, is
  kept. A client you pass as `httpClient` keeps its own timeout: give it at least 300 s if you
  import large files.
- For a large file pass your own `idempotencyKey`. If an attempt still times out, the import
  keeps running on the server. The SDK's retries with the same key are then answered
  `409 idempotency_in_progress`, and the call ends with `RateLimitedError`. Call `import()` again
  later with the same key, content and `tags`: once the first run is finished you get its result,
  and nothing is imported twice.

```php
<?php

$idempotencyKey = bin2hex(random_bytes(16)); // store it: you need it to ask again
$imported = $sdk->contacts()->import($csv, idempotencyKey: $idempotencyKey);
```

**Delete**

```php
<?php

$deleted = $sdk->contacts()->delete('CONTACT_ID');
var_dump($deleted->deleted);
```

A contact that opted out cannot be deleted: the API answers `409 contact_opted_out`
(`ValidationError`).

### Campaigns

| Method                                                              | What it does                                         |
| ------------------------------------------------------------------- | ---------------------------------------------------- |
| `$sdk->campaigns()->create(CreateCampaignOptions)`                   | Creates a campaign and starts it now or at `sendAt`. |
| `$sdk->campaigns()->list(?int $page, ?int $limit)`                   | One page of campaigns, newest first.                 |
| `$sdk->campaigns()->get(string\|int $id)`                            | One campaign with message and click counts.          |
| `$sdk->campaigns()->pause(string\|int $id, ?string $idempotencyKey)` | Pauses an active campaign.                           |
| `$sdk->campaigns()->resume(string\|int $id, ?string $idempotencyKey)` | Resumes a paused campaign.                           |

**Create**

```php
<?php

use Sanadwa\WhatsApp\Dto\CampaignTemplateVariable;
use Sanadwa\WhatsApp\Dto\CreateCampaignOptions;

// Store this key AND the exact input with your own record of the campaign BEFORE the call.
$idempotencyKey = bin2hex(random_bytes(16));
// A fixed time, not one computed from the clock.
$sendAt = new DateTimeImmutable('2026-12-01T09:00:00+00:00');

$created = $sdk->campaigns()->create(new CreateCampaignOptions(
    name: 'November offer',
    phoneNumberId: 'YOUR_PHONE_NUMBER_ID',
    templateName: 'november_offer',
    templateLanguage: 'ar',
    audienceTags: ['vip'],
    idempotencyKey: $idempotencyKey,
    templateVariables: [
        new CampaignTemplateVariable(index: 1, source: 'contact.first_name'),
        new CampaignTemplateVariable(index: 2, source: 'custom', value: '20%'),
    ],
    sendAt: $sendAt,
));

echo $created->campaign->id, ' ', $created->campaign->status, "\n";
var_dump($created->replayed);
```

- **`idempotencyKey` is required.** The SDK does not generate one here. The API stores the key
  with the campaign as its duplicate guard. Store the key, and send the same value when you
  retry: the API then returns the first campaign with `replayed` set to `true` instead of
  creating, and charging for, a second one. An empty key throws `ValidationError`
  (`idempotency_key_required`) before any request is made.
- **A retry must send the same input, including `sendAt`.** The same key with any different field
  answers `409 idempotency_conflict` (`ValidationError`) and creates nothing. A `sendAt` computed
  again from the clock (`'+1 hour'`) is a different value: store the time you sent.
- `templateLanguage` is required. There is no default language for campaigns.
- `audienceTags` is 1 to 20 tag names.
- `CampaignTemplateVariable::$source` is `contact.first_name`, `contact.last_name`,
  `contact.phone`, `contact.email` or `custom`. `value` is required for `custom` and not allowed
  otherwise.
- `sendAt` is optional. Leave it out to start now. It must be in the future and at most 30 days
  ahead. Pass a `DateTimeInterface`, or an ISO 8601 string with a time zone.
- `headerMediaUrl` is an https link, required when the template has a media header.
  `trackedDestinationUrl` is optional.
- The API allows 5 creates per minute per key, on top of the general rate limit.
- `422` answers (`audience_empty`, `audience_all_excluded`, `audience_too_large`) throw
  `ValidationError`.

**List, get, pause, resume**

```php
<?php

$campaigns = $sdk->campaigns()->list(limit: 20)->data;

if ($campaigns !== []) {
    $campaign = $sdk->campaigns()->get($campaigns[0]->id);
    echo $campaign->status, ' ', $campaign->counts->sent, ' ', $campaign->counts->delivered, "\n";
    echo $campaign->clicks?->clicked ?? 0, " clicks\n";

    if ($campaign->status === 'active') {
        $paused = $sdk->campaigns()->pause($campaign->id);
        echo $paused->status, ' ', $paused->pauseReason, "\n";

        $resumed = $sdk->campaigns()->resume($campaign->id);
        echo $resumed->status, "\n";
    }
}
```

- `status` is one of `draft`, `scheduled`, `delayed`, `start_failed`, `active`, `paused`,
  `completed`, `failed`. Treat any other value as not final.
- `pauseReason` is `null` unless the campaign is paused. Values: `paused_by_user`,
  `insufficient_credits`, `balance_check_failed`, `start_failed`, `event_cancelled`.
- `counts` has `total`, `queued`, `sending`, `sent`, `delivered`, `read`, `failed`, `canceled`.
- `clicks` (`tracked`, `clicked`) is `null` on `list()` rows. The list endpoint leaves it out.
  Use `get()` for click counts.
- `pause()` can answer `409 campaign_busy` when another change is in progress. It is not retried
  automatically. Try again after a few seconds.
- `resume()` can answer `402 insufficient_credits` or `402 subscription_lapsed`
  (base `SanadApiError`).

## Covered endpoints

The public API has 20 operations. The SDK wraps 19 of them.

| #  | Operation                      | SDK method                                      |
| -- | ------------------------------ | ----------------------------------------------- |
| 1  | `GET /health`                  | `$sdk->health()`                                |
| 2  | `GET /phone-numbers`           | `$sdk->phoneNumbers()->list()`                  |
| 3  | `GET /templates`               | `$sdk->templates()->list()`                     |
| 4  | `POST /messages/template`      | `$sdk->messages()->send()`                      |
| 5  | `POST /messages/text`          | `$sdk->messages()->sendText()` (alias `reply()`) |
| 6  | `GET /messages/{id}`           | `$sdk->messages()->get()`                       |
| 7  | `GET /balance`                 | `$sdk->balance()->get()`                        |
| 8  | `GET /tags`                    | `$sdk->tags()->list()`                          |
| 9  | `POST /tags`                   | `$sdk->tags()->create()`                        |
| 10 | `DELETE /tags/{id}`            | `$sdk->tags()->delete()`                        |
| 11 | `GET /contacts`                | `$sdk->contacts()->list()`                      |
| 12 | `POST /contacts`               | `$sdk->contacts()->upsert()`                    |
| 13 | `POST /contacts/import`        | `$sdk->contacts()->import()`                    |
| 14 | `DELETE /contacts/{id}`        | `$sdk->contacts()->delete()`                    |
| 15 | `POST /campaigns`              | `$sdk->campaigns()->create()`                   |
| 16 | `GET /campaigns`               | `$sdk->campaigns()->list()`                     |
| 17 | `GET /campaigns/{id}`          | `$sdk->campaigns()->get()`                      |
| 18 | `POST /campaigns/{id}/pause`   | `$sdk->campaigns()->pause()`                    |
| 19 | `POST /campaigns/{id}/resume`  | `$sdk->campaigns()->resume()`                   |
| 20 | `GET /openapi.json`            | Not wrapped. It is a public document and needs no key. Fetch `https://api.sanadwa.com/v1/openapi.json` directly. |

`Webhooks::verify()` makes no HTTP call.

## Pagination

`templates()->list()`, `tags()->list()`, `contacts()->list()` and `campaigns()->list()` take
`page` (starts at 1) and `limit` (default 50, maximum 200). They return an object with `page`,
`limit` and `data`, holding the values the server used.

The API returns no total and no next link. You have reached the last page when the page holds
fewer rows than `limit`.

```php
<?php

$all = [];
for ($page = 1; ; $page++) {
    $result = $sdk->contacts()->list(page: $page, limit: 200);
    array_push($all, ...$result->data);
    if (count($result->data) < $result->limit) {
        break;
    }
}
```

## Idempotency

- Every write sends an `Idempotency-Key` header: `messages()->send()`, `messages()->sendText()`,
  `tags()->create()`, `tags()->delete()`, `contacts()->upsert()`, `contacts()->import()`,
  `contacts()->delete()`, `campaigns()->pause()` and `campaigns()->resume()`.
- When you pass no `idempotencyKey`, the SDK generates a UUID. It reuses the same key on every
  automatic retry of that call, so a retry after a lost response does not repeat the action.
- `campaigns()->create()` is the exception: you must pass the key yourself. See
  [Campaigns](#campaigns).
- A key is 1 to 120 visible ASCII characters (`!` to `~`). An invalid key throws `ValidationError`
  (`invalid_idempotency_key`) before any request is made.
- Reusing a key with a different request body answers `409 idempotency_conflict`
  (`ValidationError`).
- **A key you pass must be unique per action, not per campaign, contact or tag.** For 24 hours
  the same key on the same call returns the first answer again and does not run the action. This
  matters most for calls without a body. Example: `campaigns()->pause($id, 'K')`, then
  `resume($id)`, then `pause($id, 'K')` returns the stored "paused" answer while the campaign
  keeps sending. Only `messages()->send()`, `messages()->sendText()` and `campaigns()->create()`
  report a repeat (`replayed`); the other methods do not. When in doubt, pass no key and let the
  SDK generate one.

```php
<?php

use Sanadwa\WhatsApp\Dto\SendMessageOptions;

$sent = $sdk->messages()->send(new SendMessageOptions(
    phoneNumberId: 'YOUR_PHONE_NUMBER_ID',
    toPhone: '+966500000000',
    templateName: 'order_update',
    templateLanguage: 'en',
    idempotencyKey: 'order-1042-confirmation',
));
var_dump($sent->replayed); // true when this key was already used for the same send
```

## Errors

Every error the API returns is thrown as `Sanadwa\WhatsApp\Exceptions\SanadApiError` or one of
its subclasses. The first matching row decides the class.

| Response                                             | Class                              | Retried automatically |
| ---------------------------------------------------- | ---------------------------------- | --------------------- |
| Code `send_failed`, whatever the HTTP status         | `SendFailedError`                  | never                 |
| 400                                                  | `ValidationError`                  | no                    |
| 401, 403                                             | `AuthError`                        | no                    |
| 404                                                  | `NotFoundError`                    | no                    |
| 409 with code `idempotency_in_progress`              | `RateLimitedError`                 | yes                   |
| 409 with any other code                              | `ValidationError`                  | no                    |
| 422                                                  | `ValidationError`                  | no                    |
| 429                                                  | `RateLimitedError`                 | yes                   |
| 500 to 599                                           | `ServerError`                      | yes                   |
| 402, 413, 415 and any other status                   | `SanadApiError` (base class)       | no                    |
| No response: network failure                         | `ServerError`, code `network_error`, status `0` | yes      |
| No response: the attempt timed out                   | `ServerError`, code `timeout`, status `0`. See [Retries and timeouts](#retries-and-timeouts). | yes |
| Refused by the SDK before any request                | `ValidationError`, status `0`      | no                    |
| A success answer the SDK cannot read                 | `SanadApiError`, code `malformed_response` | no            |

Every error has the properties `code`, `status`, `requestId`, `messageAr`, `details`,
`upstreamCode` and `rawBody` (the decoded error body), and `getMessage()`.

Read the API error code from the `code` property: `$error->code`. PHP's own `getCode()` returns
`0`.

Several codes share one class. **Branch on `code`, not only on the class.**

**`SendFailedError`** means WhatsApp refused or failed the send, or the result of the send is not
known. See [Retries and timeouts](#retries-and-timeouts) for what to do with each status.

- `upstreamStatus` is the HTTP status of the answer (same as `status`). It is normally WhatsApp's
  own status, or 500 when WhatsApp gave none. It is the API's own 409 when you repeat a send
  whose result is still unknown, and the API's own 503 when WhatsApp accepted a send but returned
  no message id (this 503 can be the first answer).
- **A 401 or 403 `SendFailedError` is not about your API key.** It is WhatsApp's status.
- `upstreamCode` is WhatsApp's error code as a string, or `null`.
- `metaError` is WhatsApp's error object as an array (`title`, `message`, `code`, `subcode`,
  `type`, `fbtrace_id`), or `null`.
- It extends `SanadApiError` only. It is not an `AuthError`, `ValidationError`,
  `RateLimitedError` or `ServerError`. Catch it before the base class.

**`RateLimitedError`** carries:

- `retryAfterSec`: the server's `Retry-After` value in seconds, not capped. `null` when absent.
- `limit`: the `X-RateLimit-Limit` header, the requests allowed per window. `null` when absent.
- `remaining`: the `X-RateLimit-Remaining` header. `null` when absent.

It is thrown only after the automatic retries are used up.

**402 errors** are the base `SanadApiError`. The code depends on the endpoint:

| Endpoint                                         | Codes                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `messages()->send()`, `messages()->sendText()`   | `PREPAID_CREDIT_CAP_REACHED`, `SUBSCRIPTION_LAPSED`, `PREPAID_CAP_CHECK_FAILED` (upper case) |
| `campaigns()->create()`, `campaigns()->resume()` | `insufficient_credits`, `subscription_lapsed` (lower case)       |

Compare the code exactly: `SUBSCRIPTION_LAPSED` on a send and `subscription_lapsed` on a campaign
are the same condition with two spellings. `PREPAID_CAP_CHECK_FAILED` means the balance could not be read. It does not mean the credits ran
out, although the API message says "Not enough credits". The SDK does not retry a 402. It is safe
to make the same call again after a few seconds with the same idempotency key.

**409 errors:**

| Code                              | Class              | Meaning                                                    |
| --------------------------------- | ------------------ | ---------------------------------------------------------- |
| `idempotency_in_progress`         | `RateLimitedError` | The first call with this key is still running. Retried.    |
| `idempotency_conflict`            | `ValidationError`  | The key was used with a different request.                 |
| `customer_service_window_closed`  | `ValidationError`  | Free-form text is not allowed now. `details` has `last_inbound_at`, `window_expires_at` (each a string or `null`) and `template_required` (`true`). Send a template. |
| `MARKETING_SUPPRESSED`            | `ValidationError`  | Marketing messages to this recipient are blocked.          |
| `tag_already_exists`              | `ValidationError`  | A tag with this name exists.                               |
| `contact_opted_out`               | `ValidationError`  | An opted-out contact cannot be deleted.                    |
| `template_not_approved`           | `ValidationError`  | The campaign template is not approved.                     |
| `campaign_not_active`, `campaign_not_paused`, `campaign_cannot_resume` | `ValidationError` | The campaign is not in a state that allows the change. |
| `campaign_busy`                   | `ValidationError`  | Another change is in progress. Not retried automatically.  |
| `send_failed`                     | `SendFailedError`  | A repeat of a send whose result is still unknown.          |

**403 errors** such as `kyc_required` and `tracked_links_disabled` are `AuthError`. They are
about the account, not about a wrong key.

**413 and 415** (`PAYLOAD_TOO_LARGE`, `import_file_too_large`, `import_file_not_csv`) are the
base `SanadApiError`.

**Refused before any request** (`ValidationError`, status `0`): `invalid_idempotency_key`,
`idempotency_key_required`, `invalid_id`, `invalid_contacts`, `import_file_too_large`,
`invalid_import_tags`, `invalid_request_body`.

```php
<?php

use Sanadwa\WhatsApp\Dto\SendTextOptions;
use Sanadwa\WhatsApp\Exceptions\AuthError;
use Sanadwa\WhatsApp\Exceptions\RateLimitedError;
use Sanadwa\WhatsApp\Exceptions\SanadApiError;
use Sanadwa\WhatsApp\Exceptions\SendFailedError;
use Sanadwa\WhatsApp\Exceptions\ValidationError;

try {
    $sdk->messages()->sendText(new SendTextOptions(
        phoneNumberId: 'YOUR_PHONE_NUMBER_ID',
        toPhone: '+966500000000',
        text: 'Your order has shipped.',
    ));
} catch (SendFailedError $e) {
    // WhatsApp refused the message. Not retried. Do not treat a 401/403 here as a bad API key.
    error_log("WhatsApp error {$e->upstreamStatus} {$e->upstreamCode} " . json_encode($e->metaError));
} catch (RateLimitedError $e) {
    error_log("Rate limited. Retry after {$e->retryAfterSec} s. {$e->remaining} of {$e->limit} left.");
} catch (ValidationError $e) {
    if ($e->code === 'customer_service_window_closed') {
        $expires = $e->details['window_expires_at'] ?? null;
        error_log('Window closed. Send a template instead. Expired: ' . ($expires ?? 'unknown'));
    } else {
        error_log("{$e->code}: {$e->getMessage()}");
    }
} catch (AuthError $e) {
    error_log("Key or account problem: {$e->code}");
} catch (SanadApiError $e) {
    error_log("{$e->code} ({$e->status}), request {$e->requestId}: {$e->getMessage()}");
}
```

`SanadApiError::is($error)` tells you whether a value is an SDK error.

## Retries and timeouts

| Rule                    | Value                                                                        |
| ----------------------- | ---------------------------------------------------------------------------- |
| Attempts                | `retries` is the total number of attempts, including the first. Default 5.   |
| Retried                 | Network failure, timeout, 429, `409 idempotency_in_progress`, and any 5xx whose code is not `send_failed`. |
| Never retried           | Code `send_failed` with any status. 400, 401, 402, 403, 404, 413, 415, 422. Every 409 other than `idempotency_in_progress`. |
| Wait, no `Retry-After`  | 250 ms, 500 ms, 1 s, 2 s, and so on, doubling. Capped at 30 s.               |
| Wait, with `Retry-After` | The server's value, capped at 60 s. Seconds and HTTP dates are both read.   |
| After the last attempt  | The error of the last answer is thrown.                                      |
| Applies to              | Every method. Writes reuse the same `Idempotency-Key` on each attempt.       |

**`send_failed` is never retried.** The first error goes straight to your code. What to do next
depends on its `status`:

- **A 4xx other than 408 and 429** (or `upstreamCode` `130429` with any status): WhatsApp refused
  the message and nothing was sent. Fix the cause, then send again.
- **A 5xx, 408 or 429, or the API's own 409 or 503: the result is not known.** The message may
  already be on its way. **Do not send it again with a new idempotency key**: a new key removes
  the guard against a duplicate, and the customer can get the message twice. Wait for the
  `message.delivered` or `message.failed` webhook, or check the message in the SanadWA console.
  A failed send returns no message id, so `messages()->get()` cannot be used here. A repeat with
  the same key is safe: it is answered `409 send_failed` and sends nothing.

The 503 can be the first answer to a send, when WhatsApp accepted the request but returned no
message id. See
[When the result of a send is not known](https://developers.sanadwa.com/idempotency/#when-the-result-of-a-send-is-not-known).

One narrow case: when the answer of a failed send is cut off before its body arrives, the SDK
cannot see the code `send_failed`. It retries with the same key, and you may get the repeat's
`409 send_failed` without WhatsApp's reason. Nothing is sent twice.

`RateLimitedError::$retryAfterSec` keeps the server's raw value even when the wait was capped.

**Timeouts.** The default Guzzle client uses `timeout` (30 s for one whole attempt) and
`connectTimeout` (10 s to connect). `0` disables either. A timed-out attempt is retried like a
network failure. If the last attempt times out, the SDK throws `ServerError` with code `timeout`.
The code is `timeout` only when Guzzle reports the timeout (curl error 28). With another PSR-18
client the code is `network_error`; the retry behaviour is the same. `contacts()->import()` gets
at least 300 s per attempt with the default client; see [Contacts](#contacts).

**A write that outlasts its timeout.** The timeout stops the SDK from waiting. It does not stop
the API. When the first attempt of a write times out while the API is still working, the retries
with the same key are answered `409 idempotency_in_progress`, and the call ends with
`RateLimitedError` (code `idempotency_in_progress`), not with `timeout`. The action may still
complete. Calling again with the same idempotency key returns its result once it is finished.

**How long one call can take.** With the defaults (5 attempts of up to 30 s each, plus the
waits) one call can take about two and a half minutes when every attempt times out. It can take
up to about six and a half minutes when the server asks for 60-second waits with `Retry-After`,
as it does on some 503 answers for campaigns. Lower `retries` or `timeout` if that is too long.

## Webhooks

### What SanadWA sends

- A `POST` with a JSON body: `{ "event": "<name>", "tenant_id": <number>, "data": { ... } }`.
- `X-Sanad-Signature: sha256=<hex>`. The hex is HMAC-SHA256 of the **exact raw body bytes** with
  your webhook secret.
- `X-Sanad-Event`: the event name.
- `X-Sanad-Delivery-Id`: the same value on every retry of one delivery. Use it to drop
  duplicates.
- Only a 2xx answer counts as delivered. SanadWA waits 5 seconds for it. Any other answer is
  retried: 5 attempts in total, at once and then after 5 s, 30 s, 120 s and 600 s. After that the
  delivery is marked dead.

### Rules for a handler

1. Verify with the raw body. Do not decode and re-encode it first.
2. **Answer 401 only when `$result->valid` is false.** That is the only case of a bad signature.
3. Answer 2xx for every valid delivery, including events you do not handle, `unknown` events and
   `test` events. A non-2xx answer makes SanadWA retry and then give up.
4. Act only on the event types you handle. Ignore the rest.
5. Drop duplicates by the `X-Sanad-Delivery-Id` header.
6. Answer within 5 seconds. Do slow work after you answer.

### Plain PHP handler

```php
<?php

require __DIR__ . '/vendor/autoload.php';

use Sanadwa\WhatsApp\Resources\Webhooks;

$rawBody = (string) file_get_contents('php://input');
$signature = $_SERVER['HTTP_X_SANAD_SIGNATURE'] ?? '';
$deliveryId = $_SERVER['HTTP_X_SANAD_DELIVERY_ID'] ?? null;

$result = Webhooks::verify($rawBody, $signature, (string) getenv('SANAD_WEBHOOK_SECRET'));

// Bad signature: the only case that gets a 401.
if (!$result->valid) {
    http_response_code(401);
    return;
}

// Check $deliveryId against your own store here and stop if you have seen it.

$event = $result->event;
switch ($event->type) {
    case 'message.sent':
        // $event->data['messageId'] is the WhatsApp message id (wamid.…). It can be null.
        break;
    case 'message.delivered':
    case 'message.read':
        // Match on providerMsgId: it equals the messageId your send returned.
        error_log($event->type . ' ' . ($event->data['providerMsgId'] ?? ''));
        break;
    case 'message.failed':
        $error = $event->data['error']; // Dto\WebhookFailedError
        error_log('failed ' . ($event->data['providerMsgId'] ?? '') . " {$error->code} {$error->details}");
        break;
    case 'inbound.message':
        error_log('from ' . $event->data['from'] . ': ' . ($event->data['text'] ?? ''));
        break;
    case 'test':
        // The console's "Send test event". Nothing to do.
        break;
    case 'unknown':
        // Correctly signed, but this SDK version cannot type it. $event->data['raw'] has the payload.
        break;
}

// Valid signature: always 2xx, whatever the event was.
http_response_code(200);
```

### Laravel controller

Use `$request->getContent()` for the raw body. Put the route in `routes/api.php`, or exclude it
from CSRF protection.

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;
use Sanadwa\WhatsApp\Laravel\Facades\SanadWhatsApp;

final class SanadWebhookController
{
    public function __invoke(Request $request): Response
    {
        $result = SanadWhatsApp::webhooks()->verify(
            $request->getContent(),
            (string) $request->header('X-Sanad-Signature', ''),
            (string) config('sanadwa.webhook_secret'),
        );

        // Bad signature: the only case that gets a 401.
        if (!$result->valid) {
            return response('', 401);
        }

        // A retry of a delivery we already handled.
        $deliveryId = (string) $request->header('X-Sanad-Delivery-Id', '');
        if ($deliveryId !== '' && !Cache::add("sanad-webhook:{$deliveryId}", true, now()->addDay())) {
            return response('', 200);
        }

        $event = $result->event;
        switch ($event->type) {
            case 'message.delivered':
            case 'message.read':
                // Match on providerMsgId: it equals the messageId your send returned.
                break;
            case 'message.failed':
                // $event->data['error'] has code, title, message, errorData, details, errorUserMsg.
                break;
            case 'inbound.message':
                break;
            default:
                // message.sent, test, unknown and anything you do not handle: nothing to do.
                break;
        }

        // Valid signature: always 2xx, whatever the event was.
        return response('', 200);
    }
}
```

`$sdk->webhooks()->verify(...)` and the static `Webhooks::verify(...)` are the same function.
`Webhooks::verifyInput(['rawBody' => ..., 'signature' => ..., 'secret' => ...])` takes the same
values as an array.

### The verify result

`Webhooks::verify()` returns a `Dto\WebhookVerifyResult`. It never throws.

| Property                   | Meaning                                                                      |
| -------------------------- | ---------------------------------------------------------------------------- |
| `valid`, `signatureValid`  | `true` when the signature matches the raw body. Nothing else makes it false. |
| `recognized`               | `false` when the event type is `unknown`, and when the result is invalid.    |
| `eventType`                | The event name from the body, or `null` when the body has none.              |
| `envelope`                 | The decoded JSON body, or `null` when the body is not JSON.                  |
| `event`                    | A `Dto\WebhookEvent`. Set whenever `valid` is `true`, otherwise `null`.      |
| `reason`                   | Set only when `valid` is `false`.                                            |

`reason` is one of `invalid_input`, `invalid_secret`, `missing_body`, `malformed_signature`,
`empty_signature`, `signature_length_mismatch`, `signature_mismatch`, `verification_error`.

### Events

`WebhookEvent` has `type` (a string) and `data` (an array). Every event has `data['raw']`: the
full `data` object as sent, with its original snake_case keys.

| `type`              | Keys of `data`                                                                     |
| ------------------- | ---------------------------------------------------------------------------------- |
| `message.sent`      | `messageId` (`wamid.…` or `null`), `messageType` (`template` or `text`), `toPhone`, `templateName`, `templateLanguage`, `text`, `sentAt` |
| `message.delivered` | `messageId`, `providerMsgId`, `toPhone`, `deliveredAt`                             |
| `message.read`      | `messageId`, `providerMsgId`, `toPhone`, `readAt`                                  |
| `message.failed`    | `messageId`, `providerMsgId`, `toPhone`, `failedAt`, `error`                       |
| `inbound.message`   | `from`, `messageType`, `messageId`, and `text`, `timestamp` when present           |
| `test`              | `test` (`true`), `from`, `text`                                                    |
| `unknown`           | `raw` only                                                                         |

**Correlate status events on `providerMsgId`.** On `message.delivered`, `message.read` and
`message.failed`, `messageId` is SanadWA's row id. It is not the id your send returned.
`providerMsgId` is the WhatsApp message id (`wamid.…`): it equals the `messageId` returned by
`messages()->send()` and `messages()->sendText()`, and it is the id `messages()->get()` takes.
`providerMsgId` and `toPhone` can be `null`.

**`message.failed` error.** `data['error']` is a `Dto\WebhookFailedError` with six properties.
Each is `null` when WhatsApp gave no value: `code` (int), `title`, `message`, `errorData`
(array), `details`, `errorUserMsg`.

**The console test event.** The "Send test event" button in the console sends a delivery named
`inbound.message` whose `data.test` is `true`. The SDK returns it as a `test` event, with `valid`
and `recognized` both `true`. Answer 2xx and do nothing else. Any delivery whose `data.test` is
`true` is returned as `test`, whatever its event name.

**Unknown events.** A correctly signed delivery that the SDK cannot type is returned as valid,
with `recognized` set to `false` and an `unknown` event. This covers a newer event name, a known
event with missing fields, a body that is not JSON, and a body nested deeper than 512 levels.
Answer 2xx.

### Test fixtures

`Sanadwa\WhatsApp\TestFixtures` builds signed sample deliveries, so you can test a handler
without computing signatures.

```php
<?php

use Sanadwa\WhatsApp\Resources\Webhooks;
use Sanadwa\WhatsApp\TestFixtures;

$fixture = TestFixtures::createMessageDeliveredFixture(['providerMsgId' => 'wamid.EXAMPLE']);
$result = Webhooks::verify($fixture['rawBody'], $fixture['signature'], $fixture['secret']);

assert($result->valid === true);
assert($result->recognized === $fixture['recognized']);
assert($result->eventType === $fixture['eventType']);
assert($result->event == $fixture['expectedEvent']);

$unknown = TestFixtures::createUnknownEventFixture();
$result = Webhooks::verify($unknown['rawBody'], $unknown['signature'], $unknown['secret']);

assert($result->valid === true);       // answer 2xx
assert($result->recognized === false);
assert($result->event->type === 'unknown');
```

Each fixture is an array with the keys `rawBody`, `signature`, `secret`, `expectedEvent`,
`recognized` and `eventType`. Each method takes an optional array of overrides.

All shipped fixtures:

| Method                                        | Event                                         | Overrides                                              |
| --------------------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| `TestFixtures::createMessageSentFixture()`      | `message.sent` (template)                     | `messageId`, `toPhone`, `templateName`, `templateLanguage`, `sentAt`, `secret` |
| `TestFixtures::createTextMessageSentFixture()`  | `message.sent` (text)                         | `messageId`, `toPhone`, `text`, `sentAt`, `secret`     |
| `TestFixtures::createMessageDeliveredFixture()` | `message.delivered`                           | `messageId`, `deliveredAt`, `providerMsgId`, `toPhone`, `secret` |
| `TestFixtures::createMessageReadFixture()`      | `message.read`                                | `messageId`, `readAt`, `providerMsgId`, `toPhone`, `secret` |
| `TestFixtures::createMessageFailedFixture()`    | `message.failed` with the six-field error     | `messageId`, `failedAt`, `errorCode`, `errorTitle`, `errorMessage`, `errorData`, `details`, `errorUserMsg`, `providerMsgId`, `toPhone`, `secret` |
| `TestFixtures::createInboundMessageFixture()`   | `inbound.message`                             | `from`, `text`, `messageType`, `messageId`, `timestamp`, `secret` |
| `TestFixtures::createTestEventFixture()`        | `test` (the console test event)               | `secret`                                               |
| `TestFixtures::createUnknownEventFixture()`     | `unknown` (default name `campaign.completed`) | `eventType`, `data`, `secret`                          |

In the overrides, `providerMsgId` and `toPhone` accept `null`. On the failed fixture, `details`
and `errorUserMsg` default to the values in `errorData`.

Do not use the fixtures in production code.

## Upgrading from 0.3.0

These changes can affect existing code. The full list is in [CHANGELOG.md](CHANGELOG.md).

| Area | Before | Now |
| ---- | ------ | --- |
| `send_failed` class | `AuthError`, `NotFoundError`, `ValidationError`, `RateLimitedError` or `ServerError`, by HTTP status | Always `SendFailedError`. Catch it before the base class. |
| `send_failed` retry | Retried on 429 and 5xx | Never retried |
| Signed delivery the SDK cannot type | Invalid, `reason` `unknown_event_type` (or `verification_error`) | Valid, `recognized` `false`, event `unknown`. Answer 401 only when `valid` is false. |
| Console test event | Rejected as invalid | Valid, event `test` |
| Event types | 5 | 7: `test` and `unknown` are new |
| Default base URL | `https://api.sanadwa.com/api/public/v1` | `https://api.sanadwa.com/v1`. The old one still works when set explicitly. |
| `Retry-After` wait | Capped at 30 s | Capped at 60 s |
| HTTP 422 | `SanadApiError` | `ValidationError` |
| Timed-out request | `ServerError` code `network_error` | `ServerError` code `timeout` when Guzzle reports it |
| Nullable properties | `Template::$category`, `Message::$status`, `$toPhone`, `$channel`, `$provider` were non-null | Each can be `null` |
| `messages()->get()` and `templates()->list()` | Threw on a null `status`, `to_phone`, `channel`, `provider` or `category` | Return the row with `null` |

## License

MIT
