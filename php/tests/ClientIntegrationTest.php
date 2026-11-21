<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Dto\Page;
use Sanadwa\WhatsApp\Dto\SendTextOptions;
use Sanadwa\WhatsApp\Exceptions\RateLimitedError;
use Sanadwa\WhatsApp\Exceptions\SendFailedError;
use Sanadwa\WhatsApp\Exceptions\ServerError;
use Sanadwa\WhatsApp\Laravel\Facades\SanadWhatsApp as SanadWhatsAppFacade;
use Sanadwa\WhatsApp\Resources\Balance;
use Sanadwa\WhatsApp\Resources\Campaigns;
use Sanadwa\WhatsApp\Resources\Contacts;
use Sanadwa\WhatsApp\Resources\PhoneNumbers;
use Sanadwa\WhatsApp\Resources\Tags;
use Sanadwa\WhatsApp\SanadWhatsApp;
use Sanadwa\WhatsApp\TestFixtures;
use Sanadwa\WhatsApp\Tests\Support\FakeHttpClient;

/**
 * The real client with a fake PSR-18 client: proves that the resources are
 * wired to one requester and behave end to end.
 */
final class ClientIntegrationTest extends TestCase
{
    private const BASE_URL = 'https://api.example.test/v1';

    public function testAccessorsReturnTheResourceClasses(): void
    {
        $sdk = $this->sdk(new FakeHttpClient([]), $sleeps);

        self::assertInstanceOf(PhoneNumbers::class, $sdk->phoneNumbers());
        self::assertInstanceOf(Balance::class, $sdk->balance());
        self::assertInstanceOf(Tags::class, $sdk->tags());
        self::assertInstanceOf(Contacts::class, $sdk->contacts());
        self::assertInstanceOf(Campaigns::class, $sdk->campaigns());
        self::assertSame($sdk->tags(), $sdk->tags());
    }

    public function testFacadeDocblockNamesEveryClientAccessor(): void
    {
        $docblock = (string) (new \ReflectionClass(SanadWhatsAppFacade::class))->getDocComment();

        $accessors = [];
        foreach ((new \ReflectionClass(SanadWhatsApp::class))->getMethods(\ReflectionMethod::IS_PUBLIC) as $method) {
            if ($method->isConstructor()) {
                continue;
            }
            $returnType = (string) $method->getReturnType();
            $shortName = substr($returnType, (int) strrpos($returnType, '\\') + 1);
            $accessors[] = $method->getName();
            self::assertStringContainsString(
                sprintf('@method static %s %s()', $shortName, $method->getName()),
                $docblock,
            );
        }

        foreach (['phoneNumbers', 'balance', 'tags', 'contacts', 'campaigns'] as $expected) {
            self::assertContains($expected, $accessors);
        }
    }

    public function testEveryNewResourceReachesItsEndpointWithTheClientKey(): void
    {
        $page = ['success' => true, 'page' => 1, 'limit' => 50, 'data' => []];
        $client = new FakeHttpClient([
            $this->json(200, ['success' => true, 'data' => []]),
            $this->json(200, $page),
            $this->json(200, $page),
            $this->json(200, $page),
        ]);
        $sdk = $this->sdk($client, $sleeps);

        $sdk->phoneNumbers()->list();
        $tags = $sdk->tags()->list();
        $contacts = $sdk->contacts()->list();
        $campaigns = $sdk->campaigns()->list();

        foreach ([$tags, $contacts, $campaigns] as $result) {
            self::assertInstanceOf(Page::class, $result);
            self::assertSame([1, 50, []], [$result->page, $result->limit, $result->data]);
        }
        self::assertSame(
            ['/v1/phone-numbers', '/v1/tags', '/v1/contacts', '/v1/campaigns'],
            array_map(static fn ($request) => $request->getUri()->getPath(), $client->requests),
        );
        foreach ($client->requests as $request) {
            self::assertSame('Bearer pk_test_fake_key', $request->getHeaderLine('Authorization'));
            self::assertFalse($request->hasHeader('Idempotency-Key'));
        }
    }

    public function testTagCreateIsRetriedAfter429WithTheSameIdempotencyKey(): void
    {
        $client = new FakeHttpClient([
            $this->json(
                429,
                ['success' => false, 'code' => 'rate_limited', 'message' => 'Too many requests.'],
                ['Retry-After' => '2'],
            ),
            $this->json(201, [
                'success' => true,
                'data' => [
                    'id' => 42,
                    'name' => 'vip',
                    'description' => null,
                    'created_at' => '2026-11-21T10:00:00.000Z',
                ],
            ]),
        ]);
        $sdk = $this->sdk($client, $sleeps);

        $tag = $sdk->tags()->create('vip');

        self::assertSame(['42', 'vip', null], [$tag->id, $tag->name, $tag->description]);
        self::assertSame([2000], $sleeps);
        self::assertCount(2, $client->requests);
        $first = $client->requests[0]->getHeaderLine('Idempotency-Key');
        self::assertMatchesRegularExpression(
            '/\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/',
            $first,
        );
        self::assertSame($first, $client->requests[1]->getHeaderLine('Idempotency-Key'));
        self::assertSame('POST', $client->requests[0]->getMethod());
        self::assertSame('{"name":"vip"}', (string) $client->requests[0]->getBody());
    }

    public function testA429ThatNeverClearsEndsAsRateLimitedErrorWithTheRateLimitHeaders(): void
    {
        $refusal = fn (): Response => $this->json(
            429,
            ['success' => false, 'code' => 'rate_limited', 'message' => 'Too many requests.'],
            ['Retry-After' => '1', 'X-RateLimit-Limit' => '60', 'X-RateLimit-Remaining' => '0'],
        );
        $client = new FakeHttpClient([$refusal(), $refusal()]);
        $sdk = $this->sdk($client, $sleeps, 2);

        try {
            $sdk->tags()->delete(42);
            self::fail('Expected RateLimitedError.');
        } catch (RateLimitedError $error) {
            self::assertSame([60, 0], [$error->limit, $error->remaining]);
            self::assertCount(2, $client->requests);
        }
    }

    #[DataProvider('sendFailedStatusProvider')]
    public function testSendFailedOnASendIsThrownAfterOneCall(int $status): void
    {
        $metaError = ['title' => 'Something went wrong', 'code' => 131000, 'fbtrace_id' => 'FAKE_TRACE'];
        $client = new FakeHttpClient([
            $this->json(
                $status,
                [
                    'success' => false,
                    'code' => 'send_failed',
                    'message' => 'WhatsApp did not accept the message.',
                    'upstream_code' => '131000',
                    'meta_error' => $metaError,
                ],
                ['Retry-After' => '1'],
            ),
            $this->json(200, [
                'success' => true,
                'message_id' => 'wamid.FAKE_SHOULD_NOT_BE_REACHED',
                'accepted_at' => '2026-11-21T10:00:00.000Z',
            ]),
        ]);
        $sdk = $this->sdk($client, $sleeps, 5);

        try {
            $sdk->messages()->sendText(new SendTextOptions('100000000000001', '+966500000000', 'Hello'));
            self::fail('Expected SendFailedError.');
        } catch (SendFailedError $error) {
            self::assertNotInstanceOf(ServerError::class, $error);
            self::assertNotInstanceOf(RateLimitedError::class, $error);
            self::assertSame('send_failed', $error->code);
            self::assertSame($status, $error->status);
            self::assertSame($status, $error->upstreamStatus);
            self::assertSame('131000', $error->upstreamCode);
            self::assertSame($metaError, $error->metaError);
        }

        self::assertCount(1, $client->requests);
        self::assertSame([], $sleeps);
    }

    public static function sendFailedStatusProvider(): iterable
    {
        yield '500' => [500];
        yield '503' => [503];
        yield '429' => [429];
        yield '409' => [409];
    }

    public function testUnknownSignedWebhookEventVerifiesThroughTheClient(): void
    {
        $client = new FakeHttpClient([]);
        $sdk = $this->sdk($client, $sleeps);
        $fixture = TestFixtures::createUnknownEventFixture();

        $result = $sdk->webhooks()->verify($fixture['rawBody'], $fixture['signature'], $fixture['secret']);

        self::assertTrue($result->valid);
        self::assertTrue($result->signatureValid);
        self::assertFalse($result->recognized);
        self::assertNull($result->reason);
        self::assertSame('campaign.completed', $result->eventType);
        self::assertNotNull($result->event);
        self::assertSame('unknown', $result->event->type);
        self::assertSame(
            ['raw' => ['campaign_id' => '42', 'completed_at' => '2026-11-21T10:00:00.000Z']],
            $result->event->data,
        );
        self::assertIsArray($result->envelope);
        self::assertSame('campaign.completed', $result->envelope['event']);
        self::assertSame([], $client->requests);

        $tampered = $sdk->webhooks()->verify(
            $fixture['rawBody'],
            $fixture['signature'],
            'whsec_another_fake_secret',
        );
        self::assertFalse($tampered->valid);
        self::assertFalse($tampered->recognized);
        self::assertSame('signature_mismatch', $tampered->reason);
    }

    /**
     * @param-out list<int> $sleeps
     */
    private function sdk(FakeHttpClient $client, ?array &$sleeps, int $retries = 3): SanadWhatsApp
    {
        $sleeps = [];

        return new SanadWhatsApp([
            'apiKey' => 'pk_test_fake_key',
            'baseUrl' => self::BASE_URL,
            'retries' => $retries,
            'httpClient' => $client,
            'sleeper' => static function (int $milliseconds) use (&$sleeps): void {
                $sleeps[] = $milliseconds;
            },
        ]);
    }

    /**
     * @param array<string, string> $headers
     */
    private function json(int $status, array $body, array $headers = []): Response
    {
        return new Response($status, $headers, json_encode($body, JSON_THROW_ON_ERROR));
    }
}
