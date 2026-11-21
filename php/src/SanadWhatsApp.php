<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp;

use GuzzleHttp\Client;
use Psr\Http\Client\ClientInterface;
use Sanadwa\WhatsApp\Dto\HealthResponse;
use Sanadwa\WhatsApp\Http\Requester;
use Sanadwa\WhatsApp\Resources\Balance;
use Sanadwa\WhatsApp\Resources\Campaigns;
use Sanadwa\WhatsApp\Resources\Contacts;
use Sanadwa\WhatsApp\Resources\Health;
use Sanadwa\WhatsApp\Resources\Messages;
use Sanadwa\WhatsApp\Resources\PhoneNumbers;
use Sanadwa\WhatsApp\Resources\Tags;
use Sanadwa\WhatsApp\Resources\Templates;
use Sanadwa\WhatsApp\Resources\Webhooks;

final class SanadWhatsApp
{
    public const VERSION = '0.4.0';

    private readonly Health $healthResource;
    private readonly Templates $templatesResource;
    private readonly Messages $messagesResource;
    private readonly Webhooks $webhooksResource;
    private readonly PhoneNumbers $phoneNumbersResource;
    private readonly Balance $balanceResource;
    private readonly Tags $tagsResource;
    private readonly Contacts $contactsResource;
    private readonly Campaigns $campaignsResource;

    public function __construct(Config|array $config)
    {
        $resolved = is_array($config) ? Config::fromArray($config) : $config;
        if ($resolved->apiKey === '') {
            throw new \InvalidArgumentException('SanadWhatsApp: `apiKey` is required.');
        }

        $userAgent = $resolved->userAgent ?? '@sanadwa/whatsapp-sdk-php/' . self::VERSION;
        $newRequester = static fn (ClientInterface $httpClient): Requester => new Requester(
            apiKey: $resolved->apiKey,
            baseUrl: $resolved->baseUrl,
            retries: $resolved->retries,
            httpClient: $httpClient,
            userAgent: $userAgent,
            sleeper: $resolved->sleeper,
        );

        $requester = $newRequester($resolved->httpClient ?? new Client([
            'timeout' => $resolved->timeout,
            'connect_timeout' => $resolved->connectTimeout,
        ]));
        // A caller-supplied client owns its timeouts; the default one gets a longer
        // timeout for the CSV import, which answers only when every row is handled.
        $importRequester = $resolved->httpClient !== null
            ? $requester
            : $newRequester(new Client([
                'timeout' => $resolved->timeout > 0.0
                    ? max($resolved->timeout, Config::IMPORT_MIN_TIMEOUT)
                    : 0.0,
                'connect_timeout' => $resolved->connectTimeout,
            ]));

        $this->healthResource = new Health($requester);
        $this->templatesResource = new Templates($requester);
        $this->messagesResource = new Messages($requester);
        $this->webhooksResource = new Webhooks();
        $this->phoneNumbersResource = new PhoneNumbers($requester);
        $this->balanceResource = new Balance($requester);
        $this->tagsResource = new Tags($requester);
        $this->contactsResource = new Contacts($requester, $importRequester);
        $this->campaignsResource = new Campaigns($requester);
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

    public function phoneNumbers(): PhoneNumbers
    {
        return $this->phoneNumbersResource;
    }

    public function balance(): Balance
    {
        return $this->balanceResource;
    }

    public function tags(): Tags
    {
        return $this->tagsResource;
    }

    public function contacts(): Contacts
    {
        return $this->contactsResource;
    }

    public function campaigns(): Campaigns
    {
        return $this->campaignsResource;
    }
}
