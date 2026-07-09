# plato-semantic-search

A Cloudflare Worker that provides semantic search using Workers AI embeddings (`@cf/baai/bge-small-en-v1.5`, 384-dimensional) and a Vectorize cosine-similarity ANN index.

## Quickstart

```bash
# 1. Create the Vectorize index
npx wrangler vectorize create plato-search --dimensions=384 --metric=cosine

# 2. Install dependencies
npm install

# 3. (Optional) Protect ALL endpoints with a shared Bearer key
npx wrangler secret put API_KEY

# 4. Deploy (local dev requires --remote)
npm run dev          # local development
npm run deploy       # production
```

After deployment, verify the service is running:

```bash
curl https://<your-worker>.workers.dev/health
```

Response:

```json
{"status":"ok","service":"plato-semantic-search","timestamp":"2026-06-15T12:00:00.000Z","version":"2.0.0"}
```

## Usage

### Check health

```bash
curl https://<your-worker>.workers.dev/health
```

Response:

```json
{"status":"ok","service":"plato-semantic-search","timestamp":"2026-06-15T12:00:00.000Z","version":"2.0.0"}
```

### Upsert a document

```bash
curl -X POST https://<your-worker>.workers.dev/upsert \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": [
      {"id":"doc-001","text":"Fast SIMD matrix multiplication for dense linear algebra workloads","metadata":{"domain":"linear-algebra"}}
    ]
  }'
```

Response:

```json
{"upserted":1,"batches":1,"model":"@cf/baai/bge-small-en-v1.5","latencyMs":380}
```

### Search

```bash
curl -X POST https://<your-worker>.workers.dev/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"vector search embeddings","topK":5}'
```

Response:

```json
{"results":[{"id":"doc-001","score":0.934,"metadata":{"domain":"linear-algebra"}}],"query":"vector search embeddings","topK":5,"count":1,"model":"@cf/baai/bge-small-en-v1.5","latencyMs":142}
```

### Delete vectors

```bash
curl -X DELETE https://<your-worker>.workers.dev/delete \
  -H 'Content-Type: application/json' \
  -d '{"ids":["doc-001"]}'
```

Response:

```json
{"deleted":1,"ids":["doc-001"]}
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Returns service status |
| GET | `/stats` | Returns index statistics (vector count, dimensions, metric) |
| POST | `/search` | Semantic search – accepts `{ query, topK?, namespace?, filter?, returnMetadata? }` |
| POST | `/upsert` | Batch upsert – accepts `{ vectors: [{ id, text?, values?, namespace?, metadata? }] }` |
| DELETE | `/delete` | Delete vectors by ID – accepts `{ ids: string[] }` |

All responses are JSON and include CORS headers (`Access-Control-Allow-Origin: *`).

## Status & capabilities

Everything below was verified against the source in `src/` (router in
`src/index.ts`, handlers in `src/handlers/`) and the test suite in
`src/index.test.ts`, `test/integration.test.ts`, `test/e2e.test.ts`
(74 passing, 1 conditionally skipped).

- ✅ **Five endpoints, all real today:** `GET /health`, `GET /stats`,
  `POST /search`, `POST /upsert`, `DELETE /delete`.
- ✅ **Real embeddings:** text is embedded by Workers AI
  `@cf/baai/bge-small-en-v1.5` (384-dim); pre-computed `values` bypass the
  AI call entirely.
- ✅ **Real ANN search:** backed by a Vectorize cosine-similarity index
  (`env.VECTORIZE.query()`).
- ✅ **Batching:** embeddings batched at 100 texts/call, upserts at
  1,000 vectors/call, deletes at 1,000 IDs/call (binding limits).
- ✅ **CORS** (`Access-Control-Allow-Origin: *`) on every response, plus
  `OPTIONS` preflight handling.
- ✅ **Optional Bearer auth** via the `API_KEY` secret (gates all routes).
- ✅ **Namespacing & metadata filtering** passed through to Vectorize on
  `/search`.
- ⚠️ **Real but conditional:** the Worker only functions when deployed to
  Cloudflare with provisioned `AI` + `VECTORIZE` bindings. Workers AI is
  unavailable in the local simulator, so `npm run dev` runs
  `--remote` against your real account.

### What this Worker explicitly does NOT do (yet)

These are sometimes assumed from sibling docs but are **not** in the code —
do not expect them:

- 🔮 **No webhook / sync ingestion.** There is no `POST /sync/webhook` and no
  HMAC signature validation. (`FEATURES.md` describes one; it is inaccurate —
  see that file's corrected header.)
- 🔮 **No `/monitoring/*` endpoints, no Prometheus metrics, no rate limiting,
  no Cloudflare Queue consumer.** None of these exist in `src/`.
- 🔮 **No result caching.** Every `/search` hits the AI binding fresh.
- 🔮 **No `/similar`, `/recommend`, `/gap-analysis`, or bulk-ingest endpoints.**
  These were listed in the 1.0.0 changelog and removed in 2.0.0.
- 🔮 **No multi-auth.** Only a single shared Bearer token; no per-user /
  per-key identity.

## How it works

The Worker routes each request to a dedicated handler based on HTTP method and path:

```
Request
  → index.ts (router + CORS + optional auth)
       ├─ GET  /health  → handlers/health.ts
       ├─ GET  /stats   → handlers/stats.ts     (env.VECTORIZE.describe())
       ├─ POST /search  → handlers/search.ts    (AI.run() → VECTORIZE.query())
       ├─ POST /upsert  → handlers/upsert.ts    (AI.run() → VECTORIZE.upsert())
       └─ DELETE /delete → handlers/delete.ts   (VECTORIZE.deleteByIds())
```

- **Embedding**: The worker sends text to Workers AI model `@cf/baai/bge-small-en-v1.5` and receives a 384‑dimensional vector.
- **Index**: Vectorize stores the vectors and performs cosine‑similarity approximate nearest neighbour search.
- **Batching**: Embedding requests are batched at 100 texts per call; upsert calls are batched at 1,000 vectors per call (both are binding limits).
- **CORS**: The worker adds `Access-Control-Allow-Origin: *` to every response.

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_KEY` (Wrangler secret) | optional | none | If set, **every** request — including `GET /health` and `GET /stats` — must include `Authorization: Bearer <key>`. It is not scoped to writes. |
| `AI` binding | yes | – | Workers AI binding, configured in `wrangler.toml`. |
| `VECTORIZE` binding | yes | – | Vectorize index binding (`index_name = "plato-search"`), configured in `wrangler.toml`. |

See [`wrangler.toml`](./wrangler.toml) and [`SETUP.md`](./SETUP.md) for the full Wrangler configuration.

## Limitations

- The Vectorize index dimensions (384) and metric (`cosine`) are set at creation time and cannot be changed later.
- After upserting vectors, they become queryable after about 5–10 seconds.
- Upsert accepts up to 10,000 vectors per HTTP request; internally batched at 1,000 per Vectorize call.
- Delete accepts up to 10,000 IDs per request; also batched at 1,000.
- When `returnMetadata` is set to `"all"`, `topK` is silently capped at 20 (Vectorize limit).
- Authentication is only via Bearer token; no other auth methods are built in.
- The worker does not cache results.

## License

MIT — see [LICENSE](./LICENSE).

## See also

- [SETUP.md](./SETUP.md) – detailed deployment guide
- [TESTING.md](./TESTING.md) – testing instructions
- [`src/index.ts`](./src/index.ts) – router, CORS, and auth logic
- [`src/types.ts`](./src/types.ts) – request/response type definitions
