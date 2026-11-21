<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Dto\ListPhoneNumbersResponse;
use Sanadwa\WhatsApp\Dto\PhoneNumber;
use Sanadwa\WhatsApp\Exceptions\AuthError;
use Sanadwa\WhatsApp\Resources\PhoneNumbers;
use Sanadwa\WhatsApp\Tests\Support\FakeHttpClient;
use Sanadwa\WhatsApp\Tests\Support\ResourceTestSupport;

final class PhoneNumbersTest extends TestCase
{
    use ResourceTestSupport;

    public function testListSendsPlainGetAndMapsAllEightFields(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'data' => [[
                'phone_number_id' => '100000000000001',
                'display_phone_number' => '+12025550123',
                'verified_name' => 'Example Store',
                'name_status' => 'APPROVED',
                'new_name_status' => 'NONE',
                'waba_id' => '200000000000002',
                'quality_rating' => 'GREEN',
                'status' => 'CONNECTED',
            ]],
        ])]);

        $response = (new PhoneNumbers($this->requester($client)))->list();

        self::assertCount(1, $client->requests);
        $request = $client->requests[0];
        self::assertSame('GET', $request->getMethod());
        self::assertSame(self::BASE_URL . '/phone-numbers', $this->url($request));
        self::assertSame('', $request->getUri()->getQuery());
        self::assertFalse($request->hasHeader('Idempotency-Key'));
        $this->assertNoBody($request);

        self::assertInstanceOf(ListPhoneNumbersResponse::class, $response);
        self::assertEquals([
            new PhoneNumber(
                phoneNumberId: '100000000000001',
                displayPhoneNumber: '+12025550123',
                verifiedName: 'Example Store',
                nameStatus: 'APPROVED',
                newNameStatus: 'NONE',
                wabaId: '200000000000002',
                qualityRating: 'GREEN',
                status: 'CONNECTED',
            ),
        ], $response->data);
    }

    public function testListMapsNullAndMissingNullableFieldsToNull(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'data' => [
                [
                    'phone_number_id' => '100000000000001',
                    'display_phone_number' => null,
                    'verified_name' => null,
                    'name_status' => null,
                    'new_name_status' => null,
                    'waba_id' => '200000000000002',
                    'quality_rating' => null,
                    'status' => null,
                ],
                // Numeric ids are coerced; absent nullable keys do not throw.
                ['phone_number_id' => 100000000000003, 'waba_id' => 200000000000004],
            ],
        ])]);

        $numbers = (new PhoneNumbers($this->requester($client)))->list()->data;

        self::assertCount(2, $numbers);
        foreach ($numbers as $number) {
            self::assertNull($number->displayPhoneNumber);
            self::assertNull($number->verifiedName);
            self::assertNull($number->nameStatus);
            self::assertNull($number->newNameStatus);
            self::assertNull($number->qualityRating);
            self::assertNull($number->status);
        }
        self::assertSame('100000000000003', $numbers[1]->phoneNumberId);
        self::assertSame('200000000000004', $numbers[1]->wabaId);
    }

    public function testListAcceptsEmptyData(): void
    {
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => []])]);

        self::assertSame([], (new PhoneNumbers($this->requester($client)))->list()->data);
    }

    public function testListRethrowsApiErrorsUnchanged(): void
    {
        $client = new FakeHttpClient([$this->json(403, [
            'success' => false,
            'code' => 'api_scope_insufficient',
            'message' => 'This API key does not have the required scope.',
        ], ['x-request-id' => 'req_fake_1'])]);

        $error = $this->captureError(
            fn () => (new PhoneNumbers($this->requester($client)))->list(),
        );

        self::assertInstanceOf(AuthError::class, $error);
        self::assertSame('api_scope_insufficient', $error->code);
        self::assertSame(403, $error->status);
        self::assertSame('req_fake_1', $error->requestId);
    }

    public function testMissingDataIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([$this->json(200, ['success' => true])]);

        $this->assertMalformed(
            fn () => (new PhoneNumbers($this->requester($client)))->list(),
            '`data`',
        );
    }

    public function testNonArrayDataIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => 'nope'])]);

        $this->assertMalformed(
            fn () => (new PhoneNumbers($this->requester($client)))->list(),
            '`data`',
        );
    }

    public function testObjectDataIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'data' => ['phone_number_id' => '1', 'waba_id' => '2'],
        ])]);

        $this->assertMalformed(
            fn () => (new PhoneNumbers($this->requester($client)))->list(),
            '`data`',
        );
    }

    public function testMistypedRequiredFieldIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'data' => [['phone_number_id' => ['x'], 'waba_id' => '200000000000002']],
        ])]);

        $this->assertMalformed(
            fn () => (new PhoneNumbers($this->requester($client)))->list(),
            '`data[0].phone_number_id`',
        );
    }

    public function testMissingRequiredFieldIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'data' => [['phone_number_id' => '100000000000001']],
        ])]);

        $this->assertMalformed(
            fn () => (new PhoneNumbers($this->requester($client)))->list(),
            '`data[0].waba_id`',
        );
    }

    public function testMistypedNullableFieldIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'data' => [[
                'phone_number_id' => '100000000000001',
                'waba_id' => '200000000000002',
                'status' => 5,
            ]],
        ])]);

        $this->assertMalformed(
            fn () => (new PhoneNumbers($this->requester($client)))->list(),
            '`data[0].status`',
        );
    }
}
