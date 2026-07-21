<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use GuzzleHttp\Client;
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
