# SETUP — plato-semantic-search

End-to-end deployment guide for a **new deployer with zero context**.
This is the source of truth for bindings, secrets, and seeding.
See `README.md` for the API reference.

> **Heads-up on legacy docs:** `FEATURES.md`, `TESTING.md`, and older sections of
> `.env.example` describe endpoints/secrets that do **not** exist in the current
> Worker (webhooks, `/monitoring/*`, queues, rate limiting, `INGEST_SECRET`,
> `WEBHOOK_SECRET`, `METRICS_*`). The real Worker exposes only
> `/health`, `/stats`, `/search`, `/upsert`, `/delete` and a single optional
> `API_KEY` secret. Trust this file and `README.md` over those.

---

## 0. Prerequisites

- A Cloudflare account (Workers + Workers AI + Vectorize must be enabled).
- Node.js 18+ (tested on 20/22) and npm.
- The Wrangler CLI (installed locally by `npm install`):
  ```bash
  npx wrangler login   # one-time; authorizes wrangler against your account
  ```

---

## 1. What this Worker actually needs

| Kind        | Name        | Required | Purpose                                                                 |
|-------------|-------------|----------|-------------------------------------------------------------------------|
| **Binding** | `AI`        | yes      | Workers AI — runs `@cf/baai/bge-small-en-v1.5` (384-dim) embeddings.    |
| **Binding** | `VECTORIZE` | yes      | Vectorize index `plato-search` — cosine ANN store.                      |
| **Secret**  | `API_KEY`   | no       | Optional Bearer token gating **all** endpoints.                         |

**Bindings vs. secrets — don't confuse them:**

- `AI` and `VECTORIZE` are **bindings**, declared in `wrangler.toml`. Cloudflare
  provisions them automatically when you `wrangler deploy`; there is **no API
  key or token** for you to obtain — they are authenticated by your account.
- `API_KEY` is the **only** secret you may set. It is an arbitrary string *you
  choose*; the Worker compares the `Authorization: Bearer <key>` header against
  it. Leave it unset for an open, internal deployment.

No other tokens (Workers AI token, Vectorize token, ingest/webhook secrets) are
required. If it isn't in the table above, the Worker doesn't use it.

### `wrangler.toml` reference

```toml
name = "plato-semantic-search"
main = "src/index.ts"
compatibility_date = "2024-09-23"

[ai]
binding = "AI"                       # -> env.AI

[[vectorize]]
binding = "VECTORIZE"                # -> env.VECTORIZE
index_name = "plato-search"

# Optional auth (set via `wrangler secret put API_KEY`, NOT here):
# API_KEY — Bearer token protecting every endpoint
```

---

## 2. Create the Vectorize index

`@cf/baai/bge-small-en-v1.5` emits **384-dim** vectors. Dimensions and metric
are **immutable** after creation, so get them right the first time:

```bash
npx wrangler vectorize create plato-search --dimensions=384 --metric=cosine
```

Optional metadata indexes (enable `filter` on `domain` / `wave` at query time):

```bash
npx wrangler vectorize create-metadata-index plato-search --property-name=domain --type=string
npx wrangler vectorize create-metadata-index plato-search --property-name=wave  --type=number
```

---

## 3. Install dependencies

```bash
npm install
```

This also installs `wrangler`, `vitest`, `tsc`, and `tsx` (used by the seed
script).

---

## 4. Configure secrets

### Production (`wrangler secret put`)

Secrets are stored encrypted on Cloudflare and are **not** written to
`wrangler.toml` or committed to git.

```bash
# Optional but recommended for any internet-facing deployment:
npx wrangler secret put API_KEY
# (paste a strong random string when prompted, e.g. `openssl rand -hex 32`)
```

Once `API_KEY` is set, every request must carry:
```
Authorization: Bearer <your-key>
```

### Local development (`.dev.vars`)

Wrangler reads `.dev.vars` (gitignored) for local `wrangler dev`. Copy the
example and edit:

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` example:
```
# Optional local auth (leave commented for an open local server)
# API_KEY=dev-only-secret
```

---

## 5. Run locally

Workers AI is not available in the local simulator, so local dev must run
**remote** bindings:

```bash
npm run dev          # = wrangler dev --remote
```

This serves the Worker on http://localhost:8787 using your real Cloudflare
account's Workers AI + the `plato-search` Vectorize index.

Quick check:
```bash
curl http://localhost:8787/health
```

---

## 6. Seed the index with real data

The Worker ships with a sample corpus at `data/seed.json` (12 documents) and a
seeding script at `scripts/seed.ts` that POSTs it to `/upsert` in batches.

```bash
# Against local dev server:
npm run seed:dev                                  # PLATO_BASE_URL=http://localhost:8787

# Against production (prompt for key via env):
PLATO_BASE_URL=https://plato-semantic-search.<account>.workers.dev \
  npm run seed -- --api-key "$(cat .api-key)"

# Inspect what would be sent without calling the API:
npm run seed:dry-run
```

The script accepts these flags:

| Flag                       | Purpose                                                          |
|----------------------------|------------------------------------------------------------------|
| `<worker-base-url>`        | Positional; base URL (or set `PLATO_BASE_URL`).                  |
| `--file <path>`            | Alternate corpus (default `data/seed.json`).                     |
| `--api-key <key>`          | Bearer token (default: `$API_KEY` env var).                      |
| `--namespace <ns>`         | Override the namespace on every seeded item.                     |
| `--batch-size <n>`         | Vectors per `/upsert` request (default 500, max 10000).          |
| `--replace`                | Delete the corpus ids first, then upsert (idempotent reseed).    |
| `--dry-run`                | Parse and print the plan without calling the API.                |

Vectors become queryable ~5–10 seconds after upsert.

### Seed file format

```jsonc
{
  "vectors": [
    { "id": "my-doc", "text": "content to embed", "namespace": "ns", "metadata": { "domain": "x" } }
  ]
}
```

A bare top-level array is also accepted (the script wraps it). `text` items are
embedded server-side by Workers AI; alternatively supply pre-computed
`values` (384 numbers).

---

## 7. Deploy

```bash
npm run deploy       # = wrangler deploy
```

Then seed production (step 6 with the production URL) and verify:
```bash
curl https://plato-semantic-search.<account>.workers.dev/health
curl https://plato-semantic-search.<account>.workers.dev/stats
```

---

## 8. Test

```bash
npm run type-check     # tsc --noEmit
npm test               # vitest run — unit + integration + in-memory e2e
```

`test/e2e.test.ts` verifies the full **seed → `/search` → relevant result**
path with behaviorally-accurate in-memory fakes (always runs). To run the same
scenario against a **real** deployed/local Worker:

```bash
PLATO_E2E_URL=https://plato-semantic-search.<account>.workers.dev \
PLATO_E2E_API_KEY=$API_KEY \
  npx vitest run test/e2e.test.ts
```

(When `PLATO_E2E_URL` is unset, the live block is skipped so CI stays green.)

---

## Troubleshooting

- **`AI/YOUR_ACCOUNT` / binding errors on deploy** — confirm `[ai]` and
  `[[vectorize]]` are present in `wrangler.toml` and Workers AI is enabled on
  your account.
- **`Vectorize index not found`** — you skipped step 2; create `plato-search`
  with `--dimensions=384 --metric=cosine`.
- **401 Unauthorized** — `API_KEY` is set but your request lacks a matching
  `Authorization: Bearer <key>` header (this includes `/health`).
- **Empty `/search` results right after upsert** — Vectorize needs ~5–10s to
  index new vectors; wait and retry.
- **Dimension mismatch on upsert** — the index wasn't created at 384 dims, or
  you're sending `values` of the wrong length. Recreate the index correctly
  (dimensions are immutable).
