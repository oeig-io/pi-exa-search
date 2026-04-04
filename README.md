# pi-exa-search

Exa web search extension for the pi coding agent.

## Installation

1. Clone this repo:

```bash
git clone https://github.com/oeig-io/pi-exa-search.git ~/.pi/agent/extensions/pi-exa-search
```

Or if already cloned:

```bash
cd ~/.pi/agent/extensions/pi-exa-search
git pull
```

2. Install dependencies:

```bash
cd ~/.pi/agent/extensions/pi-exa-search
npm install
```

## Configuration

Set your Exa API key in your shell environment:

```bash
export EXA_API_KEY="your-exa-api-key"
```

Add this to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.) to persist it across sessions.

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

1. Reads `EXA_API_KEY` from environment
2. Calls Exa API via `exa-js` SDK
3. Formats results as markdown (title, URL, snippet)
4. Returns formatted text to the LLM
