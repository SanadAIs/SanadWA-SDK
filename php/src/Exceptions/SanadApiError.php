<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Exceptions;

class SanadApiError extends \RuntimeException
{
    private readonly string $apiCode;

    public function __construct(
        string $message,
        string $code,
        public readonly int $status,
        public readonly ?string $requestId = null,
        ?\Throwable $previous = null,
        public readonly ?string $messageAr = null,
        public readonly array $details = [],
        public readonly ?string $upstreamCode = null,
        public readonly array $rawBody = [],
    ) {
        parent::__construct($message, 0, $previous);
        $this->apiCode = $code;
    }

    public static function is(mixed $error): bool
    {
        return $error instanceof self;
    }

    public function __get(string $name): mixed
    {
        if ($name === 'code') {
            return $this->apiCode;
        }

        throw new \LogicException('Undefined property ' . self::class . '::$' . $name);
    }

    public function __isset(string $name): bool
    {
        return $name === 'code';
    }
}
