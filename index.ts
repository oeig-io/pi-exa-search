import Exa from "exa-js";
import { defineTool } from "@mariozechner/pi-coding-agent";
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

/**
 * Call the hosted Exa MCP endpoint (the free, no-key path).
 * Sends a JSON-RPC tools/call for `web_search_exa` and parses the
 * SSE / JSON response into a normalized result list.
 */
async function searchViaMcp(
	query: string,
	numResults: number,
	apiKey: string | undefined,
	signal: AbortSignal,
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
 * The Exa MCP tool returns either a JSON string of results or a
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

const searchTool = defineTool({
	name: "web_search",
	label: "Web Search",
	description:
		"Search the web for current information, facts, news, or to verify up-to-date details. Use this when you need information that may have changed recently or isn't in your training data.",
	promptSnippet: "Search the web",
	promptGuidelines: [
		"Use web_search for factual queries, recent events, or verifying current information.",
		"Synthesize results into a coherent answer rather than just listing links.",
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
	}),
	async execute(toolCallId, params, signal) {
		const apiKey = process.env.EXA_API_KEY;
		const numResults = params.numResults ?? 5;

		let results: SearchResultItem[];
		let via: "sdk" | "mcp-free" | "mcp-keyed";

		if (apiKey) {
			// Authenticated path via the official SDK.
			const exa = new Exa(apiKey);
			const result = await exa.search(params.query, {
				numResults,
				type: params.type ?? "auto",
			});
			results = (result.results ?? []).map((r) => ({
				title: r.title ?? r.url,
				url: r.url,
				snippet: (r as { snippet?: string }).snippet,
			}));
			via = "sdk";
		} else {
			// Free path: Exa's public hosted MCP endpoint, no API key required.
			results = await searchViaMcp(params.query, numResults, undefined, signal);
			via = "mcp-free";
		}

		if (!results || results.length === 0) {
			return {
				content: [{ type: "text", text: "No results found for the query." }],
				details: { query: params.query, count: 0, via },
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
				results: results.map((r) => ({ title: r.title, url: r.url })),
			},
		};
	},
});

export default (pi) => {
	pi.registerTool(searchTool);
};
