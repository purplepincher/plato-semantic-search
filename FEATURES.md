# Features — plato-semantic-search

> **Correction notice (2026-07).** An earlier version of this file described a
> webhook integration (`POST /sync/webhook` with HMAC validation), advanced
> monitoring endpoints (`/monitoring/health`, `/monitoring/version`,
> `/monitoring/metrics` with Prometheus output), built-in per-IP rate limiting,
> uptime tracking, and a Cloudflare Queue consumer. **None of those features
> exist in the Worker source.** They were carried over from aspirational 1.0.0
> copy and never landed (or were removed in the 2.0.0 refactor — see
> `CHANGELOG.md`). This file now documents only what the code actually does.
>
> The same caveat applies to `TESTING.md` until it is updated: trust this file,
> `README.md`, and `SETUP.md` over the legacy copy.

Everything below was verified against `src/index.ts` (router) and the handlers
in `src/handlers/` (`health`, `stats`, `search`, `upsert`, `delete`), and is
covered by the passing test suite (`src/index.test.ts`,
`test/integration.test.ts`, `test/e2e.test.ts`).

## What is real today (✅)

### Five HTTP endpoints

| Method | Path | Handler | What it does |
|--------|------|---------|--------------|
| `GET` | `/health` | `handlers/health.ts` | Returns `{ status, service, timestamp, version }`. No binding calls — always succeeds. |
| `GET` | `/stats` | `handlers/stats.ts` | Calls `env.VECTORIZE.describe()` and returns `{ vectorCount, dimensions, metric, model }`. |
| `POST` | `/search` | `handlers/search.ts` | Embeds the query via Workers AI, then runs `env.VECTORIZE.query()`. Supports `topK`, `namespace`, `filter`, `returnMetadata`. |
| `POST` | `/upsert` | `handlers/upsert.ts` | Accepts text (embedded server-side) **or** pre-computed `values`, then `env.VECTORIZE.upsert()`. |
| `DELETE` | `/delete` | `handlers/delete.ts` | Calls `env.VECTORIZE.deleteByIds()` for a list of IDs. |

### Embedding & indexing

- ✅ Text → vector via Workers AI `@cf/baai/bge-small-en-v1.5` (384-dimensional).
- ✅ Cosine-similarity ANN search via a Vectorize index (`plato-search`).
- ✅ Pre-computed vectors (`values`) skip the AI call entirely.

### Batch processing (binding limits)

- ✅ Embedding requests batched at **100 texts** per `AI.run()` call.
- ✅ Upserts batched at **1,000 vectors** per `VECTORIZE.upsert()` call (up to
  10,000 accepted per HTTP request).
- ✅ Deletes batched at **1,000 IDs** per `VECTORIZE.deleteByIds()` call (up to
  10,000 accepted per HTTP request).

### Request handling

- ✅ Centralized router (`ROUTES` table in `src/index.ts`) with proper
  **404 vs 405** distinction and a shared `HttpError` → JSON error mapping.
- ✅ **CORS** (`Access-Control-Allow-Origin: *`) applied to every response,
  with `OPTIONS` preflight returning `204 No Content`.
- ✅ Optional **Bearer auth**: if the `API_KEY` secret is set, every request —
  including `GET /health` — must carry `Authorization: Bearer <key>`.
- ✅ Input validation with `400` responses for malformed bodies, empty arrays,
  non-string IDs, out-of-range `topK` (1–100), and invalid `returnMetadata`.

### Seeding tooling

- ✅ `scripts/seed.ts` — POSTs `data/seed.json` to `/upsert` in client-side
  batches, with `--dry-run`, `--replace`, `--namespace`, and `--batch-size`
  flags. Documented in `SETUP.md`.

### Tests & CI

- ✅ Unit (`src/index.test.ts`), integration (`test/integration.test.ts`), and
  an always-on in-memory end-to-end suite (`test/e2e.test.ts`) that proves
  seed → search → relevant top result using a deterministic bag-of-words
  embedder and an in-memory cosine store.
- ✅ Live e2e mode gated on `PLATO_E2E_URL` (skipped in CI without creds).
- ✅ `npm run type-check` (`tsc --noEmit`) + GitHub Actions CI (Node 22).

## Real but conditional (⚠️)

- ⚠️ **Deployment-targeted:** the Worker only does real work on Cloudflare with
  provisioned `AI` + `VECTORIZE` bindings. Workers AI is unavailable in the
  local Wrangler simulator, so `npm run dev` intentionally runs
  `wrangler dev --remote`.
- ⚠️ **Metadata `filter`:** pass-through to Vectorize; only effective if you
  create metadata indexes (`wrangler vectorize create-metadata-index …`) first.
- ⚠️ **`returnMetadata: "all"`** silently caps `topK` at 20 — a Vectorize limit.

## Not implemented (🔮)

- 🔮 No webhook / sync ingestion, no HMAC validation, no `WEBHOOK_SECRET`.
- 🔮 No `/monitoring/*` endpoints, no Prometheus metrics, no uptime tracking.
- 🔮 No rate limiting.
- 🔮 No Cloudflare Queue consumer / async index sync.
- 🔮 No result caching (Cache API or otherwise).
- 🔮 No `/similar`, `/recommend`, `/gap-analysis`, or bulk-ingest endpoints
  (removed in 2.0.0).
- 🔮 No multi-tenant identity — only a single shared Bearer token.

If you need any of the above, it would be net-new work, not configuration.
