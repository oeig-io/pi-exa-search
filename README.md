# pi-exa-search

Exa web search extension for the pi coding agent.

## Installation

Install by pointing pi at a local copy of this repo. This works fully offline and
does not depend on git remaining reachable.

1. Get the code onto the machine (clone, copy, `rsync`, etc.) at any path you like,
   e.g. `~/code/oeig/pi-exa-search`.

2. Install dependencies. **This step is required** — `node_modules/` is gitignored,
   and pi does **not** auto-run `npm install` for local-path packages (only for
   npm/git sources):

   ```bash
   cd ~/code/oeig/pi-exa-search
   npm install
   ```

3. Register the local path as a pi package:

   ```bash
   pi install ~/code/oeig/pi-exa-search
   ```

   This adds the path to `~/.pi/agent/settings.json` under `packages` **without
   copying** — pi loads the extension directly from your working copy, so edits
   take effect on the next start (or `/reload`). Use `pi install -l <path>` to write
   to project settings (`.pi/settings.json`) instead of user settings.

To uninstall: `pi remove ~/code/oeig/pi-exa-search` (or edit `settings.json`).

> **Use only one install method.** Do **not** also symlink the repo into
> `~/.pi/agent/extensions/`. That directory is auto-discovered, so combining it
> with `pi install` registers the `web_search` tool twice and pi will error with
> a tool conflict. Pick `pi install` (recommended) **or** the symlink, never both.

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

Once installed, start pi and the `web_search` tool is available automatically:

```bash
pi
```

Verify it loaded with `pi list` (the local path should appear under packages).

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
