# Testing & Validation Guide

## Local Development Testing

### 1. Start Local Dev Server
```bash
npm run dev
```

### 2. Test Health Endpoint
```bash
curl http://localhost:8787/health
```

Expected output:
```json
{"status":"ok"}
```

### 3. Test Index Stats
```bash
curl http://localhost:8787/index/stats
```

### 4. Test Search
```bash
curl -X POST http://localhost:8787/search \
  -H "Content-Type: application/json" \
  -d '{"query": "test search query", "topK": 5}'
```

### 5. Test Upsert Document
```bash
curl -X POST http://localhost:8787/index/upsert \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test-doc-1",
    "text": "This is a test document for semantic search",
    "metadata": {
      "category": "testing",
      "author": "test-user"
    }
  }'
```

### 6. Test Batch Upsert
```bash
curl -X POST http://localhost:8787/index/upsert-batch \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "id": "test-doc-2",
        "text": "Second test document content"
      },
      {
        "id": "test-doc-3",
        "text": "Third test document with metadata",
        "metadata": { "tags": ["test", "demo"] }
      }
    ]
  }'
```

### 7. Test Delete
```bash
curl -X POST http://localhost:8787/index/delete \
  -H "Content-Type: application/json" \
  -d '{
    "ids": ["test-doc-1", "test-doc-2"]
  }'
```

### 8. Test Webhook Sync
```bash
curl -X POST http://localhost:8787/sync/webhook \
  -H "Content-Type: application/json" \
  -d '[
    {
      "action": "upsert",
      "id": "webhook-doc-1",
      "text": "Document synced via webhook",
      "metadata": { "source": "webhook" }
    },
    {
      "action": "delete",
      "id": "webhook-doc-2"
    }
  ]'
```

## Unit Testing

### Run Tests
```bash
npm test
```

### Run Tests with Coverage
```bash
npm test -- --coverage
```

## Production Validation

### 1. Deploy to Cloudflare
```bash
npm run deploy
```

### 2. Test Production Endpoints
Replace the API base URL with your deployed worker URL:
```bash
API_BASE="https://plato-semantic-search.your-subdomain.workers.dev"

# Test health
curl $API_BASE/health

# Test search
curl -X POST $API_BASE/search \
  -H "Content-Type: application/json" \
  -d '{"query": "your production search query"}'
```

## Queue Testing (Optional)

If you configured the sync queue, test the queue consumer:

1. Publish a test message to the queue:
```bash
wrangler queues send plato-sync-queue '{"action": "upsert", "id": "queue-test-1", "text": "Queue test document"}'
```

2. Check worker logs:
```bash
wrangler tail
```