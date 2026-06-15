# Plato Semantic Search - New Features

## Webhook Integration

### Overview
Added secure webhook support for real-time index synchronization from external systems.

### Features
- **`POST /sync/webhook` endpoint** for receiving webhook events
- **HMAC SHA256 signature validation** using `WEBHOOK_SECRET` environment variable
- **Timestamp freshness checks** to prevent replay attacks
- **Batch event support** for multiple upsert/delete operations in one request

### Example Webhook Payload
```json
[
  {
    "action": "upsert",
    "id": "doc-123",
    "text": "Document content to index",
    "metadata": { "category": "documentation" }
  },
  {
    "action": "delete",
    "id": "doc-456"
  }
]
```

### Security Headers
- `X-Webhook-Signature`: `sha256=<signature>` - HMAC signature of the request
- `X-Webhook-Timestamp`: `<timestamp>` - Unix timestamp of the request

### Example Client
See `examples/webhook-example.js` for a complete Node.js client implementation.

## Advanced Monitoring Endpoints

### Overview
Added production-grade monitoring and observability features.

### Endpoints

#### 1. Detailed Health Check
`GET /monitoring/health`
Returns detailed health status including:
- Service uptime
- Vectorize index connectivity
- AI model availability
- Timestamp

#### 2. Version Information
`GET /monitoring/version`
Returns:
- Service name
- Version
- Git commit hash
- Build timestamp

#### 3. Prometheus Metrics
`GET /monitoring/metrics`
Returns standard Prometheus format metrics:
- Vectorize index total vector count
- Vectorize index dimensions
- Total request count
- Active request count
- Service uptime

**Protected by basic authentication** when `METRICS_BASIC_AUTH_USER` and `METRICS_BASIC_AUTH_PASS` are set.

## Additional Enhancements

### Rate Limiting
Built-in per-IP rate limiting: **100 requests per minute per client** to prevent abuse.

### Uptime Tracking
Automatic service uptime tracking accessible through health checks and metrics.

### Environment Variables
New supported environment variables:
| Variable | Description |
|----------|-------------|
| `WEBHOOK_SECRET` | Secret for webhook signature validation |
| `METRICS_BASIC_AUTH_USER` | Basic auth username for metrics endpoint |
| `METRICS_BASIC_AUTH_PASS` | Basic auth password for metrics endpoint |

### Queue Integration
Updated `wrangler.toml` with Cloudflare Queue support for scalable, multi-region index synchronization.

## Getting Started

### 1. Configure Webhooks
Add your webhook secret to `wrangler.toml` or `.dev.vars`:
```toml
[vars]
WEBHOOK_SECRET = "your-strong-secret-here"
```

### 2. Configure Metrics Protection (Optional)
Add basic auth for metrics endpoint:
```toml
[vars]
METRICS_BASIC_AUTH_USER = "admin"
METRICS_BASIC_AUTH_PASS = "your-strong-password-here"
```

### 3. Deploy
```bash
npm run deploy
```

### 4. Test Webhooks
See `examples/webhook-example.js` for how to send signed webhook events.

## Full API Changes
See `README.md` for complete updated API documentation.