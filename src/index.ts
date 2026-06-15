import type { Env } from './types';
import { HttpError } from './errors';
import { handleHealth } from './handlers/health';
import { handleStats } from './handlers/stats';
import { handleSearch } from './handlers/search';
import { handleUpsert } from './handlers/upsert';
import { handleDelete } from './handlers/delete';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS_HEADERS };

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}

function addCors(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

type Handler = (req: Request, env: Env) => Promise<Response>;

// [method, path, handler]
const ROUTES: Array<[string, string, Handler]> = [
  ['GET',    '/health', handleHealth],
  ['GET',    '/stats',  handleStats],
  ['POST',   '/search', handleSearch],
  ['POST',   '/upsert', handleUpsert],
  ['DELETE', '/delete', handleDelete],
];

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Optional API key auth — set API_KEY secret in wrangler to enable
    if (env.API_KEY) {
      const auth = request.headers.get('Authorization') ?? '';
      if (auth !== `Bearer ${env.API_KEY}`) {
        return jsonError('Unauthorized', 401);
      }
    }

    const { pathname } = new URL(request.url);

    const route = ROUTES.find(([m, p]) => m === request.method && p === pathname);
    if (!route) {
      // Distinguish 404 from 405
      const pathExists = ROUTES.some(([, p]) => p === pathname);
      return jsonError(pathExists ? 'Method Not Allowed' : 'Not Found', pathExists ? 405 : 404);
    }

    try {
      return addCors(await route[2](request, env));
    } catch (err) {
      if (err instanceof HttpError) return jsonError(err.message, err.status);
      console.error('[plato-semantic-search] unhandled error:', err);
      return jsonError('Internal Server Error', 500);
    }
  },
};
