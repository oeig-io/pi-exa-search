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

## Tools

The extension registers two tools with pi:

### `web_search` — search the web

Search the web for current information, facts, news, or to verify up-to-date details.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| query | string | Yes | - | The search query |
| numResults | number | No | 5 | Max results to return (max: 100) |
| type | string | No | "auto" | "auto", "keyword", or "neural" |
| domains | string[] | No | - | Restrict to these domains. *Requires EXA_API_KEY; ignored on the free path.* |
| excludeDomains | string[] | No | - | Exclude these domains. *Requires EXA_API_KEY; ignored on the free path.* |
| startDate | string | No | - | ISO date (YYYY-MM-DD). Published on or after this. *Requires EXA_API_KEY; ignored on the free path.* |
| endDate | string | No | - | ISO date (YYYY-MM-DD). Published on or before this. *Requires EXA_API_KEY; ignored on the free path.* |
| category | string | No | - | Exa content category (e.g. `news`, `company`, `github`, `research paper`, `pdf`, `tweet`, `personal site`, `linkedin profile`, `financial report`). *Requires EXA_API_KEY; ignored on the free path.* |

When filter parameters are supplied on the free path, the request still runs and
`details.filtersIgnored` is set to `true` so the caller can see the filters were
silently dropped.

### `fetch_page` — extract page contents

Fetch the full text of one or more URLs through Exa's server-side extraction.
Use this when a site blocks curl, requires JavaScript to render, or you need
clean markdown instead of raw HTML. **Prefer this over running `curl` in the
bash tool** — it handles JS-rendered pages, bot detection, and PDF extraction
server-side.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| urls | string[] | Yes | - | URLs to fetch. Batch multiple URLs into a single call. |
| maxCharacters | number | No | 5000 | Max characters of text to return per URL. |
| highlights | object | No | - | `{ query: string }` — extract only excerpts relevant to a query. *Requires EXA_API_KEY; ignored on the free path.* |
| subpages | number | No | - | Max number of linked subpages to crawl per URL. *Requires EXA_API_KEY; ignored on the free path.* |
| subpageTarget | string[] | No | - | Keywords to prioritize when selecting subpages. *Requires EXA_API_KEY; ignored on the free path.* |

When advanced parameters are supplied on the free path, the request still runs
with the basic text extraction and `details.filtersIgnored` is set to `true`.

## Usage

Once installed, start pi and both tools are available automatically:

```bash
pi
```

Verify they loaded with `pi list` (the local path should appear under packages).

The model can then use these tools for queries like:
- "Search for the latest React release" → `web_search`
- "Find documentation on Exa API" → `web_search`
- "Read the contents of <url>" → `fetch_page`
- "What's on the iDempiere REST API docs page?" → `fetch_page`

## How It Works

When the LLM calls `web_search` or `fetch_page`:

1. Reads `EXA_API_KEY` from environment.
2. **If a key is set** — calls the Exa API via the `exa-js` SDK (authenticated path).
3. **If no key is set** — POSTs a JSON-RPC `tools/call` to Exa's public hosted
   MCP endpoint `https://mcp.exa.ai/mcp` (free, unauthenticated path) and parses
   the SSE/JSON response.
   - `web_search` uses the `web_search_exa` MCP tool.
   - `fetch_page` uses the `web_fetch_exa` MCP tool.
4. Formats results as markdown and returns them to the LLM. The `details.via`
   field reports which path was used (`sdk` or `mcp-free`).

### Why the free path works

Exa runs a public MCP server at `https://mcp.exa.ai/mcp` that serves the
`web_search_exa` and `web_fetch_exa` tools without requiring an API key (it is
rate-limited). When a key is available it can be passed as `?exaApiKey=...`.
This is exactly how [opencode](https://github.com/sst/opencode) obtains free
Exa search — see `packages/opencode/src/tool/mcp-websearch.ts` in that repo.

### Why `fetch_page` exists

`curl` fails on many modern sites — JavaScript-rendered SPAs, Cloudflare
blocklists, aggressive bot detection, redirect chains. Exa fetches pages from
its own infrastructure and returns clean markdown, so it works where curl
returns a JS shell or a 403. See `planning/exa-expanded-api-usage.md` for the
full design notes.
