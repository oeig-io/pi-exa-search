import Exa from "exa-js";
import { defineTool } from "@mariozechner/pi-coding-agent";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// Exa hosts a public MCP server that accepts unauthenticated requests.
// When no EXA_API_KEY is provided we fall back to it (rate-limited but free).
// When a key is provided it is passed as a query param for proper quota/billing.
// This mirrors how opencode obtains "free" Exa search.
const EXA_MCP_BASE = "https://mcp.exa.ai/mcp";

interface SearchResultItem {
	title: string;
	url: string;
	snippet?: string;
}

interface ContentResultItem {
	title: string;
	url: string;
	text?: string;
	highlights?: string[];
	summary?: string;
}

/**
 * Call the hosted Exa MCP endpoint (the free, no-key path).
 * Sends a JSON-RPC tools/call for `web_search_exa` and parses the
 * SSE / JSON response into a normalized result list.
 */
async function searchViaMcp(
	query: string,
	numResults: number,
	apiKey: string | undefined,
	signal: AbortSignal | undefined,
): Promise<SearchResultItem[]> {
	const url = apiKey ? `${EXA_MCP_BASE}?exaApiKey=${encodeURIComponent(apiKey)}` : EXA_MCP_BASE;

	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: {
				name: "web_search_exa",
				arguments: {
					query,
					type: "auto",
					numResults,
					livecrawl: "fallback",
				},
			},
		}),
		signal,
	});

	if (!response.ok) {
		throw new Error(`Exa MCP request failed: ${response.status} ${response.statusText}`);
	}

	const body = await response.text();
	const text = parseMcpResponse(body);
	if (!text) return [];

	return parseExaTextResults(text);
}

/**
 * Call the hosted Exa MCP endpoint to fetch the contents of one or more URLs.
 * Uses the `web_fetch_exa` tool (the public, no-key MCP tool for content extraction).
 */
async function fetchPageViaMcp(
	urls: string[],
	maxCharacters: number,
	apiKey: string | undefined,
	signal: AbortSignal | undefined,
): Promise<ContentResultItem[]> {
	const url = apiKey ? `${EXA_MCP_BASE}?exaApiKey=${encodeURIComponent(apiKey)}` : EXA_MCP_BASE;

	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: {
				name: "web_fetch_exa",
				arguments: { urls, maxCharacters },
			},
		}),
		signal,
	});

	if (!response.ok) {
		throw new Error(`Exa MCP fetch failed: ${response.status} ${response.statusText}`);
	}

	const body = await response.text();
	const text = parseMcpResponse(body);
	if (!text) return [];

	return parseExaTextContents(text);
}

/**
 * Extract the inner tool text from an MCP response, which may arrive as
 * a direct JSON body or as Server-Sent Events (`data: {...}` lines).
 */
function parseMcpResponse(body: string): string | undefined {
	const tryPayload = (payload: string): string | undefined => {
		const trimmed = payload.trim();
		if (!trimmed.startsWith("{")) return undefined;
		try {
			const data = JSON.parse(trimmed);
			const content = data?.result?.content;
			if (Array.isArray(content)) {
				const item = content.find((c: { text?: string }) => c?.text);
				return item?.text;
			}
		} catch {
			// fall through
		}
		return undefined;
	};

	const direct = tryPayload(body);
	if (direct) return direct;

	for (const line of body.split("\n")) {
		if (!line.startsWith("data: ")) continue;
		const data = tryPayload(line.substring(6));
		if (data) return data;
	}
	return undefined;
}

/**
 * The Exa MCP web_search tool returns either a JSON string of results or a
 * human-readable "Title: / URL: / Highlights:" text block. Handle both.
 */
function parseExaTextResults(text: string): SearchResultItem[] {
	const trimmed = text.trim();

	// Try structured JSON first.
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			const parsed = JSON.parse(trimmed);
			const arr = Array.isArray(parsed) ? parsed : parsed.results;
			if (Array.isArray(arr)) {
				return arr
					.map((r: { title?: string; url?: string; text?: string; snippet?: string }) => ({
						title: r.title ?? r.url ?? "Untitled",
						url: r.url ?? "",
						snippet: r.snippet ?? r.text,
					}))
					.filter((r) => r.url);
			}
		} catch {
			// fall through to text parsing
		}
	}

	// Fall back to parsing the readable text block(s).
	const results: SearchResultItem[] = [];
	const blocks = trimmed.split(/\n(?=Title:)/);
	for (const block of blocks) {
		const titleMatch = block.match(/Title:\s*(.*)/);
		const urlMatch = block.match(/URL:\s*(\S+)/);
		if (!urlMatch) continue;
		const highlightsIdx = block.search(/Highlights?:/i);
		let snippet: string | undefined;
		if (highlightsIdx !== -1) {
			snippet = block
				.slice(highlightsIdx)
				.replace(/Highlights?:/i, "")
				.trim()
				.split("\n")
				.slice(0, 3)
				.join(" ")
				.slice(0, 500);
		}
		results.push({
			title: titleMatch?.[1]?.trim() || urlMatch[1],
			url: urlMatch[1],
			snippet,
		});
	}
	return results;
}

/**
 * Parse the response of the Exa MCP `web_fetch_exa` tool. It returns either a
 * JSON array of {title, url, text} records or a human-readable text block of
 * "Title: ... / URL: ... / Content: ..." sections, one per URL.
 */
function parseExaTextContents(text: string): ContentResultItem[] {
	const trimmed = text.trim();

	// Try structured JSON first.
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			const parsed = JSON.parse(trimmed);
			const arr = Array.isArray(parsed) ? parsed : parsed.results;
			if (Array.isArray(arr)) {
				return arr
					.map((r: { title?: string; url?: string; text?: string }) => ({
						title: r.title ?? r.url ?? "Untitled",
						url: r.url ?? "",
						text: r.text,
					}))
					.filter((r) => r.url);
			}
		} catch {
			// fall through to text parsing
		}
	}

	// Fall back to parsing the readable text block(s). MediaWiki-style responses
	// emit a "title / URL / page chrome" header followed by a blank line and the
	// actual content (which may itself start with a `# Heading` and contains no
	// repeated URL). Older responses (and the web_search tool) emit one
	// `Title: / URL: / Content:` block per result.
	//
	// Split into sections on a blank line that precedes a new heading-like line,
	// then walk the sections: each section inherits the most recently seen URL
	// and adds its body. The page title is the first `# ...` heading or the
	// explicit `Title:` line in the first section that carries the URL.
	const results: ContentResultItem[] = [];
	const sections = trimmed.split(/\n\s*\n(?=(?:Title:|#\s))/);
	let currentUrl: string | undefined;
	let currentTitle: string | undefined;
	let bodyParts: string[] = [];
	const flush = () => {
		if (!currentUrl) return;
		const body = bodyParts
			.join("\n\n")
			.split("\n")
			.filter((l) => !/^\s*(Author|Published):/i.test(l))
			.join("\n")
			.replace(/^\s*(Content|Text|Highlights?):\s*/i, "")
			.trim();
		results.push({
			title: currentTitle || currentUrl,
			url: currentUrl,
			text: body || undefined,
		});
		bodyParts = [];
	};
	for (const section of sections) {
		const urlMatch = section.match(/URL:\s*(\S+)/);
		if (urlMatch) {
			// A new URL starts a new result. Flush whatever we had.
			flush();
			currentUrl = urlMatch[1];
			currentTitle =
				section.match(/^Title:\s*(.+)/m)?.[1]?.trim()
				|| section.match(/^#\s+(.+)/m)?.[1]?.trim()
				|| section.split("\n", 1)[0]?.trim();
		}
		// Body: everything after the URL line (if any), else the whole section.
		const startFrom = urlMatch
			? section.indexOf(urlMatch[0]) + urlMatch[0].length
			: 0;
		const chunk = section.slice(startFrom).trim();
		if (chunk) bodyParts.push(chunk);
	}
	flush();
	return results;
}

const searchTool = defineTool({
	name: "web_search",
	label: "Web Search",
	description:
		"Search the web for current information, facts, news, or to verify up-to-date details. Use this when you need information that may have changed recently or isn't in your training data.",
	promptSnippet: "Search the web",
	promptGuidelines: [
		"Use web_search for factual queries, recent events, or verifying current information.",
		"Synthesize results into a coherent answer rather than just listing links.",
		"Use domains / excludeDomains to focus on authoritative or relevant sources (requires EXA_API_KEY; ignored on the free path).",
		"Use startDate / endDate for news and research queries to avoid stale results (requires EXA_API_KEY; ignored on the free path).",
		"Use category (e.g. 'news', 'company', 'github', 'research paper') to bias results toward a specific content type (requires EXA_API_KEY; ignored on the free path).",
		"After web_search surfaces a promising URL, call fetch_page to read its full content rather than running curl in the bash tool.",
	],
	parameters: Type.Object({
		query: Type.String({ description: "The search query" }),
		numResults: Type.Optional(
			Type.Number({ description: "Maximum number of results to return (default: 5, max: 100)" }),
		),
		type: Type.Optional(
			Type.Union([Type.Literal("auto"), Type.Literal("keyword"), Type.Literal("neural")], {
				description: "Search type: 'auto' (default), 'keyword' (exact match), or 'neural' (semantic)",
			}),
		),
		domains: Type.Optional(
			Type.Array(Type.String(), {
				description:
					"Restrict results to these domains (e.g. ['nytimes.com', 'reuters.com']). Requires EXA_API_KEY; ignored on the free path.",
			}),
		),
		excludeDomains: Type.Optional(
			Type.Array(Type.String(), {
				description:
					"Exclude results from these domains. Requires EXA_API_KEY; ignored on the free path.",
			}),
		),
		startDate: Type.Optional(
			Type.String({
				description:
					"ISO date (YYYY-MM-DD). Only return results published on or after this date. Requires EXA_API_KEY; ignored on the free path.",
			}),
		),
		endDate: Type.Optional(
			Type.String({
				description:
					"ISO date (YYYY-MM-DD). Only return results published on or before this date. Requires EXA_API_KEY; ignored on the free path.",
			}),
		),
		category: Type.Optional(
			Type.String({
				description:
					"Exa content category to focus on (e.g. 'news', 'company', 'github', 'research paper', 'pdf', 'tweet', 'personal site', 'linkedin profile', 'financial report'). Requires EXA_API_KEY; ignored on the free path.",
			}),
		),
	}),
	async execute(toolCallId, params, signal) {
		const apiKey = process.env.EXA_API_KEY;
		const numResults = params.numResults ?? 5;

		let results: SearchResultItem[];
		let via: "sdk" | "mcp-free" | "mcp-keyed";
		// Surface filter usage so users can tell when a no-key run silently dropped
		// filters because the MCP path doesn't support them.
		const filterParamsUsed =
			(params.domains && params.domains.length > 0) ||
			(params.excludeDomains && params.excludeDomains.length > 0) ||
			params.startDate !== undefined ||
			params.endDate !== undefined ||
			params.category !== undefined;
		const filtersIgnored = !apiKey && filterParamsUsed;

		if (apiKey) {
			// Authenticated path via the official SDK.
			const exa = new Exa(apiKey);
			const result = await exa.search(params.query, {
				numResults,
				type: params.type ?? "auto",
				includeDomains: params.domains,
				excludeDomains: params.excludeDomains,
				startPublishedDate: params.startDate,
				endPublishedDate: params.endDate,
				category: params.category as
					| "company"
					| "research paper"
					| "news"
					| "pdf"
					| "github"
					| "tweet"
					| "personal site"
					| "linkedin profile"
					| "financial report"
					| undefined,
			});
			results = (result.results ?? []).map((r) => ({
				title: r.title ?? r.url,
				url: r.url,
				snippet: (r as { snippet?: string }).snippet,
			}));
			via = "sdk";
		} else {
			// Free path: Exa's public hosted MCP endpoint, no API key required.
			// Filter parameters are not supported by the hosted MCP tool.
			results = await searchViaMcp(params.query, numResults, undefined, signal);
			via = "mcp-free";
		}

		if (!results || results.length === 0) {
			return {
				content: [{ type: "text", text: "No results found for the query." }],
				details: {
					query: params.query,
					count: 0,
					via,
					filtersIgnored: filtersIgnored || undefined,
					results: [],
				},
			};
		}

		// Format results as markdown for the LLM to read
		const formattedResults = results
			.map((r, i) => {
				const snippet = r.snippet ? `\n${r.snippet}` : "";
				return `${i + 1}. [${r.title}](${r.url})${snippet}`;
			})
			.join("\n\n");

		const summary = `Found ${results.length} results for "${params.query}":\n\n${formattedResults}`;

		return {
			content: [{ type: "text", text: summary }],
			details: {
				query: params.query,
				count: results.length,
				via,
				filtersIgnored: filtersIgnored || undefined,
				results: results.map((r) => ({ title: r.title, url: r.url })),
			},
		};
	},
});

const fetchPageTool = defineTool({
	name: "fetch_page",
	label: "Fetch Page",
	description:
		"Fetch the full text of one or more URLs through Exa's server-side extraction. " +
		"Use this when a site blocks curl, requires JavaScript to render, or you need clean " +
		"markdown instead of raw HTML. Prefer this over running curl in the bash tool. " +
		"Batch multiple URLs in a single call when possible.",
	promptSnippet: "Fetch page contents",
	promptGuidelines: [
		"Use fetch_page to read the content of a specific URL rather than running curl in the bash tool — it handles JS-rendered pages, bot-detection, and PDF extraction server-side.",
		"Batch multiple URLs into a single fetch_page call when you need content from several pages.",
		"Set maxCharacters lower (e.g. 2000) for quick reads, higher (10000+) for full article extraction.",
		"Pass a highlights query to extract only the parts of a page relevant to a specific question (EXA_API_KEY only).",
	],
	parameters: Type.Object({
		urls: Type.Array(Type.String(), {
			description: "List of URLs to fetch. Batch multiple URLs into a single call when possible.",
		}),
		maxCharacters: Type.Optional(
			Type.Number({
				description:
					"Maximum characters of text to return per URL (default: 5000). Lower this for quick reads; raise it for full article extraction.",
			}),
		),
		highlights: Type.Optional(
			Type.Object(
				{
					query: Type.String({
						description:
							"Extract only the parts of each page most relevant to this query. Requires EXA_API_KEY; ignored on the free path.",
					}),
				},
				{
					description:
						"Query-focused extraction. When set, returns only excerpts relevant to the query instead of the full page text. Requires EXA_API_KEY; ignored on the free path.",
				},
			),
		),
		subpages: Type.Optional(
			Type.Number({
				description:
					"Maximum number of linked subpages to crawl from each URL (e.g. 5 to pull a docs section). Requires EXA_API_KEY; ignored on the free path.",
			}),
		),
		subpageTarget: Type.Optional(
			Type.Array(Type.String(), {
				description:
					"Keywords to prioritize when selecting subpages (e.g. ['docs', 'about', 'pricing']). Requires EXA_API_KEY; ignored on the free path.",
			}),
		),
	}),
	async execute(toolCallId, params, signal) {
		const apiKey = process.env.EXA_API_KEY;
		const maxCharacters = params.maxCharacters ?? 5000;
		const filterParamsUsed =
			(params.highlights !== undefined && params.highlights.query.length > 0) ||
			params.subpages !== undefined ||
			(params.subpageTarget && params.subpageTarget.length > 0);
		const filtersIgnored = !apiKey && filterParamsUsed;

		let results: ContentResultItem[];
		let via: "sdk" | "mcp-free" | "mcp-keyed";

		if (apiKey) {
			const exa = new Exa(apiKey);
			const textOptions: { maxCharacters: number; includeHtmlTags?: boolean } = {
				maxCharacters,
			};
			const sdkOptions: {
				text: { maxCharacters: number; includeHtmlTags?: boolean };
				highlights?: { query: string };
				subpages?: number;
				subpageTarget?: string[];
			} = { text: textOptions };

			if (params.highlights?.query) {
				sdkOptions.highlights = { query: params.highlights.query };
			}
			if (params.subpages !== undefined) {
				sdkOptions.subpages = params.subpages;
			}
			if (params.subpageTarget && params.subpageTarget.length > 0) {
				sdkOptions.subpageTarget = params.subpageTarget;
			}

			const response = await exa.getContents(params.urls, sdkOptions);
			// The SearchResult<T> conditional type from the SDK does not surface
			// the contents-derived fields (highlights, summary) when the options
			// object includes `| undefined`; the data is present at runtime, so
			// access them via a narrow cast. This matches the pattern used for
			// `snippet` in web_search above.
			results = (response.results ?? []).map((r) => ({
				title: r.title ?? r.url ?? "Untitled",
				url: r.url ?? "",
				text: r.text,
				highlights: (r as { highlights?: string[] }).highlights,
				summary: (r as { summary?: string }).summary,
			}));
			via = "sdk";
		} else {
			// Free path: hosted MCP web_fetch_exa tool. The free tool only
			// supports basic text extraction with a character cap — the more
			// advanced modes (highlights, subpages) require an API key.
			results = await fetchPageViaMcp(params.urls, maxCharacters, undefined, signal);
			via = "mcp-free";
		}

		if (!results || results.length === 0) {
			return {
				content: [{ type: "text", text: "No content extracted from the given URL(s)." }],
				details: {
					urls: params.urls,
					count: 0,
					via,
					filtersIgnored: filtersIgnored || undefined,
					results: [],
				},
			};
		}

		// Format results as markdown, one section per URL.
		const sections = results.map((r) => {
			const header = `## ${r.title}\n${r.url}`;
			const body = r.text ? `\n\n${r.text}` : "";
			const highlights = r.highlights && r.highlights.length > 0
				? `\n\n### Highlights\n${r.highlights.map((h) => `- ${h}`).join("\n")}`
				: "";
			const summary = r.summary ? `\n\n### Summary\n${r.summary}` : "";
			return `${header}${body}${highlights}${summary}`;
		});
		const summary = `Fetched ${results.length} page(s):\n\n${sections.join("\n\n---\n\n")}`;

		return {
			content: [{ type: "text", text: summary }],
			details: {
				urls: params.urls,
				count: results.length,
				via,
				filtersIgnored: filtersIgnored || undefined,
				results: results.map((r) => ({ title: r.title, url: r.url })),
			},
		};
	},
});

export default (pi: ExtensionAPI) => {
	pi.registerTool(searchTool);
	pi.registerTool(fetchPageTool);
};
