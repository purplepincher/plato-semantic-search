import type { Env, UpsertRequestBody, UpsertResponseBody } from '../types';
import { HttpError } from '../errors';
import { EMBED_MODEL } from './search';

// Workers AI embedding response shape
interface EmbedOutput { data: number[][] }

// Vectorize accepts up to 1,000 vectors per upsert call from Workers
const VECTORIZE_BATCH = 1_000;
// Workers AI embedding accepts up to 100 texts per call
const EMBED_BATCH = 100;

export async function handleUpsert(req: Request, env: Env): Promise<Response> {
  const start = Date.now();

  let body: UpsertRequestBody;
  try {
    body = await req.json<UpsertRequestBody>();
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }

  if (!Array.isArray(body?.vectors) || body.vectors.length === 0) {
    throw new HttpError(400, '"vectors" must be a non-empty array');
  }
  if (body.vectors.length > 10_000) {
    throw new HttpError(400, 'Maximum 10,000 vectors per request');
  }

  for (const v of body.vectors) {
    if (!v.id || typeof v.id !== 'string') {
      throw new HttpError(400, 'Each item must have a string "id"');
    }
    if (!v.text && !v.values) {
      throw new HttpError(400, `Item "${v.id}" must have either "text" or "values"`);
    }
    if (v.text && typeof v.text !== 'string') {
      throw new HttpError(400, `Item "${v.id}": "text" must be a string`);
    }
    if (v.values && !Array.isArray(v.values)) {
      throw new HttpError(400, `Item "${v.id}": "values" must be a number[]`);
    }
  }

  const textItems  = body.vectors.filter(v => v.text);
  const valueItems = body.vectors.filter(v => !v.text && v.values);

  const finalVectors: VectorizeVector[] = valueItems.map(v => ({
    id: v.id,
    values: v.values!,
    ...(v.namespace ? { namespace: v.namespace } : {}),
    ...(v.metadata  ? { metadata:  v.metadata  } : {}),
  }));

  // Embed text items in batches of EMBED_BATCH
  for (let i = 0; i < textItems.length; i += EMBED_BATCH) {
    const chunk = textItems.slice(i, i + EMBED_BATCH);
    const texts = chunk.map(v => v.text!);
    const out = await env.AI.run(EMBED_MODEL, { text: texts }) as unknown as EmbedOutput;

    for (let j = 0; j < chunk.length; j++) {
      const v = chunk[j];
      finalVectors.push({
        id: v.id,
        values: out.data[j],
        ...(v.namespace ? { namespace: v.namespace } : {}),
        ...(v.metadata  ? { metadata:  v.metadata  } : {}),
      });
    }
  }

  // Upsert to Vectorize in batches of VECTORIZE_BATCH
  let batches = 0;
  for (let i = 0; i < finalVectors.length; i += VECTORIZE_BATCH) {
    await env.VECTORIZE.upsert(finalVectors.slice(i, i + VECTORIZE_BATCH));
    batches++;
  }

  const responseBody: UpsertResponseBody = {
    upserted: finalVectors.length,
    batches,
    model: EMBED_MODEL,
    latencyMs: Date.now() - start,
  };

  return Response.json(responseBody);
}
