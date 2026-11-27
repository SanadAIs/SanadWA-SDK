import type { Requester } from '../request.js';
import { ValidationError } from '../errors.js';
import type {
  Campaign,
  CampaignAudience,
  CampaignClicks,
  CampaignTemplate,
  CampaignTemplateVariable,
  CreateCampaignInput,
  CreatedCampaign,
  ListOptions,
  Page,
  PreviewCampaignInput,
  SendPreview,
  WriteOptions,
} from '../resource-types.js';
import { toSendPreview } from './send-preview.js';
import {
  assertIdempotencyKey,
  idSegment,
  isIdempotentReplay,
  pageQuery,
  toId,
  toInteger,
  toNullableId,
  toNullableString,
  toDataRecord,
  toOptionalStringList,
  toPage,
  toRecord,
  toRecordOrNull,
  toRequiredString,
  writeOptions,
  type WireRecord,
} from './resource-helpers.js';

const toTemplate = (value: unknown, field: string): CampaignTemplate | null => {
  const template = toRecordOrNull(value, field);
  return template === null
    ? null
    : {
      name: toRequiredString(template.name, `${field}.name`),
      language: toNullableString(template.language, `${field}.language`),
    };
};

/** Only a `tags` audience carries tag names; the others are sent without the key. */
const toAudience = (value: unknown, field: string): CampaignAudience | null => {
  const audience = toRecordOrNull(value, field);
  return audience === null
    ? null
    : {
      type: toRequiredString(audience.type, `${field}.type`),
      tags: toOptionalStringList(audience.tags, `${field}.tags`),
    };
};

/** The list endpoint omits `clicks`. */
const toClicks = (value: unknown, field: string): CampaignClicks | null => {
  const clicks = toRecordOrNull(value, field);
  return clicks === null
    ? null
    : {
      tracked: toInteger(clicks.tracked, `${field}.tracked`),
      clicked: toInteger(clicks.clicked, `${field}.clicked`),
    };
};

const toCampaign = (row: WireRecord, field: string): Campaign => {
  const template = toTemplate(row.template, `${field}.template`);
  const audience = toAudience(row.audience, `${field}.audience`);
  const clicks = toClicks(row.clicks, `${field}.clicks`);
  const counts = toRecord(row.counts, `${field}.counts`);
  const count = (key: string): number => toInteger(counts[key], `${field}.counts.${key}`);
  return {
    id: toId(row.id, `${field}.id`),
    name: toRequiredString(row.name, `${field}.name`),
    status: toRequiredString(row.status, `${field}.status`),
    pauseReason: toNullableString(row.pause_reason, `${field}.pause_reason`),
    phoneNumberId: toNullableId(row.phone_number_id, `${field}.phone_number_id`),
    template,
    audience,
    startAt: toNullableString(row.start_at, `${field}.start_at`),
    createdAt: toNullableString(row.created_at, `${field}.created_at`),
    updatedAt: toNullableString(row.updated_at, `${field}.updated_at`),
    createdVia: toRequiredString(row.created_via, `${field}.created_via`),
    counts: {
      total: count('total'),
      queued: count('queued'),
      sending: count('sending'),
      sent: count('sent'),
      delivered: count('delivered'),
      read: count('read'),
      failed: count('failed'),
      canceled: count('canceled'),
    },
    clicks,
  };
};

const toCampaignFromEnvelope = (raw: unknown): Campaign => toCampaign(toDataRecord(raw), 'data');

/** The API forbids `value` unless the source is `custom`, so an unset one is left out. */
const toVariableWire = (variable: CampaignTemplateVariable): Record<string, unknown> => {
  const wire: Record<string, unknown> = { index: variable.index, source: variable.source };
  if (variable.value !== undefined) wire.value = variable.value;
  return wire;
};

/** The API rejects a body with any other key, so every key is named here. */
const toCreateBody = (input: PreviewCampaignInput): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    name: input.name,
    phone_number_id: input.phoneNumberId,
    template: { name: input.template.name, language: input.template.language },
    audience: { tags: input.audience.tags },
  };
  if (input.templateVariables !== undefined) {
    body.template_variables = input.templateVariables.map(toVariableWire);
  }
  if (input.headerMediaUrl !== undefined) body.header_media_url = input.headerMediaUrl;
  if (input.trackedDestinationUrl !== undefined) body.tracked_destination_url = input.trackedDestinationUrl;
  if (input.sendAt !== undefined) {
    body.send_at = input.sendAt instanceof Date ? input.sendAt.toISOString() : input.sendAt;
  }
  return body;
};

/**
 * The key is the API's durable duplicate guard for a campaign, so the caller
 * must supply one it can send again; the SDK never generates it here.
 */
const requireCampaignKey = (idempotencyKey: unknown): string => {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
    throw new ValidationError({
      message: '`idempotencyKey` is required to create a campaign. Use a unique value per campaign (for example a UUID) and send the same value when you retry.',
      code: 'idempotency_key_required',
      status: 0,
    });
  }
  assertIdempotencyKey(idempotencyKey);
  return idempotencyKey;
};

export class CampaignsResource {
  readonly #req: Requester;

  constructor(req: Requester) {
    this.#req = req;
  }

  /**
   * POST /campaigns — create a WhatsApp campaign and start it now, or at `sendAt`.
   *
   * `idempotencyKey` is required. It is stored with the campaign as its
   * duplicate guard: keep it, and send the same value when you retry, so a
   * retry returns the first campaign (`replayed: true`) and never a second one.
   *
   * The audience is 1 to 20 tag names. The API allows 5 creates per minute per
   * key on top of the general rate limit.
   */
  readonly create = async (input: CreateCampaignInput): Promise<CreatedCampaign> => {
    const idempotencyKey = requireCampaignKey((input as { idempotencyKey?: unknown }).idempotencyKey);

    let replayed = false;
    const raw = await this.#req<unknown>({
      method: 'POST',
      path: '/campaigns',
      body: toCreateBody(input),
      idempotent: true,
      idempotencyKey,
      onHeaders: (headers) => {
        replayed = isIdempotentReplay(headers);
      },
    });
    return { campaign: toCampaignFromEnvelope(raw), replayed };
  };

  /**
   * POST /campaigns/preview — what `create()` would do with this input, without
   * creating anything.
   *
   * It never sends a message, never creates or queues a campaign and never
   * charges credits. A refusal `create()` would throw comes back in
   * `refusal`; it is not thrown. No `idempotencyKey` is needed (one passed is
   * ignored), and an API key with scope `read` is enough. The API allows 20
   * previews per minute per key on top of the general rate limit. The balance
   * can change before the real create, which stays the authority. For a
   * campaign that starts now `credits.estimated` is an upper bound; for a
   * scheduled one (`sendAt`) it is computed now and is not a bound, because the
   * audience, coverage and credits are checked again when it starts.
   */
  readonly preview = async (input: PreviewCampaignInput): Promise<SendPreview> => {
    const raw = await this.#req<unknown>({
      method: 'POST',
      path: '/campaigns/preview',
      body: toCreateBody(input),
      idempotent: false,
    });
    return toSendPreview(raw);
  };

  /**
   * GET /campaigns — one page of WhatsApp campaigns, newest first.
   *
   * Rows have no click counts (`clicks` is `null`); use `get()` for them.
   * There is no total: the last page is reached when `data.length < limit`.
   */
  readonly list = async (opts: ListOptions = {}): Promise<Page<Campaign>> => {
    const query = pageQuery(opts);
    const raw = await this.#req<unknown>({
      method: 'GET',
      path: '/campaigns',
      ...(query !== undefined ? { query } : {}),
    });
    return toPage(raw, toCampaign);
  };

  /** GET /campaigns/{id} — one campaign with its message and click counts. */
  readonly get = async (id: string): Promise<Campaign> => {
    const path = `/campaigns/${idSegment(id)}`;
    const raw = await this.#req<unknown>({ method: 'GET', path });
    return toCampaignFromEnvelope(raw);
  };

  /**
   * POST /campaigns/{id}/pause — pause an active campaign.
   *
   * 409 `campaign_busy` means another change is in progress; it is not retried
   * automatically.
   */
  readonly pause = async (id: string, opts: WriteOptions = {}): Promise<Campaign> =>
    this.#change(id, 'pause', opts);

  /**
   * POST /campaigns/{id}/resume — resume a paused campaign.
   *
   * 402 `insufficient_credits` or `subscription_lapsed` means the account
   * cannot pay for the remaining messages.
   */
  readonly resume = async (id: string, opts: WriteOptions = {}): Promise<Campaign> =>
    this.#change(id, 'resume', opts);

  readonly #change = async (id: string, action: 'pause' | 'resume', opts: WriteOptions): Promise<Campaign> => {
    const path = `/campaigns/${idSegment(id)}/${action}`;
    const write = writeOptions(opts.idempotencyKey);
    const raw = await this.#req<unknown>({ method: 'POST', path, ...write });
    return toCampaignFromEnvelope(raw);
  };
}
