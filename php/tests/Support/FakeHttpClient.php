<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests\Support;

use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;

final class FakeHttpClient implements ClientInterface
{
    public array $requests = [];
    private array $queue;

    public function __construct(array $queue)
    {
        $this->queue = array_values($queue);
    }

    public function sendRequest(RequestInterface $request): ResponseInterface
    {
        $this->requests[] = $request;
        if ($this->queue === []) {
            throw new \RuntimeException('Fake HTTP response queue is empty.');
        }

        $next = array_shift($this->queue);
        if ($next instanceof \Throwable) {
            throw $next;
        }
        if (!$next instanceof ResponseInterface) {
            throw new \RuntimeException('Fake HTTP queue item must be a response or throwable.');
        }

        return $next;
    }
}
