import Exa from "exa-js";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

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
		if (!apiKey) {
			return {
				content: [
					{
						type: "text",
						text: "Error: EXA_API_KEY environment variable is not set. Please set it before using web search.",
					},
				],
				details: { error: "missing_api_key" },
			};
		}

		const exa = new Exa(apiKey);
		const result = await exa.search(params.query, {
			numResults: params.numResults ?? 5,
			type: params.type ?? "auto",
		});

		if (!result.results || result.results.length === 0) {
			return {
				content: [{ type: "text", text: "No results found for the query." }],
				details: { query: params.query, count: 0 },
			};
		}

		// Format results as markdown for the LLM to read
		const formattedResults = result.results
			.map((r, i) => {
				const snippet = r.snippet ? `\n${r.snippet}` : "";
				return `${i + 1}. [${r.title}](${r.url})${snippet}`;
			})
			.join("\n\n");

		const summary = `Found ${result.results.length} results for "${params.query}":\n\n${formattedResults}`;

		return {
			content: [{ type: "text", text: summary }],
			details: {
				query: params.query,
				count: result.results.length,
				results: result.results.map((r) => ({ title: r.title, url: r.url })),
			},
		};
	},
});

export default (pi) => {
	pi.registerTool(searchTool);
};
