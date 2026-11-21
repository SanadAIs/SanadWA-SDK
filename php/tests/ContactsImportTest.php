<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use PHPUnit\Framework\TestCase;
use Psr\Http\Message\RequestInterface;
use Sanadwa\WhatsApp\Dto\ContactImportError;
use Sanadwa\WhatsApp\Dto\ContactImportResult;
use Sanadwa\WhatsApp\Dto\ContactImportSummary;
use Sanadwa\WhatsApp\Exceptions\NotFoundError;
use Sanadwa\WhatsApp\Exceptions\SanadApiError;
use Sanadwa\WhatsApp\Exceptions\ValidationError;
use Sanadwa\WhatsApp\Resources\Contacts;
use Sanadwa\WhatsApp\Tests\Support\FakeHttpClient;
use Sanadwa\WhatsApp\Tests\Support\ResourceTestSupport;

/**
 * The cases that reach HTTP need the requester's `multipart` parameter
 * (transport support added in the same release).
 */
final class ContactsImportTest extends TestCase
{
    use ResourceTestSupport;

    private const CSV = "phone,first_name,tags\n+12025550123,Example,vip\n+12025550124,Other,\n";
    private const MAX_BYTES = 5242880;

    private const EMPTY_RESULT = [
        'success' => true,
        'data' => [
            'summary' => ['rows' => 2, 'created' => 2, 'updated' => 0, 'rejected' => 0, 'failed' => 0],
            'errors' => [],
        ],
    ];

    public function testImportGoesThroughTheImportRequesterAndOtherCallsDoNot(): void
    {
        $general = new FakeHttpClient([
            $this->json(200, ['success' => true, 'page' => 1, 'limit' => 50, 'data' => []]),
        ]);
        $slow = new FakeHttpClient([$this->json(200, self::EMPTY_RESULT)]);
        $contacts = new Contacts($this->requester($general), $this->requester($slow));

        $contacts->import(self::CSV);
        $contacts->list();

        self::assertCount(1, $slow->requests);
        self::assertSame(self::BASE_URL . '/contacts/import', $this->url($slow->requests[0]));
        self::assertCount(1, $general->requests);
        self::assertSame(self::BASE_URL . '/contacts', $this->url($general->requests[0]));
    }

    public function testImportSendsMultipartFileWithDefaultFilenameAndNoTagsPart(): void
    {
        $client = new FakeHttpClient([$this->json(200, self::EMPTY_RESULT)]);

        $result = (new Contacts($this->requester($client)))->import(self::CSV);

        self::assertCount(1, $client->requests);
        $request = $client->requests[0];
        self::assertSame('POST', $request->getMethod());
        self::assertSame(self::BASE_URL . '/contacts/import', $this->url($request));
        $this->assertGeneratedIdempotencyKey($request);

        $parts = $this->multipartParts($request);
        self::assertSame(['file'], array_keys($parts));
        self::assertSame('contacts.csv', $parts['file']['filename']);
        self::assertSame('text/csv', $parts['file']['contentType']);
        self::assertSame(self::CSV, $parts['file']['contents']);

        self::assertInstanceOf(ContactImportResult::class, $result);
        self::assertEquals(new ContactImportSummary(2, 2, 0, 0, 0), $result->summary);
        self::assertSame([], $result->errors);
    }

    public function testImportHonoursFilenameTagsAndCallerKey(): void
    {
        $client = new FakeHttpClient([$this->json(200, self::EMPTY_RESULT)]);

        (new Contacts($this->requester($client)))->import(
            csv: self::CSV,
            tags: ['vip', 'newsletter'],
            filename: 'november list.csv',
            idempotencyKey: 'import-key-1',
        );

        $request = $client->requests[0];
        self::assertSame('import-key-1', $request->getHeaderLine('Idempotency-Key'));

        $parts = $this->multipartParts($request);
        self::assertSame(['file', 'tags'], array_keys($parts));
        self::assertSame('november list.csv', $parts['file']['filename']);
        self::assertSame('text/csv', $parts['file']['contentType']);
        self::assertSame(self::CSV, $parts['file']['contents']);
        self::assertNull($parts['tags']['filename']);
        self::assertSame('vip,newsletter', $parts['tags']['contents']);
        self::assertStringNotContainsString('idempotency_key', (string) $request->getBody());
    }

    public function testImportMapsSummaryAndRowErrorsWithoutThrowing(): void
    {
        $client = new FakeHttpClient([$this->json(200, [
            'success' => true,
            'data' => [
                'summary' => ['rows' => 4, 'created' => 1, 'updated' => 1, 'rejected' => 1, 'failed' => 1],
                'errors' => [
                    [
                        'row' => 3,
                        'status' => 'rejected',
                        'code' => 'validation_error',
                        'message' => '"phone" is required.',
                    ],
                    [
                        'row' => 5,
                        'status' => 'failed',
                        'code' => 'contact_write_failed',
                        'message' => 'This contact could not be saved. Retry it.',
                    ],
                ],
            ],
        ])]);

        $result = (new Contacts($this->requester($client)))->import(self::CSV);

        self::assertEquals(new ContactImportSummary(4, 1, 1, 1, 1), $result->summary);
        self::assertEquals([
            new ContactImportError(3, 'rejected', 'validation_error', '"phone" is required.'),
            new ContactImportError(
                5,
                'failed',
                'contact_write_failed',
                'This contact could not be saved. Retry it.',
            ),
        ], $result->errors);
    }

    public function testImportSendsAFileOfExactlyTheMaximumSize(): void
    {
        $client = new FakeHttpClient([$this->json(200, self::EMPTY_RESULT)]);
        $csv = "phone\n" . str_repeat('1', self::MAX_BYTES - 6);
        self::assertSame(self::MAX_BYTES, strlen($csv));

        (new Contacts($this->requester($client)))->import($csv);

        self::assertCount(1, $client->requests);
        self::assertSame(
            self::MAX_BYTES,
            strlen($this->multipartParts($client->requests[0])['file']['contents']),
        );
    }

    public function testImportRefusesAFileOneByteOverTheMaximumBeforeHttp(): void
    {
        $client = new FakeHttpClient([]);
        $csv = str_repeat('1', self::MAX_BYTES + 1);

        $error = $this->captureError(fn () => (new Contacts($this->requester($client)))->import($csv));

        self::assertInstanceOf(ValidationError::class, $error);
        self::assertSame('import_file_too_large', $error->code);
        self::assertSame(0, $error->status);
        self::assertSame([], $client->requests);
    }

    public function testImportRefusesATagContainingACommaBeforeHttp(): void
    {
        $client = new FakeHttpClient([]);

        $error = $this->captureError(
            fn () => (new Contacts($this->requester($client)))->import(self::CSV, ['vip', 'a,b']),
        );

        self::assertInstanceOf(ValidationError::class, $error);
        self::assertSame('invalid_import_tags', $error->code);
        self::assertSame(0, $error->status);
        self::assertSame([], $client->requests);
    }

    public function testImportRefusesANonStringTagBeforeHttp(): void
    {
        $client = new FakeHttpClient([]);

        $error = $this->captureError(
            fn () => (new Contacts($this->requester($client)))->import(self::CSV, ['vip', 7]),
        );

        self::assertSame('invalid_import_tags', $error->code);
        self::assertSame([], $client->requests);
    }

    public function testImportRefusesAnInvalidCallerKeyBeforeHttp(): void
    {
        $client = new FakeHttpClient([]);

        $error = $this->captureError(
            fn () => (new Contacts($this->requester($client)))->import(self::CSV, idempotencyKey: ''),
        );

        self::assertSame('invalid_idempotency_key', $error->code);
        self::assertSame(0, $error->status);
        self::assertSame([], $client->requests);
    }

    public function testImportRethrowsApiErrorsUnchanged(): void
    {
        $client = new FakeHttpClient([
            $this->json(404, [
                'success' => false,
                'code' => 'tag_not_found',
                'message' => 'These tags are not in your account\'s tag list: missing.',
                'details' => ['tags' => ['missing']],
            ]),
            $this->json(415, [
                'success' => false,
                'code' => 'import_file_not_csv',
                'message' => 'The file is an Excel workbook.',
            ]),
            $this->json(400, [
                'success' => false,
                'code' => 'import_too_many_rows',
                'message' => 'The file has more than 5000 contact rows.',
                'details' => ['max_rows' => 5000],
            ]),
        ]);
        $contacts = new Contacts($this->requester($client));

        $notFound = $this->captureError(fn () => $contacts->import(self::CSV, ['missing']));
        $notCsv = $this->captureError(fn () => $contacts->import(self::CSV));
        $tooManyRows = $this->captureError(fn () => $contacts->import(self::CSV));

        self::assertInstanceOf(NotFoundError::class, $notFound);
        self::assertSame('tag_not_found', $notFound->code);
        self::assertSame(['tags' => ['missing']], $notFound->details);
        self::assertSame(SanadApiError::class, $notCsv::class);
        self::assertSame('import_file_not_csv', $notCsv->code);
        self::assertSame(415, $notCsv->status);
        self::assertInstanceOf(ValidationError::class, $tooManyRows);
        self::assertSame(['max_rows' => 5000], $tooManyRows->details);
    }

    public function testImportMalformedResponses(): void
    {
        $summary = ['rows' => 1, 'created' => 1, 'updated' => 0, 'rejected' => 0, 'failed' => 0];
        $client = new FakeHttpClient([
            $this->json(200, ['success' => true]),
            $this->json(200, ['success' => true, 'data' => ['errors' => []]]),
            $this->json(200, [
                'success' => true,
                'data' => ['summary' => ['rows' => 'one'] + $summary, 'errors' => []],
            ]),
            $this->json(200, ['success' => true, 'data' => ['summary' => $summary, 'errors' => 'none']]),
            $this->json(200, [
                'success' => true,
                'data' => [
                    'summary' => $summary,
                    'errors' => [['row' => 2, 'status' => 'rejected', 'code' => 'validation_error']],
                ],
            ]),
        ]);
        $contacts = new Contacts($this->requester($client));

        $this->assertMalformed(fn () => $contacts->import(self::CSV), '`data`');
        $this->assertMalformed(fn () => $contacts->import(self::CSV), '`data.summary`');
        $this->assertMalformed(fn () => $contacts->import(self::CSV), '`data.summary.rows`');
        $this->assertMalformed(fn () => $contacts->import(self::CSV), '`data.errors`');
        $this->assertMalformed(fn () => $contacts->import(self::CSV), '`data.errors[0].message`');
    }

    /**
     * Splits a multipart/form-data request into its parts, keyed by part name.
     *
     * @return array<string, array{filename: ?string, contentType: ?string, contents: string}>
     */
    private function multipartParts(RequestInterface $request): array
    {
        $contentType = $request->getHeaderLine('Content-Type');
        self::assertMatchesRegularExpression('#\Amultipart/form-data; boundary=\S+\z#', $contentType);
        $boundary = trim(substr($contentType, strlen('multipart/form-data; boundary=')), '"');

        $body = (string) $request->getBody();
        self::assertStringEndsWith('--' . $boundary . "--\r\n", $body);

        $parts = [];
        $sections = explode('--' . $boundary . "\r\n", substr($body, 0, -strlen('--' . $boundary . "--\r\n")));
        foreach ($sections as $section) {
            if ($section === '') {
                continue;
            }
            [$rawHeaders, $contents] = explode("\r\n\r\n", $section, 2);
            self::assertStringEndsWith("\r\n", $contents);
            $contents = substr($contents, 0, -2);
            $rawHeaders = str_replace("\r\n", "\n", $rawHeaders);

            self::assertSame(
                1,
                preg_match('/^Content-Disposition: form-data; name="([^"]*)"(?:; filename="([^"]*)")?$/mi', $rawHeaders, $disposition),
                'Each part needs a form-data Content-Disposition header.',
            );
            $partContentType = preg_match('/^Content-Type: (.+)$/mi', $rawHeaders, $type) === 1
                ? trim($type[1])
                : null;

            $parts[$disposition[1]] = [
                'filename' => isset($disposition[2]) && $disposition[2] !== '' ? $disposition[2] : null,
                'contentType' => $partContentType,
                'contents' => $contents,
            ];
        }

        return $parts;
    }
}
