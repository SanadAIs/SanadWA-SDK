<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use GuzzleHttp\Psr7\Response;
use GuzzleHttp\Client;
use Illuminate\Config\Repository;
use Illuminate\Container\Container;
use Illuminate\Contracts\Foundation\CachesConfiguration;
use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Http\Requester;
use Sanadwa\WhatsApp\Laravel\SanadWhatsAppServiceProvider;
use Sanadwa\WhatsApp\SanadWhatsApp;
use Sanadwa\WhatsApp\Tests\Support\FakeHttpClient;

final class LaravelBridgeTest extends TestCase
{
    public function testProviderRegistersConfiguredSingletonAndApiKey(): void
    {
        $container = $this->container([
            'api_key' => 'pk_laravel_test',
            'base_url' => 'https://laravel.example.test/v1',
            'retries' => 1,
            'timeout' => 15.5,
            'connect_timeout' => 3.5,
        ]);
        $provider = new SanadWhatsAppServiceProvider($container);

        $provider->register();

        $first = $container->make(SanadWhatsApp::class);
        $second = $container->make(SanadWhatsApp::class);
        self::assertSame($first, $second);

        $configuredRequester = $this->requesterFrom($first);
        $apiKey = $this->privateProperty($configuredRequester, 'apiKey');
        $baseUrl = $this->privateProperty($configuredRequester, 'baseUrl');
        self::assertSame('pk_laravel_test', $apiKey);
        self::assertSame('https://laravel.example.test/v1', $baseUrl);
        $defaultClient = $this->privateProperty($configuredRequester, 'httpClient');
        self::assertInstanceOf(Client::class, $defaultClient);
        self::assertSame(15.5, $defaultClient->getConfig('timeout'));
        self::assertSame(3.5, $defaultClient->getConfig('connect_timeout'));

        $client = new FakeHttpClient([
            new Response(200, [], json_encode([
                'success' => true,
                'tenant_id' => 'tenant-laravel',
                'scope' => 'messages:send',
                'server_time' => '2026-05-10T12:00:00.000Z',
            ], JSON_THROW_ON_ERROR)),
        ]);
        $requester = new Requester(
            apiKey: $apiKey,
            baseUrl: $baseUrl,
            retries: 1,
            httpClient: $client,
            userAgent: 'laravel-bridge-test',
        );

        $requester->request('GET', '/health');

        self::assertSame(
            'Bearer pk_laravel_test',
            $client->requests[0]->getHeaderLine('Authorization'),
        );
    }

    public function testProviderResolutionFailsWithoutConfiguredApiKey(): void
    {
        $container = $this->container([]);
        $provider = new SanadWhatsAppServiceProvider($container);
        $provider->register();

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('SanadWhatsApp: `apiKey` is required.');

        $container->make(SanadWhatsApp::class);
    }

    private function container(array $sanadwaConfig): Container
    {
        $container = new class extends Container implements CachesConfiguration {
            public function configurationIsCached(): bool
            {
                return true;
            }

            public function getCachedConfigPath(): string
            {
                return '';
            }

            public function getCachedServicesPath(): string
            {
                return '';
            }
        };
        $container->instance('config', new Repository(['sanadwa' => $sanadwaConfig]));

        return $container;
    }

    private function requesterFrom(SanadWhatsApp $sdk): Requester
    {
        $messages = $this->privateProperty($sdk, 'messagesResource');
        $requester = $this->privateProperty($messages, 'requester');
        self::assertInstanceOf(Requester::class, $requester);

        return $requester;
    }

    private function privateProperty(object $object, string $property): mixed
    {
        $reflection = new \ReflectionProperty($object, $property);

        return $reflection->getValue($object);
    }
}
