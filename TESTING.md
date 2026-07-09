# Testing — plato-semantic-search

> **Correction notice (2026-07).** An earlier version of this file referenced
> endpoints that no longer exist: `/index/stats`, `/index/upsert`,
> `/index/upsert-batch`, `/index/delete`, and `/sync/webhook`, plus a
> `plato-sync-queue` queue consumer. **None of those exist in the current
> Worker** (see `CHANGELOG.md` — the `/index/*` and webhook routes were part of
> 1.0.0 and removed in the 2.0.0 refactor). The real surface is
> `/health`, `/stats`, `/search`, `/upsert`, `/delete`. This file now uses only
> those.

The automated suite (`npm test`) runs **74 tests, 1 conditionally skipped**,
across three files, all against the real router in `src/index.ts`:

| File | What it covers |
|------|----------------|
| `src/index.test.ts` | Unit tests: routing, CORS, auth, validation, and call-shape assertions for every endpoint (AI + Vectorize stubbed with `vi.fn()`). |
| `test/integration.test.ts` | Broader integration coverage across all five endpoints with edge cases. |
| `test/e2e.test.ts` | End-to-end: a deterministic bag-of-words embedder + an in-memory cosine vector store, proving seed → `/search` → relevant top result. A **live** block runs against a real Worker only if `PLATO_E2E_URL` is set (skipped otherwise). |

## Run the automated tests

```bash
npm install          # one-time
npm run type-check   # tsc --noEmit
npm test             # vitest run  →  unit + integration + in-memory e2e
npm run test:watch   # vitest      →  watch mode for development
```

Expected:

```
 Test Files  3 passed (3)
      Tests  74 passed | 1 skipped (75)
```

### Run the e2e suite against a real Worker (optional)

The in-memory e2e suite always runs in CI. To exercise the same scenario
against a deployed Worker (or `wrangler dev --remote`):

```bash
npm run deploy        # or: npm run dev   (needs --remote for Workers AI)

PLATO_E2E_URL=https://plato-semantic-search.<account>.workers.dev \
PLATO_E2E_API_KEY=$API_KEY \
  npx vitest run test/e2e.test.ts
```

When `PLATO_E2E_URL` is unset, the live block is skipped so CI stays green
without cloud credentials.

## Manual smoke test against a running Worker

Start local (uses **remote** bindings — Workers AI is unavailable locally):

```bash
npm run dev           # serves http://localhost:8787
```

### 1. Health

```bash
curl http://localhost:8787/health
```

```json
{"status":"ok","service":"plato-semantic-search","timestamp":"2026-07-08T…","version":"2.0.0"}
```

### 2. Index stats

```bash
curl http://localhost:8787/stats
```

```json
{"vectorCount":0,"dimensions":384,"metric":"cosine","model":"@cf/baai/bge-small-en-v1.5"}
```

### 3. Upsert documents

```bash
curl -X POST http://localhost:8787/upsert \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": [
      {"id":"doc-1","text":"Fast SIMD matrix multiplication for dense linear algebra","metadata":{"domain":"linear-algebra"}},
      {"id":"doc-2","text":"Approximate nearest neighbour search over embeddings","metadata":{"domain":"search"}}
    ]
  }'
```

```json
{"upserted":2,"batches":1,"model":"@cf/baai/bge-small-en-v1.5","latencyMs":410}
```

### 4. Search

```bash
curl -X POST http://localhost:8787/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"vector similarity search","topK":5}'
```

```json
{"results":[{"id":"doc-2","score":0.91,"metadata":{"domain":"search"}}],"query":"vector similarity search","topK":5,"count":1,"model":"@cf/baai/bge-small-en-v1.5","latencyMs":142}
```

### 5. Delete

```bash
curl -X DELETE http://localhost:8787/delete \
  -H 'Content-Type: application/json' \
  -d '{"ids":["doc-1","doc-2"]}'
```

```json
{"deleted":2,"ids":["doc-1","doc-2"]}
```

## Authenticating requests

If you set the `API_KEY` secret (`wrangler secret put API_KEY`, or in
`.dev.vars` for local dev), **every** request must include the header:

```
Authorization: Bearer <your-key>
```

This includes read endpoints — `GET /health` and `GET /stats` return `401`
without it. (See `src/index.ts`; asserted in `src/index.test.ts`.)

## Troubleshooting

- **`404 Not Found` on `/index/stats` etc.** — you are following old docs. Use
  `/stats`, `/upsert`, `/delete` (no `/index/` prefix). See `README.md`.
- **Empty `/search` results immediately after `/upsert`** — Vectorize needs
  ~5–10 seconds to index new vectors; wait and retry.
- **`401 Unauthorized` on `/health`** — `API_KEY` is set; add the Bearer header.
- **Binding errors (`AI`, `VECTORIZE`)** — confirm `[ai]` and `[[vectorize]]`
  are in `wrangler.toml` and the `plato-search` index exists
  (`wrangler vectorize create plato-search --dimensions=384 --metric=cosine`).

See `SETUP.md` for the full deployment + binding guide.
