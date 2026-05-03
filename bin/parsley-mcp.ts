#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WsBridge } from "../src/index.js";
import { createMcpServer } from "../src/mcp-server.js";

const port = parseInt(process.env["PARSLEY_PORT"] ?? "9271", 10);

const bridge = new WsBridge(port);
bridge.start();

const mcpServer = createMcpServer(bridge);
const transport = new StdioServerTransport();
await mcpServer.connect(transport);

process.on("SIGINT", () => {
  console.error("\n[parsley-mcp] Shutting down…");
  bridge.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  bridge.stop();
  process.exit(0);
});
