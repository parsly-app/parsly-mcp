#!/usr/bin/env node
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { WsBridge } from "../src/index.js";
import { createMcpServer } from "../src/mcp-server.js";

const mcpPort = parseInt(process.env["PARSLY_MCP_PORT"] ?? "9270", 10);
const bridgePort = parseInt(process.env["PARSLY_PORT"] ?? "9271", 10);

const bridge = new WsBridge(bridgePort);
bridge.start();

// Create a fresh transport + server pair for each request (stateless pattern).
// Sharing a single transport instance across requests causes state corruption
// when clients reconnect or retry the handshake.
const httpServer = createServer(async (req, res) => {
  if (req.url !== "/mcp") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const mcpServer = createMcpServer(bridge);
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res);
});

httpServer.listen(mcpPort, "127.0.0.1", () => {
  console.error(`[parsly-mcp] Listening on http://127.0.0.1:${mcpPort}/mcp`);
  console.error(`[parsly-mcp] Bridge WebSocket on ws://127.0.0.1:${bridgePort}`);
});

process.on("SIGINT", () => {
  console.error("\n[parsly-mcp] Shutting down…");
  bridge.stop();
  httpServer.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  bridge.stop();
  httpServer.close();
  process.exit(0);
});
