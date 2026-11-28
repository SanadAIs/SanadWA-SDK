<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

/**
 * `requested = optedOut + suppressed + invalidPhone + duplicate + allowlistBlocked + eligible`.
 *
 * `allowlistBlocked` is non-zero only in a test environment with a recipient
 * allowlist. `eligible` is what would reach WhatsApp.
 */
final class SendPreviewRecipients
{
    public function __construct(
        public readonly int $requested,
        public readonly int $optedOut,
        public readonly int $suppressed,
        public readonly int $invalidPhone,
        public readonly int $duplicate,
        public readonly int $allowlistBlocked,
        public readonly int $eligible,
    ) {
    }
}
