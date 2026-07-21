<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Exceptions;

final class ServerError extends SanadApiError
{
    public function __construct(
        string $message,
        string $code,
        int $status,
        ?string $requestId = null,
        ?string $upstreamCode = null,
        ?\Throwable $previous = null,
        ?string $messageAr = null,
        array $details = [],
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
