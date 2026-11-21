<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Http;

use Closure;
use GuzzleHttp\Psr7\MultipartStream;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Psr7\UriResolver;
use GuzzleHttp\Psr7\Utils;
use Psr\Http\Client\ClientExceptionInterface;
use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\UriInterface;
use Sanadwa\WhatsApp\Exceptions\AuthError;
use Sanadwa\WhatsApp\Exceptions\NotFoundError;
use Sanadwa\WhatsApp\Exceptions\RateLimitedError;
use Sanadwa\WhatsApp\Exceptions\SanadApiError;
use Sanadwa\WhatsApp\Exceptions\SendFailedError;
use Sanadwa\WhatsApp\Exceptions\ServerError;
use Sanadwa\WhatsApp\Exceptions\ValidationError;

final class Requester
{
    private const MAX_REDIRECTS = 5;
    private const CURL_ERRNO_OPERATION_TIMEDOUT = 28;

    private readonly int $maxAttempts;
    private readonly Closure $sleeper;

    public function __construct(
        private readonly string $apiKey,
        private readonly string $baseUrl,
        int $retries,
        private readonly ClientInterface $httpClient,
        private readonly string $userAgent,
        ?Closure $sleeper = null,
    ) {
        $this->maxAttempts = max(1, $retries);
        $this->sleeper = $sleeper ?? static function (int $milliseconds): void {
            $microseconds = $milliseconds > intdiv(PHP_INT_MAX, 1000)
                ? PHP_INT_MAX
                : $milliseconds * 1000;
            usleep($microseconds);
        };
    }

    /**
     * @param array<string, scalar|null>|null $query Flat map; null values are dropped.
     * @param mixed $body JSON-encoded when not null.
     * @param bool $idempotent Sends `Idempotency-Key`: the caller's value, or one UUID v4 that
     *     is reused on every retry of this call.
     * @param Closure|null $onHeaders Called once with the final success response.
     * @param list<array{name: string, contents: mixed, filename?: string, headers?: array<string, string>}>|null $multipart
     *     Parts in the element format of `GuzzleHttp\Psr7\MultipartStream`. Sent as
     *     `multipart/form-data`; the stream is rebuilt for every attempt. Cannot be combined
     *     with `$body`.
     */
    public function request(
        string $method,
        string $path,
        ?array $query = null,
        mixed $body = null,
        bool $idempotent = false,
        ?Closure $onHeaders = null,
        ?string $idempotencyKey = null,
        ?array $multipart = null,
    ): mixed {
        if ($body !== null && $multipart !== null) {
            throw new \InvalidArgumentException(
                'SanadWhatsApp: `body` and `multipart` cannot be used together.',
            );
        }

        $resolvedIdempotencyKey = $idempotent
            ? ($idempotencyKey ?? self::uuidV4())
            : null;
        $url = $this->buildUrl($path, $query);
        $encodedBody = null;

        if ($body !== null) {
            try {
                $encodedBody = json_encode(
                    $body,
                    JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
                );
            } catch (\JsonException $exception) {
                throw new ValidationError(
                    message: 'Invalid request body: JSON encoding failed.',
                    code: 'invalid_request_body',
                    status: 0,
                    previous: $exception,
                );
            }
        }

        for ($attempt = 1; $attempt <= $this->maxAttempts; $attempt++) {
            $headers = [
                'Authorization' => 'Bearer ' . $this->apiKey,
                'Accept' => 'application/json',
                'User-Agent' => $this->userAgent,
            ];

            $requestBody = null;
            if ($encodedBody !== null) {
                $headers['Content-Type'] = 'application/json';
                $requestBody = Utils::streamFor($encodedBody);
            } elseif ($multipart !== null) {
                $requestBody = new MultipartStream($multipart);
                $headers['Content-Type'] = 'multipart/form-data; boundary='
                    . $requestBody->getBoundary();
            }
            if ($resolvedIdempotencyKey !== null) {
                $headers['Idempotency-Key'] = $resolvedIdempotencyKey;
            }

            $request = new Request($method, $url, $headers, $requestBody);

            try {
                $response = $this->sendFollowingRedirects($request);
            } catch (ClientExceptionInterface $exception) {
                if ($attempt < $this->maxAttempts) {
                    ($this->sleeper)(RetryPolicy::computeBackoff($attempt, null));
                    continue;
                }

                $timedOut = self::isTimeout($exception);

                throw new ServerError(
                    message: $timedOut ? 'Request timed out' : 'Network error',
                    code: $timedOut ? 'timeout' : 'network_error',
                    status: 0,
                    previous: $exception,
                );
            }

            $status = $response->getStatusCode();
            $requestIdHeader = $response->getHeaderLine('x-request-id');
            $requestId = $requestIdHeader === '' ? null : $requestIdHeader;

            if ($status >= 200 && $status < 300) {
                if ($onHeaders !== null) {
                    $onHeaders($response);
                }

                $text = (string) $response->getBody();
                if ($text === '') {
                    return null;
                }

                try {
                    return json_decode($text, true, 512, JSON_THROW_ON_ERROR);
                } catch (\JsonException $exception) {
                    throw new SanadApiError(
                        message: 'Malformed response: field `body` contains invalid JSON.',
                        code: 'malformed_response',
                        status: $status,
                        requestId: $requestId,
                        previous: $exception,
                    );
                }
            }

            $errorBody = $this->parseErrorBody($response);
            $code = self::scalarString($errorBody['code'] ?? null) ?? 'unknown_error';
            $retryAfterHeader = $response->getHeaderLine('retry-after');
            $retryAfterMs = RetryPolicy::parseRetryAfter(
                $retryAfterHeader === '' ? null : $retryAfterHeader,
            );
            $retryAfterSec = $retryAfterMs !== null
                ? (int) ceil($retryAfterMs / 1000)
                : null;

            if (RetryPolicy::isRetryable($status, $code) && $attempt < $this->maxAttempts) {
                ($this->sleeper)(RetryPolicy::computeBackoff($attempt, $retryAfterMs));
                continue;
            }

            throw $this->mapErrorResponse(
                $status,
                $errorBody,
                $requestId,
                $retryAfterSec,
                self::nonNegativeIntHeader($response, 'x-ratelimit-limit'),
                self::nonNegativeIntHeader($response, 'x-ratelimit-remaining'),
            );
        }

        throw new ServerError(
            message: 'Retry loop exhausted without response',
            code: 'retry_exhausted',
            status: 0,
        );
    }

    private function buildUrl(string $path, ?array $query): string
    {
        $base = str_ends_with($this->baseUrl, '/')
            ? substr($this->baseUrl, 0, -1)
            : $this->baseUrl;
        $normalizedPath = str_starts_with($path, '/') ? $path : '/' . $path;
        $url = $base . $normalizedPath;

        if ($query === null) {
            return $url;
        }

        $presentQuery = [];
        foreach ($query as $key => $value) {
            if ($value !== null) {
                $presentQuery[$key] = is_bool($value)
                    ? ($value ? 'true' : 'false')
                    : (string) $value;
            }
        }

        if ($presentQuery === []) {
            return $url;
        }

        return $url . '?' . http_build_query($presentQuery, '', '&', PHP_QUERY_RFC1738);
    }

    private function sendFollowingRedirects(RequestInterface $request): ResponseInterface
    {
        $redirects = 0;

        while (true) {
            $body = $request->getBody();
            if ($body->isSeekable()) {
                $body->rewind();
            }

            $response = $this->httpClient->sendRequest($request);
            $status = $response->getStatusCode();
            if (!in_array($status, [301, 302, 303, 307, 308], true)) {
                return $response;
            }

            $location = $response->getHeaderLine('location');
            if ($location === '') {
                return $response;
            }
            if ($redirects >= self::MAX_REDIRECTS) {
                $requestIdHeader = $response->getHeaderLine('x-request-id');

                throw new SanadApiError(
                    message: 'Too many redirects',
                    code: 'too_many_redirects',
                    status: $status,
                    requestId: $requestIdHeader === '' ? null : $requestIdHeader,
                );
            }

            $redirects++;
            $redirectUri = UriResolver::resolve($request->getUri(), Utils::uriFor($location));
            $nextRequest = $request->withUri($redirectUri);

            if (in_array($status, [301, 302, 303], true)) {
                $nextRequest = $nextRequest
                    ->withMethod('GET')
                    ->withBody(Utils::streamFor(''))
                    ->withoutHeader('Content-Type')
                    ->withoutHeader('Content-Length')
                    ->withoutHeader('Transfer-Encoding')
                    ->withoutHeader('Idempotency-Key');
            }

            if (!self::haveSameOrigin($request->getUri(), $redirectUri)) {
                $nextRequest = $nextRequest
                    ->withoutHeader('Authorization')
                    ->withoutHeader('Proxy-Authorization');
            }

            $request = $nextRequest;
        }
    }

    private static function haveSameOrigin(UriInterface $left, UriInterface $right): bool
    {
        return strtolower($left->getScheme()) === strtolower($right->getScheme())
            && strtolower($left->getHost()) === strtolower($right->getHost())
            && self::effectivePort($left) === self::effectivePort($right);
    }

    private static function effectivePort(UriInterface $uri): ?int
    {
        $port = $uri->getPort();
        if ($port !== null) {
            return $port;
        }

        return match (strtolower($uri->getScheme())) {
            'http' => 80,
            'https' => 443,
            default => null,
        };
    }

    private function parseErrorBody(ResponseInterface $response): array
    {
        $text = (string) $response->getBody();
        if ($text === '') {
            return [];
        }

        try {
            $decoded = json_decode($text, true, 512, JSON_THROW_ON_ERROR);

            return is_array($decoded) ? $decoded : [];
        } catch (\JsonException) {
            return [];
        }
    }

    private function mapErrorResponse(
        int $status,
        array $body,
        ?string $requestId,
        ?int $retryAfterSec,
        ?int $rateLimitLimit,
        ?int $rateLimitRemaining,
    ): SanadApiError {
        $code = self::scalarString($body['code'] ?? null) ?? 'unknown_error';
        $message = self::scalarString($body['message'] ?? null)
            ?? 'Request failed with status ' . $status;
        $messageAr = self::scalarString($body['message_ar'] ?? null);
        $details = isset($body['details']) && is_array($body['details'])
            ? $body['details']
            : [];
        $upstreamCode = self::scalarString($body['upstream_code'] ?? null);

        // First rule: `send_failed` carries WhatsApp's own status, so the status says nothing
        // about the API key, the route or the rate limit.
        if ($code === 'send_failed') {
            $metaError = $body['meta_error'] ?? null;

            return new SendFailedError(
                message: $message,
                code: $code,
                status: $status,
                requestId: $requestId,
                messageAr: $messageAr,
                details: $details,
                upstreamCode: $upstreamCode,
                rawBody: $body,
                metaError: self::isJsonObject($metaError) ? $metaError : null,
            );
        }
        if ($status === 400 || $status === 422) {
            return new ValidationError(
                message: $message,
                code: $code,
                status: $status,
                requestId: $requestId,
                messageAr: $messageAr,
                details: $details,
                upstreamCode: $upstreamCode,
                rawBody: $body,
            );
        }
        if ($status === 401 || $status === 403) {
            return new AuthError(
                message: $message,
                code: $code,
                status: $status,
                requestId: $requestId,
                messageAr: $messageAr,
                details: $details,
                upstreamCode: $upstreamCode,
                rawBody: $body,
            );
        }
        if ($status === 404) {
            return new NotFoundError(
                message: $message,
                code: $code,
                status: $status,
                requestId: $requestId,
                messageAr: $messageAr,
                details: $details,
                upstreamCode: $upstreamCode,
                rawBody: $body,
            );
        }
        if ($status === 409) {
            if ($code === 'idempotency_in_progress') {
                return new RateLimitedError(
                    message: $message,
                    code: $code,
                    status: $status,
                    requestId: $requestId,
                    retryAfterSec: $retryAfterSec,
                    messageAr: $messageAr,
                    details: $details,
                    upstreamCode: $upstreamCode,
                    rawBody: $body,
                    limit: $rateLimitLimit,
                    remaining: $rateLimitRemaining,
                );
            }

            return new ValidationError(
                message: $message,
                code: $code,
                status: $status,
                requestId: $requestId,
                messageAr: $messageAr,
                details: $details,
                upstreamCode: $upstreamCode,
                rawBody: $body,
            );
        }
        if ($status === 429) {
            return new RateLimitedError(
                message: $message,
                code: $code,
                status: $status,
                requestId: $requestId,
                retryAfterSec: $retryAfterSec,
                messageAr: $messageAr,
                details: $details,
                upstreamCode: $upstreamCode,
                rawBody: $body,
                limit: $rateLimitLimit,
                remaining: $rateLimitRemaining,
            );
        }
        if ($status >= 500 && $status < 600) {
            return new ServerError(
                message: $message,
                code: $code,
                status: $status,
                requestId: $requestId,
                upstreamCode: $upstreamCode,
                messageAr: $messageAr,
                details: $details,
                rawBody: $body,
            );
        }

        return new SanadApiError(
            message: $message,
            code: $code,
            status: $status,
            requestId: $requestId,
            messageAr: $messageAr,
            details: $details,
            upstreamCode: $upstreamCode,
            rawBody: $body,
        );
    }

    /**
     * PSR-18 has no timeout exception type. Guzzle reports the curl error number in the
     * handler context of its `ConnectException` / `RequestException`; 28 is a timeout.
     */
    private static function isTimeout(ClientExceptionInterface $exception): bool
    {
        if (!method_exists($exception, 'getHandlerContext')) {
            return false;
        }

        $context = $exception->getHandlerContext();

        return is_array($context)
            && ($context['errno'] ?? null) === self::CURL_ERRNO_OPERATION_TIMEDOUT;
    }

    private static function nonNegativeIntHeader(ResponseInterface $response, string $name): ?int
    {
        $value = trim($response->getHeaderLine($name));
        if (preg_match('/\A\d+\z/', $value) !== 1 || strlen($value) > 18) {
            return null;
        }

        return (int) $value;
    }

    private static function isJsonObject(mixed $value): bool
    {
        return is_array($value) && ($value === [] || !array_is_list($value));
    }

    private static function scalarString(mixed $value): ?string
    {
        return is_string($value) || is_int($value) || is_float($value)
            ? (string) $value
            : null;
    }

    private static function uuidV4(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);

        return sprintf(
            '%s-%s-%s-%s-%s',
            substr($hex, 0, 8),
            substr($hex, 8, 4),
            substr($hex, 12, 4),
            substr($hex, 16, 4),
            substr($hex, 20, 12),
        );
    }
}
