# Plato Semantic Search API

Production-ready Cloudflare Worker semantic search API with real-time Vectorize index sync.

## Features

- 🔍 **Semantic Search**: Built-in embedding generation using Cloudflare Workers AI
- 🚀 **Real-time Sync**: Built-in queue support for multi-region index replication
- 📦 **Batch Operations**: Bulk upsert and delete for large datasets
- 🔒 **CORS Support**: Pre-configured for cross-origin requests
- 📊 **Index Stats**: Built-in endpoints for monitoring index health
- 🛠️ **TypeScript**: Fully typed API and request/response objects

## Prerequisites

1. Node.js 18+ installed
2. Cloudflare account with Workers and Vectorize access
3. `wrangler` CLI installed (`npm install -g wrangler`)

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Wrangler

Edit `wrangler.toml` to match your environment:
- Update `index_name` to match your Vectorize index name
- Adjust `dimensions` to match your embedding model (384 for BGE Small)

### 3. Authenticate with Cloudflare
```bash
wrangler login
```

### 4. Create Vectorize Index
```bash
wrangler vectorize create plato-semantic-index --dimensions=384 --metric=cosine
```

## Local Development

Start the development server:
```bash
npm run dev
```

The API will be available at `http://localhost:8787`

## Deployment

### Production
```bash
npm run deploy
```

### Staging
```bash
wrangler deploy --env staging
```

## API Endpoints

### Health Check
```
GET /health
```
Returns service health status.

### Get Index Stats
```
GET /index/stats
```
Returns Vectorize index statistics.

### Semantic Search
```
POST /search
Content-Type: application/json

{
  "query": "your search text",
  "topK": 10,
  "filter": { "category": "documentation" }
}
```

### Find Similar Crates
```
POST /similar
Content-Type: application/json

{
  "crate_name": "plato-core",
  "topK": 10
}
```

### Context-Aware Recommendations
```
POST /recommend
Content-Type: application/json

{
  "context": "building a fleet management system",
  "topK": 5
}
```

### Quality Gap Analysis
```
POST /gap-analysis
Content-Type: application/json

{
  "domain": "system-administration"
}
```

### Bulk Crate Ingest (Authenticated)
```
POST /ingest
Authorization: Bearer YOUR_INGEST_SECRET
Content-Type: application/json

[
  {
    "name": "plato-core",
    "description": "Core Plato agent framework",
    "version": "1.0.0",
    "domain": "core",
    "tests": 24,
    "loc": 1250,
    "github_url": "https://github.com/SuperInstance/plato-core",
    "keywords": ["agent-framework", "fleet-management"],
    "readme": "Full Readme content..."
  }
]
```

### Get Single Crate Metadata
```
GET /crates/:crate_name
```

### Upsert Document
```
POST /index/upsert
Content-Type: application/json

{
  "id": "doc-123",
  "text": "Your document text content",
  "metadata": { "category": "guides" }
}
```

### Batch Upsert Documents
```
POST /index/upsert-batch
Content-Type: application/json

{
  "items": [
    {
      "id": "doc-123",
      "text": "First document",
      "metadata": { "category": "guides" }
    },
    {
      "id": "doc-456",
      "text": "Second document",
      "metadata": { "category": "reference" }
    }
  ]
}
```

### Delete Documents
```
POST /index/delete
Content-Type: application/json

{
  "ids": ["doc-123", "doc-456"]
}
```

### Webhook Sync
```
POST /sync/webhook
Content-Type: application/json

[
  {
    "action": "upsert",
    "id": "doc-123",
    "text": "Document text",
    "metadata": {}
  },
  {
    "action": "delete",
    "id": "doc-456"
  }
]
```

## Real-time Index Sync

### Queue Configuration

Add a queue to your `wrangler.toml` for multi-region sync:
```toml
[[queues]]
binding = "PLATO_SYNC_QUEUE"
queue_name = "plato-sync-queue"
```

Create the queue:
```bash
wrangler queues create plato-sync-queue
```

The built-in queue consumer will automatically:
- Generate embeddings if not provided
- Upsert/delete records in the Vectorize index
- Retry failed operations up to 3 times

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PLATO_VECTORIZE` | Vectorize index binding | ✅ |
| `AI` | Workers AI model binding | ✅ |
| `PLATO_SYNC_QUEUE` | Queue binding for real-time sync | ❌ |
| `WEBHOOK_SECRET` | Webhook validation secret | ❌ |
| `INGEST_SECRET` | Secret for /ingest API endpoint | ❌ |

## Monitoring

### View Logs
```bash
wrangler tail
```

### Metrics

All operations are automatically logged with:
- Request latency
- Success/failure rates
- Vectorize operation counts

## Example Usage

### JavaScript/TypeScript
```typescript
const apiBase = "https://plato-semantic-search.your-worker.workers.dev";

// Search
const response = await fetch(`${apiBase}/search`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    query: "how to use Cloudflare Vectorize",
    topK: 5
  })
});
const results = await response.json();

// Upsert
await fetch(`${apiBase}/index/upsert`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    id: "doc-1",
    text: "Cloudflare Vectorize documentation",
    metadata: { type: "docs" }
  })
});
```

### Python
```python
import requests

api_base = "https://plato-semantic-search.your-worker.workers.dev"

# Search
response = requests.post(f"{api_base}/search", json={
    "query": "how to use Cloudflare Vectorize",
    "topK": 5
})
results = response.json()

# Upsert
requests.post(f"{api_base}/index/upsert", json={
    "id": "doc-1",
    "text": "Cloudflare Vectorize documentation",
    "metadata": { "type": "docs" }
})
```

## Best Practices

1. **Batch Operations**: Use `/index/upsert-batch` for bulk indexing to reduce API calls
2. **Caching**: The API includes built-in cache headers for search responses
3. **Rate Limiting**: Add Cloudflare Rate Limiting for production use
4. **Authentication**: Add API key authentication for production endpoints
5. **Monitoring**: Set up Workers AI and Vectorize monitoring dashboards

## License

MIT
