<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class HealthResponse
{
    public function __construct(
        public readonly string $tenantId,
        public readonly string $scope,
        public readonly string $serverTime,
    ) {
    }
}
