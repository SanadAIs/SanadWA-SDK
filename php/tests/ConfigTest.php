<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use GuzzleHttp\Client;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Config;
use Sanadwa\WhatsApp\Http\Requester;
use Sanadwa\WhatsApp\SanadWhatsApp;
use Sanadwa\WhatsApp\Tests\Support\FakeHttpClient;

final class ConfigTest extends TestCase
{
    public function testTimeoutDefaultsAreAppliedToDefaultClient(): void
    {
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test']);
        $client = $this->httpClientFrom($sdk);

        self::assertInstanceOf(Client::class, $client);
        self::assertSame(30.0, $client->getConfig('timeout'));
        self::assertSame(10.0, $client->getConfig('connect_timeout'));
    }

    public function testConfiguredTimeoutsAreAppliedToDefaultClient(): void
    {
        $sdk = new SanadWhatsApp([
            'apiKey' => 'pk_test',
            'timeout' => 12.5,
            'connectTimeout' => 4,
        ]);
        $client = $this->httpClientFrom($sdk);

        self::assertInstanceOf(Client::class, $client);
        self::assertSame(12.5, $client->getConfig('timeout'));
        self::assertSame(4.0, $client->getConfig('connect_timeout'));
    }

    public function testCallerSuppliedHttpClientWinsUntouched(): void
    {
        $client = new FakeHttpClient([]);
        $sdk = new SanadWhatsApp(new Config(
            apiKey: 'pk_test',
            httpClient: $client,
            timeout: 1.0,
            connectTimeout: 1.0,
        ));

        self::assertSame($client, $this->httpClientFrom($sdk));
    }

    public function testDefaultBaseUrlIsTheShortPath(): void
    {
        $client = new FakeHttpClient([$this->healthResponse()]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test_fake_key', 'httpClient' => $client]);

        $sdk->health();

        self::assertSame('https://api.sanadwa.com/v1', Config::DEFAULT_BASE_URL);
        self::assertSame(
            'https://api.sanadwa.com/v1/health',
            (string) $client->requests[0]->getUri(),
        );
    }

    public function testExplicitOldBaseUrlIsUsedUnchanged(): void
    {
        $client = new FakeHttpClient([$this->healthResponse()]);
        $sdk = new SanadWhatsApp([
            'apiKey' => 'pk_test_fake_key',
            'baseUrl' => 'https://api.sanadwa.com/api/public/v1',
            'httpClient' => $client,
        ]);

        $sdk->health();

        self::assertSame(
            'https://api.sanadwa.com/api/public/v1/health',
            (string) $client->requests[0]->getUri(),
        );
    }

    public function testDefaultUserAgentCarriesTheReleaseVersion(): void
    {
        $client = new FakeHttpClient([$this->healthResponse()]);
        $sdk = new SanadWhatsApp(['apiKey' => 'pk_test_fake_key', 'httpClient' => $client]);

        $sdk->health();

        self::assertSame('0.4.0', SanadWhatsApp::VERSION);
        self::assertSame(
            '@sanadwa/whatsapp-sdk-php/0.4.0',
            $client->requests[0]->getHeaderLine('User-Agent'),
        );
    }

    private function healthResponse(): Response
    {
        return new Response(200, [], json_encode([
            'success' => true,
            'tenant_id' => 1,
            'scope' => 'read',
            'server_time' => '2026-11-21T10:00:00.000Z',
        ], JSON_THROW_ON_ERROR));
    }

    private function httpClientFrom(SanadWhatsApp $sdk): object
    {
        $messagesProperty = new \ReflectionProperty($sdk, 'messagesResource');
        $messages = $messagesProperty->getValue($sdk);
        $requesterProperty = new \ReflectionProperty($messages, 'requester');
        $requester = $requesterProperty->getValue($messages);
        self::assertInstanceOf(Requester::class, $requester);

        $clientProperty = new \ReflectionProperty($requester, 'httpClient');

        return $clientProperty->getValue($requester);
    }
}
