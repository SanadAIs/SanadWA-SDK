<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Exceptions;

final class RateLimitedError extends SanadApiError
{
    /**
     * @param int|null $retryAfterSec The server's `Retry-After` in seconds, not capped.
     * @param int|null $limit Header `X-RateLimit-Limit`; null when absent or not a
     *     non-negative integer.
     * @param int|null $remaining Header `X-RateLimit-Remaining`; null when absent or not a
     *     non-negative integer.
     */
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
        public readonly ?int $limit = null,
        public readonly ?int $remaining = null,
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
