export interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  API_KEY?: string;
}

// POST /search
export interface SearchRequestBody {
  query: string;
  topK?: number;
  namespace?: string;
  filter?: VectorizeVectorMetadataFilter;
  returnMetadata?: 'none' | 'indexed' | 'all';
}

export interface SearchMatch {
  id: string;
  score: number;
  metadata?: Record<string, VectorizeVectorMetadata>;
}

export interface SearchResponseBody {
  results: SearchMatch[];
  query: string;
  topK: number;
  count: number;
  model: string;
  latencyMs: number;
}

// POST /upsert
export interface UpsertItem {
  id: string;
  /** Raw text to embed. Mutually exclusive with values. */
  text?: string;
  /** Pre-computed embedding vector. Mutually exclusive with text. */
  values?: number[];
  namespace?: string;
  metadata?: Record<string, VectorizeVectorMetadata>;
}

export interface UpsertRequestBody {
  vectors: UpsertItem[];
}

export interface UpsertResponseBody {
  upserted: number;
  batches: number;
  model: string;
  latencyMs: number;
}

// DELETE /delete
export interface DeleteRequestBody {
  ids: string[];
}

export interface DeleteResponseBody {
  deleted: number;
  ids: string[];
}

// GET /health
export interface HealthResponseBody {
  status: 'ok';
  service: string;
  timestamp: string;
  version: string;
}

// GET /stats
export interface StatsResponseBody {
  vectorCount: number;
  dimensions: number;
  metric: string;
  model: string;
}
