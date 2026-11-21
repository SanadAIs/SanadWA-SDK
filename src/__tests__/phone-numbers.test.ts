import { describe, it, expect, vi } from 'vitest';
import { PhoneNumbersResource } from '../resources/phone-numbers.js';
import { ServerError } from '../errors.js';
import type { Requester, RequestOptions } from '../request.js';

const fakeRequester = (response: unknown) => {
  const calls: RequestOptions[] = [];
  const fn = vi.fn(async (opts: RequestOptions) => {
    calls.push(opts);
    return response;
  });
  return { req: fn as unknown as Requester, calls };
};

describe('phoneNumbers.list', () => {
  it('GETs /phone-numbers with no query, no body and no Idempotency-Key', async () => {
    const { req, calls } = fakeRequester({ success: true, data: [] });
    await new PhoneNumbersResource(req).list();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ method: 'GET', path: '/phone-numbers' });
  });

  it('maps all eight fields', async () => {
    const { req } = fakeRequester({
      success: true,
      data: [{
        phone_number_id: '100000000000001',
        display_phone_number: '+12025550123',
        verified_name: 'Example Store',
        name_status: 'APPROVED',
        new_name_status: 'NONE',
        waba_id: '200000000000002',
        quality_rating: 'GREEN',
        status: 'CONNECTED',
      }],
    });
    const out = await new PhoneNumbersResource(req).list();
    expect(out).toEqual({
      data: [{
        phoneNumberId: '100000000000001',
        displayPhoneNumber: '+12025550123',
        verifiedName: 'Example Store',
        nameStatus: 'APPROVED',
        newNameStatus: 'NONE',
        wabaId: '200000000000002',
        qualityRating: 'GREEN',
        status: 'CONNECTED',
      }],
    });
  });

  it('maps the six nullable fields as null, also when the keys are missing', async () => {
    const { req } = fakeRequester({
      success: true,
      data: [
        {
          phone_number_id: '100000000000001',
          display_phone_number: null,
          verified_name: null,
          name_status: null,
          new_name_status: null,
          waba_id: '200000000000002',
          quality_rating: null,
          status: null,
        },
        { phone_number_id: 100000000000003, waba_id: 200000000000002 },
      ],
    });
    const out = await new PhoneNumbersResource(req).list();
    const nulls = {
      displayPhoneNumber: null,
      verifiedName: null,
      nameStatus: null,
      newNameStatus: null,
      qualityRating: null,
      status: null,
    };
    expect(out.data).toEqual([
      { phoneNumberId: '100000000000001', wabaId: '200000000000002', ...nulls },
      { phoneNumberId: '100000000000003', wabaId: '200000000000002', ...nulls },
    ]);
  });

  it('returns an empty list', async () => {
    const { req } = fakeRequester({ success: true, data: [] });
    expect(await new PhoneNumbersResource(req).list()).toEqual({ data: [] });
  });

  it('rethrows the requester error unchanged', async () => {
    const failure = new ServerError({ message: 'lookup failed', code: 'phone_numbers_lookup_failed', status: 500 });
    const req = vi.fn(async () => { throw failure; }) as unknown as Requester;
    await expect(new PhoneNumbersResource(req).list()).rejects.toBe(failure);
  });

  it('works when detached', async () => {
    const { req, calls } = fakeRequester({ success: true, data: [] });
    const { list } = new PhoneNumbersResource(req);
    await list();
    expect(calls[0]!.path).toBe('/phone-numbers');
  });
});
