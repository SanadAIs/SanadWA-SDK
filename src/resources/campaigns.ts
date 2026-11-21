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
  WriteOptions,
} from '../resource-types.js';
import {
  assertIdempotencyKey,
  idSegment,
  pageQuery,
  toId,
  toNullableId,
  toNullableString,
  toNumber,
  toPage,
  toRecord,
  toRecordOrNull,
  toStringList,
  toText,
  writeOptions,
  type WireRecord,
} from './resource-helpers.js';

const REPLAY_HEADER = 'x-idempotent-replay';

const toTemplate = (value: unknown): CampaignTemplate | null => {
  const template = toRecordOrNull(value);
  return template === null
    ? null
    : { name: toText(template.name), language: toNullableString(template.language) };
};

/** Only a `tags` audience carries tag names; the others are sent without the key. */
const toAudience = (value: unknown): CampaignAudience | null => {
  const audience = toRecordOrNull(value);
  return audience === null ? null : { type: toText(audience.type), tags: toStringList(audience.tags) };
};

/** The list endpoint omits `clicks`. */
const toClicks = (value: unknown): CampaignClicks | null => {
  const clicks = toRecordOrNull(value);
  return clicks === null ? null : { tracked: toNumber(clicks.tracked), clicked: toNumber(clicks.clicked) };
};

const toCampaign = (row: WireRecord): Campaign => {
  const counts = toRecord(row.counts);
  return {
    id: toId(row.id),
    name: toText(row.name),
    status: toText(row.status),
    pauseReason: toNullableString(row.pause_reason),
    phoneNumberId: toNullableId(row.phone_number_id),
    template: toTemplate(row.template),
    audience: toAudience(row.audience),
    startAt: toNullableString(row.start_at),
    createdAt: toNullableString(row.created_at),
    updatedAt: toNullableString(row.updated_at),
    createdVia: row.created_via === 'api' ? 'api' : 'console',
    counts: {
      total: toNumber(counts.total),
      queued: toNumber(counts.queued),
      sending: toNumber(counts.sending),
      sent: toNumber(counts.sent),
      delivered: toNumber(counts.delivered),
      read: toNumber(counts.read),
      failed: toNumber(counts.failed),
      canceled: toNumber(counts.canceled),
    },
    clicks: toClicks(row.clicks),
  };
};

const toCampaignFromEnvelope = (raw: unknown): Campaign => toCampaign(toRecord(toRecord(raw).data));

/** The API forbids `value` unless the source is `custom`, so an unset one is left out. */
const toVariableWire = (variable: CampaignTemplateVariable): Record<string, unknown> => {
  const wire: Record<string, unknown> = { index: variable.index, source: variable.source };
  if (variable.value !== undefined) wire.value = variable.value;
  return wire;
};

/** The API rejects a body with any other key, so every key is named here. */
const toCreateBody = (input: CreateCampaignInput): Record<string, unknown> => {
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
        replayed = headers.get(REPLAY_HEADER)?.trim().toLowerCase() === 'true';
      },
    });
    return { campaign: toCampaignFromEnvelope(raw), replayed };
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
