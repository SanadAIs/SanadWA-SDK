<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Dto;

final class ListPhoneNumbersResponse
{
    public function __construct(
        /** @var list<PhoneNumber> */
        public readonly array $data,
    ) {
    }
}
