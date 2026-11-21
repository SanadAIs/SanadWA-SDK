import type { Requester, RequestOptions } from '../request.js';
import type { ListTemplatesOptions, ListTemplatesResponse, Template } from '../types.js';

interface TemplateWire {
  name: string;
  language: string;
  category?: string | null;
  status: string;
  waba_id?: string | number | null;
  components?: unknown;
}

interface ListTemplatesWire {
  success: true;
  page: number;
  limit: number;
  data: TemplateWire[];
}

const toTemplate = (row: TemplateWire): Template => ({
  name: row.name,
  language: row.language,
  category: row.category ?? null,
  status: row.status,
  wabaId: row.waba_id != null ? String(row.waba_id) : null,
  components: row.components ?? null,
});

/**
 * GET /templates — list the account's APPROVED WhatsApp templates.
 *
 * Paged with `page` / `limit`; there is no total, so the last page is the one
 * with fewer than `limit` rows. Pass `phoneNumberId` to get only the templates
 * a sender can use.
 */
export const listTemplates = async (
  req: Requester,
  opts: ListTemplatesOptions = {},
): Promise<ListTemplatesResponse> => {
  const query: Record<string, string | number> = {};
  if (opts.page !== undefined) query.page = opts.page;
  if (opts.limit !== undefined) query.limit = opts.limit;
  if (opts.q !== undefined) query.q = opts.q;
  if (opts.phoneNumberId !== undefined) query.phone_number_id = opts.phoneNumberId;
  if (opts.wabaId !== undefined) query.waba_id = opts.wabaId;

  const request: RequestOptions = { method: 'GET', path: '/templates' };
  if (Object.keys(query).length > 0) request.query = query;

  const raw = await req<ListTemplatesWire>(request);
  return { page: raw.page, limit: raw.limit, data: raw.data.map(toTemplate) };
};
