<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Laravel\Facades;

use Sanadwa\WhatsApp\Dto\HealthResponse;
use Sanadwa\WhatsApp\Resources\Balance;
use Sanadwa\WhatsApp\Resources\Campaigns;
use Sanadwa\WhatsApp\Resources\Contacts;
use Sanadwa\WhatsApp\Resources\Messages;
use Sanadwa\WhatsApp\Resources\PhoneNumbers;
use Sanadwa\WhatsApp\Resources\Tags;
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
 * @method static PhoneNumbers phoneNumbers()
 * @method static Balance balance()
 * @method static Tags tags()
 * @method static Contacts contacts()
 * @method static Campaigns campaigns()
 */
final class SanadWhatsApp extends \Illuminate\Support\Facades\Facade
{
    protected static function getFacadeAccessor(): string
    {
        return SanadWhatsAppClient::class;
    }
}
