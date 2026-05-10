import type { Requester } from '../request.js';
import type { ListTemplatesOptions, ListTemplatesResponse, Template } from '../types.js';

interface ListTemplatesWire {
  success: true;
  page: number;
  limit: number;
  data: Template[];
}

/**
 * GET /templates — list approved WhatsApp templates for the tenant.
 */
export const listTemplates = async (
  req: Requester,
  opts: ListTemplatesOptions = {},
): Promise<ListTemplatesResponse> => {
  const query: Record<string, string | number> = {};
  if (opts.page !== undefined) query.page = opts.page;
  if (opts.limit !== undefined) query.limit = opts.limit;
  if (opts.q !== undefined) query.q = opts.q;

  const raw = await req<ListTemplatesWire>({
    method: 'GET',
    path: '/templates',
    query: Object.keys(query).length > 0 ? query : undefined,
  });
  return { page: raw.page, limit: raw.limit, data: raw.data };
};
