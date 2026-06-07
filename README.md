# pi-exa-search

Exa web search extension for the pi coding agent.

## Installation

1. Clone this repo into your code directory:

```bash
git clone https://github.com/oeig-io/pi-exa-search.git ~/code/oeig/pi-exa-search
```

2. Symlink it into pi's extensions directory so pi can discover it:

```bash
mkdir -p ~/.pi/agent/extensions
ln -s ~/code/oeig/pi-exa-search ~/.pi/agent/extensions/pi-exa-search
```

> From here on, `~/.pi/agent/extensions/pi-exa-search` resolves to your clone, so the paths below work as-is.

3. Install dependencies (required — `node_modules/` is gitignored, so a fresh clone won't have `exa-js`):

```bash
cd ~/.pi/agent/extensions/pi-exa-search
npm install
```

## Configuration

An Exa API key is **optional**. If you have one, set it in your shell environment
for higher rate limits and proper quota/billing:

```bash
export EXA_API_KEY="your-exa-api-key"
```

Add this to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.) to persist it across sessions.

If `EXA_API_KEY` is **not** set, the extension automatically falls back to Exa's
public hosted MCP endpoint (`https://mcp.exa.ai/mcp`), which accepts
unauthenticated requests. This is rate-limited but free and requires no signup —
the same mechanism opencode uses to provide "free" web search.

## Usage

Start pi and the `web_search` tool will be automatically available:

```bash
pi
```

The model can then use `web_search` for queries like:
- "Search for the latest React release"
- "Find documentation on Exa API"
- "Look up current best practices for TypeScript"

## Tool Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| query | string | Yes | - | The search query |
| numResults | number | No | 5 | Max results to return (max: 100) |
| type | string | No | "auto" | "auto", "keyword", or "neural" |

## How It Works

The extension registers a `web_search` tool with pi. When the LLM calls it:

1. Reads `EXA_API_KEY` from environment.
2. **If a key is set** — calls the Exa API via the `exa-js` SDK (authenticated path).
3. **If no key is set** — POSTs a JSON-RPC `tools/call` for `web_search_exa` to
   Exa's public hosted MCP endpoint `https://mcp.exa.ai/mcp` (free, unauthenticated
   path) and parses the SSE/JSON response.
4. Formats results as markdown (title, URL, snippet).
5. Returns formatted text to the LLM. The `details.via` field reports which path
   was used (`sdk` or `mcp-free`).

### Why the free path works

Exa runs a public MCP server at `https://mcp.exa.ai/mcp` that serves the
`web_search_exa` tool without requiring an API key (it is rate-limited). When a
key is available it can be passed as `?exaApiKey=...`. This is exactly how
[opencode](https://github.com/sst/opencode) obtains free Exa search — see
`packages/opencode/src/tool/mcp-websearch.ts` in that repo.
