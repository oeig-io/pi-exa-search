# Exa API Expansion — Planning

## Status: Implemented (2026-07-28)

Both features described in this plan were implemented in the
`expand-api-usage` branch and merged into `index.ts` / `README.md`. This
document is retained as the design record; see git history for the change.

## Context

The `pi-exa-search` extension originally provided only a thin wrapper around
`exa.search()` with `query`, `numResults`, and `type`. The SDK exposes a much
richer API surface. This document captures the analysis and decisions from the
2026-06-18 conversation about which features to add, and the 2026-07-28
implementation that followed.

---

## Decision: Two Immediate Additions

Two features were selected for near-term implementation:

### 1. `fetch_page` tool

**Problem:** Agents currently use `curl` to fetch page content, which fails on
many modern sites (JavaScript-rendered, Cloudflare blocklists, aggressive
bots detection, redirects, etc.).

**Solution:** Add a new `fetch_page` tool that calls `exa.getContents()` to
retrieve the full text of one or more URLs.

**Behavior:**
- Takes a list of URLs
- Returns the extracted text content (up to configurable `maxCharacters`)
- Works for sites that block curl because Exa accesses them server-side
- Optionally include HTML tags or highlights for targeted extraction

**SDK call:**
```ts
await exa.getContents(urls, { text: { maxCharacters: 5000 } })
```

**Use cases:**
- Read a specific article or documentation page
- Fetch full content after `web_search` surfaces a promising URL
- Replace fragile `bash("curl ...")` calls throughout skills and agent prompts

---

### 2. Filter parameters on `web_search`

**Problem:** The current `web_search` tool has no way to narrow results by
source domain, publication date, or content category. Agents doing research
or competitive intelligence need temporal and domain scoping.

**Solution:** Extend the existing tool's parameter schema with optional filters.

**New parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `domains` | `string[]` | Restrict to these domains (e.g. `["nytimes.com", "reuters.com"]`) |
| `excludeDomains` | `string[]` | Exclude these domains |
| `startDate` | `string` (ISO date) | Published on or after this date |
| `endDate` | `string` (ISO date) | Published on or before this date |
| `category` | `string` | Exa content category (e.g. `"news"`, `"blog"`, `"research"`) |

**SDK mapping:**
```ts
await exa.search(query, {
  numResults,
  type,
  includeDomains: params.domains,
  excludeDomains: params.excludeDomains,
  startPublishedDate: params.startDate,
  endPublishedDate: params.endDate,
  category: params.category,
})
```

**Prompt guidelines to add:**
- "Use `startDate`/`endDate` for news and research queries to avoid stale results."
- "Use `domains` to focus on authoritative or relevant sources."

---

## Deferred: Other Available Features

These were evaluated and set aside for now but remain available if needed later:

### Tier 1 — Available on SDK path (API key required)

| Feature | SDK Method | Reason deferred |
|---------|-----------|-----------------|
| `answer` (Q&A with citations) | `exa.answer()` | Most useful for factual lookups; consider as a third tool (`ask_the_web`) |
| Streaming answer | `exa.streamAnswer()` | Requires async streaming integration with pi |
| Structured output | `exa.answer()` + `outputSchema` | Powerful but needs schema design per use case |
| Highlights | `search()` + `highlights` | Low-effort add; consider alongside filter params |
| Find similar | `exa.findSimilar()` | Useful for "read more like this" flows |
| Subpage crawling | `search()` + `subpages` | Niche; add when needed |

### Tier 2 — New extension candidates

| Feature | Product | Reason deferred |
|---------|---------|-----------------|
| `pi-exa-research` | `exa.research` (Deep Research agent) | Separate extension; multi-step async workflow |
| `pi-exa-websets` | Websets + Enrichments + Monitors | Full dataset pipeline; significant scope |

### Tier 3 — Free MCP path

The public MCP endpoint (`https://mcp.exa.ai/mcp`) also exposes
`find_similar_exa`, `get_contents_exa`, and `answer_exa` without requiring an
API key. These could be wired into the free fallback path in the future.

---

## Implementation Notes (2026-07-28)

- Both additions remain on the SDK path when an API key is present, but the
  `fetch_page` MCP path was also wired up against the public
  `web_fetch_exa` MCP tool. Free-tier users now get basic content extraction
  out of the box; only advanced modes (highlights, subpages, summary) and
  search filters still require an API key.
- When a filter / advanced parameter is supplied on the free path, the
  request still runs and the response includes `details.filtersIgnored: true`
  so the caller can see the parameter was silently dropped.
- Adding filter params is backward-compatible (all new fields are optional).
- The existing `via: "sdk" | "mcp-free"` detail in responses continues to
  accurately report which path was taken.
- The original `index.ts` was never typechecked (missing types, inconsistent
  `details` shape across return branches, implicit `any` for the `pi`
  parameter). The implementation also fixes those so a `tsc --noEmit` against
  the right `package.json` deps passes cleanly.

---

## Files modified

| File | Change |
|------|--------|
| `index.ts` | Added `fetch_page` tool; extended `web_search` parameter schema with filters; fixed long-standing typecheck issues |
| `README.md` | Documented both tools, all parameters, free-path behavior, and `filtersIgnored` semantics |
| `planning/exa-expanded-api-usage.md` | This file (status banner + implementation notes added) |
