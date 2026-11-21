<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Resources;

use Sanadwa\WhatsApp\Dto\Contact;
use Sanadwa\WhatsApp\Dto\ContactImportError;
use Sanadwa\WhatsApp\Dto\ContactImportResult;
use Sanadwa\WhatsApp\Dto\ContactImportSummary;
use Sanadwa\WhatsApp\Dto\ContactInput;
use Sanadwa\WhatsApp\Dto\ContactItemError;
use Sanadwa\WhatsApp\Dto\ContactUpsertItem;
use Sanadwa\WhatsApp\Dto\ContactUpsertResult;
use Sanadwa\WhatsApp\Dto\ContactUpsertSummary;
use Sanadwa\WhatsApp\Dto\DeletedResource;
use Sanadwa\WhatsApp\Dto\Page;
use Sanadwa\WhatsApp\Exceptions\ValidationError;
use Sanadwa\WhatsApp\Http\Requester;
use Sanadwa\WhatsApp\Http\ResponseValidator;
use Sanadwa\WhatsApp\Resources\Support\ResourceSupport;

final class Contacts
{
    private const UPSERT_MAX_CONTACTS = 100;
    private const IMPORT_MAX_BYTES = 5242880;

    private readonly Requester $importRequester;

    /**
     * @param Requester|null $importRequester Used for `import()` only: a requester whose HTTP
     *     client allows a long attempt. Defaults to `$requester`.
     */
    public function __construct(
        private readonly Requester $requester,
        ?Requester $importRequester = null,
    ) {
        $this->importRequester = $importRequester ?? $requester;
    }

    /**
     * Lists the account's contacts, ordered by phone ascending, then id.
     *
     * `page` is 1-based (default 1); `limit` defaults to 50 and the API caps
     * it at 200. The returned `page` / `limit` are the values the server used.
     * There is no total: the last page is reached when it holds fewer rows
     * than `limit`.
     *
     * `tag` keeps only the contacts that carry this exact tag name (compared
     * without regard to case). There is no phone or free-text filter.
     *
     * @return Page Page whose `data` is `list<Contact>`.
     */
    public function list(?int $page = null, ?int $limit = null, ?string $tag = null): Page
    {
        $raw = $this->requester->request(
            'GET',
            '/contacts',
            ResourceSupport::pageQuery($page, $limit, ['tag' => $tag]),
        );

        return ResourceSupport::page($raw, self::mapContact(...));
    }

    /**
     * Creates or updates 1 to 100 contacts in one call.
     *
     * The phone, normalised to E.164, is the key within the account. For a
     * phone that already exists, a new first name replaces the stored one,
     * last name and email are filled only when empty, and tags are added;
     * nothing is removed. Tag names must already exist (`tags()->create()`).
     *
     * The API answers 200 even when some contacts are refused, and this
     * method does not throw for them: read each `results[i]->status`
     * (`created`, `updated`, `rejected` or `failed`) and its `error`.
     *
     * @param ContactInput|list<ContactInput> $contacts
     */
    public function upsert(
        ContactInput|array $contacts,
        ?string $idempotencyKey = null,
    ): ContactUpsertResult {
        ResourceSupport::validateIdempotencyKey($idempotencyKey);

        $inputs = $contacts instanceof ContactInput ? [$contacts] : array_values($contacts);
        $count = count($inputs);
        if ($count < 1 || $count > self::UPSERT_MAX_CONTACTS) {
            throw new ValidationError(
                message: '`contacts` must contain 1 to 100 contacts.',
                code: 'invalid_contacts',
                status: 0,
            );
        }

        $items = [];
        foreach ($inputs as $input) {
            if (!$input instanceof ContactInput) {
                throw new ValidationError(
                    message: '`contacts` must be a ContactInput or a list of ContactInput.',
                    code: 'invalid_contacts',
                    status: 0,
                );
            }
            $items[] = self::contactItem($input);
        }

        $raw = $this->requester->request(
            method: 'POST',
            path: '/contacts',
            body: ['contacts' => $items],
            idempotent: true,
            idempotencyKey: $idempotencyKey,
        );

        $data = ResourceSupport::dataObject($raw);
        $summary = ResponseValidator::requiredArray($data, 'summary', 'data.summary');

        return new ContactUpsertResult(
            summary: new ContactUpsertSummary(
                created: ResourceSupport::int($summary, 'created', 'data.summary.created'),
                updated: ResourceSupport::int($summary, 'updated', 'data.summary.updated'),
                rejected: ResourceSupport::int($summary, 'rejected', 'data.summary.rejected'),
                failed: ResourceSupport::int($summary, 'failed', 'data.summary.failed'),
            ),
            results: ResourceSupport::mapList(
                $data,
                'results',
                'data.results',
                self::mapUpsertItem(...),
            ),
        );
    }

    /**
     * Deletes a contact. A contact that has opted out of marketing messages
     * cannot be deleted: the API answers 409 `contact_opted_out`.
     */
    public function delete(string|int $id, ?string $idempotencyKey = null): DeletedResource
    {
        $pathId = ResourceSupport::pathId($id);
        ResourceSupport::validateIdempotencyKey($idempotencyKey);

        $raw = $this->requester->request(
            method: 'DELETE',
            path: '/contacts/' . $pathId,
            idempotent: true,
            idempotencyKey: $idempotencyKey,
        );

        return ResourceSupport::deletedResource($raw);
    }

    /**
     * Imports contacts from CSV content (the bytes of the file, UTF-8).
     *
     * The CSV needs a header row. Columns: `phone` (or `phone_number`,
     * `phoneNumber`), `first_name`, `last_name`, `email`, `tags` (or `tag`;
     * names separated by `,` or `;`). Limits: 5 MB, 5000 data rows, 10 tags
     * per row. `$tags` (at most 50 names) is applied to every row; every tag
     * name must already exist (`tags()->create()`).
     *
     * The API answers 200 with per-row errors, and this method does not throw
     * for them: read `errors`, where `row` is the CSV line (the header is
     * line 1).
     *
     * The API answers only when every row is handled. With the default Guzzle
     * client one attempt gets at least 300 s (`Config::IMPORT_MIN_TIMEOUT`); a
     * client you pass as `httpClient` keeps its own timeout. If an attempt
     * still times out, the import keeps running on the server and the retries
     * with the same key are answered 409 `idempotency_in_progress`
     * (`RateLimitedError`): pass your own `$idempotencyKey` and call again with
     * it later to get the stored result.
     *
     * @param string $csv CSV bytes, not a file path.
     * @param list<string> $tags
     */
    public function import(
        string $csv,
        array $tags = [],
        string $filename = 'contacts.csv',
        ?string $idempotencyKey = null,
    ): ContactImportResult {
        ResourceSupport::validateIdempotencyKey($idempotencyKey);

        if (strlen($csv) > self::IMPORT_MAX_BYTES) {
            throw new ValidationError(
                message: 'The file is larger than 5 MB. Split it into smaller files.',
                code: 'import_file_too_large',
                status: 0,
            );
        }
        foreach ($tags as $tag) {
            if (!is_string($tag) || str_contains($tag, ',')) {
                throw new ValidationError(
                    message: '`tags` names may not contain a comma: the names are sent as one comma-separated list.',
                    code: 'invalid_import_tags',
                    status: 0,
                );
            }
        }

        $parts = [[
            'name' => 'file',
            'contents' => $csv,
            'filename' => $filename,
            'headers' => ['Content-Type' => 'text/csv'],
        ]];
        if ($tags !== []) {
            $parts[] = ['name' => 'tags', 'contents' => implode(',', $tags)];
        }

        $raw = $this->importRequester->request(
            method: 'POST',
            path: '/contacts/import',
            idempotent: true,
            idempotencyKey: $idempotencyKey,
            multipart: $parts,
        );

        $data = ResourceSupport::dataObject($raw);
        $summary = ResponseValidator::requiredArray($data, 'summary', 'data.summary');

        return new ContactImportResult(
            summary: new ContactImportSummary(
                rows: ResourceSupport::int($summary, 'rows', 'data.summary.rows'),
                created: ResourceSupport::int($summary, 'created', 'data.summary.created'),
                updated: ResourceSupport::int($summary, 'updated', 'data.summary.updated'),
                rejected: ResourceSupport::int($summary, 'rejected', 'data.summary.rejected'),
                failed: ResourceSupport::int($summary, 'failed', 'data.summary.failed'),
            ),
            errors: ResourceSupport::mapList(
                $data,
                'errors',
                'data.errors',
                static fn (array $row, string $field): ContactImportError => new ContactImportError(
                    row: ResourceSupport::int($row, 'row', $field . '.row'),
                    status: ResponseValidator::requiredString($row, 'status', $field . '.status'),
                    code: ResponseValidator::requiredString($row, 'code', $field . '.code'),
                    message: ResponseValidator::requiredString($row, 'message', $field . '.message'),
                ),
            ),
        );
    }

    /**
     * The API refuses an item with any key other than these five, so unset
     * fields are left out.
     *
     * @return array<string, mixed>
     */
    private static function contactItem(ContactInput $input): array
    {
        $item = ['phone' => $input->phone];
        if ($input->firstName !== null) {
            $item['first_name'] = $input->firstName;
        }
        if ($input->lastName !== null) {
            $item['last_name'] = $input->lastName;
        }
        if ($input->email !== null) {
            $item['email'] = $input->email;
        }
        if ($input->tags !== null) {
            $item['tags'] = array_values($input->tags);
        }

        return $item;
    }

    private static function mapUpsertItem(array $row, string $field): ContactUpsertItem
    {
        $contact = ResourceSupport::nullableObject($row, 'contact', $field . '.contact');
        $error = ResourceSupport::nullableObject($row, 'error', $field . '.error');

        return new ContactUpsertItem(
            index: ResourceSupport::int($row, 'index', $field . '.index'),
            status: ResponseValidator::requiredString($row, 'status', $field . '.status'),
            contact: $contact === null ? null : self::mapContact($contact, $field . '.contact'),
            error: $error === null ? null : new ContactItemError(
                code: ResponseValidator::requiredString($error, 'code', $field . '.error.code'),
                message: ResponseValidator::requiredString($error, 'message', $field . '.error.message'),
            ),
        );
    }

    private static function mapContact(array $row, string $field): Contact
    {
        return new Contact(
            id: ResponseValidator::requiredStringOrNumber($row, 'id', $field . '.id'),
            phone: ResourceSupport::nullableString($row, 'phone', $field . '.phone'),
            firstName: ResourceSupport::nullableString($row, 'first_name', $field . '.first_name'),
            lastName: ResourceSupport::nullableString($row, 'last_name', $field . '.last_name'),
            email: ResourceSupport::nullableString($row, 'email', $field . '.email'),
            tags: ResourceSupport::stringList($row, 'tags', $field . '.tags'),
            createdAt: ResourceSupport::nullableString($row, 'created_at', $field . '.created_at'),
            updatedAt: ResourceSupport::nullableString($row, 'updated_at', $field . '.updated_at'),
        );
    }
}
