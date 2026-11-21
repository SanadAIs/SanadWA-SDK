<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Dto\Campaign;
use Sanadwa\WhatsApp\Dto\CampaignAudience;
use Sanadwa\WhatsApp\Dto\CampaignClicks;
use Sanadwa\WhatsApp\Dto\CampaignCounts;
use Sanadwa\WhatsApp\Dto\CampaignTemplate;
use Sanadwa\WhatsApp\Dto\CampaignTemplateVariable;
use Sanadwa\WhatsApp\Dto\CreateCampaignOptions;
use Sanadwa\WhatsApp\Dto\CreatedCampaign;
use Sanadwa\WhatsApp\Dto\Page;
use Sanadwa\WhatsApp\Exceptions\NotFoundError;
use Sanadwa\WhatsApp\Exceptions\SanadApiError;
use Sanadwa\WhatsApp\Exceptions\ValidationError;
use Sanadwa\WhatsApp\Resources\Campaigns;
use Sanadwa\WhatsApp\Tests\Support\FakeHttpClient;
use Sanadwa\WhatsApp\Tests\Support\ResourceTestSupport;

final class CampaignsTest extends TestCase
{
    use ResourceTestSupport;

    private const COUNTS = [
        'total' => 120,
        'queued' => 10,
        'sending' => 5,
        'sent' => 100,
        'delivered' => 90,
        'read' => 40,
        'failed' => 4,
        'canceled' => 1,
    ];

    private const CAMPAIGN_ROW = [
        'id' => '501',
        'name' => 'November offer',
        'status' => 'active',
        'pause_reason' => null,
        'phone_number_id' => '100000000000001',
        'template' => ['name' => 'november_offer', 'language' => 'en'],
        'audience' => ['type' => 'tags', 'tags' => ['newsletter', 'vip']],
        'start_at' => '2026-11-22T09:00:00.000Z',
        'created_at' => '2026-11-21T10:00:00.000Z',
        'updated_at' => '2026-11-21T10:05:00.000Z',
        'created_via' => 'api',
        'counts' => self::COUNTS,
        'clicks' => ['tracked' => 100, 'clicked' => 12],
    ];

    // ── create ──────────────────────────────────────────────────────────────

    public function testCreateSendsOnlyTheRequiredKeysAndTheCallerKeyInTheHeader(): void
    {
        $client = new FakeHttpClient([$this->json(201, [
            'success' => true,
            'code' => 'created',
            'data' => self::CAMPAIGN_ROW,
        ])]);

        $created = (new Campaigns($this->requester($client)))->create($this->options());

        self::assertCount(1, $client->requests);
        $request = $client->requests[0];
        self::assertSame('POST', $request->getMethod());
        self::assertSame(self::BASE_URL . '/campaigns', $this->url($request));
        self::assertSame('application/json', $request->getHeaderLine('Content-Type'));
        self::assertSame('campaign-key-0001', $request->getHeaderLine('Idempotency-Key'));
        self::assertSame(
            '{"name":"November offer","phone_number_id":"100000000000001",'
            . '"template":{"name":"november_offer","language":"en"},'
            . '"audience":{"tags":["vip","newsletter"]}}',
            (string) $request->getBody(),
        );

        self::assertInstanceOf(CreatedCampaign::class, $created);
        self::assertFalse($created->replayed);
        self::assertEquals($this->expectedCampaign(), $created->campaign);
    }

    public function testCreateSendsEveryOptionalKeyWhenSet(): void
    {
        $client = new FakeHttpClient([$this->json(201, ['success' => true, 'data' => self::CAMPAIGN_ROW])]);

        (new Campaigns($this->requester($client)))->create($this->options(
            templateVariables: [
                new CampaignTemplateVariable(1, 'contact.first_name'),
                new CampaignTemplateVariable(2, 'custom', '20%'),
            ],
            headerMediaUrl: 'https://cdn.example.test/offer.png',
            trackedDestinationUrl: 'https://shop.example.test/offer',
            sendAt: '2026-12-01T09:00:00+03:00',
        ));

        $body = $this->decodedBody($client->requests[0]);
        self::assertSame(
            [
                'name',
                'phone_number_id',
                'template',
                'audience',
                'template_variables',
                'header_media_url',
                'tracked_destination_url',
                'send_at',
            ],
            array_keys($body),
        );
        self::assertSame(
            [
                ['index' => 1, 'source' => 'contact.first_name'],
                ['index' => 2, 'source' => 'custom', 'value' => '20%'],
            ],
            $body['template_variables'],
        );
        self::assertSame('https://cdn.example.test/offer.png', $body['header_media_url']);
        self::assertSame('https://shop.example.test/offer', $body['tracked_destination_url']);
        self::assertSame('2026-12-01T09:00:00+03:00', $body['send_at']);
        self::assertArrayNotHasKey('idempotency_key', $body);
    }

    public function testCreateSerialisesADateTimeSendAtAsAtom(): void
    {
        $client = new FakeHttpClient([$this->json(201, ['success' => true, 'data' => self::CAMPAIGN_ROW])]);
        $sendAt = new \DateTimeImmutable('2026-12-01 09:00:00', new \DateTimeZone('+03:00'));

        (new Campaigns($this->requester($client)))->create($this->options(sendAt: $sendAt));

        self::assertSame(
            '2026-12-01T09:00:00+03:00',
            $this->decodedBody($client->requests[0])['send_at'],
        );
    }

    public function testCreateSendsAnEmptyTemplateVariablesListAsAnArray(): void
    {
        $client = new FakeHttpClient([$this->json(201, ['success' => true, 'data' => self::CAMPAIGN_ROW])]);

        (new Campaigns($this->requester($client)))->create($this->options(templateVariables: []));

        self::assertStringContainsString('"template_variables":[]', (string) $client->requests[0]->getBody());
    }

    /**
     * @return iterable<string, array{0: array<string, string>, 1: bool}>
     */
    public static function replayHeaders(): iterable
    {
        yield 'no header' => [[], false];
        yield 'true' => [['X-Idempotent-Replay' => 'true'], true];
        yield 'false' => [['X-Idempotent-Replay' => 'false'], false];
        yield 'other value' => [['X-Idempotent-Replay' => '1'], false];
    }

    /**
     * @param array<string, string> $headers
     */
    #[DataProvider('replayHeaders')]
    public function testCreateReportsReplayedOnlyForTheReplayHeader(array $headers, bool $expected): void
    {
        $client = new FakeHttpClient([$this->json(
            201,
            ['success' => true, 'code' => 'idempotent_replay', 'data' => self::CAMPAIGN_ROW],
            $headers,
        )]);

        $created = (new Campaigns($this->requester($client)))->create($this->options());

        self::assertSame($expected, $created->replayed);
        self::assertSame('501', $created->campaign->id);
    }

    public function testCreateRefusesAnEmptyKeyBeforeHttp(): void
    {
        $client = new FakeHttpClient([]);

        $error = $this->captureError(
            fn () => (new Campaigns($this->requester($client)))->create($this->options(idempotencyKey: '')),
        );

        self::assertInstanceOf(ValidationError::class, $error);
        self::assertSame('idempotency_key_required', $error->code);
        self::assertSame(0, $error->status);
        self::assertSame(
            '`idempotencyKey` is required to create a campaign. Use a unique value per campaign '
            . '(for example a UUID) and send the same value when you retry.',
            $error->getMessage(),
        );
        self::assertSame([], $client->requests);
    }

    public function testOptionsCannotBeBuiltWithoutAStringKey(): void
    {
        // PHP's own typing covers the "missing" and "not a string" cases.
        try {
            new CreateCampaignOptions(
                name: 'November offer',
                phoneNumberId: '100000000000001',
                templateName: 'november_offer',
                templateLanguage: 'en',
                audienceTags: ['vip'],
            );
            self::fail('Expected ArgumentCountError.');
        } catch (\ArgumentCountError) {
            $this->addToAssertionCount(1);
        }

        $this->expectException(\TypeError::class);
        new CreateCampaignOptions(
            name: 'November offer',
            phoneNumberId: '100000000000001',
            templateName: 'november_offer',
            templateLanguage: 'en',
            audienceTags: ['vip'],
            idempotencyKey: 12345,
        );
    }

    /**
     * @return iterable<string, array{0: string}>
     */
    public static function invalidIdempotencyKeys(): iterable
    {
        yield 'space inside' => ['has space'];
        yield 'control character' => ["tab\there"];
        yield 'non-ASCII' => ["cl\u{00E9}"];
        yield '121 characters' => [str_repeat('a', 121)];
    }

    #[DataProvider('invalidIdempotencyKeys')]
    public function testCreateRefusesAnInvalidKeyBeforeHttp(string $key): void
    {
        $client = new FakeHttpClient([]);

        $error = $this->captureError(
            fn () => (new Campaigns($this->requester($client)))->create($this->options(idempotencyKey: $key)),
        );

        self::assertInstanceOf(ValidationError::class, $error);
        self::assertSame('invalid_idempotency_key', $error->code);
        self::assertSame(0, $error->status);
        self::assertSame([], $client->requests);
    }

    public function testCreateKeepsTheCallerKeyAcrossRetries(): void
    {
        $client = new FakeHttpClient([
            $this->json(
                503,
                ['success' => false, 'code' => 'campaign_create_timeout', 'message' => 'Try again.'],
                ['Retry-After' => '60'],
            ),
            $this->json(201, ['success' => true, 'data' => self::CAMPAIGN_ROW], ['X-Idempotent-Replay' => 'true']),
        ]);

        $created = (new Campaigns($this->requester($client, retries: 2)))->create($this->options());

        self::assertCount(2, $client->requests);
        self::assertSame('campaign-key-0001', $client->requests[0]->getHeaderLine('Idempotency-Key'));
        self::assertSame('campaign-key-0001', $client->requests[1]->getHeaderLine('Idempotency-Key'));
        self::assertTrue($created->replayed);
    }

    public function testCreateRethrowsApiErrorsUnchanged(): void
    {
        $client = new FakeHttpClient([
            $this->json(402, [
                'success' => false,
                'code' => 'insufficient_credits',
                'message' => 'Your account does not have enough credits for this audience.',
                'details' => ['needed' => 120, 'remaining' => 20, 'shortfall' => 100],
            ]),
            $this->json(409, [
                'success' => false,
                'code' => 'template_not_approved',
                'message' => 'The template is not approved.',
                'details' => ['template_status' => 'PENDING'],
            ]),
        ]);
        $campaigns = new Campaigns($this->requester($client));

        $credits = $this->captureError(fn () => $campaigns->create($this->options()));
        $template = $this->captureError(fn () => $campaigns->create($this->options()));

        self::assertSame(SanadApiError::class, $credits::class);
        self::assertSame('insufficient_credits', $credits->code);
        self::assertSame(402, $credits->status);
        self::assertSame(['needed' => 120, 'remaining' => 20, 'shortfall' => 100], $credits->details);
        self::assertInstanceOf(ValidationError::class, $template);
        self::assertSame('template_not_approved', $template->code);
        self::assertSame(['template_status' => 'PENDING'], $template->details);
    }

    // ── list ────────────────────────────────────────────────────────────────

    public function testListWithoutOptionsSendsNoQueryAndMapsRowsWithoutClicks(): void
    {
        $listRow = self::CAMPAIGN_ROW;
        unset($listRow['clicks']);
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'page' => 1,
            'limit' => 50,
            'data' => [
                $listRow,
                [
                    'id' => 502,
                    'name' => 'Console draft',
                    'status' => 'some_future_status',
                    'pause_reason' => null,
                    'phone_number_id' => null,
                    'template' => null,
                    'audience' => null,
                    'start_at' => null,
                    'created_at' => null,
                    'updated_at' => null,
                    'created_via' => 'console',
                    'counts' => array_fill_keys(array_keys(self::COUNTS), 0),
                ],
            ],
        ])]);

        $page = (new Campaigns($this->requester($client)))->list();

        $request = $client->requests[0];
        self::assertSame('GET', $request->getMethod());
        self::assertSame(self::BASE_URL . '/campaigns', $this->url($request));
        self::assertFalse($request->hasHeader('Idempotency-Key'));
        $this->assertNoBody($request);

        self::assertInstanceOf(Page::class, $page);
        self::assertSame(1, $page->page);
        self::assertSame(50, $page->limit);
        self::assertEquals([
            $this->expectedCampaign(clicks: null),
            new Campaign(
                id: '502',
                name: 'Console draft',
                status: 'some_future_status',
                pauseReason: null,
                phoneNumberId: null,
                template: null,
                audience: null,
                startAt: null,
                createdAt: null,
                updatedAt: null,
                createdVia: 'console',
                counts: new CampaignCounts(0, 0, 0, 0, 0, 0, 0, 0),
                clicks: null,
            ),
        ], $page->data);
    }

    public function testListPassesPageAndLimitVerbatimWithoutClamping(): void
    {
        $client = new FakeHttpClient([
            $this->json(200, ['success' => true, 'page' => 3, 'limit' => 200, 'data' => []]),
            $this->json(200, ['success' => true, 'page' => 1, 'limit' => 200, 'data' => []]),
        ]);
        $campaigns = new Campaigns($this->requester($client));

        $first = $campaigns->list(page: 3, limit: 200);
        $second = $campaigns->list(limit: 500);

        self::assertSame(self::BASE_URL . '/campaigns?page=3&limit=200', $this->url($client->requests[0]));
        self::assertSame(self::BASE_URL . '/campaigns?limit=500', $this->url($client->requests[1]));
        self::assertSame([], $first->data);
        self::assertSame(1, $second->page);
        self::assertSame(200, $second->limit);
    }

    // ── get ─────────────────────────────────────────────────────────────────

    public function testGetMapsTheCampaignWithClicks(): void
    {
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => self::CAMPAIGN_ROW])]);

        $campaign = (new Campaigns($this->requester($client)))->get(501);

        $request = $client->requests[0];
        self::assertSame('GET', $request->getMethod());
        self::assertSame(self::BASE_URL . '/campaigns/501', $this->url($request));
        self::assertFalse($request->hasHeader('Idempotency-Key'));
        $this->assertNoBody($request);
        self::assertEquals($this->expectedCampaign(), $campaign);
    }

    public function testGetMapsPausedCampaignAndNonTagAudienceWithoutTags(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'data' => [
                'id' => '503',
                'name' => 'Paused',
                'status' => 'paused',
                'pause_reason' => 'insufficient_credits',
                'phone_number_id' => 100000000000001,
                'template' => ['name' => 'november_offer', 'language' => null],
                'audience' => ['type' => 'all_contacts'],
                'created_via' => 'console',
                'counts' => self::COUNTS,
            ],
        ])]);

        $campaign = (new Campaigns($this->requester($client)))->get('503');

        self::assertSame('paused', $campaign->status);
        self::assertSame('insufficient_credits', $campaign->pauseReason);
        self::assertSame('100000000000001', $campaign->phoneNumberId);
        self::assertEquals(new CampaignTemplate('november_offer', null), $campaign->template);
        self::assertEquals(new CampaignAudience('all_contacts', []), $campaign->audience);
        self::assertNull($campaign->startAt);
        self::assertNull($campaign->createdAt);
        self::assertNull($campaign->updatedAt);
        self::assertNull($campaign->clicks);
    }

    public function testGetRethrowsNotFoundUnchanged(): void
    {
        $client = new FakeHttpClient([$this->json(404, [
            'success' => false,
            'code' => 'campaign_not_found',
            'message' => 'No campaign with this id exists in your account.',
        ])]);

        $error = $this->captureError(fn () => (new Campaigns($this->requester($client)))->get('999'));

        self::assertInstanceOf(NotFoundError::class, $error);
        self::assertSame('campaign_not_found', $error->code);
        self::assertSame(404, $error->status);
    }

    // ── pause / resume ──────────────────────────────────────────────────────

    /**
     * @return iterable<string, array{0: string}>
     */
    public static function transitions(): iterable
    {
        yield 'pause' => ['pause'];
        yield 'resume' => ['resume'];
    }

    #[DataProvider('transitions')]
    public function testTransitionPostsWithGeneratedKeyAndNoBody(string $method): void
    {
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => self::CAMPAIGN_ROW])]);

        $campaign = (new Campaigns($this->requester($client)))->{$method}(501);

        $request = $client->requests[0];
        self::assertSame('POST', $request->getMethod());
        self::assertSame(self::BASE_URL . '/campaigns/501/' . $method, $this->url($request));
        $this->assertGeneratedIdempotencyKey($request);
        $this->assertNoBody($request);
        self::assertEquals($this->expectedCampaign(), $campaign);
    }

    #[DataProvider('transitions')]
    public function testTransitionUsesCallerKeyAndEncodesTheId(string $method): void
    {
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => self::CAMPAIGN_ROW])]);

        (new Campaigns($this->requester($client)))->{$method}('5/01', 'transition-key-1');

        $request = $client->requests[0];
        self::assertSame(self::BASE_URL . '/campaigns/5%2F01/' . $method, $this->url($request));
        self::assertSame('transition-key-1', $request->getHeaderLine('Idempotency-Key'));
    }

    #[DataProvider('transitions')]
    public function testTransitionRefusesAnInvalidCallerKeyBeforeHttp(string $method): void
    {
        $client = new FakeHttpClient([]);

        $error = $this->captureError(
            fn () => (new Campaigns($this->requester($client)))->{$method}('501', 'has space'),
        );

        self::assertSame('invalid_idempotency_key', $error->code);
        self::assertSame(0, $error->status);
        self::assertSame([], $client->requests);
    }

    public function testCampaignBusyIsNotRetried(): void
    {
        $client = new FakeHttpClient([$this->json(
            409,
            ['success' => false, 'code' => 'campaign_busy', 'message' => 'Try again shortly.'],
            ['Retry-After' => '2'],
        )]);

        $error = $this->captureError(
            fn () => (new Campaigns($this->requester($client, retries: 3)))->pause('501'),
        );

        self::assertInstanceOf(ValidationError::class, $error);
        self::assertSame('campaign_busy', $error->code);
        self::assertCount(1, $client->requests);
    }

    public function testEmptyIdThrowsInvalidIdBeforeHttp(): void
    {
        $client = new FakeHttpClient([]);
        $campaigns = new Campaigns($this->requester($client));

        foreach ([
            fn () => $campaigns->get(''),
            fn () => $campaigns->pause(''),
            fn () => $campaigns->resume(''),
        ] as $call) {
            $error = $this->captureError($call);
            self::assertInstanceOf(ValidationError::class, $error);
            self::assertSame('invalid_id', $error->code);
            self::assertSame(0, $error->status);
        }
        self::assertSame([], $client->requests);
    }

    // ── malformed responses ─────────────────────────────────────────────────

    public function testMissingOrNonArrayDataIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([
            $this->json(200, ['success' => true, 'page' => 1, 'limit' => 50]),
            $this->json(200, ['success' => true, 'page' => 1, 'limit' => 50, 'data' => 'nope']),
            $this->json(200, ['success' => true]),
            $this->json(200, ['success' => true, 'data' => 'nope']),
            $this->json(201, ['success' => true]),
            $this->json(200, ['success' => true]),
            $this->json(200, ['success' => true]),
        ]);
        $campaigns = new Campaigns($this->requester($client));

        $this->assertMalformed(fn () => $campaigns->list(), '`data`');
        $this->assertMalformed(fn () => $campaigns->list(), '`data`');
        $this->assertMalformed(fn () => $campaigns->get('501'), '`data`');
        $this->assertMalformed(fn () => $campaigns->get('501'), '`data`');
        $this->assertMalformed(fn () => $campaigns->create($this->options()), '`data`');
        $this->assertMalformed(fn () => $campaigns->pause('501'), '`data`');
        $this->assertMalformed(fn () => $campaigns->resume('501'), '`data`');
    }

    /**
     * @return iterable<string, array{0: array<string, mixed>, 1: string}>
     */
    public static function malformedCampaigns(): iterable
    {
        $without = static function (string $key): array {
            $row = self::CAMPAIGN_ROW;
            unset($row[$key]);

            return $row;
        };
        $countsWithoutCanceled = self::COUNTS;
        unset($countsWithoutCanceled['canceled']);

        yield 'missing id' => [$without('id'), '`data.id`'];
        yield 'missing name' => [$without('name'), '`data.name`'];
        yield 'missing status' => [$without('status'), '`data.status`'];
        yield 'null status' => [['status' => null] + self::CAMPAIGN_ROW, '`data.status`'];
        yield 'missing created_via' => [$without('created_via'), '`data.created_via`'];
        yield 'missing counts' => [$without('counts'), '`data.counts`'];
        yield 'missing count key' => [
            ['counts' => $countsWithoutCanceled] + self::CAMPAIGN_ROW,
            '`data.counts.canceled`',
        ];
        yield 'mistyped count' => [
            ['counts' => ['sent' => '100'] + self::COUNTS] + self::CAMPAIGN_ROW,
            '`data.counts.sent`',
        ];
        yield 'template without name' => [
            ['template' => ['language' => 'en']] + self::CAMPAIGN_ROW,
            '`data.template.name`',
        ];
        yield 'audience without type' => [
            ['audience' => ['tags' => ['vip']]] + self::CAMPAIGN_ROW,
            '`data.audience.type`',
        ];
        yield 'mistyped audience tags' => [
            ['audience' => ['type' => 'tags', 'tags' => 'vip']] + self::CAMPAIGN_ROW,
            '`data.audience.tags`',
        ];
        yield 'mistyped clicks' => [
            ['clicks' => ['tracked' => 1, 'clicked' => 'two']] + self::CAMPAIGN_ROW,
            '`data.clicks.clicked`',
        ];
        yield 'mistyped pause_reason' => [
            ['pause_reason' => 7] + self::CAMPAIGN_ROW,
            '`data.pause_reason`',
        ];
    }

    /**
     * @param array<string, mixed> $row
     */
    #[DataProvider('malformedCampaigns')]
    public function testMalformedCampaignFields(array $row, string $fieldFragment): void
    {
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => $row])]);

        $this->assertMalformed(
            fn () => (new Campaigns($this->requester($client)))->get('501'),
            $fieldFragment,
        );
    }

    public function testMalformedListRowNamesItsIndex(): void
    {
        $row = self::CAMPAIGN_ROW;
        unset($row['name']);
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'page' => 1,
            'limit' => 50,
            'data' => [self::CAMPAIGN_ROW, $row],
        ])]);

        $this->assertMalformed(
            fn () => (new Campaigns($this->requester($client)))->list(),
            '`data[1].name`',
        );
    }

    /**
     * @param list<CampaignTemplateVariable>|null $templateVariables
     */
    private function options(
        string $idempotencyKey = 'campaign-key-0001',
        ?array $templateVariables = null,
        ?string $headerMediaUrl = null,
        ?string $trackedDestinationUrl = null,
        \DateTimeInterface|string|null $sendAt = null,
    ): CreateCampaignOptions {
        return new CreateCampaignOptions(
            name: 'November offer',
            phoneNumberId: '100000000000001',
            templateName: 'november_offer',
            templateLanguage: 'en',
            audienceTags: ['vip', 'newsletter'],
            idempotencyKey: $idempotencyKey,
            templateVariables: $templateVariables,
            headerMediaUrl: $headerMediaUrl,
            trackedDestinationUrl: $trackedDestinationUrl,
            sendAt: $sendAt,
        );
    }

    private function expectedCampaign(?CampaignClicks $clicks = new CampaignClicks(100, 12)): Campaign
    {
        return new Campaign(
            id: '501',
            name: 'November offer',
            status: 'active',
            pauseReason: null,
            phoneNumberId: '100000000000001',
            template: new CampaignTemplate('november_offer', 'en'),
            audience: new CampaignAudience('tags', ['newsletter', 'vip']),
            startAt: '2026-11-22T09:00:00.000Z',
            createdAt: '2026-11-21T10:00:00.000Z',
            updatedAt: '2026-11-21T10:05:00.000Z',
            createdVia: 'api',
            counts: new CampaignCounts(120, 10, 5, 100, 90, 40, 4, 1),
            clicks: $clicks,
        );
    }
}
