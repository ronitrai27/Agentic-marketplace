from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Set
from dotenv import load_dotenv
import httpx
from pydantic_ai import Agent, RunContext

# Load environment variables
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)

os.environ["PYDANTIC_AI_NO_BANNER"] = "1"

if not os.getenv("OPENAI_API_KEY") and os.getenv("OPENAPI_KEY"):
    os.environ["OPENAI_API_KEY"] = os.environ["OPENAPI_KEY"]

from models import BatchExtractionResult
from tools import search_google_maps, search_google_web


@dataclass
class LeadFinderDeps:
    serpapi_key: str
    http_client: httpx.AsyncClient
    excluded_domains: Set[str] = field(default_factory=set)
    excluded_names: Set[str] = field(default_factory=set)


# ---------------------------------------------------------------------------
# 1. Search & Extraction Worker: openai:gpt-4.1-nano (Fast, cheap, massive TPM)
# ---------------------------------------------------------------------------
WORKER_PROMPT = """You are a fast, practical Lead Extraction Worker.
Your job is to search Google Maps (for local physical venues/shops) or Google Web (for digital/companies)
and extract matching entities into structured leads.

Rules:
1. ALWAYS call `search_maps` for local businesses, shops, cafes, clinics, contractors, or retail places.
2. ALWAYS call `search_web` for digital companies, remote agencies, or online directories.
3. Extract real data: title, primary_url, address, phone, and rating.
4. Do not include entities present in `excluded_names`.
5. If the user asks for businesses that do NOT own a website (e.g. 'no website' / 'doesn't own a website'), strictly select entities where `has_website` is false, and set `primary_url` to their maps listing URL.
6. Extract contact person or owner names if mentioned in the listing description.
7. Return results in BatchExtractionResult format.
"""

worker_agent = Agent(
    "openai:gpt-4.1-nano",
    deps_type=LeadFinderDeps,
    output_type=BatchExtractionResult,
    system_prompt=WORKER_PROMPT,
)


@worker_agent.tool
async def search_maps(
    ctx: RunContext[LeadFinderDeps],
    query: str,
    start: int = 0,
) -> Dict[str, Any]:
    """Search Google Maps for local businesses, venues, shops, and places."""
    return await search_google_maps(
        query=query,
        api_key=ctx.deps.serpapi_key,
        start=start,
        client=ctx.deps.http_client,
    )


@worker_agent.tool
async def search_web(
    ctx: RunContext[LeadFinderDeps],
    query: str,
    start: int = 0,
) -> Dict[str, Any]:
    """Search Google Web for organic search results and websites."""
    return await search_google_web(
        query=query,
        api_key=ctx.deps.serpapi_key,
        start=start,
        client=ctx.deps.http_client,
    )


# ---------------------------------------------------------------------------
# 2. Precision Quality & Validation Agent: openai:gpt-5.1-mini
# ---------------------------------------------------------------------------
VERIFIER_PROMPT = """You are a Precision Lead Quality Verifier.
You receive raw candidate leads extracted by the search worker.
Your job is to:
1. Verify each candidate matches the user's criteria.
2. Remove duplicates or near-duplicate entries.
3. Clean and normalize contact data.
4. If criteria demands businesses with NO website, discard entries that have external custom websites and keep map listings.
5. Output clean verified leads conforming to BatchExtractionResult.
"""

verifier_agent = Agent(
    "openai:gpt-5.1-mini",
    output_type=BatchExtractionResult,
    system_prompt=VERIFIER_PROMPT,
)
