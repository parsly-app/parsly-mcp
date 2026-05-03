import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { WsBridge } from "./ws-bridge.js";

// ---------------------------------------------------------------------------
// Output file helpers
// ---------------------------------------------------------------------------

function resolveOutputPath(outputPath: string | undefined, operationId: string, runId: string): string {
  if (outputPath) {
    // Expand leading ~ to home directory
    return outputPath.startsWith("~/")
      ? path.join(os.homedir(), outputPath.slice(2))
      : outputPath;
  }
  const dir = process.env["PARSLEY_OUTPUT_DIR"]
    ? (process.env["PARSLEY_OUTPUT_DIR"].startsWith("~/")
        ? path.join(os.homedir(), process.env["PARSLEY_OUTPUT_DIR"].slice(2))
        : process.env["PARSLEY_OUTPUT_DIR"])
    : path.join(os.homedir(), "Desktop", "parsley");
  return path.join(dir, `${operationId}-${runId}.json`);
}

function buildSummary(
  data: unknown,
  filePath: string | null,
  fileWriteError: string | null,
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  if (Array.isArray(data)) {
    summary["itemCount"] = data.length;
    const first = data[0];
    summary["columns"] = first && typeof first === "object" ? Object.keys(first) : null;
    summary["preview"] = data.slice(0, 3);
  } else if (data !== null && data !== undefined) {
    summary["itemCount"] = null;
    summary["columns"] = null;
    summary["preview"] = data;
  } else {
    summary["itemCount"] = 0;
    summary["columns"] = null;
    summary["preview"] = null;
  }

  if (filePath) summary["filePath"] = filePath;
  if (fileWriteError) summary["fileWriteError"] = fileWriteError;

  return summary;
}

function writeOutputFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

// Rate-limit state — enforced across all calls to parsley_run_operation
let lastRunTimestamp = 0;

const NOT_CONNECTED_RESPONSE = {
  content: [
    {
      type: "text" as const,
      text: JSON.stringify({
        error:
          "Chrome extension not connected. Make sure Chrome is open with the Parsley extension installed.",
        code: "NOT_CONNECTED",
      }),
    },
  ],
};

export function createMcpServer(bridge: WsBridge): McpServer {
  const server = new McpServer({
    name: "parsley",
    version: "0.1.0",
  });

  // -------------------------------------------------------------------------
  // parsley_list_operations
  // -------------------------------------------------------------------------
  server.tool(
    "parsley_list_operations",
    "List all available Parsley operations with their descriptions and parameters. Call this first to discover what extraction operations you can run.",
    {},
    async () => {
      if (!bridge.isConnected) return NOT_CONNECTED_RESPONSE;

      const response = await bridge.request(
        { type: "list-operations", correlationId: crypto.randomUUID(), payload: {} },
        10_000,
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(response.payload) }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // parsley_get_status
  // -------------------------------------------------------------------------
  server.tool(
    "parsley_get_status",
    "Check whether the Parsley Chrome extension is connected and ready to run operations. Optionally returns an activeRun object if an operation is currently executing.",
    {},
    async () => {
      if (!bridge.isConnected) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ connected: false }) }],
        };
      }

      const response = await bridge.request(
        { type: "get-status", correlationId: crypto.randomUUID(), payload: {} },
        5_000,
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ connected: true, ...(response.payload as object) }),
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // parsley_run_operation
  // -------------------------------------------------------------------------
  server.tool(
    "parsley_run_operation",
    `Run a Parsley operation on a web page and save the results to a file.
The operation extracts data from the page using CSS selectors or network interception — fast and deterministic, no AI inference cost.
Use parsley_list_operations first to discover available operations and their parameters.
The browser must be open and the user must be logged in for sites that require authentication.
Results are written to disk — only a summary (item count, columns, 3-row preview, file path) is returned to avoid consuming context.
Always provide outputPath based on the user's working context (e.g. their project directory). If unsure, omit it and a default location will be used.`,
    {
      operationId: z.string().describe("The operation ID (from parsley_list_operations)"),
      url: z.string().url().describe("The URL to navigate to before running the operation"),
      params: z.record(z.unknown()).optional().describe("Operation-specific parameters"),
      tabBehavior: z
        .enum(["new", "active", "reuse"])
        .optional()
        .default("new")
        .describe(
          "'new' = create a fresh tab (default), 'active' = use the current tab without navigating, 'reuse' = find an existing tab for this origin",
        ),
      outputPath: z
        .string()
        .optional()
        .describe(
          "Absolute path where results should be saved as JSON (e.g. /Users/you/project/data/tweets.json). Supports ~ expansion. If omitted, saved to PARSLEY_OUTPUT_DIR or ~/Desktop/parsley.",
        ),
    },
    async ({ operationId, url, params, tabBehavior, outputPath }) => {
      if (!bridge.isConnected) return NOT_CONNECTED_RESPONSE;

      // Enforce minimum delay between consecutive runs
      const minDelay = parseInt(process.env["PARSLEY_RATE_LIMIT"] ?? "2000", 10);
      const elapsed = Date.now() - lastRunTimestamp;
      if (elapsed < minDelay) {
        await new Promise<void>((r) => setTimeout(r, minDelay - elapsed));
      }

      const timeoutMs = parseInt(process.env["PARSLEY_TIMEOUT"] ?? "120", 10) * 1_000;

      // Auto-populate urlParam from the top-level `url` argument.
      // If the operation declares urlParam and the caller didn't already provide
      // that param explicitly, inject it so the LLM only needs to pass `url` once.
      const resolvedParams: Record<string, unknown> = { ...(params ?? {}) };
      try {
        const manifestResp = await bridge.request(
          { type: "list-operations", correlationId: crypto.randomUUID(), payload: {} },
          10_000,
        );
        const ops = (manifestResp.payload as { operations?: { id: string; urlParam?: string }[] }).operations ?? [];
        const opMeta = ops.find((o) => o.id === operationId);
        if (opMeta?.urlParam && !(opMeta.urlParam in resolvedParams)) {
          resolvedParams[opMeta.urlParam] = url;
        }
      } catch {
        // Non-fatal — proceed with the params as provided
      }

      try {
        const response = await bridge.request(
          {
            type: "run-operation",
            correlationId: crypto.randomUUID(),
            payload: { operationId, url, params: resolvedParams, tabBehavior },
          },
          timeoutMs,
        );

        lastRunTimestamp = Date.now();

        const result = response.payload as Record<string, unknown>;
        const data = result["data"];
        const runId = result["runId"] as string;

        // Write full data to disk; only return a summary to the LLM
        let filePath: string | null = null;
        let fileWriteError: string | null = null;

        const hasData = data !== null && data !== undefined && !(Array.isArray(data) && data.length === 0);
        if (hasData) {
          filePath = resolveOutputPath(outputPath, operationId, runId);
          try {
            writeOutputFile(filePath, data);
          } catch (err) {
            console.error("[parsley] Failed to write output file:", err);
            fileWriteError = String(err);
            filePath = null;
          }
        }

        const summary = buildSummary(data, filePath, fileWriteError);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: result["status"],
                runId,
                outputKey: result["outputKey"],
                renderAs: result["renderAs"],
                logs: result["logs"],
                ...(result["error"] ? { error: result["error"] } : {}),
                ...summary,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "failure",
                error: String(err),
                code: "RUN_FAILED",
              }),
            },
          ],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // parsley_cancel_run
  // -------------------------------------------------------------------------
  server.tool(
    "parsley_cancel_run",
    "Cancel a currently running Parsley operation.",
    {
      runId: z
        .string()
        .describe("The run ID to cancel (from a previous parsley_run_operation response)"),
    },
    async ({ runId }) => {
      if (!bridge.isConnected) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Not connected", code: "NOT_CONNECTED" }),
            },
          ],
        };
      }

      const response = await bridge.request(
        {
          type: "cancel-run",
          correlationId: crypto.randomUUID(),
          payload: { runId },
        },
        10_000,
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(response.payload) }],
      };
    },
  );

  return server;
}
