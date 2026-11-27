/**
 * `@sanadwa/whatsapp-sdk` — public entry.
 *
 * @example
 * ```ts
 * import { SanadWhatsApp } from '@sanadwa/whatsapp-sdk';
 * const sdk = new SanadWhatsApp({ apiKey: process.env.SANAD_API_KEY! });
 * await sdk.health();
 * ```
 */

import { createRequester, DEFAULT_TIMEOUT_MS, type Requester } from './request.js';
import { health } from './resources/health.js';
import { listTemplates } from './resources/templates.js';
import { sendMessage, sendTextReply, getMessage, previewMessage } from './resources/messages.js';
import { verifyWebhook } from './resources/webhooks.js';
import { PhoneNumbersResource } from './resources/phone-numbers.js';
import { BalanceResource } from './resources/balance.js';
import { TagsResource } from './resources/tags.js';
import { ContactsResource } from './resources/contacts.js';
import { CampaignsResource } from './resources/campaigns.js';
import type { PreviewMessageInput, SendPreview } from './resource-types.js';
import type {
  ClientOptions,
  HealthResponse,
  ListTemplatesOptions,
  ListTemplatesResponse,
  Message,
  SendMessageOptions,
  SendMessageResponse,
  SendTextReplyOptions,
  SendTextReplyResponse,
  WebhookVerifyInput,
  WebhookVerifyResult,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.sanadwa.com/v1';
const DEFAULT_RETRIES = 5;
const DEFAULT_USER_AGENT = '@sanadwa/whatsapp-sdk/0.4.0';

export class SanadWhatsApp {
  readonly #req: Requester;

  readonly templates: {
    list: (opts?: ListTemplatesOptions) => Promise<ListTemplatesResponse>;
  };

  readonly messages: {
    send: (opts: SendMessageOptions) => Promise<SendMessageResponse>;
    sendText: (opts: SendTextReplyOptions) => Promise<SendTextReplyResponse>;
    reply: (opts: SendTextReplyOptions) => Promise<SendTextReplyResponse>;
    get: (id: string) => Promise<Message>;
    preview: (input: PreviewMessageInput) => Promise<SendPreview>;
  };

  readonly webhooks: {
    verify: (input: WebhookVerifyInput) => WebhookVerifyResult;
  } = { verify: verifyWebhook };

  readonly phoneNumbers: PhoneNumbersResource;
  readonly balance: BalanceResource;
  readonly tags: TagsResource;
  readonly contacts: ContactsResource;
  readonly campaigns: CampaignsResource;

  constructor(opts: ClientOptions) {
    if (!opts || typeof opts.apiKey !== 'string' || opts.apiKey.length === 0) {
      throw new Error('SanadWhatsApp: `apiKey` is required.');
    }
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new Error('SanadWhatsApp: `timeoutMs` must be a non-negative finite number.');
    }
    const retries = opts.retries ?? DEFAULT_RETRIES;
    if (typeof retries !== 'number' || !Number.isFinite(retries)) {
      throw new Error('SanadWhatsApp: `retries` must be a finite number.');
    }
    const fetchImpl: typeof fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.#req = createRequester({
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl ?? DEFAULT_BASE_URL,
      retries,
      fetchImpl,
      userAgent: opts.userAgent ?? DEFAULT_USER_AGENT,
      timeoutMs,
    });

    this.phoneNumbers = new PhoneNumbersResource(this.#req);
    this.balance = new BalanceResource(this.#req);
    this.tags = new TagsResource(this.#req);
    this.contacts = new ContactsResource(this.#req);
    this.campaigns = new CampaignsResource(this.#req);

    this.templates = {
      list: (o) => listTemplates(this.#req, o),
    };
    const sendText = (o: SendTextReplyOptions): Promise<SendTextReplyResponse> =>
      sendTextReply(this.#req, o);
    this.messages = {
      send: (o) => sendMessage(this.#req, o),
      sendText,
      reply: sendText,
      get: (id) => getMessage(this.#req, id),
      preview: (input) => previewMessage(this.#req, input),
    };
  }

  health(): Promise<HealthResponse> {
    return health(this.#req);
  }
}

// ---------- public re-exports ----------
export {
  SanadApiError,
  RateLimitedError,
  ValidationError,
  AuthError,
  NotFoundError,
  ServerError,
  SendFailedError,
  isSanadApiError,
} from './errors.js';

export type {
  ClientOptions,
  HealthResponse,
  Template,
  ListTemplatesOptions,
  ListTemplatesResponse,
  SendMessageOptions,
  SendMessageResponse,
  SendTextReplyOptions,
  SendTextReplyResponse,
  Message,
  MessageSentWebhookData,
  MessageDeliveredWebhookData,
  MessageReadWebhookData,
  MessageFailedWebhookData,
  WebhookEvent,
  WebhookFailedError,
  WebhookInvalidReason,
  WebhookVerifyInput,
  WebhookVerifyResult,
} from './types.js';

export type {
  SendTextReplyOptions as SendTextOptions,
  SendTextReplyResponse as SendTextResponse,
} from './types.js';

export { PhoneNumbersResource, BalanceResource, TagsResource, ContactsResource, CampaignsResource };
export type * from './resource-types.js';

// Webhook fixtures for adopter unit tests.
// `__` prefix marks this as a TESTING surface, not the supported runtime API.
import * as __testFixtures from './testFixtures.js';
export { __testFixtures };
export type { WebhookFixture } from './testFixtures.js';

// Standalone re-export for adopters who don't want to construct the client.
export { verifyWebhook } from './resources/webhooks.js';
