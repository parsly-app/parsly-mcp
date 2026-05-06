# parsly-mcp

Give your AI agent a browser. Parsly connects Claude, Cursor, and ChatGPT to a Chrome extension that automates browsing in the user's own authenticated session — reading what's on screen, scrolling through feeds, and structuring what a person could do manually. No external APIs or infrastructure required.

Parsly bridges MCP to a Chrome extension running in your browser, so AI agents can automate real browser interactions on any site you can open in a tab.

## Prerequisites

1. **Chrome** with the [Parsly extension](https://parsly.to) installed and active
2. **Node.js 18+** on your machine
3. The extension's side panel open in Chrome (click the Parsly icon)

The MCP server communicates with the Chrome extension over a local WebSocket. Chrome must be running for any tool calls to work.

## Quick Start

### Cursor

Add to your `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "parsly": {
      "command": "npx",
      "args": ["parsly-mcp"]
    }
  }
}
```

### Claude Desktop — Chat mode

Install the `.mcpb` extension from [parsly.to](https://parsly.to) for single-click setup via Settings → Extensions → Install Extension.

### Claude Desktop — Cowork mode (recommended)

Cowork requires an entry in `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`). Claude Desktop automatically bridges this into the Cowork VM:

```json
{
  "mcpServers": {
    "parsly": {
      "command": "npx",
      "args": ["parsly-mcp"]
    }
  }
}
```

> **Note:** The `.mcpb` extension is not bridged to Cowork. The `claude_desktop_config.json` entry is the only path that works in Cowork.

### Manual / other clients

```bash
npx parsly-mcp
```

The server starts on stdio and opens a WebSocket bridge on `127.0.0.1:9271` (configurable via `PARSLY_PORT`).

## Available Tools

| Tool | Description |
|------|-------------|
| `parsly_list_operations` | List all available browser automation operations with their parameters. Call this first to discover what Parsly can do. |
| `parsly_run_operation` | Run an operation in the user's browser tab and save results to a JSON file. Returns a summary (item count, columns, 3-row preview, file path). |
| `parsly_get_status` | Check whether the Chrome extension is connected and ready. |
| `parsly_cancel_run` | Cancel a running operation by run ID. |
| `parsly_fetch_image` | Fetch an image URL through the browser and return it inline for display. |

### Example usage

```
You: Read the top 20 posts from r/programming and save them to my Desktop.

Claude: [calls parsly_run_operation with operationId="reddit-posts", url="https://reddit.com/r/programming", params={maxItems: 20}]
        Saved 20 posts to ~/Desktop/parsly/reddit-posts-abc123.json
```

## What you can automate

- **Instagram** — profile posts, reels (with thumbnails, permalinks, engagement metrics)
- **Reddit** — subreddit posts, post comments
- **Twitter / X** — profile tweets
- **YouTube** — video transcripts with timestamps
- Any site you can open in Chrome, authenticated or not

More operations are added regularly. Run `parsly_list_operations` to see the current full list.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PARSLY_PORT` | `9271` | WebSocket port for the Chrome extension bridge |
| `PARSLY_OUTPUT_DIR` | `~/Desktop/parsly` | Directory where result JSON files are saved |
| `PARSLY_TIMEOUT` | `120` | Operation timeout in seconds |
| `PARSLY_RATE_LIMIT` | `2000` | Minimum milliseconds between consecutive runs |

## Running multiple AI clients simultaneously

By MCP convention, stdio servers serve a single client at a time — each AI client spawns its own dedicated process. If you run Cursor and Claude Desktop simultaneously, they will conflict on port 9271.

For multi-client setups, use the HTTP transport instead. Run the server once and point all clients at it:

```bash
npx parsly-mcp-http
```

This starts an HTTP MCP server on `http://127.0.0.1:9270/mcp` and a single bridge on port `9271`. Then configure each client to use the URL instead of spawning a process:

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "parsly": {
      "url": "http://127.0.0.1:9270/mcp"
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "parsly": {
      "url": "http://127.0.0.1:9270/mcp"
    }
  }
}
```

Set `PARSLY_MCP_PORT` (default `9270`) and `PARSLY_PORT` (default `9271`) to change either port.

## Troubleshooting

**"Chrome extension not connected"**
- Make sure Chrome is open with the Parsly extension installed
- Click the Parsly extension icon to open the side panel
- Check that the side panel shows "Connected" status

**Operation times out**
- Some sites load slowly — try increasing `PARSLY_TIMEOUT` to `300`
- Make sure you're logged into the site in Chrome if it requires authentication

**Results have fewer items than expected**
- Use the `maxItems` parameter to set a target count
- For infinite-scroll feeds, the operation scrolls until it reaches your target or the feed is exhausted

**Port conflict**
- If port `9271` is in use, set `PARSLY_PORT` to another value (e.g. `9272`) in your MCP config's `env` block

## License

MIT — [parsly.to](https://parsly.to)
