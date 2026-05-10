import type { Requester } from '../request.js';
import type { HealthResponse } from '../types.js';

interface HealthWire {
  success: true;
  tenant_id: string;
  scope: string;
  server_time: string;
}

/**
 * GET /health — verifies the API key is valid and returns tenant context.
 */
export const health = async (req: Requester): Promise<HealthResponse> => {
  const raw = await req<HealthWire>({ method: 'GET', path: '/health' });
  return {
    tenantId: raw.tenant_id,
    scope: raw.scope,
    serverTime: raw.server_time,
  };
};
