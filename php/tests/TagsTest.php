<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Dto\DeletedResource;
use Sanadwa\WhatsApp\Dto\Page;
use Sanadwa\WhatsApp\Dto\Tag;
use Sanadwa\WhatsApp\Exceptions\NotFoundError;
use Sanadwa\WhatsApp\Exceptions\ValidationError;
use Sanadwa\WhatsApp\Resources\Tags;
use Sanadwa\WhatsApp\Tests\Support\FakeHttpClient;
use Sanadwa\WhatsApp\Tests\Support\ResourceTestSupport;

final class TagsTest extends TestCase
{
    use ResourceTestSupport;

    public function testListWithoutOptionsSendsNoQueryAndMapsPage(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'page' => 1,
            'limit' => 50,
            'data' => [
                [
                    'id' => '42',
                    'name' => 'vip',
                    'description' => 'Top customers',
                    'created_at' => '2026-11-20T08:00:00.000Z',
                ],
                ['id' => 43, 'name' => 'newsletter', 'description' => null, 'created_at' => null],
                ['id' => '44', 'name' => 'bare'],
            ],
        ])]);

        $page = (new Tags($this->requester($client)))->list();

        $request = $client->requests[0];
        self::assertSame('GET', $request->getMethod());
        self::assertSame(self::BASE_URL . '/tags', $this->url($request));
        self::assertFalse($request->hasHeader('Idempotency-Key'));
        $this->assertNoBody($request);

        self::assertInstanceOf(Page::class, $page);
        self::assertSame(1, $page->page);
        self::assertSame(50, $page->limit);
        self::assertEquals([
            new Tag('42', 'vip', 'Top customers', '2026-11-20T08:00:00.000Z'),
            new Tag('43', 'newsletter', null, null),
            new Tag('44', 'bare', null, null),
        ], $page->data);
    }

    public function testListPassesPageAndLimitVerbatim(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'page' => 3,
            'limit' => 200,
            'data' => [],
        ])]);

        $page = (new Tags($this->requester($client)))->list(page: 3, limit: 200);

        self::assertSame(self::BASE_URL . '/tags?page=3&limit=200', $this->url($client->requests[0]));
        self::assertSame([], $page->data);
    }

    public function testListDoesNotClampLimitAndReportsTheServerValues(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'page' => 1,
            'limit' => 200,
            'data' => [],
        ])]);

        $page = (new Tags($this->requester($client)))->list(page: 0, limit: 500);

        self::assertSame(self::BASE_URL . '/tags?page=0&limit=500', $this->url($client->requests[0]));
        self::assertSame(1, $page->page);
        self::assertSame(200, $page->limit);
    }

    public function testCreateSendsNameOnlyAndGeneratesIdempotencyKey(): void
    {
        $client = new FakeHttpClient([$this->json(201, [
            'success' => true,
            'code' => 'created',
            'data' => [
                'id' => '42',
                'name' => 'vip',
                'description' => null,
                'created_at' => '2026-11-21T10:00:00.000Z',
            ],
        ])]);

        $tag = (new Tags($this->requester($client)))->create('vip');

        $request = $client->requests[0];
        self::assertSame('POST', $request->getMethod());
        self::assertSame(self::BASE_URL . '/tags', $this->url($request));
        self::assertSame('application/json', $request->getHeaderLine('Content-Type'));
        self::assertSame(['name' => 'vip'], $this->decodedBody($request));
        $this->assertGeneratedIdempotencyKey($request);
        self::assertEquals(new Tag('42', 'vip', null, '2026-11-21T10:00:00.000Z'), $tag);
    }

    public function testCreateSendsDescriptionAndCallerKeyInHeaderOnly(): void
    {
        $client = new FakeHttpClient([$this->json(201, [
            'success' => true,
            'data' => ['id' => '42', 'name' => 'vip', 'description' => 'Top customers'],
        ])]);

        $tag = (new Tags($this->requester($client)))->create(
            name: 'vip',
            description: 'Top customers',
            idempotencyKey: 'tag-key-0001',
        );

        $request = $client->requests[0];
        self::assertSame('tag-key-0001', $request->getHeaderLine('Idempotency-Key'));
        self::assertSame(
            ['name' => 'vip', 'description' => 'Top customers'],
            $this->decodedBody($request),
        );
        self::assertSame('Top customers', $tag->description);
        self::assertNull($tag->createdAt);
    }

    public function testCreateReusesTheGeneratedKeyAcrossRetries(): void
    {
        $client = new FakeHttpClient([
            $this->json(503, ['success' => false, 'code' => 'tag_create_failed', 'message' => 'Try again.']),
            $this->json(201, ['success' => true, 'data' => ['id' => '42', 'name' => 'vip']]),
        ]);

        (new Tags($this->requester($client, retries: 2)))->create('vip');

        self::assertCount(2, $client->requests);
        $this->assertGeneratedIdempotencyKey($client->requests[0]);
        self::assertSame(
            $client->requests[0]->getHeaderLine('Idempotency-Key'),
            $client->requests[1]->getHeaderLine('Idempotency-Key'),
        );
    }

    public function testCreateRethrowsConflictUnchanged(): void
    {
        $client = new FakeHttpClient([$this->json(409, [
            'success' => false,
            'code' => 'tag_already_exists',
            'message' => 'A tag with this name already exists in your account.',
        ])]);

        $error = $this->captureError(fn () => (new Tags($this->requester($client)))->create('vip'));

        self::assertInstanceOf(ValidationError::class, $error);
        self::assertSame('tag_already_exists', $error->code);
        self::assertSame(409, $error->status);
    }

    public function testDeleteSendsDeleteWithKeyAndNoBody(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'data' => ['id' => '42', 'deleted' => true],
        ])]);

        $deleted = (new Tags($this->requester($client)))->delete(42);

        $request = $client->requests[0];
        self::assertSame('DELETE', $request->getMethod());
        self::assertSame(self::BASE_URL . '/tags/42', $this->url($request));
        $this->assertGeneratedIdempotencyKey($request);
        $this->assertNoBody($request);
        self::assertEquals(new DeletedResource('42', true), $deleted);
    }

    public function testDeleteUsesCallerKeyAndEncodesTheId(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'data' => ['id' => 42, 'deleted' => true],
        ])]);

        $deleted = (new Tags($this->requester($client)))->delete('4/2 x', 'delete-key-1');

        $request = $client->requests[0];
        self::assertSame(self::BASE_URL . '/tags/4%2F2%20x', $this->url($request));
        self::assertSame('delete-key-1', $request->getHeaderLine('Idempotency-Key'));
        self::assertSame('42', $deleted->id);
    }

    public function testDeleteRethrowsNotFoundUnchanged(): void
    {
        $client = new FakeHttpClient([$this->json(404, [
            'success' => false,
            'code' => 'tag_not_found',
            'message' => 'No tag with this id exists in your account.',
        ])]);

        $error = $this->captureError(fn () => (new Tags($this->requester($client)))->delete('42'));

        self::assertInstanceOf(NotFoundError::class, $error);
        self::assertSame('tag_not_found', $error->code);
        self::assertSame(404, $error->status);
    }

    public function testEmptyIdThrowsInvalidIdBeforeHttp(): void
    {
        $client = new FakeHttpClient([]);

        $error = $this->captureError(fn () => (new Tags($this->requester($client)))->delete(''));

        self::assertInstanceOf(ValidationError::class, $error);
        self::assertSame('invalid_id', $error->code);
        self::assertSame(0, $error->status);
        self::assertSame([], $client->requests);
    }

    /**
     * @return iterable<string, array{0: string}>
     */
    public static function invalidIdempotencyKeys(): iterable
    {
        yield 'empty' => [''];
        yield 'space inside' => ['has space'];
        yield 'control character' => ["tab\there"];
        yield 'non-ASCII' => ["cl\u{00E9}"];
        yield '121 characters' => [str_repeat('a', 121)];
    }

    #[DataProvider('invalidIdempotencyKeys')]
    public function testInvalidCallerKeyThrowsBeforeHttp(string $key): void
    {
        $client = new FakeHttpClient([]);
        $tags = new Tags($this->requester($client));

        foreach ([
            fn () => $tags->create('vip', null, $key),
            fn () => $tags->delete('42', $key),
        ] as $call) {
            $error = $this->captureError($call);
            self::assertInstanceOf(ValidationError::class, $error);
            self::assertSame('invalid_idempotency_key', $error->code);
            self::assertSame(0, $error->status);
            self::assertSame(
                '`idempotencyKey` must contain 1 to 120 visible ASCII characters.',
                $error->getMessage(),
            );
        }
        self::assertSame([], $client->requests);
    }

    public function testKeyOf120VisibleCharactersIsAccepted(): void
    {
        $key = str_repeat('k', 120);
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'data' => ['id' => '42', 'deleted' => true],
        ])]);

        (new Tags($this->requester($client)))->delete('42', $key);

        self::assertSame($key, $client->requests[0]->getHeaderLine('Idempotency-Key'));
    }

    public function testMissingDataIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([
            $this->json(200, ['success' => true, 'page' => 1, 'limit' => 50]),
            $this->json(201, ['success' => true]),
            $this->json(200, ['success' => true]),
        ]);
        $tags = new Tags($this->requester($client));

        $this->assertMalformed(fn () => $tags->list(), '`data`');
        $this->assertMalformed(fn () => $tags->create('vip'), '`data`');
        $this->assertMalformed(fn () => $tags->delete('42'), '`data`');
    }

    public function testNonArrayDataIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([
            $this->json(200, ['success' => true, 'page' => 1, 'limit' => 50, 'data' => 'nope']),
            $this->json(201, ['success' => true, 'data' => 'nope']),
        ]);
        $tags = new Tags($this->requester($client));

        $this->assertMalformed(fn () => $tags->list(), '`data`');
        $this->assertMalformed(fn () => $tags->create('vip'), '`data`');
    }

    public function testMistypedRequiredFieldsAreMalformedResponses(): void
    {
        $client = new FakeHttpClient([
            $this->json(200, [
                'success' => true,
                'page' => 1,
                'limit' => 50,
                'data' => [['id' => '42', 'name' => 7]],
            ]),
            $this->json(200, ['success' => true, 'page' => '1', 'limit' => 50, 'data' => []]),
            $this->json(201, ['success' => true, 'data' => ['name' => 'vip']]),
            $this->json(200, ['success' => true, 'data' => ['id' => '42', 'deleted' => 'yes']]),
        ]);
        $tags = new Tags($this->requester($client));

        $this->assertMalformed(fn () => $tags->list(), '`data[0].name`');
        $this->assertMalformed(fn () => $tags->list(), '`page`');
        $this->assertMalformed(fn () => $tags->create('vip'), '`data.id`');
        $this->assertMalformed(fn () => $tags->delete('42'), '`data.deleted`');
    }
}
