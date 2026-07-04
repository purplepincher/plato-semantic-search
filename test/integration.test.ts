import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from '../src/index';
import type { Env } from '../src/types';
import { EMBED_MODEL } from '../src/handlers/search';

// Workers AI returns { data: number[][] } — flat arrays, NOT nested .embedding
const EMBED_DIM = 384;
const MOCK_VECTOR = Array<number>(EMBED_DIM).fill(0.1);

// Scale mock embeddings to match the number of input texts
const mockAi = {
  run: vi.fn().mockImplementation((_model: string, { text }: { text: string[] }) =>
    Promise.resolve({ data: text.map(() => MOCK_VECTOR) }),
  ),
};

const mockVectorize = {
  query: vi.fn().mockResolvedValue({
    matches: [
      { id: 'vec-1', score: 0.97, metadata: { title: 'Alpha' } },
      { id: 'vec-2', score: 0.85, metadata: { title: 'Beta' } },
    ],
  }),
  upsert: vi.fn().mockResolvedValue({}),
  insert: vi.fn().mockResolvedValue({}),
  deleteByIds: vi.fn().mockResolvedValue({}),
  describe: vi.fn().mockResolvedValue({
    id: 'plato-search',
    name: 'plato-search',
    config: { dimensions: 384, metric: 'cosine' },
    vectorsCount: 42,
  }),
};

function makeEnv(overrides: Record<string, unknown> = {}): Env {
  return { AI: mockAi, VECTORIZE: mockVectorize, ...overrides } as unknown as Env;
}

const CTX = {} as ExecutionContext;

function get(path: string): Request {
  return new Request(`http://worker${path}`);
}

function post(path: string, body: unknown): Request {
  return new Request(`http://worker${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function del(path: string, body: unknown): Request {
  return new Request(`http://worker${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Plato Worker – integration', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // ── GET /health ──────────────────────────────────────────────────────────────

  describe('GET /health', () => {
    it('returns 200 with ok status and service metadata', async () => {
      const res = await handler.fetch(get('/health'), makeEnv(), CTX);
      expect(res.status).toBe(200);
      const body = await res.json<{ status: string; service: string; timestamp: string; version: string }>();
      expect(body.status).toBe('ok');
      expect(body.service).toBe('plato-semantic-search');
      expect(body.version).toBeDefined();
    });

    it('timestamp is a valid ISO 8601 string', async () => {
      const res = await handler.fetch(get('/health'), makeEnv(), CTX);
      const body = await res.json<{ timestamp: string }>();
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    });

    it('includes CORS headers', async () => {
      const res = await handler.fetch(get('/health'), makeEnv(), CTX);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('does not call AI or Vectorize', async () => {
      await handler.fetch(get('/health'), makeEnv(), CTX);
      expect(mockAi.run).not.toHaveBeenCalled();
      expect(mockVectorize.query).not.toHaveBeenCalled();
    });
  });

  // ── GET /stats ───────────────────────────────────────────────────────────────

  describe('GET /stats', () => {
    it('returns 200 with index statistics', async () => {
      const res = await handler.fetch(get('/stats'), makeEnv(), CTX);
      expect(res.status).toBe(200);
      const body = await res.json<{ vectorCount: number; dimensions: number; metric: string; model: string }>();
      expect(body.vectorCount).toBe(42);
      expect(body.dimensions).toBe(384);
      expect(body.metric).toBe('cosine');
      expect(body.model).toBe(EMBED_MODEL);
    });

    it('calls VECTORIZE.describe() exactly once', async () => {
      await handler.fetch(get('/stats'), makeEnv(), CTX);
      expect(mockVectorize.describe).toHaveBeenCalledOnce();
    });

    it('defaults dimensions to 384 and metric to cosine when config uses preset', async () => {
      mockVectorize.describe.mockResolvedValueOnce({
        id: 'plato-search',
        name: 'plato-search',
        config: { preset: 'openai-text-embedding-ada-002' },
        vectorsCount: 0,
      });
      const res = await handler.fetch(get('/stats'), makeEnv(), CTX);
      const body = await res.json<{ dimensions: number; metric: string; vectorCount: number }>();
      expect(body.dimensions).toBe(384);
      expect(body.metric).toBe('cosine');
      expect(body.vectorCount).toBe(0);
    });

    it('does not call AI', async () => {
      await handler.fetch(get('/stats'), makeEnv(), CTX);
      expect(mockAi.run).not.toHaveBeenCalled();
    });
  });

  // ── POST /search ─────────────────────────────────────────────────────────────

  describe('POST /search', () => {
    it('embeds the query and returns matches with full response shape', async () => {
      const res = await handler.fetch(post('/search', { query: 'conservation laws' }), makeEnv(), CTX);
      expect(res.status).toBe(200);
      expect(mockAi.run).toHaveBeenCalledWith(EMBED_MODEL, { text: ['conservation laws'] });
      const body = await res.json<{
        results: { id: string; score: number }[];
        query: string;
        count: number;
        topK: number;
        model: string;
        latencyMs: number;
      }>();
      expect(body.query).toBe('conservation laws');
      expect(body.count).toBe(2);
      expect(body.topK).toBe(10);
      expect(body.model).toBe(EMBED_MODEL);
      expect(typeof body.latencyMs).toBe('number');
      expect(Array.isArray(body.results)).toBe(true);
      expect(body.results[0].id).toBe('vec-1');
      expect(body.results[0].score).toBe(0.97);
    });

    it('passes the embedded vector to VECTORIZE.query', async () => {
      await handler.fetch(post('/search', { query: 'test' }), makeEnv(), CTX);
      expect(mockVectorize.query).toHaveBeenCalledWith(MOCK_VECTOR, expect.objectContaining({ topK: 10 }));
    });

    it('uses topK from request', async () => {
      await handler.fetch(post('/search', { query: 'test', topK: 5 }), makeEnv(), CTX);
      expect(mockVectorize.query).toHaveBeenCalledWith(MOCK_VECTOR, expect.objectContaining({ topK: 5 }));
    });

    it('passes namespace to VECTORIZE.query', async () => {
      await handler.fetch(post('/search', { query: 'x', namespace: 'docs' }), makeEnv(), CTX);
      expect(mockVectorize.query).toHaveBeenCalledWith(
        MOCK_VECTOR,
        expect.objectContaining({ namespace: 'docs' }),
      );
    });

    it('passes filter to VECTORIZE.query', async () => {
      const filter = { category: 'science' };
      await handler.fetch(post('/search', { query: 'x', filter }), makeEnv(), CTX);
      expect(mockVectorize.query).toHaveBeenCalledWith(
        MOCK_VECTOR,
        expect.objectContaining({ filter }),
      );
    });

    it('caps effectiveTopK at 20 when returnMetadata is "all"', async () => {
      await handler.fetch(post('/search', { query: 'x', topK: 50, returnMetadata: 'all' }), makeEnv(), CTX);
      expect(mockVectorize.query).toHaveBeenCalledWith(MOCK_VECTOR, expect.objectContaining({ topK: 20 }));
    });

    it('trims whitespace from query before embedding', async () => {
      await handler.fetch(post('/search', { query: '  hello world  ' }), makeEnv(), CTX);
      expect(mockAi.run).toHaveBeenCalledWith(EMBED_MODEL, { text: ['hello world'] });
    });

    it('returns 400 when query is missing', async () => {
      const res = await handler.fetch(post('/search', {}), makeEnv(), CTX);
      expect(res.status).toBe(400);
      const body = await res.json<{ error: string }>();
      expect(body.error).toBeTruthy();
    });

    it('returns 400 when query is empty string', async () => {
      const res = await handler.fetch(post('/search', { query: '' }), makeEnv(), CTX);
      expect(res.status).toBe(400);
    });

    it('returns 400 when query is whitespace-only', async () => {
      const res = await handler.fetch(post('/search', { query: '   ' }), makeEnv(), CTX);
      expect(res.status).toBe(400);
    });

    it('returns 400 when topK is below 1', async () => {
      const res = await handler.fetch(post('/search', { query: 'x', topK: 0 }), makeEnv(), CTX);
      expect(res.status).toBe(400);
    });

    it('returns 400 when topK exceeds 100', async () => {
      const res = await handler.fetch(post('/search', { query: 'x', topK: 101 }), makeEnv(), CTX);
      expect(res.status).toBe(400);
    });

    it('returns 400 when returnMetadata is an invalid value', async () => {
      const res = await handler.fetch(post('/search', { query: 'x', returnMetadata: 'partial' }), makeEnv(), CTX);
      expect(res.status).toBe(400);
    });

    it('returns 400 for malformed JSON body', async () => {
      const req = new Request('http://worker/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ bad json }',
      });
      const res = await handler.fetch(req, makeEnv(), CTX);
      expect(res.status).toBe(400);
    });
  });

  // ── POST /upsert ─────────────────────────────────────────────────────────────

  describe('POST /upsert', () => {
    it('embeds a text item and upserts to Vectorize', async () => {
      const res = await handler.fetch(
        post('/upsert', { vectors: [{ id: 'a', text: 'Hello world' }] }),
        makeEnv(), CTX,
      );
      expect(res.status).toBe(200);
      expect(mockAi.run).toHaveBeenCalledWith(EMBED_MODEL, { text: ['Hello world'] });
      expect(mockVectorize.upsert).toHaveBeenCalledOnce();
      const body = await res.json<{ upserted: number; batches: number; model: string; latencyMs: number }>();
      expect(body.upserted).toBe(1);
      expect(body.batches).toBe(1);
      expect(body.model).toBe(EMBED_MODEL);
      expect(typeof body.latencyMs).toBe('number');
    });

    it('batches multiple text items into a single AI call', async () => {
      const vectors = [
        { id: 'a', text: 'First' },
        { id: 'b', text: 'Second' },
        { id: 'c', text: 'Third' },
      ];
      await handler.fetch(post('/upsert', { vectors }), makeEnv(), CTX);
      expect(mockAi.run).toHaveBeenCalledOnce();
      expect(mockAi.run).toHaveBeenCalledWith(EMBED_MODEL, { text: ['First', 'Second', 'Third'] });
      const upsertArg = mockVectorize.upsert.mock.calls[0][0] as { id: string }[];
      expect(upsertArg).toHaveLength(3);
    });

    it('uses pre-computed values without calling AI', async () => {
      const values = Array<number>(EMBED_DIM).fill(0.5);
      const res = await handler.fetch(
        post('/upsert', { vectors: [{ id: 'x', values }] }),
        makeEnv(), CTX,
      );
      expect(res.status).toBe(200);
      expect(mockAi.run).not.toHaveBeenCalled();
      expect(mockVectorize.upsert).toHaveBeenCalledOnce();
      const body = await res.json<{ upserted: number }>();
      expect(body.upserted).toBe(1);
    });

    it('handles mixed text and pre-computed vectors in the same request', async () => {
      const preValues = Array<number>(EMBED_DIM).fill(0.3);
      const res = await handler.fetch(
        post('/upsert', {
          vectors: [
            { id: 'text-item', text: 'embedded text' },
            { id: 'value-item', values: preValues },
          ],
        }),
        makeEnv(), CTX,
      );
      expect(res.status).toBe(200);
      expect(mockAi.run).toHaveBeenCalledOnce();
      const body = await res.json<{ upserted: number }>();
      expect(body.upserted).toBe(2);
    });

    it('preserves metadata and namespace on upserted vectors', async () => {
      await handler.fetch(
        post('/upsert', {
          vectors: [{
            id: 'meta-item',
            text: 'with metadata',
            namespace: 'ns-1',
            metadata: { author: 'Alice', year: 2024 },
          }],
        }),
        makeEnv(), CTX,
      );
      const upsertArg = mockVectorize.upsert.mock.calls[0][0] as Array<{
        id: string;
        namespace?: string;
        metadata?: Record<string, unknown>;
      }>;
      expect(upsertArg[0].namespace).toBe('ns-1');
      expect(upsertArg[0].metadata).toEqual({ author: 'Alice', year: 2024 });
    });

    it('returns 400 when vectors array is empty', async () => {
      const res = await handler.fetch(post('/upsert', { vectors: [] }), makeEnv(), CTX);
      expect(res.status).toBe(400);
    });

    it('returns 400 when vectors field is missing', async () => {
      const res = await handler.fetch(post('/upsert', {}), makeEnv(), CTX);
      expect(res.status).toBe(400);
    });

    it('returns 400 when an item has neither text nor values', async () => {
      const res = await handler.fetch(
        post('/upsert', { vectors: [{ id: 'no-source' }] }),
        makeEnv(), CTX,
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when item id is missing', async () => {
      const res = await handler.fetch(
        post('/upsert', { vectors: [{ text: 'missing id' }] }),
        makeEnv(), CTX,
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when vectors count exceeds 10,000', async () => {
      const vectors = Array.from({ length: 10_001 }, (_, i) => ({ id: `v${i}`, text: 'x' }));
      const res = await handler.fetch(post('/upsert', { vectors }), makeEnv(), CTX);
      expect(res.status).toBe(400);
    });

    it('returns 400 for malformed JSON', async () => {
      const req = new Request('http://worker/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      const res = await handler.fetch(req, makeEnv(), CTX);
      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /delete ────────────────────────────────────────────────────────────

  describe('DELETE /delete', () => {
    it('calls deleteByIds and returns deleted count with ids echo', async () => {
      const ids = ['doc-1', 'doc-2', 'doc-3'];
      const res = await handler.fetch(del('/delete', { ids }), makeEnv(), CTX);
      expect(res.status).toBe(200);
      expect(mockVectorize.deleteByIds).toHaveBeenCalledWith(ids);
      const body = await res.json<{ deleted: number; ids: string[] }>();
      expect(body.deleted).toBe(3);
      expect(body.ids).toEqual(ids);
    });

    it('does not call AI or Vectorize.query', async () => {
      await handler.fetch(del('/delete', { ids: ['x'] }), makeEnv(), CTX);
      expect(mockAi.run).not.toHaveBeenCalled();
      expect(mockVectorize.query).not.toHaveBeenCalled();
    });

    it('returns 400 when ids array is empty', async () => {
      const res = await handler.fetch(del('/delete', { ids: [] }), makeEnv(), CTX);
      expect(res.status).toBe(400);
    });

    it('returns 400 when ids field is missing', async () => {
      const res = await handler.fetch(del('/delete', {}), makeEnv(), CTX);
      expect(res.status).toBe(400);
    });

    it('returns 400 when ids contains a non-string value', async () => {
      const res = await handler.fetch(del('/delete', { ids: ['valid', 123] }), makeEnv(), CTX);
      expect(res.status).toBe(400);
    });

    it('returns 400 when ids count exceeds 10,000', async () => {
      const ids = Array.from({ length: 10_001 }, (_, i) => `id-${i}`);
      const res = await handler.fetch(del('/delete', { ids }), makeEnv(), CTX);
      expect(res.status).toBe(400);
    });

    it('returns 400 for malformed JSON', async () => {
      const req = new Request('http://worker/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: '{ invalid',
      });
      const res = await handler.fetch(req, makeEnv(), CTX);
      expect(res.status).toBe(400);
    });
  });

  // ── CORS & routing ─────────────────────────────────────────────────────────────

  describe('CORS', () => {
    it('responds to OPTIONS preflight with 204 and CORS headers', async () => {
      const req = new Request('http://worker/search', { method: 'OPTIONS' });
      const res = await handler.fetch(req, makeEnv(), CTX);
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('adds CORS headers to all 2xx responses', async () => {
      const responses = await Promise.all([
        handler.fetch(get('/health'), makeEnv(), CTX),
        handler.fetch(get('/stats'), makeEnv(), CTX),
        handler.fetch(post('/search', { query: 'test' }), makeEnv(), CTX),
      ]);
      for (const res of responses) {
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      }
    });

    it('adds CORS headers to error responses', async () => {
      const res = await handler.fetch(post('/search', {}), makeEnv(), CTX);
      expect(res.status).toBe(400);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('routing', () => {
    it('returns 404 for unknown path', async () => {
      const res = await handler.fetch(get('/nonexistent'), makeEnv(), CTX);
      expect(res.status).toBe(404);
      const body = await res.json<{ error: string }>();
      expect(body.error).toBeTruthy();
    });

    it('returns 405 when method is wrong for a known path', async () => {
      const res = await handler.fetch(
        new Request('http://worker/search', { method: 'GET' }),
        makeEnv(), CTX,
      );
      expect(res.status).toBe(405);
    });
  });

  // ── Auth ───────────────────────────────────────────────────────────────────────

  describe('auth', () => {
    it('passes through when no API_KEY is configured', async () => {
      const res = await handler.fetch(get('/health'), makeEnv(), CTX);
      expect(res.status).toBe(200);
    });

    it('returns 401 when API_KEY is set and no Authorization header is provided', async () => {
      const res = await handler.fetch(get('/health'), makeEnv({ API_KEY: 'mysecret' }), CTX);
      expect(res.status).toBe(401);
      const body = await res.json<{ error: string }>();
      expect(body.error).toBeTruthy();
    });

    it('returns 401 when API_KEY is set and Bearer token is incorrect', async () => {
      const req = new Request('http://worker/health', {
        headers: { Authorization: 'Bearer wrongtoken' },
      });
      const res = await handler.fetch(req, makeEnv({ API_KEY: 'mysecret' }), CTX);
      expect(res.status).toBe(401);
    });

    it('passes through with the correct Bearer token', async () => {
      const req = new Request('http://worker/health', {
        headers: { Authorization: 'Bearer mysecret' },
      });
      const res = await handler.fetch(req, makeEnv({ API_KEY: 'mysecret' }), CTX);
      expect(res.status).toBe(200);
    });
  });
});
