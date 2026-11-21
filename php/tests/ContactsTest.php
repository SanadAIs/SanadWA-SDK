<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Dto\Contact;
use Sanadwa\WhatsApp\Dto\ContactInput;
use Sanadwa\WhatsApp\Dto\ContactItemError;
use Sanadwa\WhatsApp\Dto\ContactUpsertItem;
use Sanadwa\WhatsApp\Dto\ContactUpsertResult;
use Sanadwa\WhatsApp\Dto\ContactUpsertSummary;
use Sanadwa\WhatsApp\Dto\DeletedResource;
use Sanadwa\WhatsApp\Dto\Page;
use Sanadwa\WhatsApp\Exceptions\NotFoundError;
use Sanadwa\WhatsApp\Exceptions\SanadApiError;
use Sanadwa\WhatsApp\Exceptions\ValidationError;
use Sanadwa\WhatsApp\Resources\Contacts;
use Sanadwa\WhatsApp\Tests\Support\FakeHttpClient;
use Sanadwa\WhatsApp\Tests\Support\ResourceTestSupport;

final class ContactsTest extends TestCase
{
    use ResourceTestSupport;

    private const CONTACT_ROW = [
        'id' => '7',
        'phone' => '+12025550123',
        'first_name' => 'Example',
        'last_name' => 'Person',
        'email' => null,
        'tags' => ['vip', 'newsletter'],
        'created_at' => '2026-11-20T08:00:00.000Z',
        'updated_at' => '2026-11-21T08:00:00.000Z',
    ];

    // ── list ────────────────────────────────────────────────────────────────

    public function testListWithoutOptionsSendsNoQueryAndMapsPage(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'page' => 1,
            'limit' => 50,
            'data' => [
                self::CONTACT_ROW,
                [
                    'id' => 8,
                    'phone' => null,
                    'first_name' => null,
                    'last_name' => null,
                    'email' => null,
                    'tags' => [],
                    'created_at' => null,
                    'updated_at' => null,
                ],
                ['id' => '9', 'tags' => ['vip']],
            ],
        ])]);

        $page = (new Contacts($this->requester($client)))->list();

        $request = $client->requests[0];
        self::assertSame('GET', $request->getMethod());
        self::assertSame(self::BASE_URL . '/contacts', $this->url($request));
        self::assertFalse($request->hasHeader('Idempotency-Key'));
        $this->assertNoBody($request);

        self::assertInstanceOf(Page::class, $page);
        self::assertSame(1, $page->page);
        self::assertSame(50, $page->limit);
        self::assertEquals([
            new Contact(
                id: '7',
                phone: '+12025550123',
                firstName: 'Example',
                lastName: 'Person',
                email: null,
                tags: ['vip', 'newsletter'],
                createdAt: '2026-11-20T08:00:00.000Z',
                updatedAt: '2026-11-21T08:00:00.000Z',
            ),
            new Contact('8', null, null, null, null, [], null, null),
            new Contact('9', null, null, null, null, ['vip'], null, null),
        ], $page->data);
    }

    public function testListPassesTagPageAndLimit(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'page' => 3,
            'limit' => 200,
            'data' => [],
        ])]);

        $page = (new Contacts($this->requester($client)))->list(page: 3, limit: 200, tag: 'VIP customers');

        self::assertSame(
            self::BASE_URL . '/contacts?page=3&limit=200&tag=VIP+customers',
            $this->url($client->requests[0]),
        );
        self::assertSame([], $page->data);
    }

    public function testListSendsTagAloneAndDoesNotClampLimit(): void
    {
        $client = new FakeHttpClient([
            $this->json(200, ['success' => true, 'page' => 1, 'limit' => 50, 'data' => []]),
            $this->json(200, ['success' => true, 'page' => 1, 'limit' => 200, 'data' => []]),
        ]);
        $contacts = new Contacts($this->requester($client));

        $contacts->list(tag: 'vip');
        $page = $contacts->list(limit: 500);

        self::assertSame(self::BASE_URL . '/contacts?tag=vip', $this->url($client->requests[0]));
        self::assertSame(self::BASE_URL . '/contacts?limit=500', $this->url($client->requests[1]));
        self::assertSame(200, $page->limit);
    }

    public function testListRethrowsValidationErrorUnchanged(): void
    {
        $client = new FakeHttpClient([$this->json(400, [
            'success' => false,
            'code' => 'validation_error',
            'message' => '"tag" length must be less than or equal to 100 characters long',
        ])]);

        $error = $this->captureError(
            fn () => (new Contacts($this->requester($client)))->list(tag: str_repeat('t', 101)),
        );

        self::assertInstanceOf(ValidationError::class, $error);
        self::assertSame('validation_error', $error->code);
        self::assertSame(400, $error->status);
    }

    // ── upsert ──────────────────────────────────────────────────────────────

    public function testUpsertWrapsASingleContactAndOmitsUnsetFields(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'data' => [
                'summary' => ['created' => 1, 'updated' => 0, 'rejected' => 0, 'failed' => 0],
                'results' => [[
                    'index' => 0,
                    'status' => 'created',
                    'contact' => self::CONTACT_ROW,
                    'error' => null,
                ]],
            ],
        ])]);

        $result = (new Contacts($this->requester($client)))->upsert(new ContactInput('+12025550123'));

        $request = $client->requests[0];
        self::assertSame('POST', $request->getMethod());
        self::assertSame(self::BASE_URL . '/contacts', $this->url($request));
        self::assertSame('application/json', $request->getHeaderLine('Content-Type'));
        self::assertSame(
            '{"contacts":[{"phone":"+12025550123"}]}',
            (string) $request->getBody(),
        );
        $this->assertGeneratedIdempotencyKey($request);

        self::assertInstanceOf(ContactUpsertResult::class, $result);
        self::assertEquals(new ContactUpsertSummary(1, 0, 0, 0), $result->summary);
        self::assertCount(1, $result->results);
        self::assertSame('created', $result->results[0]->status);
        self::assertSame('7', $result->results[0]->contact?->id);
        self::assertNull($result->results[0]->error);
    }

    public function testUpsertBatchKeepsOrderAndSendsOnlyTheFiveAllowedKeys(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'data' => [
                'summary' => ['created' => 2, 'updated' => 0, 'rejected' => 0, 'failed' => 0],
                'results' => [],
            ],
        ])]);

        (new Contacts($this->requester($client)))->upsert(
            [
                new ContactInput(
                    phone: '+12025550123',
                    firstName: 'Example',
                    lastName: 'Person',
                    email: 'person@example.test',
                    tags: ['vip', 'newsletter'],
                ),
                new ContactInput(phone: '+12025550124', tags: []),
            ],
            'contacts-key-1',
        );

        $request = $client->requests[0];
        self::assertSame('contacts-key-1', $request->getHeaderLine('Idempotency-Key'));
        self::assertSame(
            '{"contacts":['
            . '{"phone":"+12025550123","first_name":"Example","last_name":"Person",'
            . '"email":"person@example.test","tags":["vip","newsletter"]},'
            . '{"phone":"+12025550124","tags":[]}'
            . ']}',
            (string) $request->getBody(),
        );
        self::assertArrayNotHasKey('idempotency_key', $this->decodedBody($request));
    }

    public function testUpsertMapsMixedResultWithoutThrowing(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'data' => [
                'summary' => ['created' => 1, 'updated' => 1, 'rejected' => 1, 'failed' => 1],
                'results' => [
                    ['index' => 0, 'status' => 'created', 'contact' => self::CONTACT_ROW, 'error' => null],
                    [
                        'index' => 1,
                        'status' => 'updated',
                        'contact' => ['id' => 8, 'phone' => '+12025550124', 'tags' => []],
                    ],
                    [
                        'index' => 2,
                        'status' => 'rejected',
                        'contact' => null,
                        'error' => ['code' => 'tag_not_found', 'message' => 'Create the tag first.'],
                    ],
                    [
                        'index' => 3,
                        'status' => 'failed',
                        'contact' => null,
                        'error' => [
                            'code' => 'contact_write_failed',
                            'message' => 'This contact could not be saved. Retry it.',
                        ],
                    ],
                ],
            ],
        ])]);

        $result = (new Contacts($this->requester($client)))->upsert([
            new ContactInput('+12025550123'),
            new ContactInput('+12025550124'),
            new ContactInput('+12025550123', tags: ['missing']),
            new ContactInput('+12025550124'),
        ]);

        self::assertEquals(new ContactUpsertSummary(1, 1, 1, 1), $result->summary);
        self::assertContainsOnlyInstancesOf(ContactUpsertItem::class, $result->results);
        self::assertSame([0, 1, 2, 3], array_map(static fn ($item) => $item->index, $result->results));
        self::assertSame(
            ['created', 'updated', 'rejected', 'failed'],
            array_map(static fn ($item) => $item->status, $result->results),
        );
        self::assertSame('+12025550123', $result->results[0]->contact?->phone);
        self::assertEquals(
            new Contact('8', '+12025550124', null, null, null, [], null, null),
            $result->results[1]->contact,
        );
        self::assertNull($result->results[1]->error);
        self::assertNull($result->results[2]->contact);
        self::assertEquals(
            new ContactItemError('tag_not_found', 'Create the tag first.'),
            $result->results[2]->error,
        );
        self::assertSame('contact_write_failed', $result->results[3]->error?->code);
    }

    public function testUpsertRefusesAnEmptyListBeforeHttp(): void
    {
        $client = new FakeHttpClient([]);

        $error = $this->captureError(fn () => (new Contacts($this->requester($client)))->upsert([]));

        self::assertInstanceOf(ValidationError::class, $error);
        self::assertSame('invalid_contacts', $error->code);
        self::assertSame(0, $error->status);
        self::assertSame([], $client->requests);
    }

    public function testUpsertRefuses101ContactsBeforeHttp(): void
    {
        $client = new FakeHttpClient([]);

        $error = $this->captureError(
            fn () => (new Contacts($this->requester($client)))->upsert($this->inputs(101)),
        );

        self::assertInstanceOf(ValidationError::class, $error);
        self::assertSame('invalid_contacts', $error->code);
        self::assertSame(0, $error->status);
        self::assertSame([], $client->requests);
    }

    public function testUpsertSendsExactly100Contacts(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'data' => [
                'summary' => ['created' => 100, 'updated' => 0, 'rejected' => 0, 'failed' => 0],
                'results' => [],
            ],
        ])]);

        $result = (new Contacts($this->requester($client)))->upsert($this->inputs(100));

        self::assertCount(100, $this->decodedBody($client->requests[0])['contacts']);
        self::assertSame(100, $result->summary->created);
    }

    public function testUpsertRefusesAListItemThatIsNotAContactInput(): void
    {
        $client = new FakeHttpClient([]);

        $error = $this->captureError(
            fn () => (new Contacts($this->requester($client)))->upsert([['phone' => '+12025550123']]),
        );

        self::assertInstanceOf(ValidationError::class, $error);
        self::assertSame('invalid_contacts', $error->code);
        self::assertSame([], $client->requests);
    }

    public function testUpsertRefusesAnInvalidCallerKeyBeforeHttp(): void
    {
        $client = new FakeHttpClient([]);

        $error = $this->captureError(
            fn () => (new Contacts($this->requester($client)))->upsert(
                new ContactInput('+12025550123'),
                'has space',
            ),
        );

        self::assertSame('invalid_idempotency_key', $error->code);
        self::assertSame(0, $error->status);
        self::assertSame([], $client->requests);
    }

    public function testUpsertRethrowsPayloadTooLargeAsBaseError(): void
    {
        $client = new FakeHttpClient([$this->json(413, [
            'success' => false,
            'code' => 'PAYLOAD_TOO_LARGE',
            'message' => 'Request body is too large.',
        ])]);

        $error = $this->captureError(
            fn () => (new Contacts($this->requester($client)))->upsert(new ContactInput('+12025550123')),
        );

        self::assertSame(SanadApiError::class, $error::class);
        self::assertSame('PAYLOAD_TOO_LARGE', $error->code);
        self::assertSame(413, $error->status);
    }

    // ── delete ──────────────────────────────────────────────────────────────

    public function testDeleteSendsDeleteWithKeyAndNoBody(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'data' => ['id' => '7', 'deleted' => true],
        ])]);

        $deleted = (new Contacts($this->requester($client)))->delete(7);

        $request = $client->requests[0];
        self::assertSame('DELETE', $request->getMethod());
        self::assertSame(self::BASE_URL . '/contacts/7', $this->url($request));
        $this->assertGeneratedIdempotencyKey($request);
        $this->assertNoBody($request);
        self::assertEquals(new DeletedResource('7', true), $deleted);
    }

    public function testDeleteUsesCallerKey(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'data' => ['id' => 7, 'deleted' => true],
        ])]);

        $deleted = (new Contacts($this->requester($client)))->delete('7', 'delete-contact-1');

        self::assertSame('delete-contact-1', $client->requests[0]->getHeaderLine('Idempotency-Key'));
        self::assertSame('7', $deleted->id);
    }

    public function testDeleteEmptyIdThrowsInvalidIdBeforeHttp(): void
    {
        $client = new FakeHttpClient([]);

        $error = $this->captureError(fn () => (new Contacts($this->requester($client)))->delete(''));

        self::assertInstanceOf(ValidationError::class, $error);
        self::assertSame('invalid_id', $error->code);
        self::assertSame(0, $error->status);
        self::assertSame([], $client->requests);
    }

    public function testDeleteRethrowsNotFoundAndOptedOutUnchanged(): void
    {
        $client = new FakeHttpClient([
            $this->json(404, [
                'success' => false,
                'code' => 'contact_not_found',
                'message' => 'No contact with this id exists in your account.',
            ]),
            $this->json(409, [
                'success' => false,
                'code' => 'contact_opted_out',
                'message' => 'This contact has opted out of marketing messages.',
                'details' => ['suppression_state' => 'opted_out'],
            ]),
        ]);
        $contacts = new Contacts($this->requester($client));

        $notFound = $this->captureError(fn () => $contacts->delete('7'));
        $optedOut = $this->captureError(fn () => $contacts->delete('8'));

        self::assertInstanceOf(NotFoundError::class, $notFound);
        self::assertSame('contact_not_found', $notFound->code);
        self::assertInstanceOf(ValidationError::class, $optedOut);
        self::assertSame('contact_opted_out', $optedOut->code);
        self::assertSame(['suppression_state' => 'opted_out'], $optedOut->details);
    }

    // ── malformed responses ─────────────────────────────────────────────────

    public function testMissingOrNonArrayDataIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([
            $this->json(200, ['success' => true, 'page' => 1, 'limit' => 50]),
            $this->json(200, ['success' => true, 'page' => 1, 'limit' => 50, 'data' => 'nope']),
            $this->json(200, ['success' => true]),
            $this->json(200, ['success' => true, 'data' => 'nope']),
            $this->json(200, ['success' => true]),
        ]);
        $contacts = new Contacts($this->requester($client));
        $input = new ContactInput('+12025550123');

        $this->assertMalformed(fn () => $contacts->list(), '`data`');
        $this->assertMalformed(fn () => $contacts->list(), '`data`');
        $this->assertMalformed(fn () => $contacts->upsert($input), '`data`');
        $this->assertMalformed(fn () => $contacts->upsert($input), '`data`');
        $this->assertMalformed(fn () => $contacts->delete('7'), '`data`');
    }

    public function testMistypedRequiredFieldsAreMalformedResponses(): void
    {
        $summary = ['created' => 1, 'updated' => 0, 'rejected' => 0, 'failed' => 0];
        $client = new FakeHttpClient([
            $this->json(200, [
                'success' => true,
                'page' => 1,
                'limit' => 50,
                'data' => [['id' => '7', 'tags' => 'vip']],
            ]),
            $this->json(200, [
                'success' => true,
                'page' => 1,
                'limit' => 50,
                'data' => [['phone' => '+12025550123', 'tags' => []]],
            ]),
            $this->json(200, [
                'success' => true,
                'page' => 1,
                'limit' => 50,
                'data' => [['id' => '7', 'tags' => ['vip', 3]]],
            ]),
            $this->json(200, [
                'success' => true,
                'data' => ['summary' => ['created' => '1'] + $summary, 'results' => []],
            ]),
            $this->json(200, ['success' => true, 'data' => ['summary' => $summary]]),
            $this->json(200, [
                'success' => true,
                'data' => ['summary' => $summary, 'results' => [['index' => 0]]],
            ]),
            $this->json(200, [
                'success' => true,
                'data' => [
                    'summary' => $summary,
                    'results' => [[
                        'index' => 0,
                        'status' => 'rejected',
                        'error' => ['code' => 'validation_error'],
                    ]],
                ],
            ]),
        ]);
        $contacts = new Contacts($this->requester($client));
        $input = new ContactInput('+12025550123');

        $this->assertMalformed(fn () => $contacts->list(), '`data[0].tags`');
        $this->assertMalformed(fn () => $contacts->list(), '`data[0].id`');
        $this->assertMalformed(fn () => $contacts->list(), '`data[0].tags[1]`');
        $this->assertMalformed(fn () => $contacts->upsert($input), '`data.summary.created`');
        $this->assertMalformed(fn () => $contacts->upsert($input), '`data.results`');
        $this->assertMalformed(fn () => $contacts->upsert($input), '`data.results[0].status`');
        $this->assertMalformed(fn () => $contacts->upsert($input), '`data.results[0].error.message`');
    }

    /**
     * @return list<ContactInput>
     */
    private function inputs(int $count): array
    {
        // The SDK does not compare phones, so one fake number serves every item.
        return array_fill(0, $count, new ContactInput('+12025550123'));
    }
}
