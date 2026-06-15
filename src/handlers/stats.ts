import type { Env, StatsResponseBody } from '../types';
import { EMBED_MODEL } from './search';

export async function handleStats(_req: Request, env: Env): Promise<Response> {
  const info = await env.VECTORIZE.describe();
  // config is a union: { dimensions, metric } | { preset }
  const config = info.config;
  const dimensions = 'dimensions' in config ? config.dimensions : 384;
  const metric     = 'metric'     in config ? config.metric     : 'cosine';

  const body: StatsResponseBody = {
    vectorCount: info.vectorsCount ?? 0,
    dimensions,
    metric,
    model: EMBED_MODEL,
  };
  return Response.json(body);
}
