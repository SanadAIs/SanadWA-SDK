# @sanadwa/whatsapp-sdk

API documentation: https://developers.sanadwa.com

TypeScript SDK for the SanadWA WhatsApp Public API. No runtime dependencies. ESM and CommonJS builds. Node 20 or later.

For PHP and Laravel, use the [PHP SDK](php/README.md).

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Resources](#resources)
- [Covered endpoints](#covered-endpoints)
- [Pagination](#pagination)
- [Idempotency](#idempotency)
- [Errors](#errors)
- [Retries and timeouts](#retries-and-timeouts)
- [Webhooks](#webhooks)
- [Upgrading from 0.3.0](#upgrading-from-030)

## Install

The package is not on the npm registry yet. Install the tarball attached to the GitHub release:

```sh
npm install https://github.com/SanadAIs/SanadWA-SDK/releases/download/v0.4.0/sanadwa-whatsapp-sdk-0.4.0.tgz
```

This URL works once the `v0.4.0` release and its tarball are on the
[releases page](https://github.com/SanadAIs/SanadWA-SDK/releases). If it answers 404, the
release is not out yet. You can build the same tarball from a checkout of this repository:

```sh
npm ci
npm run build
npm pack
# then, in your project:
npm install /path/to/sanadwa-whatsapp-sdk-0.4.0.tgz
```

Once the package is published to npm, the command is:

```sh
npm install @sanadwa/whatsapp-sdk
```

## Quick start

```ts
import { SanadWhatsApp } from '@sanadwa/whatsapp-sdk';

const apiKey = process.env.SANAD_API_KEY ?? process.env.SANADWA_API_KEY;
if (!apiKey) throw new Error('Set SANAD_API_KEY.');

const sdk = new SanadWhatsApp({ apiKey });

// 1. List your phone numbers. Every send needs a phoneNumberId.
const { data: numbers } = await sdk.phoneNumbers.list();
const sender = numbers[0];
if (!sender) throw new Error('This account has no active phone number.');

// 2. List the approved templates this number can send.
const { data: templates } = await sdk.templates.list({ phoneNumberId: sender.phoneNumberId });
console.log(templates.map((t) => `${t.name} (${t.language})`));

// 3. Send a template message.
const sent = await sdk.messages.send({
  phoneNumberId: sender.phoneNumberId,
  toPhone: '+966500000000',
  templateName: 'hello_world',
  templateLanguage: 'en',
  templateParams: ['Alice'],
});

// 4. Look the message up with the WhatsApp message id the send returned.
if (sent.messageId) {
  const message = await sdk.messages.get(sent.messageId);
  console.log(message.status); // 'sent' | 'delivered' | 'read' | 'failed' | null
}
```

A phone number can only send the templates of its own WhatsApp Business Account. Pass
`phoneNumberId` to `templates.list()` to get only those.

## Configuration

```ts
import { SanadWhatsApp } from '@sanadwa/whatsapp-sdk';

const sdk = new SanadWhatsApp({
  apiKey: process.env.SANAD_API_KEY ?? '',
  baseUrl: 'https://api.sanadwa.com/v1',
  retries: 5,
  timeoutMs: 30_000,
});
```

| Option      | Default                       | Notes                                                              |
| ----------- | ----------------------------- | ------------------------------------------------------------------ |
| `apiKey`    | required                      | Your API key. The constructor throws when it is empty.             |
| `baseUrl`   | `https://api.sanadwa.com/v1`  | See "Base URL" below.                                              |
| `retries`   | `5`                           | Total attempts, including the first. Minimum 1; a fraction is rounded down. The constructor throws for a value that is not a finite number. |
| `timeoutMs` | `30000`                       | Timeout for each attempt, in milliseconds. `0` disables it. A fraction is rounded up. The constructor throws for a negative or non-finite value. |
| `fetch`     | `globalThis.fetch`            | Pass your own `fetch` for tests.                                   |
| `userAgent` | `@sanadwa/whatsapp-sdk/0.4.0` | Sent as the `User-Agent` header.                                   |

**Environment variables.** The SDK reads no environment variable. You pass the key as `apiKey`.
The examples here read `SANAD_API_KEY`. The docs site uses the name `SANADWA_API_KEY` in its
samples. Both are only names: use either, or read both as the quick start does.

**Base URL.** The default is `https://api.sanadwa.com/v1`. The older
`https://api.sanadwa.com/api/public/v1` serves the same routes and still works when you pass it
as `baseUrl`. Before 0.4.0 the older path was the default.

**Key scopes.** A key with scope `read` can call the GET methods. `send` is needed for sends and
for campaign create, pause and resume. `full` is needed for tag and contact writes.

## Resources

Every example below uses the `sdk` client from the quick start.

### Health

`sdk.health()` checks the key and returns the account it belongs to.

```ts
const me = await sdk.health();
console.log(me.tenantId, me.scope, me.serverTime);
```

### Phone numbers

`sdk.phoneNumbers.list()` returns the account's active numbers, oldest first. The list is not
paginated. `phoneNumberId` is the id that `messages.send()` and `campaigns.create()` need.

```ts
const { data: numbers } = await sdk.phoneNumbers.list();
for (const n of numbers) {
  console.log(n.phoneNumberId, n.displayPhoneNumber, n.verifiedName, n.wabaId, n.qualityRating);
}
```

### Templates

`sdk.templates.list(options?)` returns one page of the account's approved templates.

| Option          | Notes                                                                               |
| --------------- | ----------------------------------------------------------------------------------- |
| `page`, `limit` | See [Pagination](#pagination).                                                      |
| `q`             | Text contained in the template name or language code, without regard to case.       |
| `phoneNumberId` | Only the templates this number can send. An unknown id throws `NotFoundError` (`phone_not_found`). Wins over `wabaId`. |
| `wabaId`        | Only the templates of this WhatsApp Business Account.                               |

```ts
const page = await sdk.templates.list({ phoneNumberId: 'YOUR_PHONE_NUMBER_ID', limit: 100 });
for (const t of page.data) {
  console.log(t.name, t.language, t.category, t.status, t.wabaId);
}
```

`category` and `wabaId` can be `null`.

### Messages

| Method                          | What it does                                             |
| ------------------------------- | -------------------------------------------------------- |
| `sdk.messages.send(options)`     | Sends an approved template message.                      |
| `sdk.messages.sendText(options)` | Sends a free-form text reply. `reply()` is an alias.     |
| `sdk.messages.get(id)`           | Looks up one message by its WhatsApp message id.         |

**Send a template**

```ts
const sent = await sdk.messages.send({
  phoneNumberId: 'YOUR_PHONE_NUMBER_ID',
  toPhone: '+966500000000',
  templateName: 'order_update',
  templateLanguage: 'en',
  templateParams: ['Alice', '#1042'],
});
console.log(sent.messageId, sent.acceptedAt, sent.replayed);
```

`templateLanguage` is optional. **When you leave it out, the API sends the template in Arabic
(`ar`).** Set it whenever the template is not Arabic.

`templateParams` fills the body variables in order. Use `templateComponents` instead when the
template needs header, button or other component parameters.

`messageId` is the WhatsApp message id (`wamid.…`). It can be `null` when WhatsApp returned none.
`replayed` is `true` when the API answered with the stored result of an earlier call that used
the same idempotency key.

**Send a free-form text reply**

```ts
const reply = await sdk.messages.sendText({
  phoneNumberId: 'YOUR_PHONE_NUMBER_ID',
  toPhone: '+966500000000',
  text: 'Thank you. How can we help?',
  previewUrl: false,
});
console.log(reply.messageId);
```

WhatsApp allows free-form text only inside the customer-service window: the customer must have
written to this number recently. Outside the window the API answers
`409 customer_service_window_closed` (`ValidationError`). Send a template in that case.

**Look up a message**

```ts
const message = await sdk.messages.get('wamid.EXAMPLE_ID_FROM_A_SEND');
console.log(message.status, message.deliveredAt, message.readAt, message.error);
```

`messages.get()` takes the **WhatsApp message id**: the `messageId` a send returned, or the
`providerMsgId` of a status webhook. Do not pass `Message.id` or a status webhook's `messageId`.
Those are SanadWA row ids, and the API answers `404 message_not_found` (`NotFoundError`) for
anything that is not a `wamid.` id.

`status`, `sentAt`, `toPhone`, `channel` and `provider` can be `null`. The known `status` values
are `sent`, `delivered`, `read` and `failed`. Treat any other value as not final.

### Balance

`sdk.balance.get()` returns the credit balance and this month's usage.

```ts
const balance = await sdk.balance.get();
console.log(balance.billingType, balance.availableCredits, balance.unlimited);
console.log(balance.usageThisMonth.creditsUsed, balance.usageThisMonth.marketing);
```

Fields: `billingType` (`prepaid` or `postpaid`), `availableCredits`, `paidCreditsRemaining`,
`freeCreditsRemaining`, `unlimited`, `unlimitedUntil`, `asOf`, and `usageThisMonth`
(`periodStart`, `creditsUsed`, `marketing`, `utility`, `authentication`, `service`).
`availableCredits` and `paidCreditsRemaining` are `null` for accounts without a prepaid balance.

### Tags

| Method                        | What it does                                    |
| ----------------------------- | ----------------------------------------------- |
| `sdk.tags.list(options?)`      | One page of tags, ordered by id.                |
| `sdk.tags.create(input)`       | Creates a tag.                                  |
| `sdk.tags.delete(id, options?)` | Removes a tag from the tag list.                |

```ts
const tag = await sdk.tags.create({ name: 'vip', description: 'Repeat customers' });

const { data: tags } = await sdk.tags.list({ limit: 200 });
console.log(tags.map((t) => t.name));

const removed = await sdk.tags.delete(tag.id);
console.log(removed.deleted);
```

Tag names are 1 to 100 characters and cannot contain `,` or `;`. Names are unique without regard
to case: creating `VIP` when `vip` exists answers `409 tag_already_exists` (`ValidationError`).
Deleting a tag does not remove the name from the contacts that carry it.

### Contacts

| Method                              | What it does                                   |
| ----------------------------------- | ---------------------------------------------- |
| `sdk.contacts.list(options?)`        | One page of contacts, ordered by phone.        |
| `sdk.contacts.upsert(contacts, options?)` | Creates or updates 1 to 100 contacts.     |
| `sdk.contacts.import(input)`         | Creates or updates contacts from a CSV file.   |
| `sdk.contacts.delete(id, options?)`  | Deletes one contact.                           |

**List**

```ts
const page = await sdk.contacts.list({ tag: 'vip', page: 1, limit: 50 });
for (const c of page.data) {
  console.log(c.id, c.phone, c.firstName, c.tags);
}
```

`tag` is an exact tag name, compared without regard to case. There is no phone or text filter.

**Create or update**

```ts
const result = await sdk.contacts.upsert([
  { phone: '+966500000000', firstName: 'Alice', tags: ['vip'] },
  { phone: '+12025550123', firstName: 'Omar', lastName: 'Haddad' },
]);

console.log(result.summary); // { created, updated, rejected, failed }
for (const item of result.results) {
  if (item.status === 'rejected' || item.status === 'failed') {
    console.log(`contact ${item.index}: ${item.error?.code} ${item.error?.message}`);
  }
}
```

- Pass one contact or an array. The SDK always sends the array form; the API has no other shape.
- The phone is the key. A phone that already exists is updated: a new first name replaces the
  stored one, last name and email are filled only when empty, tags are added. Nothing is removed.
- Tags must exist first. Create them with `tags.create()`. An unknown tag rejects that contact
  with `tag_not_found`.
- **The call succeeds (HTTP 200) even when contacts are rejected.** It does not throw for them.
  Read `results[i].status`: `created`, `updated`, `rejected` or `failed`.
- More than 100 contacts, or none, throws `ValidationError` (`invalid_contacts`) before any
  request is made.

**Import a CSV file**

```ts
import { readFile } from 'node:fs/promises';

const csv = await readFile('contacts.csv');
const imported = await sdk.contacts.import({ file: csv, filename: 'contacts.csv', tags: ['vip'] });

console.log(imported.summary); // { rows, created, updated, rejected, failed }
for (const e of imported.errors) {
  console.log(`line ${e.row}: ${e.code} ${e.message}`);
}
```

- `file` is the CSV content: a string, a `Uint8Array` (a `Buffer` works) or a `Blob`. It is not a
  file path.
- The file needs a header row with a `phone` column. `first_name`, `last_name`, `email` and `tags`
  are optional columns.
- Limits: 5 MB and 5000 rows. A file over 5 MB throws `ValidationError`
  (`import_file_too_large`) before any request is made. The SDK does not count rows: for more
  than 5000 rows the API answers `400 import_too_many_rows` (`ValidationError`) and saves
  nothing.
- `tags` is applied to every row. The names must exist and cannot contain a comma.
- The call succeeds even when rows are rejected. Read `errors`. `row` is the CSV line number; the
  header is line 1.
- **A large import is slow.** The API answers only when every row is handled. Each attempt of
  `import()` therefore gets at least 300 s, not the client's 30 s (a longer client `timeoutMs`,
  or `0`, is kept). Pass `timeoutMs` in the input to set another value for this call.
- For a large file pass your own `idempotencyKey`. If an attempt still times out, the import
  keeps running on the server. The SDK's retries with the same key are then answered
  `409 idempotency_in_progress`, and the call ends with `RateLimitedError`. Call `import()` again
  later with the same key, file and `tags`: once the first run is finished you get its result,
  and nothing is imported twice. If the process that held the key died, its reservation stays in
  flight and the same key is answered `409 idempotency_in_progress` for up to 24 hours. In that
  case a new key is safe: the import is an upsert by phone number.

```ts
import { randomUUID } from 'node:crypto';

const idempotencyKey = randomUUID(); // store it: you need it to ask again
const imported = await sdk.contacts.import({ file: csv, idempotencyKey, timeoutMs: 600_000 });
```

**Delete**

```ts
const deleted = await sdk.contacts.delete('CONTACT_ID');
console.log(deleted.id, deleted.deleted);
```

A contact that opted out cannot be deleted: the API answers `409 contact_opted_out`
(`ValidationError`).

### Campaigns

| Method                              | What it does                                         |
| ----------------------------------- | ---------------------------------------------------- |
| `sdk.campaigns.create(input)`        | Creates a campaign and starts it now or at `sendAt`. |
| `sdk.campaigns.list(options?)`       | One page of campaigns, newest first.                 |
| `sdk.campaigns.get(id)`              | One campaign with message and click counts.          |
| `sdk.campaigns.pause(id, options?)`  | Pauses an active campaign.                           |
| `sdk.campaigns.resume(id, options?)` | Resumes a paused campaign.                           |

**Create**

```ts
import { randomUUID } from 'node:crypto';

// Store this key AND the exact input with your own record of the campaign BEFORE the call.
const idempotencyKey = randomUUID();
const sendAt = '2026-12-01T09:00:00.000Z'; // a fixed time, not one computed from the clock

const { campaign, replayed } = await sdk.campaigns.create({
  name: 'November offer',
  phoneNumberId: 'YOUR_PHONE_NUMBER_ID',
  template: { name: 'november_offer', language: 'ar' },
  audience: { tags: ['vip'] },
  templateVariables: [
    { index: 1, source: 'contact.first_name' },
    { index: 2, source: 'custom', value: '20%' },
  ],
  sendAt,
  idempotencyKey,
});
console.log(campaign.id, campaign.status, replayed);
```

- **`idempotencyKey` is required.** The SDK does not generate one here. The API stores the key
  with the campaign as its duplicate guard. Store the key, and send the same value when you
  retry: the API then returns the first campaign with `replayed: true` instead of creating, and
  charging for, a second one. A missing key throws `ValidationError`
  (`idempotency_key_required`) before any request is made.
- **A retry must send the same input, including `sendAt`.** The same key with any different field
  answers `409 idempotency_conflict` (`ValidationError`) and creates nothing. A `sendAt` computed
  again from the clock (`Date.now() + …`) is a different value: store the time you sent.
- `template.language` is required. There is no default language for campaigns.
- `audience.tags` is 1 to 20 tag names.
- `templateVariables[].source` is `contact.first_name`, `contact.last_name`, `contact.phone`,
  `contact.email` or `custom`. `value` is required for `custom` and not allowed otherwise.
- `sendAt` is optional. Leave it out to start now. It must be in the future and at most 30 days
  ahead. A `Date` is sent as an ISO 8601 string.
- `headerMediaUrl` is an https link, required when the template has a media header.
  `trackedDestinationUrl` is optional.
- The API allows 5 creates per minute per key, on top of the general rate limit.
- `422` answers (`audience_empty`, `audience_all_excluded`, `audience_too_large`) throw
  `ValidationError`.

**List, get, pause, resume**

```ts
const { data: campaigns } = await sdk.campaigns.list({ limit: 20 });

const first = campaigns[0];
if (first) {
  const campaign = await sdk.campaigns.get(first.id);
  console.log(campaign.status, campaign.counts.sent, campaign.counts.delivered, campaign.clicks);

  if (campaign.status === 'active') {
    const paused = await sdk.campaigns.pause(campaign.id);
    console.log(paused.status, paused.pauseReason);

    const resumed = await sdk.campaigns.resume(campaign.id);
    console.log(resumed.status);
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

| #  | Operation                      | SDK method                                   |
| -- | ------------------------------ | -------------------------------------------- |
| 1  | `GET /health`                  | `sdk.health()`                               |
| 2  | `GET /phone-numbers`           | `sdk.phoneNumbers.list()`                    |
| 3  | `GET /templates`               | `sdk.templates.list()`                       |
| 4  | `POST /messages/template`      | `sdk.messages.send()`                        |
| 5  | `POST /messages/text`          | `sdk.messages.sendText()` (alias `reply()`)  |
| 6  | `GET /messages/{id}`           | `sdk.messages.get()`                         |
| 7  | `GET /balance`                 | `sdk.balance.get()`                          |
| 8  | `GET /tags`                    | `sdk.tags.list()`                            |
| 9  | `POST /tags`                   | `sdk.tags.create()`                          |
| 10 | `DELETE /tags/{id}`            | `sdk.tags.delete()`                          |
| 11 | `GET /contacts`                | `sdk.contacts.list()`                        |
| 12 | `POST /contacts`               | `sdk.contacts.upsert()`                      |
| 13 | `POST /contacts/import`        | `sdk.contacts.import()`                      |
| 14 | `DELETE /contacts/{id}`        | `sdk.contacts.delete()`                      |
| 15 | `POST /campaigns`              | `sdk.campaigns.create()`                     |
| 16 | `GET /campaigns`               | `sdk.campaigns.list()`                       |
| 17 | `GET /campaigns/{id}`          | `sdk.campaigns.get()`                        |
| 18 | `POST /campaigns/{id}/pause`   | `sdk.campaigns.pause()`                      |
| 19 | `POST /campaigns/{id}/resume`  | `sdk.campaigns.resume()`                     |
| 20 | `GET /openapi.json`            | Not wrapped. It is a public document and needs no key. Fetch `https://api.sanadwa.com/v1/openapi.json` directly. |

`sdk.webhooks.verify()` and the standalone `verifyWebhook()` make no HTTP call.

## Pagination

`templates.list()`, `tags.list()`, `contacts.list()` and `campaigns.list()` take `page` (starts
at 1) and `limit` (default 50, maximum 200). They return `{ page, limit, data }` with the values
the server used.

The API returns no total and no next link. You have reached the last page when
`data.length < limit`.

```ts
import type { Contact } from '@sanadwa/whatsapp-sdk';

const all: Contact[] = [];
for (let page = 1; ; page++) {
  const res = await sdk.contacts.list({ page, limit: 200 });
  all.push(...res.data);
  if (res.data.length < res.limit) break;
}
```

## Idempotency

- Every write sends an `Idempotency-Key` header: `messages.send()`, `messages.sendText()`,
  `tags.create()`, `tags.delete()`, `contacts.upsert()`, `contacts.import()`,
  `contacts.delete()`, `campaigns.pause()` and `campaigns.resume()`.
- When you pass no `idempotencyKey`, the SDK generates a UUID. It reuses the same key on every
  automatic retry of that call, so a retry after a lost response does not repeat the action.
- `campaigns.create()` is the exception: you must pass the key yourself. See
  [Campaigns](#campaigns).
- A key is 1 to 120 visible ASCII characters (`!` to `~`). An invalid key throws `ValidationError`
  (`invalid_idempotency_key`) before any request is made.
- Reusing a key with a different request body answers `409 idempotency_conflict`
  (`ValidationError`).
- **A key you pass must be unique per action, not per campaign, contact or tag.** For 24 hours
  the same key on the same call returns the first answer again and does not run the action. This
  matters most for calls without a body. Example: `campaigns.pause(id, { idempotencyKey: 'K' })`,
  then `resume(id)`, then `pause(id, { idempotencyKey: 'K' })` returns the stored "paused" answer
  while the campaign keeps sending. Only `messages.send()`, `messages.sendText()` and
  `campaigns.create()` report a repeat (`replayed`); the other methods do not. When in doubt,
  pass no key and let the SDK generate one.

```ts
const sent = await sdk.messages.send({
  phoneNumberId: 'YOUR_PHONE_NUMBER_ID',
  toPhone: '+966500000000',
  templateName: 'order_update',
  templateLanguage: 'en',
  idempotencyKey: 'order-1042-confirmation',
});
console.log(sent.replayed); // true when this key was already used for the same send
```

## Errors

Every error the API returns is thrown as a `SanadApiError` or one of its subclasses. The first
matching row decides the class.

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
| No response: the attempt timed out                   | `ServerError`, code `timeout`, status `0`       | yes      |
| Refused by the SDK before any request                | `ValidationError`, status `0`      | no                    |
| A success answer the SDK cannot read                 | `SanadApiError`, code `malformed_response` | no            |

Every error has `code`, `status`, `message`, `requestId`, `messageAr`, `details`, `upstreamCode`
and `rawBody` (the decoded error body).

Several codes share one class. **Branch on `code`, not only on the class.**

**`malformed_response`** means the API answered 2xx but the SDK could not read the answer: the
body is not JSON (`status` is the HTTP status), or, for the phone number, balance, tag, contact
and campaign calls, a field is missing or has the wrong type (`status` is `0`). These calls check
every field the same way as the PHP SDK: a required field must be present with its type, a
nullable field may be missing or `null` (it reads as `null`), counts must be numbers, and ids may
be strings or numbers. The message names the field, for example `data[0].counts.sent`. It is not
retried. For a write, the action may have run. The API does not send such answers today.

**`SendFailedError`** means WhatsApp refused or failed the send, or the result of the send is not
known. See [Retries and timeouts](#retries-and-timeouts) for what to do with each status.

- `upstreamStatus` is the HTTP status of the answer (same as `status`). It is normally WhatsApp's
  own status, or 500 when WhatsApp gave none. It is the API's own 409 when you repeat a send
  whose result is still unknown, and the API's own 503 when WhatsApp accepted a send but returned
  no message id (this 503 can be the first answer).
- **A 401 or 403 `SendFailedError` is not about your API key.** It is WhatsApp's status.
- `upstreamCode` is WhatsApp's error code as a string, or `null`.
- `metaError` is WhatsApp's error object as sent (`title`, `message`, `code`, `subcode`, `type`,
  `fbtrace_id`), or `null`.
- It extends `SanadApiError` only. It is not an `AuthError`, `ValidationError`,
  `RateLimitedError` or `ServerError`.

**`RateLimitedError`** carries:

- `retryAfterSec`: the server's `Retry-After` value in seconds, not capped. `null` when absent.
- `limit`: the `X-RateLimit-Limit` header, the requests allowed per window. `null` when absent.
- `remaining`: the `X-RateLimit-Remaining` header. `null` when absent.

It is thrown only after the automatic retries are used up.

**402 errors** are the base `SanadApiError`. The code depends on the endpoint:

| Endpoint                                   | Codes                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `messages.send()`, `messages.sendText()`   | `PREPAID_CREDIT_CAP_REACHED`, `SUBSCRIPTION_LAPSED`, `PREPAID_CAP_CHECK_FAILED` (upper case) |
| `campaigns.create()`, `campaigns.resume()` | `insufficient_credits`, `subscription_lapsed` (lower case)             |

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
`invalid_import_tags`.

```ts
import {
  AuthError,
  RateLimitedError,
  SanadApiError,
  SendFailedError,
  ValidationError,
} from '@sanadwa/whatsapp-sdk';

try {
  await sdk.messages.sendText({
    phoneNumberId: 'YOUR_PHONE_NUMBER_ID',
    toPhone: '+966500000000',
    text: 'Your order has shipped.',
  });
} catch (e) {
  if (e instanceof SendFailedError) {
    // WhatsApp refused the message. Not retried. Do not treat a 401/403 here as a bad API key.
    console.error('WhatsApp error', e.upstreamStatus, e.upstreamCode, e.metaError);
  } else if (e instanceof RateLimitedError) {
    console.error('Rate limited', e.retryAfterSec, e.limit, e.remaining);
  } else if (e instanceof ValidationError && e.code === 'customer_service_window_closed') {
    const details = e.details as { window_expires_at?: string | null };
    console.error('Window closed. Send a template instead.', details.window_expires_at);
  } else if (e instanceof AuthError) {
    console.error('Key or account problem', e.code);
  } else if (e instanceof SanadApiError) {
    console.error(e.code, e.status, e.requestId, e.message);
  } else {
    throw e;
  }
}
```

`isSanadApiError(e)` is a type guard for the base class.

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

- **A 4xx other than 408, 409 and 429** (or `upstreamCode` `130429` with any status): WhatsApp refused
  the message and nothing was sent. Fix the cause, then send again.
- **A 5xx, 408 or 429, or the API's own 409 or 503: the result is not known.** The message may
  already be on its way. **Do not send it again with a new idempotency key**: a new key removes
  the guard against a duplicate, and the customer can get the message twice. Wait for the
  `message.delivered` or `message.failed` webhook, or check the message in the SanadWA console.
  A failed send returns no message id, so `messages.get()` cannot be used here. A repeat with
  the same key is safe: it sends nothing. While the first attempt is still unresolved it is
  answered `409 send_failed`; once the result is known it is answered `200` with the message id.

The 503 can be the first answer to a send, when WhatsApp accepted the request but returned no
message id. See
[When the result of a send is not known](https://developers.sanadwa.com/idempotency/#when-the-result-of-a-send-is-not-known).

One narrow case: when the answer of a failed send is cut off before its body arrives, the SDK
cannot see the code `send_failed`. It retries with the same key, and you may get the repeat's
`409 send_failed` without WhatsApp's reason. Nothing is sent twice.

`RateLimitedError.retryAfterSec` keeps the server's raw value even when the wait was capped.

**Timeouts.** Each attempt has its own timeout, `timeoutMs` (default 30000 ms). It covers the
request and the reading of the response body. A timed-out attempt is retried like a network
failure. If the last attempt times out, the SDK throws `ServerError` with code `timeout`. Pass
`timeoutMs: 0` to disable the timeout. `contacts.import()` gets at least 300 s per attempt; see
[Contacts](#contacts).

**A write that outlasts its timeout.** The timeout stops the SDK from waiting. It does not stop
the API. When the first attempt of a write times out while the API is still working, the retries
with the same key are answered `409 idempotency_in_progress`, and the call ends with
`RateLimitedError` (code `idempotency_in_progress`), not with `timeout`. The action may still
complete. Calling again with the same idempotency key returns its result once it is finished.

**How long one call can take.** With the defaults (5 attempts of up to 30 s each, plus the
waits) one call can take about two and a half minutes when every attempt times out. It can take
up to about six and a half minutes when the server asks for 60-second waits with `Retry-After`,
as it does on some 503 answers for campaigns. `contacts.import()` attempts get at least 300 s
each, so with the default 5 attempts one import call can take about 25 minutes. Lower `retries`
or `timeoutMs` if that is too long.

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

1. Verify with the raw body. Do not parse and re-serialize it first.
2. **Answer 401 only when `result.valid` is false.** That is the only case of a bad signature.
3. Answer 2xx for every valid delivery, including events you do not handle, `unknown` events and
   `test` events. A non-2xx answer makes SanadWA retry and then give up.
4. Act only on the event types you handle. Ignore the rest.
5. Drop duplicates by the `X-Sanad-Delivery-Id` header.
6. Answer within 5 seconds. Do slow work after you answer.

### Handler example

The handler is a plain function, so it works with any framework.

```ts
import { verifyWebhook } from '@sanadwa/whatsapp-sdk';

const seenDeliveries = new Set<string>(); // use a database or cache in production

export function handleSanadWebhook(
  rawBody: Uint8Array,
  signature: string | undefined,
  deliveryId: string | undefined,
): number {
  const result = verifyWebhook({
    rawBody,
    signature: signature ?? '',
    secret: process.env.SANAD_WEBHOOK_SECRET ?? '',
  });

  // Bad signature: the only case that gets a 401.
  if (!result.valid) return 401;

  // A retry of a delivery we already handled.
  if (deliveryId) {
    if (seenDeliveries.has(deliveryId)) return 200;
    seenDeliveries.add(deliveryId);
  }

  const { event } = result;
  switch (event.type) {
    case 'message.sent':
      // event.data.messageId is the WhatsApp message id (wamid.…). It can be null.
      break;
    case 'message.delivered':
    case 'message.read':
      // Match on providerMsgId: it equals the messageId your send returned.
      console.log(event.type, event.data.providerMsgId);
      break;
    case 'message.failed':
      console.log('failed', event.data.providerMsgId, event.data.error.code, event.data.error.details);
      break;
    case 'inbound.message':
      console.log('from', event.data.from, event.data.text);
      break;
    case 'test':
      // The console's "Send test event". Nothing to do.
      break;
    case 'unknown':
      // Correctly signed, but this SDK version cannot type it. event.data.raw has the payload.
      break;
  }

  // Valid signature: always 2xx, whatever the event was.
  return 200;
}
```

With Express, read the raw body with `express.raw()`. Do not use `express.json()` on this route:
it replaces the bytes the signature was computed over.

```ts
import express from 'express';

const app = express();

app.post('/webhooks/sanad', express.raw({ type: 'application/json' }), (req, res) => {
  const status = handleSanadWebhook(
    req.body,
    req.header('X-Sanad-Signature'),
    req.header('X-Sanad-Delivery-Id'),
  );
  res.sendStatus(status);
});
```

`sdk.webhooks.verify(input)` is the same function as `verifyWebhook(input)`.

### The verify result

| Field                      | Meaning                                                                      |
| -------------------------- | ---------------------------------------------------------------------------- |
| `valid`, `signatureValid`  | `true` when the signature matches the raw body. Nothing else makes it false. |
| `recognized`               | `false` when `event.type` is `unknown`. `true` otherwise.                    |
| `eventType`                | The event name from the body, or `null` when the body has none.              |
| `envelope`                 | The parsed JSON body, or `null` when the body is not JSON.                   |
| `event`                    | Present whenever `valid` is `true`.                                          |
| `reason`                   | Present only when `valid` is `false`.                                        |

`reason` is one of `invalid_input`, `invalid_secret`, `missing_body`, `malformed_signature`,
`empty_signature`, `signature_length_mismatch`, `signature_mismatch`, `verification_error`.
The verifier never throws.

### Events

Every event has `data.raw`: the full `data` object as sent, with its original snake_case keys.

| `event.type`        | `event.data`                                                                       |
| ------------------- | ---------------------------------------------------------------------------------- |
| `message.sent`      | `messageId` (`wamid.…` or `null`), `messageType` (`template` or `text`), `toPhone`, `templateName`, `templateLanguage`, `text`, `sentAt` |
| `message.delivered` | `messageId`, `providerMsgId`, `toPhone`, `deliveredAt`                             |
| `message.read`      | `messageId`, `providerMsgId`, `toPhone`, `readAt`                                  |
| `message.failed`    | `messageId`, `providerMsgId`, `toPhone`, `failedAt`, `error`                       |
| `inbound.message`   | `from`, `messageType`, `messageId`, `text`, `timestamp`                            |
| `test`              | `test` (`true`), `from`, `text`                                                    |
| `unknown`           | `raw` only                                                                         |

**Correlate status events on `providerMsgId`.** On `message.delivered`, `message.read` and
`message.failed`, `messageId` is SanadWA's row id. It is not the id your send returned.
`providerMsgId` is the WhatsApp message id (`wamid.…`): it equals the `messageId` returned by
`messages.send()` and `messages.sendText()`, and it is the id `messages.get()` takes.
`providerMsgId` and `toPhone` can be `null`.

**`message.failed` error.** `error` has six fields. Each is `null` when WhatsApp gave no value:
`code` (number), `title`, `message`, `errorData` (object), `details`, `errorUserMsg`.

**The console test event.** The "Send test event" button in the console sends a delivery named
`inbound.message` whose `data.test` is `true`. The SDK returns it as a `test` event, with
`valid: true` and `recognized: true`. Answer 2xx and do nothing else. Any delivery whose
`data.test` is `true` is returned as `test`, whatever its event name.

**Unknown events.** A correctly signed delivery that the SDK cannot type is returned as
`valid: true`, `recognized: false`, with an `unknown` event. This covers a newer event name, a
known event with missing fields, and a body that is not JSON. Answer 2xx.

### Test fixtures

The SDK ships signed sample deliveries, so you can test a handler without computing signatures.

```ts
import { __testFixtures, verifyWebhook } from '@sanadwa/whatsapp-sdk';
import { expect, it } from 'vitest';

it('accepts a delivered event', () => {
  const fx = __testFixtures.createMessageDeliveredFixture({ providerMsgId: 'wamid.EXAMPLE' });
  const result = verifyWebhook({ rawBody: fx.rawBody, signature: fx.signature, secret: fx.secret });

  expect(result).toMatchObject({
    valid: true,
    recognized: fx.recognized,
    eventType: fx.eventType,
    event: fx.expectedEvent,
  });
});

it('answers 2xx for an event the SDK does not know', () => {
  const fx = __testFixtures.createUnknownEventFixture();
  const result = verifyWebhook({ rawBody: fx.rawBody, signature: fx.signature, secret: fx.secret });

  expect(result.valid).toBe(true);
  expect(result).toMatchObject({ recognized: false, eventType: 'campaign.completed' });
});
```

Each fixture returns `{ rawBody, signature, secret, expectedEvent, recognized, eventType }`.
Use `toMatchObject`, not `toEqual`, on the whole result: the result also has `signatureValid` and
`envelope`.

All shipped fixtures:

| Fixture                                        | Event                                           | Overrides                                              |
| ---------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| `__testFixtures.createMessageSentFixture()`      | `message.sent` (template)                       | `messageId`, `toPhone`, `templateName`, `templateLanguage`, `sentAt`, `secret` |
| `__testFixtures.createTextMessageSentFixture()`  | `message.sent` (text)                           | `messageId`, `toPhone`, `text`, `sentAt`, `secret`     |
| `__testFixtures.createMessageDeliveredFixture()` | `message.delivered`                             | `messageId`, `deliveredAt`, `providerMsgId`, `toPhone`, `secret` |
| `__testFixtures.createMessageReadFixture()`      | `message.read`                                  | `messageId`, `readAt`, `providerMsgId`, `toPhone`, `secret` |
| `__testFixtures.createMessageFailedFixture()`    | `message.failed` with the six-field error       | `messageId`, `failedAt`, `errorCode`, `errorTitle`, `errorMessage`, `errorData`, `details`, `errorUserMsg`, `providerMsgId`, `toPhone`, `secret` |
| `__testFixtures.createInboundMessageFixture()`   | `inbound.message`                               | `from`, `text`, `messageType`, `messageId`, `timestamp`, `secret` |
| `__testFixtures.createTestEventFixture()`        | `test` (the console test event)                 | `secret`                                               |
| `__testFixtures.createUnknownEventFixture()`     | `unknown` (default name `campaign.completed`)   | `eventType`, `data`, `secret`                          |

`providerMsgId` and `toPhone` accept `null`. On the failed fixture, `details` and `errorUserMsg`
default to the values in `errorData`.

The `__` prefix marks a testing surface. Do not use the fixtures in production code.

## Upgrading from 0.3.0

These changes can affect existing code. The full list is in [CHANGELOG.md](CHANGELOG.md).

| Area | Before | Now |
| ---- | ------ | --- |
| `send_failed` class | `AuthError`, `NotFoundError`, `ValidationError`, `RateLimitedError` or `ServerError`, by HTTP status | Always `SendFailedError`. Catch it before the other classes. |
| `send_failed` retry | Retried on 429 and 5xx | Never retried |
| Signed delivery the SDK cannot type | `valid: false`, `reason: 'unknown_event_type'` | `valid: true`, `recognized: false`, event `unknown`. Answer 401 only when `valid` is false. |
| Console test event | Rejected as invalid | `valid: true`, event `test` |
| `WebhookEvent` union | 5 members | 7 members: add `test` and `unknown` to an exhaustive `switch` |
| Verify result | `{ valid, event }` or `{ valid, reason }` | A valid result also has `signatureValid`, `recognized`, `eventType`, `envelope`; an invalid one also has `signatureValid: false` and `recognized: false`. Use `toMatchObject` in tests. |
| Signed body that is not JSON | `valid: false`, `reason: 'verification_error'` | `valid: true`, `recognized: false`, event `unknown`, `envelope: null` |
| A 2xx answer that is not JSON | A plain `SyntaxError` | `SanadApiError`, code `malformed_response` |
| Default base URL | `https://api.sanadwa.com/api/public/v1` | `https://api.sanadwa.com/v1`. The old one still works as `baseUrl`. |
| `Retry-After` wait | Capped at 30 s | Capped at 60 s |
| Request timeout | None | 30 s per attempt (`timeoutMs`) |
| HTTP 422 | `SanadApiError` | `ValidationError` |
| Nullable types | `Template.category`, `Message.status`, `sentAt`, `toPhone`, `channel`, `provider` and the `message.sent` event's `messageId` were non-null | Each can be `null` |

## License

MIT
