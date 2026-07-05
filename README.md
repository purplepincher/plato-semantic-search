# plato-semantic-search

Production Cloudflare Worker for semantic search using **Workers AI BGE-small-en-v1.5**
(384-dim) embeddings and **Vectorize** cosine-similarity ANN retrieval.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness probe |
| `GET` | `/stats` | Index statistics (vector count, dimensions, metric) |
| `POST` | `/search` | Semantic search — embed query → cosine ANN |
| `POST` | `/upsert` | Batch upsert — text→embed or pass pre-computed vectors |
| `DELETE` | `/delete` | Delete vectors by ID |

All endpoints return JSON and include CORS headers (`Access-Control-Allow-Origin: *`).

---

## Setup

> **New here?** Read **[SETUP.md](./SETUP.md)** — it is the authoritative,
> zero-context deploy guide covering every binding, secret, the Vectorize
> index, seeding, and testing. The summary below is the short version.

### 1. Create the Vectorize index

BGE-small-en-v1.5 produces **384-dimensional** vectors.  
Dimensions and metric are immutable after creation.

```bash
npx wrangler vectorize create plato-search --dimensions=384 --metric=cosine
```

Optional — create metadata indexes before inserting any vectors:

```bash
npx wrangler vectorize create-metadata-index plato-search \
  --property-name=domain --type=string
npx wrangler vectorize create-metadata-index plato-search \
  --property-name=version --type=number
```

### 2. Install dependencies

```bash
npm install
```

### 3. Optional: protect write endpoints with an API key

```bash
npx wrangler secret put API_KEY
# Enter your secret when prompted
```

When `API_KEY` is set, every request must include `Authorization: Bearer <key>`.

### 4. Deploy

```bash
# Local dev (AI requires --remote)
npm run dev

# Production
npm run deploy
```

---

## API Reference

### `GET /health`

```json
{
  "status": "ok",
  "service": "plato-semantic-search",
  "timestamp": "2026-06-15T12:00:00.000Z",
  "version": "2.0.0"
}
```

---

### `GET /stats`

```json
{
  "vectorCount": 548,
  "dimensions": 384,
  "metric": "cosine",
  "model": "@cf/baai/bge-small-en-v1.5"
}
```

---

### `POST /search`

**Request**

```jsonc
{
  "query": "semantic retrieval with vector search",   // required
  "topK": 10,                                          // 1-100, default 10
  "namespace": "docs",                                 // optional
  "filter": { "domain": "search" },                    // optional metadata filter
  "returnMetadata": "indexed"                          // "none" | "indexed" | "all" (default "indexed")
}
```

> `returnMetadata: "all"` silently caps `topK` at 20 (Vectorize limit).

**Response**

```jsonc
{
  "results": [
    { "id": "doc-001", "score": 0.934, "metadata": { "domain": "search" } }
  ],
  "query": "semantic retrieval with vector search",
  "topK": 10,
  "count": 1,
  "model": "@cf/baai/bge-small-en-v1.5",
  "latencyMs": 142
}
```

**Example**

```bash
curl -X POST https://plato-semantic-search.<account>.workers.dev/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"vector search embeddings","topK":5}'
```

---

### `POST /upsert`

Accepts up to **10,000 vectors** per request.  
Provide `text` (auto-embedded) or pre-computed `values`, not both.

**Request**

```jsonc
{
  "vectors": [
    {
      "id": "doc-001",
      "text": "Fast SIMD matrix multiplication for dense linear algebra workloads",
      "namespace": "reference",
      "metadata": { "domain": "linear-algebra", "version": 2 }
    },
    {
      "id": "doc-002",
      "values": [0.12, 0.34],
      "metadata": { "domain": "gpu" }
    }
  ]
}
```

**Response**

```jsonc
{
  "upserted": 2,
  "batches": 1,
  "model": "@cf/baai/bge-small-en-v1.5",
  "latencyMs": 380
}
```

**Batching behaviour**

| Layer | Batch size | Reason |
|-------|-----------|--------|
| Workers AI embedding | 100 texts/call | API limit |
| Vectorize upsert | 1,000 vectors/call | Workers binding limit |

Vectors are queryable ~5-10 seconds after upsert.

**Example**

```bash
curl -X POST https://plato-semantic-search.<account>.workers.dev/upsert \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": [
      {"id":"my-crate","text":"fast SIMD matrix multiplication","metadata":{"domain":"linear-algebra"}}
    ]
  }'
```

---

### `DELETE /delete`

**Request**

```json
{ "ids": ["doc-001", "doc-002"] }
```

**Response**

```json
{ "deleted": 2, "ids": ["doc-001", "doc-002"] }
```

Accepts up to **10,000 IDs** per request; batched internally at 1,000/call.

---

## Authentication

Set the `API_KEY` secret to enable Bearer-token auth on all endpoints:

```bash
npx wrangler secret put API_KEY
```

Then include the header on every request:

```
Authorization: Bearer <your-key>
```

Without `API_KEY`, the worker is open (suitable for internal/private deployments).

---

## Development

```bash
# Type check
npm run type-check

# Unit + integration + in-memory e2e tests (no remote needed)
npm test

# Interactive watch mode
npm run test:watch

# Local dev against live Vectorize + AI
npm run dev   # wrangler dev --remote

# Seed the index from data/seed.json (see SETUP.md §6 for full options)
npm run seed:dev                                              # local
npm run seed -- https://plato-semantic-search.<account>.workers.dev --api-key "$API_KEY"   # prod
```

---

## Architecture

```
Request
  └─ index.ts (router + CORS + auth)
       ├─ GET  /health  → handlers/health.ts
       ├─ GET  /stats   → handlers/stats.ts    env.VECTORIZE.describe()
       ├─ POST /search  → handlers/search.ts   AI.run(embed) → VECTORIZE.query()
       ├─ POST /upsert  → handlers/upsert.ts   AI.run(embed) → VECTORIZE.upsert()
       └─ DELETE /delete → handlers/delete.ts  VECTORIZE.deleteByIds()
```

Workers AI model: `@cf/baai/bge-small-en-v1.5` — 384 dimensions, ~33 ms/embed at edge.  
Vectorize index: cosine similarity, L2-normalised dot product under the hood.

---

## Wrangler config reference

```toml
[ai]
binding = "AI"          # env.AI -> Workers AI binding

[[vectorize]]
binding = "VECTORIZE"   # env.VECTORIZE -> Vectorize index binding
index_name = "plato-search"
```
