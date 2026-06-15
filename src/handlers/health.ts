import type { Env, HealthResponseBody } from '../types';

export async function handleHealth(_req: Request, _env: Env): Promise<Response> {
  const body: HealthResponseBody = {
    status: 'ok',
    service: 'plato-semantic-search',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
  };
  return Response.json(body);
}
