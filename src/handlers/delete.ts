import type { Env, DeleteRequestBody, DeleteResponseBody } from '../types';
import { HttpError } from '../errors';

// Vectorize accepts up to 1,000 IDs per deleteByIds call from Workers
const DELETE_BATCH = 1_000;

export async function handleDelete(req: Request, env: Env): Promise<Response> {
  let body: DeleteRequestBody;
  try {
    body = await req.json<DeleteRequestBody>();
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }

  if (!Array.isArray(body?.ids) || body.ids.length === 0) {
    throw new HttpError(400, '"ids" must be a non-empty string array');
  }
  if (body.ids.length > 10_000) {
    throw new HttpError(400, 'Maximum 10,000 IDs per request');
  }
  for (const id of body.ids) {
    if (typeof id !== 'string') {
      throw new HttpError(400, 'All IDs must be strings');
    }
  }

  for (let i = 0; i < body.ids.length; i += DELETE_BATCH) {
    await env.VECTORIZE.deleteByIds(body.ids.slice(i, i + DELETE_BATCH));
  }

  const responseBody: DeleteResponseBody = {
    deleted: body.ids.length,
    ids: body.ids,
  };

  return Response.json(responseBody);
}
