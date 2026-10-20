# Research Agent 2 (Simple OpenAI SDK)

A clean, dual-mode research agent powered directly by the official OpenAI Responses API with built-in web grounding (`tools: [{ type: "web_search" }]`).

## Features

- **Mode 1: Fast Answers**
  - **Model**: `gpt-6-luna`
  - **Configuration**: Synchronous OpenAI Responses API with native `web_search`.
  - **Best for**: Fast fact checking and real-time summaries.

- **Mode 2: High Efficiency Deep Research**
  - **Model**: `gpt-5.4-mini`
  - **Configuration**: `background: true`, `reasoning: { effort: "medium" }`, and native `web_search`.
  - **Lifecycle**: Asynchronous background dispatch with a real-time status polling loop until completion.
  - **Best for**: Complex synthesis, in-depth research, and thorough reasoning.

## How to Run

### Interactive Mode:
```bash
pnpm start
```
You will be prompted to enter your question and select either Mode `1` (Fast) or Mode `2` (High Efficiency).

### Command Line Arguments:
```bash
# Fast mode
pnpm start "What are the latest updates in quantum computing?" 1

# High efficiency deep mode
pnpm start "Analyze recent market trends in agentic AI frameworks" 2
```

### Web UI (ChatGPT Style):
```bash
pnpm ui
```
Opens a ChatGPT-style interface at `http://localhost:3001` with real-time SSE progress tracking, model toggles, and Markdown rendering.


