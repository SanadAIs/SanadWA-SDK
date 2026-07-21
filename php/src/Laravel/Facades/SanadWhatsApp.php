<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Laravel\Facades;

use Sanadwa\WhatsApp\Dto\HealthResponse;
use Sanadwa\WhatsApp\Resources\Messages;
use Sanadwa\WhatsApp\Resources\Templates;
use Sanadwa\WhatsApp\Resources\Webhooks;
use Sanadwa\WhatsApp\SanadWhatsApp as SanadWhatsAppClient;

if (!class_exists(\Illuminate\Support\Facades\Facade::class)) {
    return;
}

/**
 * @method static HealthResponse health()
 * @method static Templates templates()
 * @method static Messages messages()
 * @method static Webhooks webhooks()
 */
final class SanadWhatsApp extends \Illuminate\Support\Facades\Facade
{
    protected static function getFacadeAccessor(): string
    {
        return SanadWhatsAppClient::class;
    }
}
