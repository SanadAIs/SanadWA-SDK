import type { Requester } from '../request.js';
import type { ListPhoneNumbersResponse, PhoneNumber } from '../resource-types.js';
import { toDataList, toId, toNullableString, type WireRecord } from './resource-helpers.js';

const toPhoneNumber = (row: WireRecord, field: string): PhoneNumber => ({
  phoneNumberId: toId(row.phone_number_id, `${field}.phone_number_id`),
  displayPhoneNumber: toNullableString(row.display_phone_number, `${field}.display_phone_number`),
  verifiedName: toNullableString(row.verified_name, `${field}.verified_name`),
  nameStatus: toNullableString(row.name_status, `${field}.name_status`),
  newNameStatus: toNullableString(row.new_name_status, `${field}.new_name_status`),
  wabaId: toId(row.waba_id, `${field}.waba_id`),
  qualityRating: toNullableString(row.quality_rating, `${field}.quality_rating`),
  status: toNullableString(row.status, `${field}.status`),
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
    return { data: toDataList(raw, toPhoneNumber) };
  };
}
