<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests\Support;

use GuzzleHttp\Psr7\Response;
use Psr\Http\Message\RequestInterface;
use Sanadwa\WhatsApp\Exceptions\SanadApiError;
use Sanadwa\WhatsApp\Http\Requester;

/**
 * Shared helpers for the resource tests: every resource is built directly on a
 * Requester with a fake PSR-18 client, so no test touches the network.
 */
trait ResourceTestSupport
{
    private const BASE_URL = 'https://api.example.test/v1';

    private function requester(FakeHttpClient $client, int $retries = 1): Requester
    {
        return new Requester(
            apiKey: 'pk_test_fake_key',
            baseUrl: self::BASE_URL,
            retries: $retries,
            httpClient: $client,
            userAgent: 'test',
            sleeper: static fn (int $milliseconds) => null,
        );
    }

    /**
     * @param array<string, string> $headers
     */
    private function json(int $status, array $body, array $headers = []): Response
    {
        return new Response($status, $headers, json_encode($body, JSON_THROW_ON_ERROR));
    }

    private function decodedBody(RequestInterface $request): mixed
    {
        return json_decode((string) $request->getBody(), true, 512, JSON_THROW_ON_ERROR);
    }

    private function url(RequestInterface $request): string
    {
        return (string) $request->getUri();
    }

    private function assertGeneratedIdempotencyKey(RequestInterface $request): void
    {
        self::assertMatchesRegularExpression(
            '/\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/',
            $request->getHeaderLine('Idempotency-Key'),
        );
    }

    private function assertNoBody(RequestInterface $request): void
    {
        self::assertSame('', (string) $request->getBody());
        self::assertFalse($request->hasHeader('Content-Type'));
    }

    /**
     * Runs $call and returns the SanadApiError it must throw.
     */
    private function captureError(callable $call): SanadApiError
    {
        try {
            $call();
        } catch (SanadApiError $error) {
            return $error;
        }

        self::fail('Expected SanadApiError.');
    }

    private function assertMalformed(callable $call, string $fieldFragment): void
    {
        $error = $this->captureError($call);
        self::assertSame('malformed_response', $error->code);
        self::assertSame(0, $error->status);
        self::assertStringContainsString($fieldFragment, $error->getMessage());
    }
}
