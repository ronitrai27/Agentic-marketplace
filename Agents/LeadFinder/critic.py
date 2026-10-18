from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from pydantic_ai import Agent

from models import UniversalLeadSpec

logger = logging.getLogger("LeadFinder.Critic")


class ApprovedCandidate(BaseModel):
    data: Dict[str, Any] = Field(
        description="Cleaned, standardized key-value pairs matching requested fields as best as possible"
    )
    source_url: str = Field(
        default="",
        description="Website or source link for this lead"
    )
    reason: str = Field(
        description="Brief confirmation of why this candidate satisfies the target entity criteria"
    )


class BulkCriticVerdict(BaseModel):
    approved_leads: List[ApprovedCandidate] = Field(
        default_factory=list,
        description="List of approved candidate leads that genuinely match the target entity"
    )
    rejection_summary: str = Field(
        default="None",
        description="Concise summary of rejected candidates and reasons (or 'None' if all approved)"
    )
    search_guidance: str = Field(
        default="",
        description="Actionable advice for the search worker to find remaining leads in next rounds"
    )
    suggested_queries: List[str] = Field(
        default_factory=list,
        description="1-3 refined search queries for the next round to find qualifying candidates"
    )


# Single candidate verdict for backward compatibility
class CriticVerdict(BaseModel):
    approved: bool = Field(description="True if the candidate matches the target entity")
    reason: str = Field(description="Justification")
    cleaned_data: Optional[Dict[str, Any]] = Field(default=None)


CRITIC_PROMPT = """You are a Pragmatic Quality & Constraint Reviewer powered by gpt-5-mini.
Your job is to audit a BATCH of candidate leads against the user's specification in a single bulk pass.

CORE PRINCIPLES:
1. FOCUS ON CORE ENTITY MATCH:
   - Does this candidate represent a real entity matching what the user asked for (e.g. if user asked for AI startups in India, is this a real AI startup in or from India)?
   - If YES, APPROVE IT!
   - Reject ONLY if the candidate is fundamentally wrong (e.g. an article author, an educational portal, a blog listicle itself instead of an actual company, wrong country, or explicitly violates a negative constraint like 'no website' when it has one).

2. TOLERANCE FOR MISSING SECONDARY FIELDS:
   - It is COMPLETELY ACCEPTABLE if some fields (such as direct website, phone, email, owner name, or employee range) are null, empty, or not found in the search snippet.
   - NEVER reject a genuine candidate simply because an optional or secondary field is missing or empty!
   - If 'website' was requested and is missing, you can use the source URL where the company was discovered or leave it as null.
   - For approved candidates, normalize their attributes into `data` with keys matching the user's requested fields.

3. SEARCH FEEDBACK / GUIDANCE:
   - Provide a concise `rejection_summary` explaining any rejected items.
   - If more leads are needed, provide `search_guidance` and 1-3 `suggested_queries` to help the search agent find more qualifying leads in the next round.
"""

critic_agent = Agent(
    "openai:gpt-5-mini",
    output_type=BulkCriticVerdict,
    system_prompt=CRITIC_PROMPT,
)


async def evaluate_candidates_bulk(
    candidates: List[Dict[str, Any]],
    source_urls: List[str],
    spec: UniversalLeadSpec,
    web_snippets: str = "",
) -> BulkCriticVerdict:
    """
    Audits a batch of candidates in a single bulk call to gpt-5-mini.
    Returns approved leads, rejection summary, and search guidance for the next round.
    """
    if not candidates:
        return BulkCriticVerdict(
            approved_leads=[],
            rejection_summary="No candidates in batch",
            search_guidance="Broaden the search terms to find more candidates",
            suggested_queries=[],
        )

    # Pair candidates with their source URLs
    batch_payload = []
    for idx, c in enumerate(candidates):
        url = source_urls[idx] if idx < len(source_urls) else (c.get("website") or c.get("url") or "")
        batch_payload.append({
            "candidate_index": idx + 1,
            "data": c,
            "source_url": url,
        })

    prompt = (
        f"--- USER LEAD SPECIFICATION ---\n"
        f"Target Entity: {spec.entity_description}\n"
        f"Required Fields: {json.dumps(spec.required_fields)}\n"
        f"Key Constraints / Rules: {json.dumps(spec.constraints)}\n\n"
        f"--- CANDIDATES TO AUDIT ({len(candidates)} items) ---\n"
        f"{json.dumps(batch_payload, ensure_ascii=False, indent=2)}\n\n"
        f"--- RECENT SEARCH CONTEXT ---\n"
        f"{web_snippets[:2000]}\n\n"
        f"Audit this entire batch now. Approve all genuine matches (missing secondary fields are fine!). "
        f"Provide cleaned data, rejection summary, and 1-3 refined suggested queries for next round."
    )

    try:
        result = await critic_agent.run(prompt)
        return result.output
    except Exception as e:
        logger.error(f"Bulk critic evaluation error: {e}")
        # Graceful fallback: accept candidates with valid names
        fallback_approved = []
        for item in batch_payload:
            c_data = item["data"]
            name = c_data.get("company_name") or c_data.get("name") or c_data.get("title")
            if name:
                fallback_approved.append(ApprovedCandidate(
                    data=c_data,
                    source_url=item["source_url"],
                    reason="Approved via fallback validation",
                ))
        return BulkCriticVerdict(
            approved_leads=fallback_approved,
            rejection_summary=f"Critic LLM issue ({str(e)}), applied fallback validation",
            search_guidance="Proceed with remaining queries in pool",
            suggested_queries=[],
        )


async def evaluate_candidate_with_critic(
    candidate: Dict[str, Any],
    source_url: str,
    spec: UniversalLeadSpec,
    extra_context: str = "",
) -> CriticVerdict:
    """Backward-compatible single candidate evaluation wrapping the bulk evaluator."""
    bulk_res = await evaluate_candidates_bulk(
        candidates=[candidate],
        source_urls=[source_url],
        spec=spec,
        web_snippets=extra_context,
    )
    if bulk_res.approved_leads:
        first = bulk_res.approved_leads[0]
        return CriticVerdict(
            approved=True,
            reason=first.reason,
            cleaned_data=first.data,
        )
    return CriticVerdict(
        approved=False,
        reason=bulk_res.rejection_summary or "Candidate did not match target entity",
        cleaned_data=None,
    )
