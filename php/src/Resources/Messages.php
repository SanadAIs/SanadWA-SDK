<?php

declare(strict_types=1);

namespace Sanadwa\WhatsApp\Resources;

use Psr\Http\Message\ResponseInterface;
use Sanadwa\WhatsApp\Dto\Message;
use Sanadwa\WhatsApp\Dto\SendMessageOptions;
use Sanadwa\WhatsApp\Dto\SendMessageResponse;
use Sanadwa\WhatsApp\Dto\SendTextReplyOptions;
use Sanadwa\WhatsApp\Dto\SendTextReplyResponse;
use Sanadwa\WhatsApp\Dto\Upstream;
use Sanadwa\WhatsApp\Exceptions\ValidationError;
use Sanadwa\WhatsApp\Http\Requester;
use Sanadwa\WhatsApp\Http\ResponseValidator;

final class Messages
{
    public function __construct(private readonly Requester $requester)
    {
    }

    public function send(SendMessageOptions $options): SendMessageResponse
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

        return $this->postMessage('/messages/template', $body, $options->idempotencyKey);
    }

    public function reply(SendTextReplyOptions $options): SendTextReplyResponse
    {
        $body = [
            'phone_number_id' => $options->phoneNumberId,
            'to_phone' => $options->toPhone,
            'text' => $options->text,
        ];
        if ($options->previewUrl !== null) {
            $body['preview_url'] = $options->previewUrl;
        }

        $response = $this->postMessage('/messages/text', $body, $options->idempotencyKey);

        return new SendTextReplyResponse(
            messageId: $response->messageId,
            acceptedAt: $response->acceptedAt,
            replayed: $response->replayed,
            upstream: $response->upstream,
        );
    }

    private function postMessage(
        string $path,
        array $body,
        ?string $idempotencyKey,
    ): SendMessageResponse
    {
        $this->validateIdempotencyKey($idempotencyKey);
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
                $replayed = $response->getHeaderLine('x-idempotent-replay') === 'true';
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

    public function get(string $id): Message
    {
        $raw = ResponseValidator::body(
            $this->requester->request('GET', '/messages/' . rawurlencode($id)),
        );
        $data = ResponseValidator::requiredArray($raw, 'data');

        return new Message(
            id: ResponseValidator::requiredString($data, 'id', 'data.id'),
            providerMsgId: ResponseValidator::optionalNullableString(
                $data,
                'provider_msg_id',
                'data.provider_msg_id',
            ),
            status: ResponseValidator::requiredString($data, 'status', 'data.status'),
            sentAt: ResponseValidator::requiredNullableString($data, 'sent_at', 'data.sent_at'),
            templateName: ResponseValidator::requiredNullableString(
                $data,
                'template_name',
                'data.template_name',
            ),
            toPhone: ResponseValidator::requiredString($data, 'to_phone', 'data.to_phone'),
            channel: ResponseValidator::requiredString($data, 'channel', 'data.channel'),
            provider: ResponseValidator::requiredString($data, 'provider', 'data.provider'),
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

    private function validateIdempotencyKey(?string $idempotencyKey): void
    {
        if ($idempotencyKey === null) {
            return;
        }
        if (
            $idempotencyKey === ''
            || strlen($idempotencyKey) > 120
            || preg_match('/\A[\x21-\x7E]+\z/', $idempotencyKey) !== 1
        ) {
            throw new ValidationError(
                message: '`idempotencyKey` must contain 1 to 120 visible ASCII characters.',
                code: 'invalid_idempotency_key',
                status: 0,
            );
        }
    }
}
