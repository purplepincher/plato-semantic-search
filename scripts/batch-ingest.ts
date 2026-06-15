#!/usr/bin/env ts-node

import * as fs from "fs";
import * as path from "path";
import { argv } from "process";

interface BatchItem {
  id: string;
  text: string;
  metadata?: Record<string, any>;
}

async function main() {
  const args = argv.slice(2);
  if (args.length < 2) {
    console.log("Usage: ts-node scripts/batch-ingest.ts <api-url> <secret> [file.json]");
    console.log("");
    console.log("If file.json is not provided, reads from stdin");
    process.exit(1);
  }

  const [apiUrl, secret, filePath] = args;

  let rawData: string;
  if (filePath) {
    rawData = fs.readFileSync(path.resolve(filePath), "utf-8");
  } else {
    rawData = await readStdin();
  }

  const items = JSON.parse(rawData);

  console.log(`Sending ${Array.isArray(items) ? items.length : Object.keys(items).length} items to ${apiUrl}`);

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${secret}`,
    },
    body: JSON.stringify(items),
  });

  const result = await response.json();
  console.log("Response:", JSON.stringify(result, null, 2));

  if (!response.ok) {
    process.exit(1);
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data);
    });
  });
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
