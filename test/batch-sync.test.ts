import { expect } from "chai";
import { handleBatchSync, handleBatchDelete } from "../src/batch-sync";
import { Ai } from "@cloudflare/workers-ai";

describe("Batch Sync Utilities", () => {
  const mockEnv = {
    PLATO_VECTORIZE: {
      upsert: async (items: any[]) => {
        expect(items).to.have.length(2);
        expect(items[0].id).to.equal("test-1");
        expect(items[1].id).to.equal("test-2");
        return { success: true };
      },
      delete: async (ids: string[]) => {
        expect(ids).to.deep.equal(["test-1", "test-2"]);
        return { success: true };
      },
    },
    AI: {
      run: async (model: string, options: any) => {
        expect(model).to.equal("@cf/baai/bge-small-en-v1.5");
        return {
          data: options.text.map((text: string) => ({
            embedding: new Array(384).fill(0.5),
          })),
        };
      },
    },
    INGEST_SECRET: "test-secret",
  } as any;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  describe("handleBatchSync", () => {
    it("should process array of items correctly", async () => {
      const request = new Request("http://localhost:8787/batch/upsert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer test-secret",
        },
        body: JSON.stringify([
          { id: "test-1", text: "Test document 1", metadata: { category: "test" } },
          { id: "test-2", text: "Test document 2", metadata: { category: "test" } },
        ]),
      });

      const response = await handleBatchSync(request, mockEnv, corsHeaders);
      expect(response.status).to.equal(200);
      const result = await response.json();
      expect(result.success).to.be.true;
      expect(result.total_processed).to.equal(2);
      expect(result.total_upserted).to.equal(2);
    });

    it("should process wrapped items format", async () => {
      const request = new Request("http://localhost:8787/batch/upsert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer test-secret",
        },
        body: JSON.stringify({
          items: [
            { id: "test-1", text: "Test document 1" },
            { id: "test-2", text: "Test document 2" },
          ],
        }),
      });

      const response = await handleBatchSync(request, mockEnv, corsHeaders);
      expect(response.status).to.equal(200);
    });
  });

  describe("handleBatchDelete", () => {
    it("should process delete requests correctly", async () => {
      const request = new Request("http://localhost:8787/batch/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer test-secret",
        },
        body: JSON.stringify({ ids: ["test-1", "test-2"] }),
      });

      const response = await handleBatchDelete(request, mockEnv, corsHeaders);
      expect(response.status).to.equal(200);
      const result = await response.json();
      expect(result.success).to.be.true;
      expect(result.total_deleted).to.equal(2);
    });
  });
});
