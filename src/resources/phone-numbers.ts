import type { Requester } from '../request.js';
import type { ListPhoneNumbersResponse, PhoneNumber } from '../resource-types.js';
import { toId, toNullableString, toRecord, toRecordList, type WireRecord } from './resource-helpers.js';

const toPhoneNumber = (row: WireRecord): PhoneNumber => ({
  phoneNumberId: toId(row.phone_number_id),
  displayPhoneNumber: toNullableString(row.display_phone_number),
  verifiedName: toNullableString(row.verified_name),
  nameStatus: toNullableString(row.name_status),
  newNameStatus: toNullableString(row.new_name_status),
  wabaId: toId(row.waba_id),
  qualityRating: toNullableString(row.quality_rating),
  status: toNullableString(row.status),
});

export class PhoneNumbersResource {
  readonly #req: Requester;

  constructor(req: Requester) {
    this.#req = req;
  }

  /**
   * GET /phone-numbers — the account's active WhatsApp numbers, oldest first.
   *
   * `phoneNumberId` is the id `messages.send()` and `campaigns.create()` need.
   * The list is not paginated.
   */
  readonly list = async (): Promise<ListPhoneNumbersResponse> => {
    const raw = await this.#req<unknown>({ method: 'GET', path: '/phone-numbers' });
    return { data: toRecordList(toRecord(raw).data).map(toPhoneNumber) };
  };
}
