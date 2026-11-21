import type { Requester, RequestOptions } from '../request.js';
import { ValidationError } from '../errors.js';
import type {
  Contact,
  ContactImportError,
  ContactImportResult,
  ContactInput,
  ContactItemError,
  ContactUpsertItem,
  ContactUpsertResult,
  DeletedResource,
  ImportContactsInput,
  ListContactsOptions,
  Page,
  WriteOptions,
} from '../resource-types.js';
import {
  idSegment,
  pageQuery,
  toDeletedResource,
  toId,
  toNullableString,
  toNumber,
  toPage,
  toRecord,
  toRecordList,
  toRecordOrNull,
  toStringList,
  toText,
  writeOptions,
  type WireRecord,
} from './resource-helpers.js';

const CONTACTS_BATCH_MAX = 100;
const IMPORT_MAX_BYTES = 5_242_880;
const IMPORT_DEFAULT_FILENAME = 'contacts.csv';
const CSV_CONTENT_TYPE = 'text/csv';

const toContact = (row: WireRecord): Contact => ({
  id: toId(row.id),
  phone: toNullableString(row.phone),
  firstName: toNullableString(row.first_name),
  lastName: toNullableString(row.last_name),
  email: toNullableString(row.email),
  tags: toStringList(row.tags),
  createdAt: toNullableString(row.created_at),
  updatedAt: toNullableString(row.updated_at),
});

const toItemError = (value: unknown): ContactItemError | null => {
  const error = toRecordOrNull(value);
  return error === null ? null : { code: toText(error.code), message: toText(error.message) };
};

const toUpsertItem = (row: WireRecord): ContactUpsertItem => {
  const contact = toRecordOrNull(row.contact);
  return {
    index: toNumber(row.index),
    status: toText(row.status) as ContactUpsertItem['status'],
    contact: contact === null ? null : toContact(contact),
    error: toItemError(row.error),
  };
};

const toImportError = (row: WireRecord): ContactImportError => ({
  row: toNumber(row.row),
  status: toText(row.status) as ContactImportError['status'],
  code: toText(row.code),
  message: toText(row.message),
});

/** The API rejects an item that carries any key other than these five. */
const toContactWire = (input: ContactInput): Record<string, unknown> => {
  const item: Record<string, unknown> = { phone: input.phone };
  if (input.firstName !== undefined) item.first_name = input.firstName;
  if (input.lastName !== undefined) item.last_name = input.lastName;
  if (input.email !== undefined) item.email = input.email;
  if (input.tags !== undefined) item.tags = input.tags;
  return item;
};

const toCsvBlob = (file: ImportContactsInput['file']): Blob => {
  if (typeof file === 'string') return new Blob([file], { type: CSV_CONTENT_TYPE });
  if (file instanceof Blob) {
    return file.type === CSV_CONTENT_TYPE ? file : new Blob([file], { type: CSV_CONTENT_TYPE });
  }
  // The cast admits a view over a SharedArrayBuffer, which `Blob` copies like any other.
  return new Blob([file as BlobPart], { type: CSV_CONTENT_TYPE });
};

export class ContactsResource {
  readonly #req: Requester;

  constructor(req: Requester) {
    this.#req = req;
  }

  /**
   * GET /contacts — one page of contacts, ordered by phone.
   *
   * `tag` filters by an exact tag name, compared without regard to case. There
   * is no phone or free-text filter, and no total: the last page is reached
   * when `data.length < limit`.
   */
  readonly list = async (opts: ListContactsOptions = {}): Promise<Page<Contact>> => {
    const query = pageQuery(opts, { tag: opts.tag });
    const raw = await this.#req<unknown>({
      method: 'GET',
      path: '/contacts',
      ...(query !== undefined ? { query } : {}),
    });
    return toPage(raw, toContact);
  };

  /**
   * POST /contacts — create or update 1 to 100 contacts.
   *
   * The phone is the key: a phone that already exists is updated (a new first
   * name replaces the stored one, last name and email are filled only when
   * empty, tags are added, nothing is removed). Tags must already exist.
   *
   * The call succeeds even when items are rejected. It does not throw for item
   * errors: read `results[i].status` and `results[i].error`.
   */
  readonly upsert = async (
    contacts: ContactInput | ContactInput[],
    opts: WriteOptions = {},
  ): Promise<ContactUpsertResult> => {
    const items = Array.isArray(contacts) ? contacts : [contacts];
    if (items.length === 0 || items.length > CONTACTS_BATCH_MAX) {
      throw new ValidationError({
        message: `\`contacts\` must contain 1 to ${CONTACTS_BATCH_MAX} contacts.`,
        code: 'invalid_contacts',
        status: 0,
      });
    }
    const write = writeOptions(opts.idempotencyKey);

    const raw = await this.#req<unknown>({
      method: 'POST',
      path: '/contacts',
      body: { contacts: items.map(toContactWire) },
      ...write,
    });
    const data = toRecord(toRecord(raw).data);
    const summary = toRecord(data.summary);
    return {
      summary: {
        created: toNumber(summary.created),
        updated: toNumber(summary.updated),
        rejected: toNumber(summary.rejected),
        failed: toNumber(summary.failed),
      },
      results: toRecordList(data.results).map(toUpsertItem),
    };
  };

  /**
   * DELETE /contacts/{id} — delete a contact.
   *
   * A contact that opted out cannot be deleted (409 `contact_opted_out`).
   */
  readonly delete = async (id: string, opts: WriteOptions = {}): Promise<DeletedResource> => {
    const path = `/contacts/${idSegment(id)}`;
    const write = writeOptions(opts.idempotencyKey);
    const raw = await this.#req<unknown>({ method: 'DELETE', path, ...write });
    return toDeletedResource(raw);
  };

  /**
   * POST /contacts/import — create or update contacts from a CSV file.
   *
   * The file needs a header row with a `phone` column; `first_name`,
   * `last_name`, `email` and `tags` are optional. Limits: 5 MB and 5000 rows.
   *
   * The call succeeds even when rows are rejected. It does not throw for row
   * errors: read `errors`, where `row` is the CSV line (the header is line 1).
   */
  readonly import = async (input: ImportContactsInput): Promise<ContactImportResult> => {
    const write = writeOptions(input.idempotencyKey);

    const tags = input.tags ?? [];
    if (tags.some((tag) => typeof tag !== 'string' || tag.includes(','))) {
      throw new ValidationError({
        message: '`tags` names may not contain a comma: the names are sent as one comma-separated list.',
        code: 'invalid_import_tags',
        status: 0,
      });
    }

    const file = toCsvBlob(input.file);
    if (file.size > IMPORT_MAX_BYTES) {
      throw new ValidationError({
        message: 'The file is larger than 5 MB. Split it into smaller files.',
        code: 'import_file_too_large',
        status: 0,
      });
    }

    const formData = new FormData();
    formData.append('file', file, input.filename ?? IMPORT_DEFAULT_FILENAME);
    if (tags.length > 0) formData.append('tags', tags.join(','));

    // Typed as a superset so this file also compiles against a requester whose
    // `RequestOptions` does not declare `formData` yet.
    const request: RequestOptions & { formData: FormData } = {
      method: 'POST',
      path: '/contacts/import',
      formData,
      ...write,
    };
    const raw = await this.#req<unknown>(request);
    const data = toRecord(toRecord(raw).data);
    const summary = toRecord(data.summary);
    return {
      summary: {
        rows: toNumber(summary.rows),
        created: toNumber(summary.created),
        updated: toNumber(summary.updated),
        rejected: toNumber(summary.rejected),
        failed: toNumber(summary.failed),
      },
      errors: toRecordList(data.errors).map(toImportError),
    };
  };
}
