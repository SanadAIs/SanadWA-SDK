<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp;

use Closure;
use Psr\Http\Client\ClientInterface;

final class Config
{
    public const DEFAULT_BASE_URL = 'https://api.sanadwa.com/api/public/v1';

    public function __construct(
        public readonly string $apiKey,
        public readonly string $baseUrl = self::DEFAULT_BASE_URL,
        public readonly int $retries = 5,
        public readonly ?ClientInterface $httpClient = null,
        public readonly ?string $userAgent = null,
        public readonly ?Closure $sleeper = null,
        public readonly float $timeout = 30.0,
        public readonly float $connectTimeout = 10.0,
    ) {
        if ($this->apiKey === '') {
            throw new \InvalidArgumentException('SanadWhatsApp: `apiKey` is required.');
        }
        if (!is_finite($this->timeout) || $this->timeout < 0) {
            throw new \InvalidArgumentException(
                'SanadWhatsApp: `timeout` must be a non-negative finite number.',
            );
        }
        if (!is_finite($this->connectTimeout) || $this->connectTimeout < 0) {
            throw new \InvalidArgumentException(
                'SanadWhatsApp: `connectTimeout` must be a non-negative finite number.',
            );
        }
    }

    public static function fromArray(array $config): self
    {
        if (!isset($config['apiKey']) || !is_string($config['apiKey']) || $config['apiKey'] === '') {
            throw new \InvalidArgumentException('SanadWhatsApp: `apiKey` is required.');
        }

        $baseUrl = $config['baseUrl'] ?? self::DEFAULT_BASE_URL;
        $retries = $config['retries'] ?? 5;
        $httpClient = $config['httpClient'] ?? null;
        $userAgent = $config['userAgent'] ?? null;
        $sleeper = $config['sleeper'] ?? null;
        $timeout = $config['timeout'] ?? 30.0;
        $connectTimeout = $config['connectTimeout'] ?? 10.0;

        if (!is_string($baseUrl)) {
            throw new \InvalidArgumentException('SanadWhatsApp: `baseUrl` must be a string.');
        }
        if (!is_int($retries)) {
            throw new \InvalidArgumentException('SanadWhatsApp: `retries` must be an integer.');
        }
        if ($httpClient !== null && !$httpClient instanceof ClientInterface) {
            throw new \InvalidArgumentException('SanadWhatsApp: `httpClient` must implement ClientInterface.');
        }
        if ($userAgent !== null && !is_string($userAgent)) {
            throw new \InvalidArgumentException('SanadWhatsApp: `userAgent` must be a string.');
        }
        if ($sleeper !== null && !$sleeper instanceof Closure) {
            throw new \InvalidArgumentException('SanadWhatsApp: `sleeper` must be a Closure.');
        }
        if (!is_int($timeout) && !is_float($timeout)) {
            throw new \InvalidArgumentException('SanadWhatsApp: `timeout` must be a number.');
        }
        if (!is_int($connectTimeout) && !is_float($connectTimeout)) {
            throw new \InvalidArgumentException(
                'SanadWhatsApp: `connectTimeout` must be a number.',
            );
        }

        return new self(
            apiKey: $config['apiKey'],
            baseUrl: $baseUrl,
            retries: $retries,
            httpClient: $httpClient,
            userAgent: $userAgent,
            sleeper: $sleeper,
            timeout: (float) $timeout,
            connectTimeout: (float) $connectTimeout,
        );
    }
}
