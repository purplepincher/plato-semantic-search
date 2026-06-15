import type { Env, SearchRequestBody, SearchResponseBody } from '../types';
import { HttpError } from '../errors';

export const EMBED_MODEL = '@cf/baai/bge-small-en-v1.5';

// Workers AI embedding response shape
interface EmbedOutput { data: number[][] }

export async function handleSearch(req: Request, env: Env): Promise<Response> {
  const start = Date.now();

  let body: SearchRequestBody;
  try {
    body = await req.json<SearchRequestBody>();
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }

  if (!body.query || typeof body.query !== 'string' || body.query.trim() === '') {
    throw new HttpError(400, '"query" is required and must be a non-empty string');
  }

  const topK = body.topK ?? 10;
  if (!Number.isInteger(topK) || topK < 1 || topK > 100) {
    throw new HttpError(400, '"topK" must be an integer between 1 and 100');
  }

  const returnMetadata = body.returnMetadata ?? 'indexed';
  if (!['none', 'indexed', 'all'].includes(returnMetadata)) {
    throw new HttpError(400, '"returnMetadata" must be "none", "indexed", or "all"');
  }

  // Vectorize limits topK to 20 when returning all metadata or values
  const effectiveTopK = returnMetadata === 'all' ? Math.min(topK, 20) : topK;

  const embedOut = await env.AI.run(EMBED_MODEL, { text: [body.query.trim()] }) as unknown as EmbedOutput;
  const queryVector = embedOut.data[0];

  const queryOptions: VectorizeQueryOptions = {
    topK: effectiveTopK,
    returnMetadata,
    returnValues: false,
  };
  if (body.namespace) queryOptions.namespace = body.namespace;
  if (body.filter)    queryOptions.filter    = body.filter;

  const results = await env.VECTORIZE.query(queryVector, queryOptions);

  const responseBody: SearchResponseBody = {
    results: results.matches.map(m => ({
      id: m.id,
      score: m.score,
      ...(m.metadata ? { metadata: m.metadata } : {}),
    })),
    query: body.query,
    topK: effectiveTopK,
    count: results.matches.length,
    model: EMBED_MODEL,
    latencyMs: Date.now() - start,
  };

  return Response.json(responseBody);
}
