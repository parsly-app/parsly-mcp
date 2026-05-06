#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WsBridge } from "../src/index.js";
import { createMcpServer } from "../src/mcp-server.js";

const port = parseInt(process.env["PARSLY_PORT"] ?? "9271", 10);

void (async () => {
  const bridge = new WsBridge(port);
  bridge.start();

  const mcpServer = createMcpServer(bridge);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  process.on("SIGINT", () => {
    console.error("\n[parsly-mcp] Shutting down…");
    bridge.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    bridge.stop();
    process.exit(0);
  });
})();
