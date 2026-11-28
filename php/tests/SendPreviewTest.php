<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Sanadwa\WhatsApp\Dto\CreateCampaignOptions;
use Sanadwa\WhatsApp\Dto\PreviewCampaignOptions;
use Sanadwa\WhatsApp\Dto\SendMessageOptions;
use Sanadwa\WhatsApp\Dto\SendPreview;
use Sanadwa\WhatsApp\Dto\SendPreviewBalance;
use Sanadwa\WhatsApp\Dto\SendPreviewCredits;
use Sanadwa\WhatsApp\Dto\SendPreviewRecipients;
use Sanadwa\WhatsApp\Dto\SendPreviewRefusal;
use Sanadwa\WhatsApp\Dto\SendPreviewTemplate;
use Sanadwa\WhatsApp\Dto\SendTextOptions;
use Sanadwa\WhatsApp\Dto\SendTextReplyOptions;
use Sanadwa\WhatsApp\Exceptions\AuthError;
use Sanadwa\WhatsApp\Exceptions\RateLimitedError;
use Sanadwa\WhatsApp\Exceptions\ServerError;
use Sanadwa\WhatsApp\Exceptions\ValidationError;
use Sanadwa\WhatsApp\Resources\Campaigns;
use Sanadwa\WhatsApp\Resources\Messages;
use Sanadwa\WhatsApp\SanadWhatsApp;
use Sanadwa\WhatsApp\Tests\Support\FakeHttpClient;
use Sanadwa\WhatsApp\Tests\Support\ResourceTestSupport;

final class SendPreviewTest extends TestCase
{
    use ResourceTestSupport;

    private const PREVIEW_WIRE = [
        'kind' => 'template',
        'would_send' => false,
        'refusal' => [
            'status' => 402,
            'code' => 'PREPAID_CREDIT_CAP_REACHED',
            'message' => 'Not enough credits. Purchase credits to continue.',
            'message_ar' => 'الرصيد غير كافٍ. اشحن رصيدك للمتابعة.',
            'details' => ['needed' => 1, 'remaining' => 0, 'shortfall' => 1],
        ],
        'template' => ['name' => 'order_update', 'language' => 'ar', 'category' => 'UTILITY'],
        'recipients' => [
            'requested' => 1,
            'opted_out' => 0,
            'suppressed' => 0,
            'invalid_phone' => 0,
            'duplicate' => 0,
            'allowlist_blocked' => 0,
            'eligible' => 1,
        ],
        'credits' => [
            'billing_type' => 'prepaid',
            'charge_category' => 'utility',
            'per_message' => 1,
            'estimated' => 1,
            'from_free_allowance' => 0,
            'from_paid_balance' => 1,
            'covered_by_subscription' => false,
        ],
        'balance' => ['available_credits' => 0, 'after_send' => -1, 'unlimited' => false],
        'as_of' => '2026-11-27T10:00:00.000Z',
    ];

    private const CAMPAIGN_PREVIEW_WIRE = [
        'kind' => 'campaign',
        'would_send' => true,
        'refusal' => null,
        'template' => ['name' => 'november_offer', 'language' => 'ar', 'category' => 'MARKETING'],
        'recipients' => [
            'requested' => 5,
            'opted_out' => 1,
            'suppressed' => 1,
            'invalid_phone' => 0,
            'duplicate' => 0,
            'allowlist_blocked' => 0,
            'eligible' => 3,
        ],
        'credits' => [
            'billing_type' => 'prepaid',
            'charge_category' => 'marketing',
            'per_message' => 1,
            'estimated' => 3,
            'from_free_allowance' => 3,
            'from_paid_balance' => 0,
            'covered_by_subscription' => false,
        ],
        'balance' => ['available_credits' => 10, 'after_send' => 7, 'unlimited' => false],
        'as_of' => '2026-11-27T10:00:00.000Z',
    ];

    // ── messages()->preview ─────────────────────────────────────────────────

    public function testMessagePreviewPostsTheTemplateBodyWithoutAnIdempotencyKey(): void
    {
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => self::PREVIEW_WIRE])]);

        (new Messages($this->requester($client)))->preview(new SendMessageOptions(
            phoneNumberId: '100000000000001',
            toPhone: '+12025550123',
            templateName: 'order_update',
            templateLanguage: 'ar',
            templateParams: ['Sara'],
        ));

        self::assertCount(1, $client->requests);
        $request = $client->requests[0];
        self::assertSame('POST', $request->getMethod());
        self::assertSame(self::BASE_URL . '/messages/preview', $this->url($request));
        self::assertFalse($request->hasHeader('Idempotency-Key'));
        self::assertSame([
            'phone_number_id' => '100000000000001',
            'to_phone' => '+12025550123',
            'template_name' => 'order_update',
            'template_language' => 'ar',
            'template_params' => ['Sara'],
        ], $this->decodedBody($request));
    }

    public function testMessagePreviewSendsTheTextBodyForTextOptions(): void
    {
        $client = new FakeHttpClient([
            $this->json(200, ['success' => true, 'data' => ['kind' => 'text', 'template' => null] + self::PREVIEW_WIRE]),
            $this->json(200, ['success' => true, 'data' => ['kind' => 'text', 'template' => null] + self::PREVIEW_WIRE]),
        ]);
        $messages = new Messages($this->requester($client));

        $preview = $messages->preview(new SendTextOptions(
            phoneNumberId: '100000000000001',
            toPhone: '+12025550123',
            text: 'Hello',
            previewUrl: true,
        ));
        $messages->preview(new SendTextReplyOptions(
            phoneNumberId: '100000000000001',
            toPhone: '+12025550123',
            text: 'Hi',
        ));

        self::assertSame('text', $preview->kind);
        self::assertNull($preview->template);
        self::assertSame(self::BASE_URL . '/messages/preview', $this->url($client->requests[0]));
        self::assertSame([
            'phone_number_id' => '100000000000001',
            'to_phone' => '+12025550123',
            'text' => 'Hello',
            'preview_url' => true,
        ], $this->decodedBody($client->requests[0]));
        self::assertSame([
            'phone_number_id' => '100000000000001',
            'to_phone' => '+12025550123',
            'text' => 'Hi',
        ], $this->decodedBody($client->requests[1]));
    }

    public function testMessagePreviewNeverForwardsAnIdempotencyKeyTheCallerSets(): void
    {
        $client = new FakeHttpClient([
            $this->json(200, ['success' => true, 'data' => self::PREVIEW_WIRE]),
            $this->json(200, ['success' => true, 'data' => self::PREVIEW_WIRE]),
        ]);
        $messages = new Messages($this->requester($client));

        $messages->preview(new SendMessageOptions(
            phoneNumberId: '100000000000001',
            toPhone: '+12025550123',
            templateName: 'order_update',
            idempotencyKey: 'k-1',
        ));
        $messages->preview(new SendTextOptions(
            phoneNumberId: '100000000000001',
            toPhone: '+12025550123',
            text: 'Hello',
            idempotencyKey: 'k-2',
        ));

        foreach ($client->requests as $request) {
            self::assertFalse($request->hasHeader('Idempotency-Key'));
            self::assertArrayNotHasKey('idempotency_key', $this->decodedBody($request));
        }
    }

    public function testMessagePreviewMapsTheWholeAnswerAndReturnsARefusalAsData(): void
    {
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => self::PREVIEW_WIRE])]);

        $preview = (new Messages($this->requester($client)))->preview($this->templateOptions());

        self::assertEquals(new SendPreview(
            kind: 'template',
            wouldSend: false,
            refusal: new SendPreviewRefusal(
                status: 402,
                code: 'PREPAID_CREDIT_CAP_REACHED',
                message: 'Not enough credits. Purchase credits to continue.',
                messageAr: 'الرصيد غير كافٍ. اشحن رصيدك للمتابعة.',
                details: ['needed' => 1, 'remaining' => 0, 'shortfall' => 1],
            ),
            template: new SendPreviewTemplate(name: 'order_update', language: 'ar', category: 'UTILITY'),
            recipients: new SendPreviewRecipients(
                requested: 1,
                optedOut: 0,
                suppressed: 0,
                invalidPhone: 0,
                duplicate: 0,
                allowlistBlocked: 0,
                eligible: 1,
            ),
            credits: new SendPreviewCredits(
                billingType: 'prepaid',
                chargeCategory: 'utility',
                perMessage: 1,
                estimated: 1,
                fromFreeAllowance: 0,
                fromPaidBalance: 1,
                coveredBySubscription: false,
            ),
            balance: new SendPreviewBalance(availableCredits: 0, afterSend: -1, unlimited: false),
            asOf: '2026-11-27T10:00:00.000Z',
        ), $preview);
    }

    public function testMessagePreviewAcceptsNullSections(): void
    {
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => [
            'kind' => 'text',
            'would_send' => true,
            'template' => null,
            'recipients' => null,
            'credits' => null,
            'balance' => null,
            'refusal' => null,
        ] + self::PREVIEW_WIRE])]);

        $preview = (new Messages($this->requester($client)))->preview($this->templateOptions());

        self::assertTrue($preview->wouldSend);
        self::assertNull($preview->refusal);
        self::assertNull($preview->template);
        self::assertNull($preview->recipients);
        self::assertNull($preview->credits);
        self::assertNull($preview->balance);
    }

    public function testMessagePreviewAcceptsPostpaidNullBalancesAndANullRefusalDetail(): void
    {
        $wire = self::PREVIEW_WIRE;
        $wire['refusal']['details'] = null;
        $wire['credits']['billing_type'] = 'postpaid';
        $wire['balance'] = ['available_credits' => null, 'after_send' => null, 'unlimited' => false];
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => $wire])]);

        $preview = (new Messages($this->requester($client)))->preview($this->templateOptions());

        self::assertNull($preview->refusal?->details);
        self::assertEquals(
            new SendPreviewBalance(availableCredits: null, afterSend: null, unlimited: false),
            $preview->balance,
        );
        self::assertSame('postpaid', $preview->credits?->billingType);
    }

    /**
     * @return iterable<string, array{array<string, mixed>, string}>
     */
    public static function malformedProvider(): iterable
    {
        $wire = self::PREVIEW_WIRE;

        yield 'kind outside the enum' => [['kind' => 'sms'] + $wire, 'data.kind'];

        $bad = $wire;
        $bad['credits']['billing_type'] = 'weekly';
        yield 'unknown billing type' => [$bad, 'data.credits.billing_type'];

        $bad = $wire;
        unset($bad['recipients']['opted_out']);
        yield 'missing count' => [$bad, 'data.recipients.opted_out'];

        $bad = $wire;
        $bad['refusal']['message_ar'] = 5;
        yield 'non-string Arabic message' => [$bad, 'data.refusal.message_ar'];

        $bad = $wire;
        unset($bad['as_of']);
        yield 'missing as_of' => [$bad, 'data.as_of'];

        $bad = $wire;
        $bad['balance']['after_send'] = 'short';
        yield 'non-numeric balance' => [$bad, 'data.balance.after_send'];
    }

    #[DataProvider('malformedProvider')]
    public function testMessagePreviewRefusesAMalformedAnswerNamingTheWirePath(array $data, string $field): void
    {
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => $data])]);

        $this->assertMalformed(
            fn () => (new Messages($this->requester($client)))->preview($this->templateOptions()),
            '`' . $field . '`',
        );
    }

    public function testMessagePreviewThrowsTheMappedErrorWithItsArabicMessage(): void
    {
        $client = new FakeHttpClient([
            $this->json(403, [
                'success' => false,
                'code' => 'insufficient_scope',
                'message' => 'This API key cannot read.',
                'message_ar' => 'مفتاح API هذا لا يملك صلاحية القراءة.',
            ]),
            $this->json(400, [
                'success' => false,
                'code' => 'validation_error',
                'message' => 'Body has both template_name and text.',
            ]),
        ]);
        $messages = new Messages($this->requester($client));

        $auth = $this->captureError(fn () => $messages->preview($this->templateOptions()));
        self::assertInstanceOf(AuthError::class, $auth);
        self::assertSame('insufficient_scope', $auth->code);
        self::assertSame(403, $auth->status);
        self::assertSame('مفتاح API هذا لا يملك صلاحية القراءة.', $auth->messageAr);

        $validation = $this->captureError(fn () => $messages->preview($this->templateOptions()));
        self::assertInstanceOf(ValidationError::class, $validation);
        self::assertSame('validation_error', $validation->code);
        self::assertSame(400, $validation->status);
    }

    public function testMessagePreviewRetriesA5xxWithoutAnIdempotencyKey(): void
    {
        $client = new FakeHttpClient([
            $this->json(500, ['success' => false, 'code' => 'message_preview_failed', 'message' => 'Try later.']),
            $this->json(200, ['success' => true, 'data' => self::PREVIEW_WIRE]),
        ]);

        $preview = (new Messages($this->requester($client, retries: 2)))->preview($this->templateOptions());

        self::assertFalse($preview->wouldSend);
        self::assertCount(2, $client->requests);
        foreach ($client->requests as $request) {
            self::assertFalse($request->hasHeader('Idempotency-Key'));
        }
    }

    public function testClientExposesMessagesPreview(): void
    {
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => self::PREVIEW_WIRE])]);
        $sdk = new SanadWhatsApp([
            'apiKey' => 'pk_test_fake_key',
            'baseUrl' => self::BASE_URL,
            'retries' => 1,
            'httpClient' => $client,
        ]);

        $preview = $sdk->messages()->preview($this->templateOptions());

        self::assertSame('PREPAID_CREDIT_CAP_REACHED', $preview->refusal?->code);
        self::assertSame(self::BASE_URL . '/messages/preview', $this->url($client->requests[0]));
        self::assertSame('POST', $client->requests[0]->getMethod());
        self::assertFalse($client->requests[0]->hasHeader('Idempotency-Key'));
    }

    // ── campaigns()->preview ────────────────────────────────────────────────

    public function testCampaignPreviewPostsTheCreateBodyWithoutAKey(): void
    {
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => self::CAMPAIGN_PREVIEW_WIRE])]);

        $preview = (new Campaigns($this->requester($client)))->preview(new PreviewCampaignOptions(
            name: 'November offer',
            phoneNumberId: '100000000000001',
            templateName: 'november_offer',
            templateLanguage: 'ar',
            audienceTags: ['vip'],
            sendAt: new \DateTimeImmutable('2026-12-01T06:00:00+00:00'),
        ));

        $request = $client->requests[0];
        self::assertSame('POST', $request->getMethod());
        self::assertSame(self::BASE_URL . '/campaigns/preview', $this->url($request));
        self::assertFalse($request->hasHeader('Idempotency-Key'));
        self::assertSame([
            'name' => 'November offer',
            'phone_number_id' => '100000000000001',
            'template' => ['name' => 'november_offer', 'language' => 'ar'],
            'audience' => ['tags' => ['vip']],
            'send_at' => '2026-12-01T06:00:00+00:00',
        ], $this->decodedBody($request));
        self::assertSame('campaign', $preview->kind);
        self::assertTrue($preview->wouldSend);
        self::assertSame(1, $preview->recipients?->optedOut);
        self::assertSame(3, $preview->credits?->estimated);
        self::assertSame(7, $preview->balance?->afterSend);
        self::assertSame('MARKETING', $preview->template?->category);
    }

    public function testCampaignPreviewAcceptsCreateOptionsAndIgnoresTheirKey(): void
    {
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => self::CAMPAIGN_PREVIEW_WIRE])]);

        (new Campaigns($this->requester($client)))->preview(new CreateCampaignOptions(
            name: 'November offer',
            phoneNumberId: '100000000000001',
            templateName: 'november_offer',
            templateLanguage: 'ar',
            audienceTags: ['vip'],
            idempotencyKey: 'campaign-key-0001',
        ));

        $request = $client->requests[0];
        self::assertFalse($request->hasHeader('Idempotency-Key'));
        self::assertArrayNotHasKey('idempotency_key', $this->decodedBody($request));
    }

    public function testCampaignPreviewReturnsARefusalAsData(): void
    {
        $wire = self::CAMPAIGN_PREVIEW_WIRE;
        $wire['would_send'] = false;
        $wire['refusal'] = [
            'status' => 402,
            'code' => 'insufficient_credits',
            'message' => 'Your account does not have enough credits for this audience, so the campaign was not created.',
            'message_ar' => 'رصيد حسابك لا يكفي لهذا الجمهور، فلم تُنشأ الحملة.',
            'details' => ['needed' => 3, 'remaining' => 1, 'shortfall' => 2],
        ];
        $wire['balance'] = ['available_credits' => 1, 'after_send' => -2, 'unlimited' => false];
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => $wire])]);

        $preview = (new Campaigns($this->requester($client)))->preview($this->campaignOptions());

        self::assertFalse($preview->wouldSend);
        self::assertEquals(new SendPreviewRefusal(
            status: 402,
            code: 'insufficient_credits',
            message: $wire['refusal']['message'],
            messageAr: $wire['refusal']['message_ar'],
            details: ['needed' => 3, 'remaining' => 1, 'shortfall' => 2],
        ), $preview->refusal);
        self::assertSame(-2, $preview->balance?->afterSend);
    }

    public function testAStoppedCampaignPreviewHasNullCounts(): void
    {
        $wire = [
            'would_send' => false,
            'recipients' => null,
            'credits' => null,
            'balance' => null,
            'refusal' => [
                'status' => 403,
                'code' => 'kyc_required',
                'message' => 'Verify.',
                'message_ar' => 'وثّق حسابك.',
                'details' => null,
            ],
        ] + self::CAMPAIGN_PREVIEW_WIRE;
        $client = new FakeHttpClient([$this->json(200, ['success' => true, 'data' => $wire])]);

        $preview = (new Campaigns($this->requester($client)))->preview($this->campaignOptions());

        self::assertNull($preview->recipients);
        self::assertNull($preview->credits);
        self::assertNull($preview->balance);
        self::assertSame('kyc_required', $preview->refusal?->code);
        self::assertSame('وثّق حسابك.', $preview->refusal?->messageAr);
    }

    public function testCampaignPreviewRateLimitIsARateLimitedError(): void
    {
        $client = new FakeHttpClient([
            $this->json(429, [
                'success' => false,
                'code' => 'rate_limited',
                'message' => 'Too many previews.',
                'message_ar' => 'طلبات معاينة كثيرة.',
            ], ['Retry-After' => '7']),
        ]);

        $error = $this->captureError(
            fn () => (new Campaigns($this->requester($client)))->preview($this->campaignOptions()),
        );

        self::assertInstanceOf(RateLimitedError::class, $error);
        self::assertSame('rate_limited', $error->code);
        self::assertSame(7, $error->retryAfterSec);
        self::assertSame('طلبات معاينة كثيرة.', $error->messageAr);
    }

    public function testCampaignPreviewServerFailureIsAServerError(): void
    {
        $client = new FakeHttpClient([
            $this->json(500, ['success' => false, 'code' => 'campaign_preview_failed', 'message' => 'Try later.']),
        ]);

        $error = $this->captureError(
            fn () => (new Campaigns($this->requester($client)))->preview($this->campaignOptions()),
        );

        self::assertInstanceOf(ServerError::class, $error);
        self::assertSame('campaign_preview_failed', $error->code);
    }

    private function templateOptions(): SendMessageOptions
    {
        return new SendMessageOptions(
            phoneNumberId: '100000000000001',
            toPhone: '+12025550123',
            templateName: 'order_update',
            templateLanguage: 'ar',
        );
    }

    private function campaignOptions(): PreviewCampaignOptions
    {
        return new PreviewCampaignOptions(
            name: 'November offer',
            phoneNumberId: '100000000000001',
            templateName: 'november_offer',
            templateLanguage: 'ar',
            audienceTags: ['vip'],
        );
    }
}
