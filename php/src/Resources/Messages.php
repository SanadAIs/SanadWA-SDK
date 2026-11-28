<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Resources;

use Psr\Http\Message\ResponseInterface;
use Sanadwa\WhatsApp\Dto\Message;
use Sanadwa\WhatsApp\Dto\SendMessageOptions;
use Sanadwa\WhatsApp\Dto\SendMessageResponse;
use Sanadwa\WhatsApp\Dto\SendPreview;
use Sanadwa\WhatsApp\Dto\SendTextOptions;
use Sanadwa\WhatsApp\Dto\SendTextReplyResponse;
use Sanadwa\WhatsApp\Dto\Upstream;
use Sanadwa\WhatsApp\Http\Requester;
use Sanadwa\WhatsApp\Http\ResponseValidator;
use Sanadwa\WhatsApp\Resources\Support\ResourceSupport;
use Sanadwa\WhatsApp\Resources\Support\SendPreviewMapper;

final class Messages
{
    public function __construct(private readonly Requester $requester)
    {
    }

    public function send(SendMessageOptions $options): SendMessageResponse
    {
        return $this->postMessage('/messages/template', self::templateBody($options), $options->idempotencyKey);
    }

    public function sendText(SendTextOptions $options): SendTextReplyResponse
    {
        $response = $this->postMessage('/messages/text', self::textBody($options), $options->idempotencyKey);

        return new SendTextReplyResponse(
            messageId: $response->messageId,
            acceptedAt: $response->acceptedAt,
            replayed: $response->replayed,
            upstream: $response->upstream,
        );
    }

    /**
     * Reports what `send()` (a `SendMessageOptions`) or `sendText()` (a
     * `SendTextOptions`) would do with this input, without sending.
     *
     * Nothing is sent, charged or stored, and no `Idempotency-Key` is sent: an
     * `idempotencyKey` set on the options is ignored. A refusal the real call
     * would answer comes back in `SendPreview::$refusal`; it is not thrown. An
     * API key with scope `read` is enough. The balance can change before the
     * real call, which stays the authority.
     */
    public function preview(SendMessageOptions|SendTextOptions $options): SendPreview
    {
        $body = $options instanceof SendMessageOptions
            ? self::templateBody($options)
            : self::textBody($options);

        return SendPreviewMapper::map($this->requester->request(
            method: 'POST',
            path: '/messages/preview',
            body: $body,
        ));
    }

    public function reply(SendTextOptions $options): SendTextReplyResponse
    {
        return $this->sendText($options);
    }

    /**
     * @return array<string, mixed>
     */
    private static function templateBody(SendMessageOptions $options): array
    {
        $body = [
            'phone_number_id' => $options->phoneNumberId,
            'to_phone' => $options->toPhone,
            'template_name' => $options->templateName,
        ];
        if ($options->templateLanguage !== null) {
            $body['template_language'] = $options->templateLanguage;
        }
        if ($options->templateParams !== null) {
            $body['template_params'] = $options->templateParams;
        }
        if ($options->templateComponents !== null) {
            $body['template_components'] = $options->templateComponents;
        }

        return $body;
    }

    /**
     * @return array<string, mixed>
     */
    private static function textBody(SendTextOptions $options): array
    {
        $body = [
            'phone_number_id' => $options->phoneNumberId,
            'to_phone' => $options->toPhone,
            'text' => $options->text,
        ];
        if ($options->previewUrl !== null) {
            $body['preview_url'] = $options->previewUrl;
        }

        return $body;
    }

    private function postMessage(
        string $path,
        array $body,
        ?string $idempotencyKey,
    ): SendMessageResponse
    {
        ResourceSupport::validateIdempotencyKey($idempotencyKey);
        if ($idempotencyKey !== null) {
            $body['idempotency_key'] = $idempotencyKey;
        }

        $replayed = false;
        $raw = $this->requester->request(
            method: 'POST',
            path: $path,
            body: $body,
            idempotent: true,
            onHeaders: static function (ResponseInterface $response) use (&$replayed): void {
                $replayed = ResourceSupport::isIdempotentReplay($response);
            },
            idempotencyKey: $idempotencyKey,
        );
        $raw = ResponseValidator::body($raw);

        $upstream = [];
        if (array_key_exists('upstream', $raw) && $raw['upstream'] !== null) {
            $upstream = ResponseValidator::arrayValue($raw['upstream'], 'upstream');
        }

        $messagingProduct = 'whatsapp';
        if (array_key_exists('messaging_product', $upstream) && $upstream['messaging_product'] !== null) {
            $messagingProduct = ResponseValidator::requiredString(
                $upstream,
                'messaging_product',
                'upstream.messaging_product',
            );
        }

        $contacts = [];
        if (array_key_exists('contacts', $upstream) && $upstream['contacts'] !== null) {
            $contacts = ResponseValidator::requiredArray($upstream, 'contacts', 'upstream.contacts');
        }

        $messages = [];
        if (array_key_exists('messages', $upstream) && $upstream['messages'] !== null) {
            $messages = ResponseValidator::requiredArray($upstream, 'messages', 'upstream.messages');
        }

        return new SendMessageResponse(
            messageId: ResponseValidator::optionalNullableString($raw, 'message_id'),
            acceptedAt: ResponseValidator::requiredString($raw, 'accepted_at'),
            replayed: $replayed,
            upstream: new Upstream(
                messagingProduct: $messagingProduct,
                contacts: $contacts,
                messages: $messages,
            ),
        );
    }

    /**
     * Looks up one message.
     *
     * Pass the WhatsApp message id (`wamid.…`) returned as `messageId` by `send()` /
     * `sendText()`, or a status webhook's `providerMsgId`. Do not pass `Message::$id` or a
     * status webhook's `messageId`: those are SanadWA row ids and the API answers 404
     * `message_not_found` for anything that is not a `wamid.` id.
     */
    public function get(string $id): Message
    {
        $raw = ResponseValidator::body(
            $this->requester->request('GET', '/messages/' . rawurlencode($id)),
        );
        $data = ResponseValidator::requiredArray($raw, 'data');

        return new Message(
            id: ResponseValidator::requiredStringOrNumber($data, 'id', 'data.id'),
            providerMsgId: ResponseValidator::optionalNullableString(
                $data,
                'provider_msg_id',
                'data.provider_msg_id',
            ),
            status: ResponseValidator::optionalNullableString($data, 'status', 'data.status'),
            sentAt: ResponseValidator::optionalNullableString($data, 'sent_at', 'data.sent_at'),
            templateName: ResponseValidator::optionalNullableString(
                $data,
                'template_name',
                'data.template_name',
            ),
            toPhone: ResponseValidator::optionalNullableString(
                $data,
                'to_phone',
                'data.to_phone',
            ),
            channel: ResponseValidator::optionalNullableString(
                $data,
                'channel',
                'data.channel',
            ),
            provider: ResponseValidator::optionalNullableString(
                $data,
                'provider',
                'data.provider',
            ),
            error: ResponseValidator::optionalNullableString($data, 'error', 'data.error'),
            deliveredAt: ResponseValidator::optionalNullableString(
                $data,
                'delivered_at',
                'data.delivered_at',
            ),
            readAt: ResponseValidator::optionalNullableString($data, 'read_at', 'data.read_at'),
            failedAt: ResponseValidator::optionalNullableString(
                $data,
                'failed_at',
                'data.failed_at',
            ),
            lastStatus: ResponseValidator::optionalNullableString(
                $data,
                'last_status',
                'data.last_status',
            ),
        );
    }
}
