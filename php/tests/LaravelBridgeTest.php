<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use GuzzleHttp\Psr7\Response;
use GuzzleHttp\Client;
use Illuminate\Config\Repository;
use Illuminate\Container\Container;
use Illuminate\Contracts\Foundation\CachesConfiguration;
use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Config;
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

    public function testProviderFallsBackToTheDefaultBaseUrl(): void
    {
        $container = $this->container(['api_key' => 'pk_test_fake_key']);
        (new SanadWhatsAppServiceProvider($container))->register();

        $requester = $this->requesterFrom($container->make(SanadWhatsApp::class));

        self::assertSame('https://api.sanadwa.com/v1', Config::DEFAULT_BASE_URL);
        self::assertSame(
            'https://api.sanadwa.com/v1',
            $this->privateProperty($requester, 'baseUrl'),
        );
    }

    public function testConfigFileDefaultsToTheNewBaseUrl(): void
    {
        $config = $this->loadConfigFile([]);

        self::assertSame('https://api.sanadwa.com/v1', $config['base_url']);
        self::assertNull($config['api_key']);
    }

    public function testConfigFileKeepsAnExplicitOldBaseUrlUnchanged(): void
    {
        $config = $this->loadConfigFile([
            'SANAD_API_BASE_URL' => 'https://api.sanadwa.com/api/public/v1',
        ]);

        self::assertSame('https://api.sanadwa.com/api/public/v1', $config['base_url']);
    }

    public function testSanadApiKeyWinsOverSanadwaApiKey(): void
    {
        $config = $this->loadConfigFile([
            'SANAD_API_KEY' => 'pk_test_fake_key',
            'SANADWA_API_KEY' => 'pk_test_fake_fallback_key',
        ]);

        self::assertSame('pk_test_fake_key', $config['api_key']);
        self::assertSame('pk_test_fake_key', $this->resolvedApiKey($config));
    }

    public function testSanadwaApiKeyIsUsedWhenSanadApiKeyIsNotSet(): void
    {
        $config = $this->loadConfigFile(['SANADWA_API_KEY' => 'pk_test_fake_fallback_key']);

        self::assertSame('pk_test_fake_fallback_key', $config['api_key']);
        self::assertSame('pk_test_fake_fallback_key', $this->resolvedApiKey($config));
    }

    public function testResolutionFailsWhenNeitherApiKeyVariableIsSet(): void
    {
        $container = $this->container($this->loadConfigFile([]));
        (new SanadWhatsAppServiceProvider($container))->register();

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('SanadWhatsApp: `apiKey` is required.');

        $container->make(SanadWhatsApp::class);
    }

    private function resolvedApiKey(array $config): mixed
    {
        $container = $this->container($config);
        (new SanadWhatsAppServiceProvider($container))->register();

        return $this->privateProperty(
            $this->requesterFrom($container->make(SanadWhatsApp::class)),
            'apiKey',
        );
    }

    /**
     * Evaluates `config/sanadwa.php` in a separate PHP process whose environment holds exactly
     * `$environment`, with an `env()` that reads it the way Laravel's helper does for strings.
     * The Laravel helper itself needs packages this SDK does not install.
     *
     * @param array<string, string> $environment
     * @return array<string, mixed>
     */
    private function loadConfigFile(array $environment): array
    {
        $script = 'function env($key, $default = null) {'
            . ' $value = getenv($key); return $value === false ? $default : $value; }'
            . ' echo json_encode(require $argv[1], JSON_THROW_ON_ERROR);';
        $process = proc_open(
            [PHP_BINARY, '-n', '-r', $script, '--', dirname(__DIR__) . '/config/sanadwa.php'],
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
            null,
            $environment,
        );
        self::assertIsResource($process);
        $output = stream_get_contents($pipes[1]);
        $errors = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        self::assertSame(0, proc_close($process), (string) $errors);

        return json_decode((string) $output, true, 512, JSON_THROW_ON_ERROR);
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
