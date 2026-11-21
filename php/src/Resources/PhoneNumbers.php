<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Resources;

use Sanadwa\WhatsApp\Dto\ListPhoneNumbersResponse;
use Sanadwa\WhatsApp\Dto\PhoneNumber;
use Sanadwa\WhatsApp\Http\Requester;
use Sanadwa\WhatsApp\Http\ResponseValidator;
use Sanadwa\WhatsApp\Resources\Support\ResourceSupport;

final class PhoneNumbers
{
    public function __construct(private readonly Requester $requester)
    {
    }

    /**
     * Lists the account's active sending numbers, oldest first.
     *
     * Use `phoneNumberId` of a row as the sender in `messages()->send()` and
     * `campaigns()->create()`. The list is not paginated.
     */
    public function list(): ListPhoneNumbersResponse
    {
        $raw = $this->requester->request('GET', '/phone-numbers');

        return new ListPhoneNumbersResponse(
            data: ResourceSupport::dataList(
                $raw,
                static fn (array $row, string $field): PhoneNumber => new PhoneNumber(
                    phoneNumberId: ResponseValidator::requiredStringOrNumber(
                        $row,
                        'phone_number_id',
                        $field . '.phone_number_id',
                    ),
                    displayPhoneNumber: ResourceSupport::nullableString(
                        $row,
                        'display_phone_number',
                        $field . '.display_phone_number',
                    ),
                    verifiedName: ResourceSupport::nullableString(
                        $row,
                        'verified_name',
                        $field . '.verified_name',
                    ),
                    nameStatus: ResourceSupport::nullableString(
                        $row,
                        'name_status',
                        $field . '.name_status',
                    ),
                    newNameStatus: ResourceSupport::nullableString(
                        $row,
                        'new_name_status',
                        $field . '.new_name_status',
                    ),
                    wabaId: ResponseValidator::requiredStringOrNumber(
                        $row,
                        'waba_id',
                        $field . '.waba_id',
                    ),
                    qualityRating: ResourceSupport::nullableString(
                        $row,
                        'quality_rating',
                        $field . '.quality_rating',
                    ),
                    status: ResourceSupport::nullableString($row, 'status', $field . '.status'),
                ),
            ),
        );
    }
}
