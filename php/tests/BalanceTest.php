<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Dto\CreditBalance;
use Sanadwa\WhatsApp\Dto\CreditUsage;
use Sanadwa\WhatsApp\Exceptions\ServerError;
use Sanadwa\WhatsApp\Resources\Balance;
use Sanadwa\WhatsApp\Tests\Support\FakeHttpClient;
use Sanadwa\WhatsApp\Tests\Support\ResourceTestSupport;

final class BalanceTest extends TestCase
{
    use ResourceTestSupport;

    public function testGetSendsPlainGetAndMapsEveryField(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'data' => $this->balancePayload(),
        ])]);

        $balance = (new Balance($this->requester($client)))->get();

        self::assertCount(1, $client->requests);
        $request = $client->requests[0];
        self::assertSame('GET', $request->getMethod());
        self::assertSame(self::BASE_URL . '/balance', $this->url($request));
        self::assertFalse($request->hasHeader('Idempotency-Key'));
        $this->assertNoBody($request);

        self::assertEquals(new CreditBalance(
            billingType: 'prepaid',
            availableCredits: 1250,
            paidCreditsRemaining: 1000.5,
            freeCreditsRemaining: 250,
            unlimited: false,
            unlimitedUntil: null,
            usageThisMonth: new CreditUsage(
                periodStart: '2026-11-01',
                creditsUsed: 340,
                marketing: 300,
                utility: 30,
                authentication: 10,
                service: 0,
            ),
            asOf: '2026-11-21T10:00:00.000Z',
        ), $balance);
        self::assertSame(1250, $balance->availableCredits);
        self::assertSame(1000.5, $balance->paidCreditsRemaining);
    }

    public function testGetMapsNullableFieldsAsNull(): void
    {
        $payload = $this->balancePayload();
        $payload['billing_type'] = 'postpaid';
        $payload['available_credits'] = null;
        $payload['paid_credits_remaining'] = null;
        $payload['unlimited_until'] = null;
        $payload['as_of'] = null;
        $payload['usage_this_month']['period_start'] = null;
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => $payload])]);

        $balance = (new Balance($this->requester($client)))->get();

        self::assertSame('postpaid', $balance->billingType);
        self::assertNull($balance->availableCredits);
        self::assertNull($balance->paidCreditsRemaining);
        self::assertNull($balance->unlimitedUntil);
        self::assertNull($balance->asOf);
        self::assertNull($balance->usageThisMonth->periodStart);
        self::assertSame(340, $balance->usageThisMonth->creditsUsed);
    }

    public function testGetDoesNotThrowWhenNullableKeysAreMissing(): void
    {
        $payload = $this->balancePayload();
        unset(
            $payload['available_credits'],
            $payload['paid_credits_remaining'],
            $payload['unlimited_until'],
            $payload['as_of'],
            $payload['usage_this_month']['period_start'],
        );
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => $payload])]);

        $balance = (new Balance($this->requester($client)))->get();

        self::assertNull($balance->availableCredits);
        self::assertNull($balance->paidCreditsRemaining);
        self::assertNull($balance->unlimitedUntil);
        self::assertNull($balance->asOf);
        self::assertNull($balance->usageThisMonth->periodStart);
    }

    public function testGetMapsUnlimitedWithDate(): void
    {
        $payload = $this->balancePayload();
        $payload['unlimited'] = true;
        $payload['unlimited_until'] = '2026-12-31T23:59:59.000Z';
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => $payload])]);

        $balance = (new Balance($this->requester($client)))->get();

        self::assertTrue($balance->unlimited);
        self::assertSame('2026-12-31T23:59:59.000Z', $balance->unlimitedUntil);
    }

    public function testGetRethrowsApiErrorsUnchanged(): void
    {
        $client = new FakeHttpClient([$this->json(500, [
            'success' => false,
            'code' => 'balance_lookup_failed',
            'message' => 'The balance could not be read.',
        ])]);

        $error = $this->captureError(fn () => (new Balance($this->requester($client)))->get());

        self::assertInstanceOf(ServerError::class, $error);
        self::assertSame('balance_lookup_failed', $error->code);
        self::assertSame(500, $error->status);
    }

    public function testMissingDataIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([$this->json(200, ['success' => true])]);

        $this->assertMalformed(fn () => (new Balance($this->requester($client)))->get(), '`data`');
    }

    public function testNonArrayDataIsMalformedResponse(): void
    {
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => 12])]);

        $this->assertMalformed(fn () => (new Balance($this->requester($client)))->get(), '`data`');
    }

    /**
     * @return iterable<string, array{0: callable(array): array, 1: string}>
     */
    public static function malformedPayloads(): iterable
    {
        yield 'missing billing_type' => [
            static function (array $p): array {
                unset($p['billing_type']);

                return $p;
            },
            '`data.billing_type`',
        ];
        yield 'free credits as string' => [
            static function (array $p): array {
                $p['free_credits_remaining'] = '250';

                return $p;
            },
            '`data.free_credits_remaining`',
        ];
        yield 'unlimited as number' => [
            static function (array $p): array {
                $p['unlimited'] = 1;

                return $p;
            },
            '`data.unlimited`',
        ];
        yield 'missing usage' => [
            static function (array $p): array {
                unset($p['usage_this_month']);

                return $p;
            },
            '`data.usage_this_month`',
        ];
        yield 'missing usage number' => [
            static function (array $p): array {
                unset($p['usage_this_month']['service']);

                return $p;
            },
            '`data.usage_this_month.service`',
        ];
        yield 'available credits as string' => [
            static function (array $p): array {
                $p['available_credits'] = 'many';

                return $p;
            },
            '`data.available_credits`',
        ];
    }

    #[DataProvider('malformedPayloads')]
    public function testMalformedBalanceFields(callable $mutate, string $field): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'data' => $mutate($this->balancePayload()),
        ])]);

        $this->assertMalformed(fn () => (new Balance($this->requester($client)))->get(), $field);
    }

    private function balancePayload(): array
    {
        return [
            'billing_type' => 'prepaid',
            'available_credits' => 1250,
            'paid_credits_remaining' => 1000.5,
            'free_credits_remaining' => 250,
            'unlimited' => false,
            'unlimited_until' => null,
            'usage_this_month' => [
                'period_start' => '2026-11-01',
                'credits_used' => 340,
                'marketing' => 300,
                'utility' => 30,
                'authentication' => 10,
                'service' => 0,
            ],
            'as_of' => '2026-11-21T10:00:00.000Z',
        ];
    }
}
