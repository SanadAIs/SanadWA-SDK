<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Exceptions;

/**
 * Thrown whenever the API answers with code `send_failed`, whatever the HTTP status.
 * The status is WhatsApp's own status, so a 401/403 here is not about your API key.
 * Never retried automatically.
 */
final class SendFailedError extends SanadApiError
{
    /**
     * The HTTP status of the API response; always equal to `$status`. For most failures it is
     * WhatsApp's status (500 when WhatsApp gave none). It is the API's own 409 or 503 when the
     * API refused a repeat of a send whose outcome is still unresolved.
     */
    public readonly int $upstreamStatus;

    /**
     * @param array<string, mixed>|null $metaError The body's `meta_error` object as sent
     *     (`title`, `message`, `code`, `subcode`, `type`, `fbtrace_id`; also `details` for
     *     WhatsApp billing error 131042), or null when absent.
     */
    public function __construct(
        string $message,
        string $code,
        int $status,
        ?string $requestId = null,
        ?\Throwable $previous = null,
        ?string $messageAr = null,
        array $details = [],
        ?string $upstreamCode = null,
        array $rawBody = [],
        public readonly ?array $metaError = null,
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
        $this->upstreamStatus = $status;
    }
}
