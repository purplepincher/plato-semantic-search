// Plato Semantic Search API Types
export interface SearchRequest {
  query: string;
  topK?: number;
  filter?: Record<string, any>;
}

export interface SearchResult {
  id: string;
  score: number;
  text?: string;
  metadata?: Record<string, any>;
}

export interface UpsertRequest {
  id: string;
  text: string;
  metadata?: Record<string, any>;
}

export interface BatchUpsertRequest {
  items: Array<{
    id: string;
    text: string;
    metadata?: Record<string, any>;
  }>;
}

export interface SyncEvent {
  action: "upsert" | "delete";
  id: string;
  text?: string;
  metadata?: Record<string, any>;
}

export interface IndexStats {
  count: number;
  dimensions: number;
  size: string;
  lastUpdated: string;
}
