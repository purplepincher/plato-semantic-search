#!/usr/bin/env node
//
// scripts/seed.ts
//
// Seeds the plato-semantic-search Vectorize index with real data by POSTing a
// corpus to the deployed Worker's POST /upsert endpoint.
//
// The Worker expects { vectors: UpsertItem[] }; this script reads a JSON file
// of that shape (or a bare array of items, which it wraps for you), splits it
// into client-side batches, and posts each batch with an optional Bearer token.
//
// Usage:
//   npx tsx scripts/seed.ts <worker-base-url> [options]
//   npx tsx scripts/seed.ts https://plato-semantic-search.<account>.workers.dev \
//     --api-key "$API_KEY"
//
// Options:
//   --file <path>       Seed JSON file (default: data/seed.json)
//   --api-key <key>     Bearer token (default: $API_KEY env var)
//   --namespace <ns>    Override namespace for every item
//   --batch-size <n>    Vectors per /upsert request (default: 500, max 10000)
//   --replace           Delete the corpus ids first, then upsert (idempotent reseed)
//   --dry-run           Parse and print the plan without calling the API
//
// The worker-base-url may be a base ("https://x.workers.dev") or already
// include the path ("https://x.workers.dev/upsert"). Local dev default is
// http://localhost:8787 (set via PLATO_BASE_URL env var too).

import * as fs from "node:fs";
import * as path from "node:path";
import { argv, cwd, exit } from "node:process";

interface SeedItem {
  id: string;
  text?: string;
  values?: number[];
  namespace?: string;
  metadata?: Record<string, unknown>;
}

interface SeedFile {
  vectors: SeedItem[];
}

function parseArgs(args: string[]): {
  baseUrl?: string;
  file: string;
  apiKey?: string;
  namespace?: string;
  batchSize: number;
  replace: boolean;
  dryRun: boolean;
} {
  let baseUrl: string | undefined;
  let file = path.join(cwd(), "data", "seed.json");
  let apiKey: string | undefined;
  let namespace: string | undefined;
  let batchSize = 500;
  let replace = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--file") file = path.resolve(args[++i]);
    else if (a === "--api-key") apiKey = args[++i];
    else if (a === "--namespace") namespace = args[++i];
    else if (a === "--batch-size") batchSize = Number.parseInt(args[++i], 10);
    else if (a === "--replace") replace = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--help" || a === "-h") printUsage(0);
    else if (!a.startsWith("--")) baseUrl = a;
    else {
      console.error(`Unknown option: ${a}`);
      printUsage(1);
    }
  }

  apiKey = apiKey ?? process.env.API_KEY;
  baseUrl = baseUrl ?? process.env.PLATO_BASE_URL;

  if (!baseUrl && !dryRun) {
    console.error("Error: <worker-base-url> is required (or set PLATO_BASE_URL).");
    printUsage(1);
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    console.error("Error: --batch-size must be an integer between 1 and 10000.");
    exit(1);
  }

  return { baseUrl, file, apiKey, namespace, batchSize, replace, dryRun };
}

function printUsage(code: number): never {
  console.log(
    "Usage: npx tsx scripts/seed.ts <worker-base-url> [--file path] [--api-key key] [--namespace ns] [--batch-size n] [--replace] [--dry-run]",
  );
  exit(code);
}

function loadItems(filePath: string, namespaceOverride?: string): SeedItem[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    console.error(`Error: cannot read seed file "${filePath}": ${(e as Error).message}`);
    exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(`Error: seed file is not valid JSON: ${(e as Error).message}`);
    exit(1);
  }

  // Accept either { vectors: [...] } or a bare [...] for convenience.
  let items: SeedItem[];
  if (Array.isArray(parsed)) {
    items = parsed as SeedItem[];
  } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as SeedFile).vectors)) {
    items = (parsed as SeedFile).vectors;
  } else {
    console.error('Error: seed file must be an array, or an object with a "vectors" array.');
    exit(1);
  }

  for (const item of items) {
    if (!item.id || typeof item.id !== "string") {
      console.error('Error: every item must have a string "id".');
      exit(1);
    }
    if (!item.text && !item.values) {
      console.error(`Error: item "${item.id}" must have either "text" or "values".`);
      exit(1);
    }
    if (namespaceOverride) item.namespace = namespaceOverride;
  }

  return items;
}

function upsertUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return base.endsWith("/upsert") ? base : `${base}/upsert`;
}

async function postBatch(
  url: string,
  items: SeedItem[],
  apiKey?: string,
): Promise<{ upserted: number; batches: number; latencyMs: number }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ vectors: items }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status} from ${url}: ${text}`);
    exit(1);
  }

  let body: { upserted?: number; batches?: number; latencyMs?: number } = {};
  try {
    body = text ? (JSON.parse(text) as typeof body) : {};
  } catch {
    // Non-JSON 2xx response; fall back to counts we know.
  }
  return {
    upserted: body.upserted ?? items.length,
    batches: body.batches ?? 1,
    latencyMs: body.latencyMs ?? 0,
  };
}

async function deleteIds(baseUrl: string, ids: string[], apiKey?: string): Promise<void> {
  const url = `${baseUrl.replace(/\/+$/, "")}/delete`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    console.error(`HTTP ${res.status} from ${url}: ${await res.text()}`);
    exit(1);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(argv.slice(2));
  const items = loadItems(opts.file, opts.namespace);

  console.log(`Loaded ${items.length} item(s) from ${opts.file}`);
  if (opts.namespace) console.log(`Overriding namespace -> "${opts.namespace}"`);
  if (opts.replace) console.log(`--replace: will delete ${items.length} id(s) before upsert`);

  if (opts.dryRun) {
    console.log(`Dry run: would POST to ${opts.baseUrl ?? "(no url)"}/upsert in batches of ${opts.batchSize}.`);
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  const base = opts.baseUrl as string;
  const url = upsertUrl(base);

  if (opts.replace) {
    await deleteIds(base, items.map((i) => i.id), opts.apiKey);
    console.log(`Deleted ${items.length} id(s).`);
  }

  let totalUpserted = 0;
  let batchNo = 0;
  const start = Date.now();

  for (let i = 0; i < items.length; i += opts.batchSize) {
    batchNo++;
    const slice = items.slice(i, i + opts.batchSize);
    const r = await postBatch(url, slice, opts.apiKey);
    totalUpserted += r.upserted;
    console.log(
      `  batch ${batchNo}: ${slice.length} sent, ${r.upserted} upserted ` +
        `(server batches=${r.batches}, ${r.latencyMs}ms)`,
    );
  }

  console.log(
    `Done: ${totalUpserted}/${items.length} vector(s) upserted in ${batchNo} request(s), ` +
      `${Date.now() - start}ms total.`,
  );
  console.log("Note: vectors are queryable ~5-10 seconds after upsert.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  exit(1);
});
