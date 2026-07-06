# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

`plato-semantic-search` is a private Cloudflare Worker (not published to npm),
so the `package.json` version is internal only and was not checked against the
npm registry. No git tags have been cut; the `1.0.0`/`2.0.0` groupings below
follow the real `package.json` version history (the version was bumped
`1.0.0 → 2.0.0` in commit `445fbe4`), not invented release events.

## [Unreleased]

No changes since the `2.0.0` grouping below.

## [2.0.0] - 2026-07-06

### Changed
- Rewrote the Worker from a single monolithic `src/index.ts` into a modular structure: per-endpoint handlers under `src/handlers/` (`delete`, `health`, `search`, `stats`, `upsert`), a shared `src/errors.ts`, a `ROUTES` dispatch table, and reorganized types in `src/types.ts`. Bumped `package.json` from `1.0.0` to `2.0.0` to mark the restructure. ([445fbe4])
- Rewrote `README.md` into a production-ready instructional style with quickstart, usage, and limitations sections. ([d884987])
- Removed the Plato/SuperInstance ecosystem framing from `README.md` and `data/seed.json`. ([e30a7b2])

### Added
- Comprehensive integration test suite covering all Worker endpoints (`test/integration.test.ts`). ([da5330f])
- Real Vectorize seeding pipeline: `scripts/seed.ts` (with `--dry-run` and local-dev modes), a `data/seed.json` dataset, a `SETUP.md` setup guide, and an end-to-end test suite (`test/e2e.test.ts`) with an always-on in-memory mode plus a live mode gated on `PLATO_E2E_URL`. The previous `scripts/batch-ingest.ts` was replaced by `scripts/seed.ts`. ([180f0d6])
- GitHub Actions CI workflow running `type-check` and the test suite. ([180f0d6])

### Fixed
- Added the missing MIT `LICENSE` file and declared it in the `README.md`. ([e1a154e])
- CI: bumped `setup-node` to Node 22 (Node 20 is deprecated on GitHub runners). ([e042b9b])

## [1.0.0] - 2026-06-15

Initial release of the semantic-search Worker.

### Added
- Initial Cloudflare Worker providing semantic search over Workers AI embeddings (`@cf/baai/bge-small-en-v1.5`, 384-dimensional) backed by a Vectorize cosine-similarity ANN index. Endpoints: `GET /health`, `GET /index/stats`, `POST /search`, `POST /index/upsert`, `POST /index/upsert-batch`, `POST /index/delete`, and `POST /sync/webhook`, with optional `API_KEY` protection on writes. Shipped `package.json` (`1.0.0`), `README.md`, `TESTING.md`, `src/types.ts`, and a unit-test suite. ([115c6de])
- Advanced search endpoints: `/similar` (similarity search), `/recommend` (context-aware recommendations), `/gap-analysis`, and bulk ingest. ([84ad254])
- Response caching via the Cache API with configurable TTLs, origin-restricted CORS, and crate metadata; added `FEATURES.md`, a batch-ingest script, and a batch-sync test. ([08c82e9])

[Unreleased]: https://github.com/purplepincher/plato-semantic-search/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/purplepincher/plato-semantic-search/releases/tag/v2.0.0
[1.0.0]: https://github.com/purplepincher/plato-semantic-search/releases/tag/v1.0.0

[445fbe4]: https://github.com/purplepincher/plato-semantic-search/commit/445fbe4
[da5330f]: https://github.com/purplepincher/plato-semantic-search/commit/da5330f
[180f0d6]: https://github.com/purplepincher/plato-semantic-search/commit/180f0d6
[e042b9b]: https://github.com/purplepincher/plato-semantic-search/commit/e042b9b
[e30a7b2]: https://github.com/purplepincher/plato-semantic-search/commit/e30a7b2
[d884987]: https://github.com/purplepincher/plato-semantic-search/commit/d884987
[e1a154e]: https://github.com/purplepincher/plato-semantic-search/commit/e1a154e
[115c6de]: https://github.com/purplepincher/plato-semantic-search/commit/115c6de
[84ad254]: https://github.com/purplepincher/plato-semantic-search/commit/84ad254
[08c82e9]: https://github.com/purplepincher/plato-semantic-search/commit/08c82e9
