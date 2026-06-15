import { describe, it, expect, vi, beforeEach } from "vitest";
import { beforeEach as fetchMock } from "vitest-fetch-mock";
import handler from "./index";
import { UpsertRequest, SearchRequest } from "./types";

// Mock Cloudflare bindings
const mockVectorize = {
  upsert: vi.fn(),
  delete: vi.fn(),
  query: vi.fn().mockResolvedValue({
    matches: [
      {
        id: "test-1",
        score: 0.95,
        metadata: { text: "Test document 1" },
      },
      {
        id: "test-2",
        score: 0.85,
        metadata: { text: "Test document 2" },
      },
    ],
  }),
  getStats: vi.fn().mockResolvedValue({
    count: 42,
    dimensions: 384,
    size: "1.2MB",
    lastUpdated: new Date().toISOString(),
  }),
};

const mockAi = {
  run: vi.fn().mockResolvedValue({
    data: [
      {
        embedding: Array(384).fill(0.1),
      },
    ],
  }),
};

describe("Plato Semantic Search API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createEnv = () => ({
    PLATO_VECTORIZE: mockVectorize,
    AI: mockAi,
  });

  describe("GET /health", () => {
    it("should return health status", async () => {
      const request = new Request("http://localhost/health");
      const response = await handler.fetch(request, createEnv());
      
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok" });
    });
  });

  describe("GET /index/stats", () => {
    it("should return index statistics", async () => {
      const request = new Request("http://localhost/index/stats");
      const response = await handler.fetch(request, createEnv());
      
      expect(response.status).toBe(200);
      expect(mockVectorize.getStats).toHaveBeenCalled();
      const stats = await response.json();
      expect(stats.count).toBe(42);
      expect(stats.dimensions).toBe(384);
    });
  });

  describe("POST /search", () => {
    it("should perform semantic search", async () => {
      const searchBody: SearchRequest = {
        query: "test search",
        topK: 10,
      };
      
      const request = new Request("http://localhost/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(searchBody),
      });
      
      const response = await handler.fetch(request, createEnv());
      expect(response.status).toBe(200);
      expect(mockAi.run).toHaveBeenCalledWith("@cf/baai/bge-small-en-v1.5", {
        text: "test search",
      });
      expect(mockVectorize.query).toHaveBeenCalled();
      
      const result = await response.json();
      expect(result.query).toBe("test search");
      expect(result.count).toBe(2);
      expect(result.results).toHaveLength(2);
    });

    it("should return 400 if query is missing", async () => {
      const request = new Request("http://localhost/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      
      const response = await handler.fetch(request, createEnv());
      expect(response.status).toBe(400);
    });
  });

  describe("POST /index/upsert", () => {
    it("should upsert a document", async () => {
      const upsertBody: UpsertRequest = {
        id: "test-123",
        text: "Test document content",
        metadata: { category: "test" },
      };
      
      const request = new Request("http://localhost/index/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(upsertBody),
      });
      
      const response = await handler.fetch(request, createEnv());
      expect(response.status).toBe(200);
      expect(mockAi.run).toHaveBeenCalledWith("@cf/baai/bge-small-en-v1.5", {
        text: "Test document content",
      });
      expect(mockVectorize.upsert).toHaveBeenCalled();
      
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.id).toBe("test-123");
    });

    it("should return 400 if required fields are missing", async () => {
      const request = new Request("http://localhost/index/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "test-123" }),
      });
      
      const response = await handler.fetch(request, createEnv());
      expect(response.status).toBe(400);
    });
  });

  describe("POST /index/upsert-batch", () => {
    it("should batch upsert documents", async () => {
      const batchBody = {
        items: [
          { id: "test-1", text: "First test document" },
          { id: "test-2", text: "Second test document", metadata: { category: "test" } },
        ],
      };
      
      const request = new Request("http://localhost/index/upsert-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batchBody),
      });
      
      const response = await handler.fetch(request, createEnv());
      expect(response.status).toBe(200);
      expect(mockAi.run).toHaveBeenCalledWith("@cf/baai/bge-small-en-v1.5", {
        text: ["First test document", "Second test document"],
      });
      expect(mockVectorize.upsert).toHaveBeenCalled();
      
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
    });
  });

  describe("POST /index/delete", () => {
    it("should delete documents", async () => {
      const request = new Request("http://localhost/index/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["test-1", "test-2"] }),
      });
      
      const response = await handler.fetch(request, createEnv());
      expect(response.status).toBe(200);
      expect(mockVectorize.delete).toHaveBeenCalledWith(["test-1", "test-2"]);
      
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.deleted).toBe(2);
    });
  });

  describe("POST /sync/webhook", () => {
    it("should handle webhook sync events", async () => {
      const webhookBody = [
        {
          action: "upsert",
          id: "webhook-1",
          text: "Webhook test document",
          metadata: { source: "webhook" },
        },
        {
          action: "delete",
          id: "webhook-2",
        },
      ];
      
      const request = new Request("http://localhost/sync/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookBody),
      });
      
      const response = await handler.fetch(request, createEnv());
      expect(response.status).toBe(200);
      
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.received).toBe(2);
    });
  });

  describe("CORS handling", () => {
    it("should handle OPTIONS preflight requests", async () => {
      const request = new Request("http://localhost/search", {
        method: "OPTIONS",
        headers: {
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type",
        },
      });
      
      const response = await handler.fetch(request, createEnv());
      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  describe("Error handling", () => {
    it("should handle internal server errors", async () => {
      // Mock a failing AI call
      mockAi.run.mockRejectedValueOnce(new Error("AI service failed"));
      
      const upsertBody: UpsertRequest = {
        id: "test-123",
        text: "Test document content",
      };
      
      const request = new Request("http://localhost/index/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(upsertBody),
      });
      
      const response = await handler.fetch(request, createEnv());
      expect(response.status).toBe(500);
      const result = await response.json();
      expect(result.error).toBe("AI service failed");
    });
  });
});
