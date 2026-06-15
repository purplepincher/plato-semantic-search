import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from './index';
import type { Env } from './types';

// Workers AI returns data as flat number[][] (NOT .embedding nested)
const MOCK_VECTOR = Array<number>(384).fill(0.1);

const mockVectorize = {
  upsert:      vi.fn().mockResolvedValue({}),
  deleteByIds: vi.fn().mockResolvedValue({}),
  query:       vi.fn().mockResolvedValue({
    matches: [
      { id: 'doc-1', score: 0.95, metadata: { title: 'Alpha' } },
      { id: 'doc-2', score: 0.82, metadata: { title: 'Beta' } },
    ],
  }),
  // VectorizeIndexDetails shape: { config: { dimensions, metric }, vectorsCount }
  describe: vi.fn().mockResolvedValue({
    id: 'plato-search',
    name: 'plato-search',
    config: { dimensions: 384, metric: 'cosine' },
    vectorsCount: 1337,
  }),
};

const mockAi = {
  run: vi.fn().mockResolvedValue({ data: [MOCK_VECTOR] }),
};

function createEnv(overrides: Record<string, unknown> = {}) {
  return { VECTORIZE: mockVectorize, AI: mockAi, ...overrides } as unknown as Env;
}

function post(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('plato-semantic-search', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // ── GET /health ─────────────────────────────────────────────────────────────
  describe('GET /health', () => {
    it('returns 200 with ok status', async () => {
      const res = await handler.fetch(new Request('http://localhost/health'), createEnv(), {} as ExecutionContext);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, string>;
      expect(body.status).toBe('ok');
      expect(body.service).toBe('plato-semantic-search');
    });
  });

  // ── GET /stats ───────────────────────────────────────────────────────────────
  describe('GET /stats', () => {
    it('returns Vectorize describe() data', async () => {
      const res = await handler.fetch(new Request('http://localhost/stats'), createEnv(), {} as ExecutionContext);
      expect(res.status).toBe(200);
      expect(mockVectorize.describe).toHaveBeenCalledOnce();
      const body = await res.json() as Record<string, unknown>;
      expect(body.vectorCount).toBe(1337);
      expect(body.dimensions).toBe(384);
      expect(body.metric).toBe('cosine');
    });
  });

  // ── POST /search ─────────────────────────────────────────────────────────────
  describe('POST /search', () => {
    it('embeds query and returns matches', async () => {
      const res = await handler.fetch(post('/search', { query: 'conservation laws' }), createEnv(), {} as ExecutionContext);
      expect(res.status).toBe(200);
      expect(mockAi.run).toHaveBeenCalledWith('@cf/baai/bge-small-en-v1.5', { text: ['conservation laws'] });
      expect(mockVectorize.query).toHaveBeenCalledWith(MOCK_VECTOR, expect.objectContaining({ topK: 10 }));
      const body = await res.json() as Record<string, unknown>;
      expect(body.count).toBe(2);
      expect(Array.isArray(body.results)).toBe(true);
      expect(body.query).toBe('conservation laws');
    });

    it('returns 400 when query is missing', async () => {
      const res = await handler.fetch(post('/search', {}), createEnv(), {} as ExecutionContext);
      expect(res.status).toBe(400);
    });

    it('returns 400 when topK is out of range', async () => {
      const res = await handler.fetch(post('/search', { query: 'x', topK: 200 }), createEnv(), {} as ExecutionContext);
      expect(res.status).toBe(400);
    });

    it('passes namespace and filter to Vectorize', async () => {
      await handler.fetch(
        post('/search', { query: 'x', namespace: 'ns-a', filter: { category: 'docs' } }),
        createEnv(), {} as ExecutionContext,
      );
      expect(mockVectorize.query).toHaveBeenCalledWith(
        MOCK_VECTOR,
        expect.objectContaining({ namespace: 'ns-a', filter: { category: 'docs' } }),
      );
    });
  });

  // ── POST /upsert ─────────────────────────────────────────────────────────────
  describe('POST /upsert', () => {
    it('embeds text vectors and upserts to Vectorize', async () => {
      const res = await handler.fetch(
        post('/upsert', {
          vectors: [
            { id: 'a', text: 'First document' },
            { id: 'b', text: 'Second document' },
          ],
        }),
        createEnv(), {} as ExecutionContext,
      );
      expect(res.status).toBe(200);
      // AI called once with both texts batched
      expect(mockAi.run).toHaveBeenCalledWith(
        '@cf/baai/bge-small-en-v1.5',
        { text: ['First document', 'Second document'] },
      );
      expect(mockVectorize.upsert).toHaveBeenCalledOnce();
      const body = await res.json() as Record<string, unknown>;
      expect(body.upserted).toBe(2);
    });

    it('accepts pre-computed values without calling AI', async () => {
      const values = Array<number>(384).fill(0.5);
      const res = await handler.fetch(
        post('/upsert', { vectors: [{ id: 'c', values }] }),
        createEnv(), {} as ExecutionContext,
      );
      expect(res.status).toBe(200);
      expect(mockAi.run).not.toHaveBeenCalled();
      expect(mockVectorize.upsert).toHaveBeenCalledOnce();
    });

    it('returns 400 when vectors array is empty', async () => {
      const res = await handler.fetch(post('/upsert', { vectors: [] }), createEnv(), {} as ExecutionContext);
      expect(res.status).toBe(400);
    });

    it('returns 400 when an item has neither text nor values', async () => {
      const res = await handler.fetch(
        post('/upsert', { vectors: [{ id: 'x' }] }),
        createEnv(), {} as ExecutionContext,
      );
      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /delete ────────────────────────────────────────────────────────────
  describe('DELETE /delete', () => {
    it('calls deleteByIds and returns count', async () => {
      const req = new Request('http://localhost/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['doc-1', 'doc-2'] }),
      });
      const res = await handler.fetch(req, createEnv(), {} as ExecutionContext);
      expect(res.status).toBe(200);
      expect(mockVectorize.deleteByIds).toHaveBeenCalledWith(['doc-1', 'doc-2']);
      const body = await res.json() as Record<string, unknown>;
      expect(body.deleted).toBe(2);
    });

    it('returns 400 when ids array is empty', async () => {
      const req = new Request('http://localhost/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [] }),
      });
      const res = await handler.fetch(req, createEnv(), {} as ExecutionContext);
      expect(res.status).toBe(400);
    });
  });

  // ── CORS & routing ────────────────────────────────────────────────────────────
  describe('CORS', () => {
    it('responds to OPTIONS preflight with 204', async () => {
      const res = await handler.fetch(
        new Request('http://localhost/search', { method: 'OPTIONS' }),
        createEnv(), {} as ExecutionContext,
      );
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('adds CORS headers to all responses', async () => {
      const res = await handler.fetch(new Request('http://localhost/health'), createEnv(), {} as ExecutionContext);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('routing', () => {
    it('returns 404 for unknown path', async () => {
      const res = await handler.fetch(new Request('http://localhost/unknown'), createEnv(), {} as ExecutionContext);
      expect(res.status).toBe(404);
    });

    it('returns 405 for wrong method on known path', async () => {
      const res = await handler.fetch(
        new Request('http://localhost/search', { method: 'GET' }),
        createEnv(), {} as ExecutionContext,
      );
      expect(res.status).toBe(405);
    });
  });

  describe('auth', () => {
    it('returns 401 when API_KEY is set and no token provided', async () => {
      const res = await handler.fetch(
        new Request('http://localhost/health'),
        createEnv({ API_KEY: 'secret' }), {} as ExecutionContext,
      );
      expect(res.status).toBe(401);
    });

    it('passes when correct Bearer token is provided', async () => {
      const res = await handler.fetch(
        new Request('http://localhost/health', { headers: { Authorization: 'Bearer secret' } }),
        createEnv({ API_KEY: 'secret' }), {} as ExecutionContext,
      );
      expect(res.status).toBe(200);
    });
  });
});
