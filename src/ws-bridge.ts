import { WebSocketServer, WebSocket } from "ws";
import type { BridgeMessage } from "./types.js";

const PING_INTERVAL_MS = 25_000;

export class WsBridge {
  private wss: WebSocketServer;
  private client: WebSocket | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private responseHandlers = new Map<string, (msg: BridgeMessage) => void>();

  constructor(private readonly port: number = 9271) {
    this.wss = new WebSocketServer({ host: "127.0.0.1", port });
  }

  start(): void {
    this.wss.on("connection", (ws, req) => {
      // Reject any connection that doesn't look like the extension
      const origin = req.headers.origin ?? "";
      if (origin && !origin.startsWith("chrome-extension://")) {
        ws.close(1008, "Forbidden origin");
        return;
      }

      // Only one client at a time
      if (this.client) {
        ws.close(1008, "Only one client allowed");
        return;
      }

      this.client = ws;
      console.error("[bridge] Extension connected");

      // Keepalive ping every 25s to prevent service worker idle
      this.pingInterval = setInterval(() => {
        this.send({ type: "ping", correlationId: "keepalive", payload: {} });
      }, PING_INTERVAL_MS);

      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as BridgeMessage;
          this.handleMessage(msg);
        } catch (err) {
          console.error("[bridge] Failed to parse message:", err);
        }
      });

      ws.on("close", () => {
        console.error("[bridge] Extension disconnected");
        this.client = null;
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        // Reject all pending requests
        for (const [id, handler] of this.responseHandlers) {
          handler({
            type: "error",
            correlationId: id,
            payload: { message: "Extension disconnected", code: "NOT_CONNECTED" },
          });
        }
        this.responseHandlers.clear();
      });

      ws.on("error", (err) => {
        console.error("[bridge] WebSocket error:", err);
      });
    });

    console.error(`[bridge] WebSocket server listening on ws://127.0.0.1:${this.port}`);
  }

  get isConnected(): boolean {
    return this.client !== null && this.client.readyState === WebSocket.OPEN;
  }

  /** Send a fire-and-forget message to the extension. */
  send(msg: BridgeMessage): void {
    if (!this.client || this.client.readyState !== WebSocket.OPEN) {
      throw new Error("Extension not connected");
    }
    this.client.send(JSON.stringify(msg));
  }

  /**
   * Send a request and wait for the response with the same correlationId.
   * Rejects after `timeoutMs` (default 120s).
   */
  request(msg: BridgeMessage, timeoutMs = 120_000): Promise<BridgeMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.responseHandlers.delete(msg.correlationId);
        reject(new Error(`Request timed out: ${msg.type} (${msg.correlationId})`));
      }, timeoutMs);

      this.responseHandlers.set(msg.correlationId, (response) => {
        clearTimeout(timer);
        resolve(response);
      });

      try {
        this.send(msg);
      } catch (err) {
        clearTimeout(timer);
        this.responseHandlers.delete(msg.correlationId);
        reject(err);
      }
    });
  }

  stop(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.client?.close();
    this.wss.close();
  }

  private handleMessage(msg: BridgeMessage): void {
    // Response to a pending request
    const handler = this.responseHandlers.get(msg.correlationId);
    if (handler) {
      this.responseHandlers.delete(msg.correlationId);
      handler(msg);
      return;
    }

    // Unsolicited messages
    if (msg.type === "pong") return; // Expected keepalive reply
    console.error(`[bridge] Unhandled message type: ${msg.type}`);
  }
}
