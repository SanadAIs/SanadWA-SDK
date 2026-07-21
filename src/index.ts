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

import { createRequester, type Requester } from './request.js';
import { health } from './resources/health.js';
import { listTemplates } from './resources/templates.js';
import { sendMessage, sendTextReply, getMessage } from './resources/messages.js';
import { verifyWebhook } from './resources/webhooks.js';
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

const DEFAULT_BASE_URL = 'https://api.sanadwa.com/api/public/v1';
const DEFAULT_RETRIES = 5;
const DEFAULT_USER_AGENT = '@sanadwa/whatsapp-sdk/0.3.0';

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
  };

  readonly webhooks: {
    verify: (input: WebhookVerifyInput) => WebhookVerifyResult;
  } = { verify: verifyWebhook };

  constructor(opts: ClientOptions) {
    if (!opts || typeof opts.apiKey !== 'string' || opts.apiKey.length === 0) {
      throw new Error('SanadWhatsApp: `apiKey` is required.');
    }
    const fetchImpl: typeof fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.#req = createRequester({
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl ?? DEFAULT_BASE_URL,
      retries: opts.retries ?? DEFAULT_RETRIES,
      fetchImpl,
      userAgent: opts.userAgent ?? DEFAULT_USER_AGENT,
    });

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
  WebhookEvent,
  WebhookFailedError,
  WebhookVerifyInput,
  WebhookVerifyResult,
} from './types.js';

export type {
  SendTextReplyOptions as SendTextOptions,
  SendTextReplyResponse as SendTextResponse,
} from './types.js';

// Phase 60 OPS-V2-04 — webhook fixtures for adopter unit tests.
// `__` prefix marks this as a TESTING surface, not the supported runtime API.
import * as __testFixtures from './testFixtures.js';
export { __testFixtures };
export type { WebhookFixture } from './testFixtures.js';

// Standalone re-export for adopters who don't want to construct the client.
export { verifyWebhook } from './resources/webhooks.js';
