//
// End-to-end integration test for plato-semantic-search.
//
// Unlike src/index.test.ts and test/integration.test.ts (which stub AI and
// Vectorize with canned vi.fn() return values and assert on call shape), this
// suite drives the REAL Worker (router -> handlers -> validation) against
// behaviorally-accurate fakes:
//
//   - AI.run()        -> a deterministic bag-of-words embedder (384-dim,
//                        L2-normalised) so that semantically similar texts map
//                        to nearby vectors.
//   - VECTORIZE.*     -> an in-memory vector store that performs a genuine
//                        cosine-similarity nearest-neighbour query, plus real
//                        upsert / deleteByIds / describe.
//
// This lets us assert an actual property the unit tests cannot: that after
// seeding, a relevant query returns the right document at the top.
//
// Optional LIVE mode: if PLATO_E2E_URL is set (and PLATO_E2E_API_KEY when the
// worker has API_KEY configured), the same scenario runs against a real
// deployed Worker / `wrangler dev --remote` via global fetch. When unset, the
// live block is skipped so CI stays green without cloud credentials.
//

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import handler from '../src/index';
import type { Env } from '../src/types';
import { EMBED_MODEL } from '../src/handlers/search';

// Node process is available under vitest but not in @cloudflare/workers-types.
declare const process: { env: Record<string, string | undefined> };

const DIM = 384;
const CTX = {} as ExecutionContext;

// ── Deterministic embedder ───────────────────────────────────────────────────
// Bag-of-words hashed into DIM dimensions, then L2-normalised. Mirrors the
// 384-dim shape of @cf/baai/bge-small-en-v1.5 well enough to make cosine
// similarity meaningful for relevance assertions.

function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function hashToken(t: string): number {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function embedOne(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (const tok of tokenize(text)) v[hashToken(tok) % DIM] += 1;
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

function embedMany(texts: string[]): number[][] {
  return texts.map(embedOne);
}

// ── In-memory Vectorize with real cosine similarity ──────────────────────────

interface StoredVector {
  id: string;
  values: number[];
  namespace?: string;
  metadata?: Record<string, unknown>;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s; // vectors are L2-normalised, so this IS cosine similarity
}

function makeVectorize() {
  const store = new Map<string, StoredVector>();

  const api = {
    async upsert(vectors: Array<{ id: string; values: number[]; namespace?: string; metadata?: Record<string, unknown> }>) {
      for (const v of vectors) store.set(v.id, { id: v.id, values: v.values, namespace: v.namespace, metadata: v.metadata });
      return {};
    },
    async deleteByIds(ids: string[]) {
      for (const id of ids) store.delete(id);
      return {};
    },
    async query(
      q: number[],
      opts: { topK?: number; returnMetadata?: string; namespace?: string; filter?: Record<string, unknown> } = {},
    ) {
      const topK = opts.topK ?? 10;
      const wantMeta = opts.returnMetadata !== 'none';
      let candidates = [...store.values()];
      if (opts.namespace) candidates = candidates.filter((v) => v.namespace === opts.namespace);
      if (opts.filter) {
        candidates = candidates.filter((v) =>
          Object.entries(opts.filter as Record<string, unknown>).every(([k, val]) => v.metadata?.[k] === val),
        );
      }
      const ranked = candidates
        .map((v) => ({ id: v.id, score: dot(q, v.values), metadata: wantMeta ? v.metadata : undefined }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
      return { matches: ranked };
    },
    async describe() {
      return { id: 'plato-search', name: 'plato-search', config: { dimensions: DIM, metric: 'cosine' }, vectorsCount: store.size };
    },
  };
  return api;
}

function makeEnv(): Env {
  return {
    AI: { run: async (_model: string, input: { text: string[] }) => ({ data: embedMany(input.text) }) } as unknown as Env['AI'],
    VECTORIZE: makeVectorize() as unknown as Env['VECTORIZE'],
  };
}

// ── Shared corpus (mirrors data/seed.json) ───────────────────────────────────

interface SeedItem { id: string; text: string; namespace?: string; metadata?: Record<string, unknown> }

const CORPUS: SeedItem[] = [
  { id: 'lau-conservation-c',  text: 'Conservation laws in ternary logic: a C-language treatment of balanced ternary arithmetic and the invariants preserved under three-valued transformations.', namespace: 'wave-3', metadata: { domain: 'algebra', wave: 3 } },
  { id: 'lau-flux-rs',          text: 'Flux hyperbolic geometry on the Poincare disk: Lorentz boosts and Mobius transformations implemented in Rust with const generics.', namespace: 'wave-3', metadata: { domain: 'geometry', wave: 3 } },
  { id: 'cuda-oxide',           text: 'GPU SIMD matrix multiplication kernels written in CUDA and Oxide for dense linear algebra workloads, with tiled shared-memory optimization.', namespace: 'wave-2', metadata: { domain: 'linear-algebra', wave: 2 } },
  { id: 'plato-store-kv',       text: 'Plato durable key-value store backed by Cloudflare Workers KV with read-through caching and eventual consistency semantics.', namespace: 'wave-1', metadata: { domain: 'storage', wave: 1 } },
  { id: 'plato-vectorize-bridge', text: 'Bridge crate connecting Plato embeddings to Cloudflare Vectorize for approximate nearest neighbor search over cosine similarity.', namespace: 'wave-2', metadata: { domain: 'search', wave: 2 } },
  { id: 'ternary-logic-primer', text: 'A primer on three-valued logic: Kleene and Lukasiewicz semantics, truth tables, and conservation of tautologies across ternary algebras.', namespace: 'wave-3', metadata: { domain: 'algebra', wave: 3 } },
  { id: 'hyperbolic-poincare',  text: 'The Poincare disk model of hyperbolic geometry: geodesics, isometries, and the Lorentz inner product on the unit disk.', namespace: 'wave-3', metadata: { domain: 'geometry', wave: 3 } },
  { id: 'simd-matmul',          text: 'SIMD-accelerated dense matrix multiplication for CPU: AVX-512 and NEON intrinsics, cache blocking, and autotuning tile sizes.', namespace: 'wave-2', metadata: { domain: 'linear-algebra', wave: 2 } },
  { id: 'workers-kv-cache',     text: 'Read-through caching patterns for Workers KV: stale-while-revalidate, edge regional caches, and cache-key design for hot keys.', namespace: 'wave-1', metadata: { domain: 'storage', wave: 1 } },
  { id: 'ann-cosine',           text: 'Approximate nearest neighbor search with cosine similarity: HNSW indexing, quantization, and recall tradeoffs on Vectorize.', namespace: 'wave-2', metadata: { domain: 'search', wave: 2 } },
  { id: 'lorentz-boost',        text: 'Lorentz transformations and relativistic boosts: the Lorentz group, invariant intervals, and hyperbolic rotations of Minkowski space.', namespace: 'wave-3', metadata: { domain: 'geometry', wave: 3 } },
  { id: 'kleene-three-valued',  text: "Kleene's three-valued logic with unknown as a third truth value: strong and weak Kleene tables, applications to database null semantics.", namespace: 'wave-3', metadata: { domain: 'algebra', wave: 3 } },
];

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

async function seedCorpus(env: Env): Promise<void> {
  const res = await handler.fetch(post('/upsert', { vectors: CORPUS }), env, CTX);
  if (!res.ok) throw new Error(`seed failed: ${res.status} ${await res.text()}`);
}

async function search(env: Env, query: string, topK = 5) {
  const res = await handler.fetch(post('/search', { query, topK }), env, CTX);
  if (!res.ok) throw new Error(`search failed: ${res.status} ${await res.text()}`);
  return res.json<{ results: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> }>();
}

// ── In-memory end-to-end (always runs) ───────────────────────────────────────

describe('e2e: seed -> /search -> relevant result (in-memory, real cosine)', () => {
  let env: Env;
  beforeAll(async () => {
    env = makeEnv();
    await seedCorpus(env);
  });

  it('seeds all 12 documents via POST /upsert', async () => {
    const res = await handler.fetch(new Request('http://worker/stats'), env, CTX);
    const body = await res.json<{ vectorCount: number; dimensions: number; metric: string }>();
    expect(body.vectorCount).toBe(12);
    expect(body.dimensions).toBe(DIM);
    expect(body.metric).toBe('cosine');
  });

  it('returns the ternary-logic conservation doc as a top hit for that query', async () => {
    const body = await search(env, 'ternary logic conservation laws', 5);
    const topIds = body.results.map((r) => r.id);
    // The strongest token overlap (conservation, laws, ternary, logic) is with
    // lau-conservation-c; it must be in the top 3 with a positive score.
    expect(topIds.slice(0, 3)).toContain('lau-conservation-c');
    expect(body.results[0].score).toBeGreaterThan(0);
  });

  it('ranks the GPU SIMD matmul doc #1 for a gpu/simd/matmul query', async () => {
    const body = await search(env, 'gpu simd matrix multiplication', 5);
    expect(body.results[0].id).toBe('cuda-oxide');
  });

  it('returns only geometry docs when filtered by metadata domain=geometry', async () => {
    const res = await handler.fetch(
      post('/search', { query: 'poincare hyperbolic geometry', topK: 10, filter: { domain: 'geometry' } }),
      env, CTX,
    );
    const body = await res.json<{ results: Array<{ id: string; metadata?: { domain?: string } }> }>();
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.every((r) => r.metadata?.domain === 'geometry')).toBe(true);
  });

  it('isolates results to a namespace', async () => {
    const res = await handler.fetch(
      post('/search', { query: 'matrix multiplication', topK: 10, namespace: 'wave-2' }),
      env, CTX,
    );
    const body = await res.json<{ results: Array<{ id: string }> }>();
    expect(body.results.length).toBeGreaterThan(0);
    // wave-2 holds the linear-algebra and search docs; simd-matmul & cuda-oxide live there.
    expect(body.results.some((r) => r.id === 'cuda-oxide' || r.id === 'simd-matmul')).toBe(true);
  });

  it('removes a document from search results after DELETE /delete', async () => {
    await handler.fetch(del('/delete', { ids: ['cuda-oxide'] }), env, CTX);
    const stats = await handler.fetch(new Request('http://worker/stats'), env, CTX);
    expect((await stats.json<{ vectorCount: number }>()).vectorCount).toBe(11);
    const body = await search(env, 'gpu simd matrix multiplication', 5);
    expect(body.results.map((r) => r.id)).not.toContain('cuda-oxide');
  });

  it('embeds the query with the documented model', async () => {
    env.AI.run = vi.fn().mockImplementation((_: string, input: { text: string[] }) =>
      Promise.resolve({ data: embedMany(input.text) }),
    ) as unknown as Env['AI']['run'];
    await search(env, 'hyperbolic poincare disk', 3);
    expect(env.AI.run).toHaveBeenCalledWith(EMBED_MODEL, { text: ['hyperbolic poincare disk'] });
  });
});

// ── Live end-to-end (opt-in via PLATO_E2E_URL) ───────────────────────────────
// Run against a real worker, e.g.:
//   PLATO_E2E_URL=https://plato-semantic-search.<account>.workers.dev \
//   PLATO_E2E_API_KEY=$API_KEY npx vitest run test/e2e.test.ts

const LIVE_URL = process.env.PLATO_E2E_URL;
const LIVE_KEY = process.env.PLATO_E2E_API_KEY;
const live = LIVE_URL ? describe : describe.skip;

function liveHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (LIVE_KEY) h.Authorization = `Bearer ${LIVE_KEY}`;
  return h;
}

live('e2e: live (PLATO_E2E_URL)', () => {
  const prefix = `e2e-${Date.now()}-`;
  const liveCorpus: SeedItem[] = [
    { id: `${prefix}conservation`, text: 'Conservation laws in ternary logic and balanced ternary arithmetic invariants.', namespace: 'e2e', metadata: { domain: 'algebra' } },
    { id: `${prefix}gpu`,          text: 'GPU SIMD matrix multiplication kernels for dense linear algebra workloads.', namespace: 'e2e', metadata: { domain: 'linear-algebra' } },
    { id: `${prefix}poincare`,     text: 'The Poincare disk model of hyperbolic geometry with Lorentz inner product.', namespace: 'e2e', metadata: { domain: 'geometry' } },
  ];

  afterAll(async () => {
    await fetch(`${LIVE_URL}/delete`, {
      method: 'DELETE', headers: liveHeaders(),
      body: JSON.stringify({ ids: liveCorpus.map((c) => c.id) }),
    }).catch(() => {});
  });

  it('seeds and finds the relevant doc', async () => {
    const up = await fetch(`${LIVE_URL}/upsert`, {
      method: 'POST', headers: liveHeaders(),
      body: JSON.stringify({ vectors: liveCorpus }),
    });
    expect(up.ok).toBe(true);
    // Vectorize needs ~5-10s to make vectors queryable.
    await new Promise((r) => setTimeout(r, 8000));
    const s = await fetch(`${LIVE_URL}/search`, {
      method: 'POST', headers: liveHeaders(),
      body: JSON.stringify({ query: 'gpu simd matrix multiplication', topK: 5, filter: { domain: 'linear-algebra' } }),
    });
    expect(s.ok).toBe(true);
    const body = await s.json<{ results: Array<{ id: string }> }>();
    expect(body.results.map((r) => r.id)).toContain(`${prefix}gpu`);
  });
});
