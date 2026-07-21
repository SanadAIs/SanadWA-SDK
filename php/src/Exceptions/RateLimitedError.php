<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Exceptions;

final class RateLimitedError extends SanadApiError
{
    public function __construct(
        string $message,
        string $code,
        int $status,
        ?string $requestId = null,
        public readonly ?int $retryAfterSec = null,
        ?\Throwable $previous = null,
        ?string $messageAr = null,
        array $details = [],
        ?string $upstreamCode = null,
        array $rawBody = [],
    ) {
        parent::__construct(
            $message,
            $code,
            $status,
            $requestId,
            $previous,
            $messageAr,
            $details,
            $upstreamCode,
            $rawBody,
        );
    }
}
