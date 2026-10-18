from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from pydantic_ai import Agent

# Load environment
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)

os.environ["PYDANTIC_AI_NO_BANNER"] = "1"
if not os.getenv("OPENAI_API_KEY") and os.getenv("OPENAPI_KEY"):
    os.environ["OPENAI_API_KEY"] = os.environ["OPENAPI_KEY"]

from models import UniversalLeadSpec


# ---------------------------------------------------------------------------
# 1. PLANNER NODE: openai:gpt-4.1-mini
# ---------------------------------------------------------------------------
PLANNER_PROMPT = """You are a Lead Discovery Architecture Planner.
Your job is to read ANY arbitrary user request and dynamically synthesize a strict Lead Specification.

Rules:
1. Target Count: Extract the exact number of leads requested (default to 10 if not mentioned).
2. Required Fields: Extract exactly what fields/columns the user asked for.
   - If user explicitly listed fields (e.g. "company name, website, careers page, employee range"), extract those exact names as snake_case strings.
   - If user did NOT specify fields, default to: ["name", "website", "summary"].
3. Constraints: List every filter, qualification rule, location requirement, size restriction, or negative condition (e.g. "no website", "10-100 employees", "actively hiring software developers").
4. Preferred Engine:
   - Use 'google_maps' ONLY if the search is for physical, local venues, clinics, local stores, or offline contractors in a specific city.
   - Use 'google' for everything else: SaaS, AI startups, B2B companies, tech, funds, remote companies, websites.
5. Initial Search Queries: Generate 2-3 high-density Google search queries or dorks tailored to find these exact entities.
"""

planner_agent = Agent(
    "openai:gpt-4.1-mini",
    output_type=UniversalLeadSpec,
    system_prompt=PLANNER_PROMPT,
)


# ---------------------------------------------------------------------------
# 2. WORKER / EXTRACTOR NODE: openai:gpt-4.1-nano
# ---------------------------------------------------------------------------
class CandidateExtractionBatch(BaseModel):
    candidates: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="List of extracted candidate entities where keys match the requested fields",
    )
    source_urls: List[str] = Field(
        default_factory=list,
        description="Corresponding primary URL or evidence link for each candidate",
    )


WORKER_PROMPT = """You are a fast precision data extraction worker.
You are given search results and a list of required fields.
Your job is to extract real entities from the provided search data, mapping their attributes into the required fields.

Rules:
1. Extract ALL real entities mentioned in the search results that match the target entity type.
2. If a search result is an article, listicle, or directory containing multiple companies/startups (e.g. "Top 10 AI Startups in India", "Best SaaS firms in US"), extract EACH company mentioned as an individual candidate in `candidates`!
3. If an entity's direct website is not explicitly visible in the search snippet, set website to null or use the source article link, but STILL extract the company/entity! Do NOT skip or discard valid entities just because a field is missing.
4. Only extract real information present in the search data. Never hallucinate fake companies or fake phone numbers.
5. Include the corresponding source or evidence URL in `source_urls` for each candidate.
"""

worker_agent = Agent(
    "openai:gpt-4.1-nano",
    output_type=CandidateExtractionBatch,
    system_prompt=WORKER_PROMPT,
)
