<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp;

use GuzzleHttp\Client;
use Sanadwa\WhatsApp\Dto\HealthResponse;
use Sanadwa\WhatsApp\Http\Requester;
use Sanadwa\WhatsApp\Resources\Health;
use Sanadwa\WhatsApp\Resources\Messages;
use Sanadwa\WhatsApp\Resources\Templates;
use Sanadwa\WhatsApp\Resources\Webhooks;

final class SanadWhatsApp
{
    public const VERSION = '0.2.2';

    private readonly Health $healthResource;
    private readonly Templates $templatesResource;
    private readonly Messages $messagesResource;
    private readonly Webhooks $webhooksResource;

    public function __construct(Config|array $config)
    {
        $resolved = is_array($config) ? Config::fromArray($config) : $config;
        if ($resolved->apiKey === '') {
            throw new \InvalidArgumentException('SanadWhatsApp: `apiKey` is required.');
        }

        $requester = new Requester(
            apiKey: $resolved->apiKey,
            baseUrl: $resolved->baseUrl,
            retries: $resolved->retries,
            httpClient: $resolved->httpClient ?? new Client([
                'timeout' => $resolved->timeout,
                'connect_timeout' => $resolved->connectTimeout,
            ]),
            userAgent: $resolved->userAgent
                ?? '@sanadwa/whatsapp-sdk-php/' . self::VERSION,
            sleeper: $resolved->sleeper,
        );

        $this->healthResource = new Health($requester);
        $this->templatesResource = new Templates($requester);
        $this->messagesResource = new Messages($requester);
        $this->webhooksResource = new Webhooks();
    }

    public function health(): HealthResponse
    {
        return $this->healthResource->get();
    }

    public function templates(): Templates
    {
        return $this->templatesResource;
    }

    public function messages(): Messages
    {
        return $this->messagesResource;
    }

    public function webhooks(): Webhooks
    {
        return $this->webhooksResource;
    }
}
