/**
 * Public types for the phone-number, balance, tag, contact and campaign
 * resources. Types only: this module has no runtime values.
 *
 * The wire format is snake_case; these are the camelCase SDK shapes. A field
 * typed `| null` is `null` when the API sends `null` or leaves the key out.
 */

// ── Pagination ──────────────────────────────────────────────────────────────

/**
 * One page of a list. The API returns no total and no next link: the last page
 * is reached when `data.length < limit`.
 */
export interface Page<T> {
  /** The page the server used (1-based). */
  page: number;
  /** The page size the server used (default 50, maximum 200). */
  limit: number;
  data: T[];
}

export interface ListOptions {
  /** 1-based page number. Sent only when set. */
  page?: number;
  /** Page size. Sent only when set; the server caps it at 200. */
  limit?: number;
}

/** Options shared by the write calls that take no body. */
export interface WriteOptions {
  /**
   * Sent as the `Idempotency-Key` header (1 to 120 visible ASCII characters).
   * When omitted the SDK generates a UUID and reuses it on its own retries.
   */
  idempotencyKey?: string;
}

export interface DeletedResource {
  id: string;
  deleted: boolean;
}

// ── Phone numbers ───────────────────────────────────────────────────────────

export interface PhoneNumber {
  /** The id `messages.send()` and `campaigns.create()` need. */
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  nameStatus: string | null;
  newNameStatus: string | null;
  /** The WhatsApp Business Account the number belongs to. */
  wabaId: string;
  qualityRating: string | null;
  status: string | null;
}

export interface ListPhoneNumbersResponse {
  /** Active numbers only, oldest first. */
  data: PhoneNumber[];
}

// ── Balance ─────────────────────────────────────────────────────────────────

export interface CreditUsage {
  /** First day of the month (UTC). */
  periodStart: string | null;
  creditsUsed: number;
  marketing: number;
  utility: number;
  authentication: number;
  service: number;
}

export interface CreditBalance {
  billingType: 'prepaid' | 'postpaid';
  /** `null` for accounts without a prepaid balance. */
  availableCredits: number | null;
  paidCreditsRemaining: number | null;
  freeCreditsRemaining: number;
  unlimited: boolean;
  /** `null` when `unlimited` is false. */
  unlimitedUntil: string | null;
  usageThisMonth: CreditUsage;
  asOf: string | null;
}

// ── Tags ────────────────────────────────────────────────────────────────────

export interface Tag {
  id: string;
  name: string;
  description: string | null;
  createdAt: string | null;
}

export interface CreateTagInput {
  /** 1 to 100 characters; may not contain `,` or `;`. Unique without regard to case. */
  name: string;
  /** At most 500 characters. `null` is sent as `null`; leave it out to send nothing. */
  description?: string | null;
  idempotencyKey?: string;
}

// ── Contacts ────────────────────────────────────────────────────────────────

export interface Contact {
  id: string;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  tags: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ListContactsOptions extends ListOptions {
  /** Exact tag name, compared without regard to case. */
  tag?: string;
}

export interface ContactInput {
  /** Required. International format, for example +12025550123; at most 32 characters. */
  phone: string;
  /** At most 100 characters. */
  firstName?: string | null;
  /** At most 100 characters. */
  lastName?: string | null;
  /** At most 254 characters; must look like an address. */
  email?: string | null;
  /** At most 10 names, each already in `tags.list()`. */
  tags?: string[];
}

export interface ContactItemError {
  /** `validation_error`, `duplicate_phone`, `tag_not_found` or `contact_write_failed`. */
  code: string;
  message: string;
}

export interface ContactUpsertItem {
  /** Position of the contact in the request. */
  index: number;
  status: 'created' | 'updated' | 'rejected' | 'failed';
  /** Set for `created` and `updated`. */
  contact: Contact | null;
  /** Set for `rejected` and `failed`. */
  error: ContactItemError | null;
}

export interface ContactUpsertSummary {
  created: number;
  updated: number;
  rejected: number;
  failed: number;
}

/**
 * Result of `contacts.upsert()`. The call succeeds (HTTP 200) even when items
 * are rejected: read `results[i].status`.
 */
export interface ContactUpsertResult {
  summary: ContactUpsertSummary;
  /** One per input, in the same order. */
  results: ContactUpsertItem[];
}

export interface ImportContactsInput {
  /** CSV content. A string is CSV text and is sent as UTF-8. At most 5 MB. */
  file: string | Uint8Array | Blob;
  /** Defaults to `contacts.csv`. */
  filename?: string;
  /** Applied to every row. At most 50 names of at most 100 characters; a name may not contain `,`. */
  tags?: string[];
  idempotencyKey?: string;
}

export interface ContactImportSummary {
  rows: number;
  created: number;
  updated: number;
  rejected: number;
  failed: number;
}

export interface ContactImportError {
  /** CSV line of the row; the header is line 1. */
  row: number;
  status: 'rejected' | 'failed';
  code: string;
  message: string;
}

/**
 * Result of `contacts.import()`. The call succeeds (HTTP 200) even when rows
 * are rejected: read `errors`.
 */
export interface ContactImportResult {
  summary: ContactImportSummary;
  errors: ContactImportError[];
}

// ── Campaigns ───────────────────────────────────────────────────────────────

export type CampaignStatus =
  | 'draft' | 'scheduled' | 'delayed' | 'start_failed'
  | 'active' | 'paused' | 'completed' | 'failed';

export type CampaignPauseReason =
  | 'paused_by_user' | 'insufficient_credits' | 'balance_check_failed'
  | 'start_failed' | 'event_cancelled';

export type CampaignVariableSource =
  | 'contact.first_name' | 'contact.last_name' | 'contact.phone' | 'contact.email' | 'custom';

export interface CampaignTemplate {
  name: string;
  language: string | null;
}

export interface CampaignAudience {
  /** `tags`, `all_contacts`, `uploaded_list`, `event` or `retarget`. */
  type: string;
  /** Empty unless `type` is `tags`. */
  tags: string[];
}

export interface CampaignCounts {
  total: number;
  queued: number;
  sending: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  canceled: number;
}

export interface CampaignClicks {
  tracked: number;
  clicked: number;
}

export interface Campaign {
  id: string;
  name: string;
  /** Known values: {@link CampaignStatus}. Treat any other value as not final. */
  status: string;
  /** Known values: {@link CampaignPauseReason}. `null` unless `status` is `paused`. */
  pauseReason: string | null;
  phoneNumberId: string | null;
  template: CampaignTemplate | null;
  audience: CampaignAudience | null;
  startAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  createdVia: 'api' | 'console';
  counts: CampaignCounts;
  /** `null` on `list()` (the list endpoint leaves it out); set on create, get, pause and resume. */
  clicks: CampaignClicks | null;
}

export interface CampaignTemplateVariable {
  /** Position of the template variable, starting at 1. */
  index: number;
  source: CampaignVariableSource;
  /** Required when `source` is `custom`; not allowed otherwise. */
  value?: string;
}

export interface CreateCampaignInput {
  /** 1 to 255 characters. */
  name: string;
  /** Digits, from `phoneNumbers.list()`. */
  phoneNumberId: string;
  /** Both are required: there is no default language here. */
  template: { name: string; language: string };
  /** 1 to 20 tag names. */
  audience: { tags: string[] };
  templateVariables?: CampaignTemplateVariable[];
  /** An https link. Required when the template has a media header. */
  headerMediaUrl?: string;
  trackedDestinationUrl?: string;
  /**
   * Leave out to start now. ISO 8601 with a time zone, in the future, at most
   * 30 days ahead. A `Date` is sent as `toISOString()`.
   */
  sendAt?: string | Date;
  /**
   * REQUIRED. Sent as the `Idempotency-Key` header. It is the API's durable
   * duplicate guard: use a unique value per campaign (for example a UUID),
   * store it, and send the same value when you retry.
   */
  idempotencyKey: string;
}

export interface CreatedCampaign {
  campaign: Campaign;
  /** `true` when the API answered with an earlier result for the same key. */
  replayed: boolean;
}
