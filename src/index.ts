import { Ai } from "@cloudflare/workers-ai";

// Environment bindings
interface Env {
  PLATO_VECTORIZE: any;
  AI: Ai;
  // Optional: Queue for real-time index sync
  PLATO_SYNC_QUEUE?: Queue<{
    action: "upsert" | "delete";
    id: string;
    text?: string;
    embedding?: number[];
    metadata?: Record<string, any>;
  }>;
  // Optional: Ingest API secret
  INGEST_SECRET?: string;
  // Optional: Webhook validation secret
  WEBHOOK_SECRET?: string;
}

// Search request/response types
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

export interface SimilarRequest {
  crate_name?: string;
  name?: string;
  id?: string;
  topK?: number;
}

export interface RecommendRequest {
  context: string;
  topK?: number;
}

export interface RecommendResult {
  name: string;
  description?: string;
  domain?: string;
  version?: string;
  semantic_score: number;
  composite_score: number;
  quality_signals?: {
    tests?: number;
    loc?: number;
    has_description: boolean;
  };
  reasoning?: string[];
}

export interface GapAnalysisRequest {
  domain?: string;
}

export interface GapSuggestion {
  name: string;
  domain?: string;
  issues: string[];
  severity: number;
  tests?: number;
  loc?: number;
  description?: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  suggestion: string[];
}

// Crate metadata types (matches fleet-vector-api)
export interface CrateMetadata {
  name: string;
  description?: string;
  version?: string;
  domain?: string;
  wave?: number;
  tests?: number;
  loc?: number;
  github_url?: string;
  keywords?: string[];
  embedded_at?: number;
  model?: string;
  dims?: number;
}

// Cache TTL constants
const SEARCH_CACHE_TTL = 60;
const EMBEDDING_CACHE_TTL = 300;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Enhanced CORS configuration - restrict origins for production
    const requestOrigin = request.headers.get("Origin") || "";
    const allowedOrigins = [
      "https://fleet-vector-api.casey-digennaro.workers.dev",
      "https://plato.casey-digennaro.workers.dev",
      "http://localhost:5173",
      "http://localhost:3000"
    ];
    const corsOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : "*";
    
    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, X-CSRF-Token",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Max-Age": "86400", // 24 hours
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Routes
      switch (url.pathname) {
        // Health check
        case "/health": {
          const uptime = Date.now() - ((globalThis as any).startTime || Date.now());
          const stats = await env.PLATO_VECTORIZE.getStats().catch(() => ({ count: 0, dimension: 384 }));
          return new Response(JSON.stringify({
            status: "ok",
            uptime_ms: uptime,
            uptime_human: `${Math.floor(uptime / 3600000)}h ${Math.floor((uptime % 3600000) / 60000)}m`,
            vector_index: {
              name: "plato-semantic-index",
              count: stats.count,
              dimension: stats.dimension,
            },
            timestamp: Date.now(),
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Get index statistics
        case "/index/stats":
          const stats = await env.PLATO_VECTORIZE.getStats();
          return new Response(JSON.stringify(stats), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });

        // Semantic search
        case "/search":
          if (request.method !== "POST") {
            return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
          }
          return handleSearch(request, env, corsHeaders);

        // Find similar crates
        case "/similar":
          if (request.method !== "POST") {
            return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
          }
          return handleSimilar(request, env, corsHeaders);

        // Context-aware recommendations
        case "/recommend":
          if (request.method !== "POST") {
            return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
          }
          return handleRecommend(request, env, corsHeaders);

        // Gap analysis
        case "/gap-analysis":
          if (request.method !== "POST") {
            return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
          }
          return handleGapAnalysis(request, env, corsHeaders);

        // Ingest crates (requires auth)
        case "/ingest":
          if (request.method !== "POST") {
            return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
          }
          return handleIngest(request, env, corsHeaders);

        // Get single crate metadata
        case "/crates/:name":
          if (request.method !== "GET") {
            return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
          }
          return handleGetCrate(request, env, corsHeaders);

        // Upsert single vector
        case "/index/upsert":
          if (request.method !== "POST") {
            return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
          }
          return handleUpsert(request, env, corsHeaders);

        // Batch upsert vectors
        case "/index/upsert-batch":
          if (request.method !== "POST") {
            return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
          }
          return handleBatchUpsert(request, env, corsHeaders);

        // Delete vector by ID
        case "/index/delete":
          if (request.method !== "POST") {
            return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
          }
          return handleDelete(request, env, corsHeaders);

        // Real-time sync endpoint (for external webhooks)
        case "/sync/webhook":
          if (request.method !== "POST") {
            return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
          }
          return handleSyncWebhook(request, env, corsHeaders);

        default:
          return new Response("Not Found", { status: 404, headers: corsHeaders });
      }
    } catch (error) {
      console.error("Unhandled error:", error);
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },

  // Queue consumer for real-time index sync
  async queue(message: QueueMessage<{
    action: "upsert" | "delete";
    id: string;
    text?: string;
    embedding?: number[];
    metadata?: Record<string, any>;
  }>, env: Env): Promise<void> {
    const { action, id, text, embedding, metadata } = message.body;

    try {
      switch (action) {
        case "upsert":
          if (!text && !embedding) {
            throw new Error("Either text or embedding must be provided for upsert");
          }

          let finalEmbedding = embedding;
          if (!finalEmbedding && text && env.AI) {
            // Generate embedding automatically if not provided
            const response = await env.AI.run("@cf/baai/bge-small-en-v1.5", {
              text: text,
            });
            finalEmbedding = response.data[0].embedding;
          }

          if (!finalEmbedding) {
            throw new Error("Failed to generate embedding");
          }

          await env.PLATO_VECTORIZE.upsert([{
            id: id,
            values: finalEmbedding,
            metadata: {
              ...metadata,
              ...(text ? { text } : {}),
            },
          }]);
          break;

        case "delete":
          await env.PLATO_VECTORIZE.delete([id]);
          break;
      }
    } catch (error) {
      console.error(`Failed to process ${action} for id ${id}:`, error);
      // Re-queue the message if needed (with backoff)
      if (message.attempts < 3) {
        await message.retry();
      }
    }
  },
};

// ------------------------------
// Route Handlers
// ------------------------------

async function handleSearch(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const searchReq: SearchRequest = await request.json();
  const { query, topK = 10, filter, includeRaw = false } = searchReq;
  const cacheTtl = includeRaw ? 0 : SEARCH_CACHE_TTL;

  if (!query) {
    return new Response(
      JSON.stringify({ error: "query parameter is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Generate cache key
  const cacheKey = new Request(request.url, {
    method: "POST",
    body: JSON.stringify({ query, topK, filter, includeRaw }),
  });
  const cache = caches.default;
  const cachedResponse = await cache.match(cacheKey);

  if (cachedResponse && cacheTtl > 0) {
    return cachedResponse;
  }

  try {
    // Generate embedding for search query
    const embeddingResponse = await env.AI.run("@cf/baai/bge-small-en-v1.5", {
      text: query,
    });
    
    if (!embeddingResponse.data || !embeddingResponse.data[0]?.embedding) {
      throw new Error("Failed to generate query embedding");
    }
    
    const [queryEmbedding] = embeddingResponse.data;

    // Perform vector search
    const results = await env.PLATO_VECTORIZE.query(queryEmbedding.embedding, {
      topK: Math.min(topK, 100), // Enforce maximum of 100 results
      returnValues: false,
      returnMetadata: true,
      ...(filter ? { filter: filter } : {}),
    });

    // Format results with full crate metadata
    const formattedResults: SearchResult[] = await Promise.all(results.matches.map(async (match) => {
      // Fetch full crate metadata from fleet API
      let crateMetadata: CrateMetadata | null = null;
      try {
        const crateResponse = await fetch(`https://fleet-vector-api.casey-digennaro.workers.dev/crates/${match.id}`);
        if (crateResponse.ok) {
          crateMetadata = await crateResponse.json();
        }
      } catch (e) {
        console.warn(`Failed to fetch metadata for crate ${match.id}:`, e);
      }

      // Build base result
      const baseResult: SearchResult = {
        id: match.id,
        score: match.score,
        name: crateMetadata?.name || match.id,
        description: crateMetadata?.description || (match.metadata?.text as string || undefined),
        version: crateMetadata?.version,
        domain: crateMetadata?.domain,
        tests: crateMetadata?.tests,
        loc: crateMetadata?.loc,
        github_url: crateMetadata?.github_url,
        keywords: crateMetadata?.keywords,
        embedded_at: crateMetadata?.embedded_at,
        model: crateMetadata?.model || "@cf/baai/bge-small-en-v1.5",
        dims: crateMetadata?.dims || 384,
      };

      // Add raw metadata only if explicitly requested
      if (includeRaw) {
        baseResult.metadata = match.metadata as Record<string, any> || undefined;
      }

      return baseResult;
    }));

    // Build final response with metadata
    const responseBody = JSON.stringify({
      query: query,
      results: formattedResults,
      count: formattedResults.length,
      timestamp: Date.now(),
      parameters: {
        topK: Math.min(topK, 100),
        filter: filter || null,
        includeRaw: includeRaw,
        cached: false
      },
    });

    // Create response with appropriate headers
    const response = new Response(responseBody, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${cacheTtl}`,
      },
    });

    // Cache successful response if appropriate
    if (cacheTtl > 0) {
      await cache.put(cacheKey, response.clone());
    }

    return response;
  } catch (error) {
    console.error("Search handler error:", error);
    return new Response(
      JSON.stringify({
        error: "Search operation failed",
        message: error instanceof Error ? error.message : "Unknown error occurred",
        timestamp: Date.now()
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

async function handleUpsert(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const upsertReq: UpsertRequest = await request.json();
  const { id, text, metadata } = upsertReq;

  if (!id || !text) {
    return new Response(
      JSON.stringify({ error: "id and text are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Generate embedding
  const embeddingResponse = await env.AI.run("@cf/baai/bge-small-en-v1.5", {
    text: text,
  });
  const [embedding] = embeddingResponse.data;

  // Upsert to Vectorize index
  await env.PLATO_VECTORIZE.upsert([{
    id: id,
    values: embedding.embedding,
    metadata: {
      ...metadata,
      text: text,
    },
  }]);

  // If queue is configured, send sync event for real-time replication
  if (env.PLATO_SYNC_QUEUE) {
    await env.PLATO_SYNC_QUEUE.send({
      action: "upsert",
      id: id,
      text: text,
      metadata: metadata,
    });
  }

  return new Response(
    JSON.stringify({ success: true, id: id }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleBatchUpsert(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const batchReq: BatchUpsertRequest = await request.json();
  const { items } = batchReq;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return new Response(
      JSON.stringify({ error: "items array is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Generate embeddings for all items
  const texts = items.map((item) => item.text);
  const embeddingResponse = await env.AI.run("@cf/baai/bge-small-en-v1.5", {
    text: texts,
  });

  // Prepare vectorize batch items
  const vectorizeItems = items.map((item, index) => ({
    id: item.id,
    values: embeddingResponse.data[index].embedding,
    metadata: {
      ...item.metadata,
      text: item.text,
    },
  }));

  // Upsert to Vectorize index
  await env.PLATO_VECTORIZE.upsert(vectorizeItems);

  // If queue is configured, send sync events
  if (env.PLATO_SYNC_QUEUE) {
    const syncMessages = items.map((item) => ({
      action: "upsert" as const,
      id: item.id,
      text: item.text,
      metadata: item.metadata,
    }));
    await env.PLATO_SYNC_QUEUE.sendBatch(syncMessages);
  }

  return new Response(
    JSON.stringify({ success: true, count: items.length }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleDelete(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const { ids }: { ids: string[] } = await request.json();

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return new Response(
      JSON.stringify({ error: "ids array is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  await env.PLATO_VECTORIZE.delete(ids);

  // If queue is configured, send delete sync events
  if (env.PLATO_SYNC_QUEUE) {
    const syncMessages = ids.map((id) => ({
      action: "delete" as const,
      id: id,
    }));
    await env.PLATO_SYNC_QUEUE.sendBatch(syncMessages);
  }

  return new Response(
    JSON.stringify({ success: true, deleted: ids.length }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleSimilar(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const similarReq: SimilarRequest = await request.json();
  const { crate_name, name, id, topK = 10 } = similarReq;
  const targetCrate = crate_name || name || id;

  if (!targetCrate) {
    return new Response(
      JSON.stringify({ error: "crate_name/name/id parameter is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Fetch crate metadata
  let crateMetadata: CrateMetadata | null = null;
  try {
    const crateResponse = await fetch(`https://fleet-vector-api.casey-digennaro.workers.dev/crates/${targetCrate}`);
    if (!crateResponse.ok) {
      return new Response(
        JSON.stringify({ error: `Crate ${targetCrate} not found` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    crateMetadata = await crateResponse.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `Failed to fetch crate: ${e instanceof Error ? e.message : "Unknown error"}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Generate embedding for crate text
  const searchText = `${crateMetadata.name} ${crateMetadata.description} ${crateMetadata.keywords?.join(" ") || ""}`;
  const embeddingResponse = await env.AI.run("@cf/baai/bge-small-en-v1.5", {
    text: searchText,
  });
  const [queryEmbedding] = embeddingResponse.data;

  // Perform vector search
  const results = await env.PLATO_VECTORIZE.query(queryEmbedding.embedding, {
    topK: topK + 1, // Add 1 to exclude the source crate
    returnValues: false,
    returnMetadata: true,
  });

  // Filter out the source crate and format results
  const filteredResults = results.matches.filter((match) => match.id !== targetCrate).slice(0, topK);
  const formattedResults: SearchResult[] = await Promise.all(filteredResults.map(async (match) => {
    let metadata: CrateMetadata | null = null;
    try {
      const resp = await fetch(`https://fleet-vector-api.casey-digennaro.workers.dev/crates/${match.id}`);
      if (resp.ok) metadata = await resp.json();
    } catch (e) {}

    return {
      id: match.id,
      score: match.score,
      name: metadata?.name || match.id,
      description: metadata?.description || (match.metadata?.text as string || undefined),
      version: metadata?.version,
      domain: metadata?.domain,
      tests: metadata?.tests,
      loc: metadata?.loc,
      github_url: metadata?.github_url,
      keywords: metadata?.keywords,
      metadata: match.metadata as Record<string, any>,
    };
  }));

  return new Response(
    JSON.stringify({
      crate: targetCrate,
      results: formattedResults,
      count: formattedResults.length,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleRecommend(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const recommendReq: RecommendRequest = await request.json();
  const { context, topK = 5 } = recommendReq;

  if (!context) {
    return new Response(
      JSON.stringify({ error: "context parameter is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Generate embedding for context
  const embeddingResponse = await env.AI.run("@cf/baai/bge-small-en-v1.5", {
    text: context,
  });
  const [queryEmbedding] = embeddingResponse.data;

  // Perform vector search
  const results = await env.PLATO_VECTORIZE.query(queryEmbedding.embedding, {
    topK: topK * 2, // Over-fetch to re-rank
    returnValues: false,
    returnMetadata: true,
  });

  // Fetch full metadata and compute composite scores
  const scoredResults = await Promise.all(results.matches.map(async (match) => {
    let crate: CrateMetadata | null = null;
    try {
      const resp = await fetch(`https://fleet-vector-api.casey-digennaro.workers.dev/crates/${match.id}`);
      if (resp.ok) crate = await resp.json();
    } catch (e) {}

    // Calculate quality signals
    const qualitySignals = {
      tests: crate?.tests || 0,
      loc: crate?.loc || 0,
      has_description: !!crate?.description,
    };

    // Composite score: 60% semantic similarity, 40% quality
    const semanticScore = match.score;
    const qualityScore = (qualitySignals.tests * 0.5 + Math.min(qualitySignals.loc / 1000, 1) * 0.3 + (qualitySignals.has_description ? 0.2 : 0)) / 1;
    const compositeScore = (semanticScore * 0.6) + (qualityScore * 0.4);

    // Generate reasoning
    const reasoning: string[] = [];
    if (!qualitySignals.has_description) reasoning.push("missing crate description");
    if (qualitySignals.tests < 5) reasoning.push("low test count");
    if (qualitySignals.loc < 100) reasoning.push("small codebase");

    return {
      name: match.id,
      description: crate?.description,
      domain: crate?.domain,
      version: crate?.version,
      semantic_score: semanticScore,
      composite_score: compositeScore,
      quality_signals: qualitySignals,
      reasoning: reasoning.length ? reasoning : ["High quality crate"],
      metadata: match.metadata,
    };
  }));

  // Sort by composite score and take topK
  const sortedResults = scoredResults.sort((a, b) => b.composite_score - a.composite_score).slice(0, topK);

  return new Response(
    JSON.stringify({
      context: context,
      recommendations: sortedResults,
      count: sortedResults.length,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleGapAnalysis(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const gapReq: GapAnalysisRequest = await request.json();
  const { domain } = gapReq;

  // First, get all crates
  // Note: This is a simplified implementation - in production you'd use a database
  // For this example, we'll use the Vectorize index stats to get count, then sample
  const stats = await env.PLATO_VECTORIZE.getStats();
  const allResults = await env.PLATO_VECTORIZE.query(new Array(384).fill(0), {
    topK: Math.min(stats.count || 1000, 1000),
    returnValues: false,
    returnMetadata: true,
  });

  // Filter by domain if specified
  let crates = allResults.matches;
  if (domain) {
    crates = crates.filter((match) => match.metadata?.domain === domain);
  }

  // Analyze gaps
  const suggestions: GapSuggestion[] = [];
  for (const match of crates) {
    const issues: string[] = [];
    let tests = 0;
    let loc = 0;
    let description = match.metadata?.text as string || "";

    if (!description || description.length < 50) {
      issues.push("missing_description");
    }
    if (match.metadata?.tests === 0) {
      issues.push("no_tests");
    } else if (match.metadata?.tests && match.metadata.tests < 5) {
      issues.push("low_test_count");
      tests = match.metadata.tests;
    }
    if (match.metadata?.loc === 0) {
      issues.push("zero_loc");
    } else if (match.metadata?.loc && match.metadata.loc < 100) {
      issues.push("low_loc");
      loc = match.metadata.loc;
    }

    if (issues.length > 0) {
      suggestions.push({
        name: match.id,
        domain: match.metadata?.domain as string || "unknown",
        issues: issues,
        severity: issues.length,
        tests: tests,
        loc: loc,
        description: description,
        priority: issues.length >= 2 ? "critical" : issues.includes("missing_description") ? "high" : "medium",
        suggestion: [
          `Add ${description ? "improved" : "a"} description`,
          tests < 5 ? "Add unit tests" : "",
          loc < 100 ? "Increase codebase size" : "",
        ].filter(Boolean),
      });
    }
  }

  // Sort suggestions by priority
  const priorityMap = { critical: 0, high: 1, medium: 2, low: 3 };
  const sortedSuggestions = suggestions.sort((a, b) => priorityMap[a.priority] - priorityMap[b.priority]);

  return new Response(
    JSON.stringify({
      domain: domain || "all",
      total_crates: crates.length,
      quality_crates: crates.length - suggestions.length,
      gap_crates: suggestions.length,
      gap_percentage: Math.round((suggestions.length / crates.length) * 100) || 0,
      suggestions: sortedSuggestions,
      references: [], // In production, fetch high-quality reference crates
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleIngest(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  // Check for Bearer token auth
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Bearer token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const token = authHeader.split(" ")[1];
  if (token !== env.INGEST_SECRET) {
    return new Response(
      JSON.stringify({ error: "Invalid Bearer token" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const body = await request.json();
  let crates: any[] = [];

  // Handle single crate or array
  if (Array.isArray(body)) {
    crates = body;
  } else if (body.crates) {
    crates = body.crates;
  } else if (body.name && body.description && body.readme) {
    crates = [body];
  } else {
    return new Response(
      JSON.stringify({ error: "Invalid request format" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (crates.length === 0 || crates.length > 50) {
    return new Response(
      JSON.stringify({ error: "Must provide 1-50 crates per request" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Generate embeddings and upsert
  const texts = crates.map(crate => `${crate.name} ${crate.description} ${crate.readme}`);
  const embeddingResponse = await env.AI.run("@cf/baai/bge-small-en-v1.5", {
    text: texts,
  });

  const vectorizeItems = crates.map((crate, index) => ({
    id: crate.name,
    values: embeddingResponse.data[index].embedding,
    metadata: {
      name: crate.name,
      description: crate.description,
      version: crate.version || "0.1.0",
      domain: crate.domain || "unknown",
      tests: crate.tests || 0,
      loc: crate.loc || 0,
      github_url: crate.github_url || "",
      keywords: crate.keywords || [],
      text: `${crate.name} ${crate.description}`,
    },
  }));

  // Upsert to Vectorize
  await env.PLATO_VECTORIZE.upsert(vectorizeItems);

  // Sync to queue if configured
  if (env.PLATO_SYNC_QUEUE) {
    const syncMessages = vectorizeItems.map(item => ({
      action: "upsert" as const,
      id: item.id,
      text: item.metadata.text,
      metadata: item.metadata,
    }));
    await env.PLATO_SYNC_QUEUE.sendBatch(syncMessages);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      inserted: crates.length,
      vectorize_upsert: { count: crates.length },
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleGetCrate(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const crateName = request.url.split("/crates/")[1];
  if (!crateName) {
    return new Response(
      JSON.stringify({ error: "Crate name required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Fetch vector metadata
  let vectorMetadata: any = null;
  try {
    const vectorResponse = await env.PLATO_VECTORIZE.getById(crateName);
    if (vectorResponse && vectorResponse.metadata) {
      vectorMetadata = vectorResponse.metadata;
    }
  } catch (e) {
    console.warn(`Failed to fetch vector for ${crateName}:`, e);
  }

  // If we have KV metadata, use that
  if (vectorMetadata) {
    return new Response(
      JSON.stringify(vectorMetadata),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Fallback to fetch from fleet-vector-api
  try {
    const crateResponse = await fetch(`https://fleet-vector-api.casey-digennaro.workers.dev/crates/${crateName}`);
    if (crateResponse.ok) {
      const crateData = await crateResponse.json();
      return new Response(
        JSON.stringify(crateData),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (e) {
    console.warn(`Failed to fetch from fleet-vector-api:`, e);
  }

  return new Response(
    JSON.stringify({ error: `Crate ${crateName} not found` }),
    { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleSyncWebhook(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const syncEvents = await request.json();

  // Validate webhook secret if configured
  // const webhookSecret = request.headers.get("X-Webhook-Secret");
  // if (webhookSecret !== env.WEBHOOK_SECRET) {
  //   return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  // }

  if (!Array.isArray(syncEvents)) {
    return new Response(
      JSON.stringify({ error: "syncEvents must be an array" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Send all events to the sync queue
  if (env.PLATO_SYNC_QUEUE) {
    const messages = syncEvents.map((event) => ({
      action: event.action || "upsert",
      id: event.id,
      text: event.text,
      metadata: event.metadata,
    }));
    await env.PLATO_SYNC_QUEUE.sendBatch(messages);
  } else {
    // Process directly if no queue is configured
    for (const event of syncEvents) {
      const { action, id, text, metadata } = event;
      switch (action) {
        case "upsert":
          if (!text) continue;
          const embeddingResponse = await env.AI.run("@cf/baai/bge-small-en-v1.5", {
            text: text,
          });
          const [embedding] = embeddingResponse.data;
          await env.PLATO_VECTORIZE.upsert([{
            id: id,
            values: embedding.embedding,
            metadata: { ...metadata, text: text },
          }]);
          break;
        case "delete":
          await env.PLATO_VECTORIZE.delete([id]);
          break;
      }
    }
  }

  return new Response(
    JSON.stringify({ success: true, received: syncEvents.length }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}