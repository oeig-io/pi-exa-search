# Exa API Expansion — Planning

## Context

The `pi-exa-search` extension currently provides only a thin wrapper around
`exa.search()` with `query`, `numResults`, and `type`. The SDK exposes a much
richer API surface. This document captures the analysis and decisions from the
2026-06-18 conversation about which features to add.

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

## Implementation Notes

- Both additions remain on the SDK path (require `EXA_API_KEY`). The MCP
  fallback path (`mcp-free`) is unchanged.
- The MCP path doesn't expose `getContents` or filter parameters — only the
  SDK does, so free-tier users won't get these features. That's acceptable.
- Adding filter params is backward-compatible (all new fields are optional).
- The existing `via: "sdk" | "mcp-free"` detail in responses continues to
  accurately report which path was taken.

---

## Files to modify

| File | Change |
|------|--------|
| `index.ts` | Add `fetch_page` tool; extend `web_search` parameter schema with filters |
| `README.md` | Document new parameters and tool |
| `planning/exa-expanded-api-usage.md` | This file |
