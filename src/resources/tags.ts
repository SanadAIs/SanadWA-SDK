import type { Requester } from '../request.js';
import type {
  CreateTagInput,
  DeletedResource,
  ListOptions,
  Page,
  Tag,
  WriteOptions,
} from '../resource-types.js';
import {
  idSegment,
  pageQuery,
  toDeletedResource,
  toId,
  toNullableString,
  toDataRecord,
  toPage,
  toRequiredString,
  writeOptions,
  type WireRecord,
} from './resource-helpers.js';

const toTag = (row: WireRecord, field: string): Tag => ({
  id: toId(row.id, `${field}.id`),
  name: toRequiredString(row.name, `${field}.name`),
  description: toNullableString(row.description, `${field}.description`),
  createdAt: toNullableString(row.created_at, `${field}.created_at`),
});

export class TagsResource {
  readonly #req: Requester;

  constructor(req: Requester) {
    this.#req = req;
  }

  /**
   * GET /tags — one page of the account's tags, ordered by id.
   *
   * There is no total: the last page is reached when `data.length < limit`.
   */
  readonly list = async (opts: ListOptions = {}): Promise<Page<Tag>> => {
    const query = pageQuery(opts);
    const raw = await this.#req<unknown>({
      method: 'GET',
      path: '/tags',
      ...(query !== undefined ? { query } : {}),
    });
    return toPage(raw, toTag);
  };

  /**
   * POST /tags — create a tag.
   *
   * Names are unique without regard to case (409 `tag_already_exists`) and may
   * not contain `,` or `;`.
   */
  readonly create = async (input: CreateTagInput): Promise<Tag> => {
    const write = writeOptions(input.idempotencyKey);
    const body: Record<string, unknown> = { name: input.name };
    if (input.description !== undefined) body.description = input.description;

    const raw = await this.#req<unknown>({ method: 'POST', path: '/tags', body, ...write });
    return toTag(toDataRecord(raw), 'data');
  };

  /**
   * DELETE /tags/{id} — remove a tag from the tag list.
   *
   * Contacts that carry the name keep it.
   */
  readonly delete = async (id: string, opts: WriteOptions = {}): Promise<DeletedResource> => {
    const path = `/tags/${idSegment(id)}`;
    const write = writeOptions(opts.idempotencyKey);
    const raw = await this.#req<unknown>({ method: 'DELETE', path, ...write });
    return toDeletedResource(raw);
  };
}
