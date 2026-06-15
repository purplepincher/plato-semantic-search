import { Vectorize } from "@cloudflare/vectorize";
import { Ai } from "@cloudflare/workers-ai";

// Environment bindings
interface Env {
  PLATO_VECTORIZE: Vectorize;
  AI: Ai;
  // Optional: Queue for real-time index sync
  PLATO_SYNC_QUEUE?: Queue<{
    action: "upsert" | "delete";
    id: string;
    text?: string;
    embedding?: number[];
    metadata?: Record<string, any>;
  }>;
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

// Cache TTL constants
const SEARCH_CACHE_TTL = 60;
const EMBEDDING_CACHE_TTL = 300;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Routes
      switch (url.pathname) {
        // Health check
        case "/health":
          return new Response(JSON.stringify({ status: "ok" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });

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
  const { query, topK = 10, filter } = searchReq;

  if (!query) {
    return new Response(
      JSON.stringify({ error: "query parameter is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Generate embedding for search query
  const embeddingResponse = await env.AI.run("@cf/baai/bge-small-en-v1.5", {
    text: query,
  });
  const [queryEmbedding] = embeddingResponse.data;

  // Perform vector search
  const results = await env.PLATO_VECTORIZE.query(queryEmbedding.embedding, {
    topK: topK,
    returnValues: false,
    returnMetadata: true,
    ...(filter ? { filter: filter } : {}),
  });

  // Format results
  const formattedResults: SearchResult[] = results.matches.map((match) => ({
    id: match.id,
    score: match.score,
    text: match.metadata?.text as string || undefined,
    metadata: match.metadata as Record<string, any> || undefined,
  }));

  return new Response(
    JSON.stringify({
      query: query,
      results: formattedResults,
      count: formattedResults.length,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
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