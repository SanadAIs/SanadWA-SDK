<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Laravel;

use Sanadwa\WhatsApp\Config;
use Sanadwa\WhatsApp\SanadWhatsApp;

if (!class_exists(\Illuminate\Support\ServiceProvider::class)) {
    return;
}

final class SanadWhatsAppServiceProvider extends \Illuminate\Support\ServiceProvider
{
    public function register(): void
    {
        $configPath = __DIR__ . '/../../config/sanadwa.php';
        $this->mergeConfigFrom($configPath, 'sanadwa');

        $this->app->singleton(SanadWhatsApp::class, static function ($app): SanadWhatsApp {
            $config = $app->make('config')->get('sanadwa', []);

            return new SanadWhatsApp([
                'apiKey' => $config['api_key'] ?? null,
                'baseUrl' => $config['base_url'] ?? Config::DEFAULT_BASE_URL,
                'retries' => (int) ($config['retries'] ?? 5),
                'timeout' => (float) ($config['timeout'] ?? 30.0),
                'connectTimeout' => (float) ($config['connect_timeout'] ?? 10.0),
            ]);
        });
    }

    public function boot(): void
    {
        $configPath = __DIR__ . '/../../config/sanadwa.php';
        $this->publishes([
            $configPath => config_path('sanadwa.php'),
        ], 'sanadwa-config');
    }
}
