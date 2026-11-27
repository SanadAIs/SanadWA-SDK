import type { SendPreview, SendPreviewBalance, SendPreviewCredits, SendPreviewRecipients, SendPreviewRefusal } from '../resource-types.js';
import {
  malformed,
  toBoolean,
  toDataRecord,
  toInteger,
  toNullableNumber,
  toNullableString,
  toRecordOrNull,
  toRequiredString,
} from './resource-helpers.js';

const KINDS = ['template', 'text', 'campaign'] as const;
const BILLING_TYPES = ['prepaid', 'postpaid'] as const;

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], field: string): T => {
  const text = toRequiredString(value, field);
  return (allowed as readonly string[]).includes(text)
    ? (text as T)
    : malformed(field, `must be one of ${allowed.join(', ')}`);
};

const toRefusal = (value: unknown, field: string): SendPreviewRefusal | null => {
  const r = toRecordOrNull(value, field);
  return r === null
    ? null
    : {
      status: toInteger(r.status, `${field}.status`),
      code: toRequiredString(r.code, `${field}.code`),
      message: toRequiredString(r.message, `${field}.message`),
      messageAr: toRequiredString(r.message_ar, `${field}.message_ar`),
      details: toRecordOrNull(r.details, `${field}.details`),
    };
};

const toRecipients = (value: unknown, field: string): SendPreviewRecipients | null => {
  const r = toRecordOrNull(value, field);
  if (r === null) return null;
  const count = (key: string): number => toInteger(r[key], `${field}.${key}`);
  return {
    requested: count('requested'),
    optedOut: count('opted_out'),
    suppressed: count('suppressed'),
    invalidPhone: count('invalid_phone'),
    duplicate: count('duplicate'),
    allowlistBlocked: count('allowlist_blocked'),
    eligible: count('eligible'),
  };
};

const toCredits = (value: unknown, field: string): SendPreviewCredits | null => {
  const c = toRecordOrNull(value, field);
  return c === null
    ? null
    : {
      billingType: oneOf(c.billing_type, BILLING_TYPES, `${field}.billing_type`),
      chargeCategory: toRequiredString(c.charge_category, `${field}.charge_category`),
      perMessage: toInteger(c.per_message, `${field}.per_message`),
      estimated: toInteger(c.estimated, `${field}.estimated`),
      fromFreeAllowance: toInteger(c.from_free_allowance, `${field}.from_free_allowance`),
      fromPaidBalance: toInteger(c.from_paid_balance, `${field}.from_paid_balance`),
      coveredBySubscription: toBoolean(c.covered_by_subscription, `${field}.covered_by_subscription`),
    };
};

const toBalance = (value: unknown, field: string): SendPreviewBalance | null => {
  const b = toRecordOrNull(value, field);
  return b === null
    ? null
    : {
      availableCredits: toNullableNumber(b.available_credits, `${field}.available_credits`),
      // May be negative: the send is short by that much.
      afterSend: toNullableNumber(b.after_send, `${field}.after_send`),
      unlimited: toBoolean(b.unlimited, `${field}.unlimited`),
    };
};

const toTemplate = (value: unknown, field: string): SendPreview['template'] => {
  const t = toRecordOrNull(value, field);
  return t === null
    ? null
    : {
      name: toRequiredString(t.name, `${field}.name`),
      language: toNullableString(t.language, `${field}.language`),
      category: toNullableString(t.category, `${field}.category`),
    };
};

/**
 * Reads the `{ success, data }` answer of `POST /messages/preview` and
 * `POST /campaigns/preview`. A missing or mistyped field throws
 * `malformed_response` naming its wire path (`data.recipients.opted_out`).
 */
export const toSendPreview = (raw: unknown): SendPreview => {
  const d = toDataRecord(raw);
  return {
    kind: oneOf(d.kind, KINDS, 'data.kind'),
    wouldSend: toBoolean(d.would_send, 'data.would_send'),
    refusal: toRefusal(d.refusal, 'data.refusal'),
    template: toTemplate(d.template, 'data.template'),
    recipients: toRecipients(d.recipients, 'data.recipients'),
    credits: toCredits(d.credits, 'data.credits'),
    balance: toBalance(d.balance, 'data.balance'),
    asOf: toRequiredString(d.as_of, 'data.as_of'),
  };
};
