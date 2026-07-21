<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Resources;

use Sanadwa\WhatsApp\Dto\HealthResponse;
use Sanadwa\WhatsApp\Http\Requester;
use Sanadwa\WhatsApp\Http\ResponseValidator;

final class Health
{
    public function __construct(private readonly Requester $requester)
    {
    }

    public function get(): HealthResponse
    {
        $raw = ResponseValidator::body($this->requester->request('GET', '/health'));

        return new HealthResponse(
            tenantId: ResponseValidator::requiredStringOrNumber($raw, 'tenant_id'),
            scope: ResponseValidator::requiredString($raw, 'scope'),
            serverTime: ResponseValidator::requiredString($raw, 'server_time'),
        );
    }
}
