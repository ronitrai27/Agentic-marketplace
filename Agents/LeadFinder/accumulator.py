from __future__ import annotations

import asyncio
import functools
import json
import logging
import re
from typing import Any, Callable, Dict, List, Optional, Set
import httpx

from models import UniversalLead, UniversalLeadReport, UniversalLeadSpec
from agent import planner_agent, worker_agent
from critic import evaluate_candidates_bulk, BulkCriticVerdict
from tools import (
    search_google_maps,
    search_google_web,
    fetch_page_snippet,
    resolve_candidates_websites,
)
from jev import audit_report_with_jev

# Force immediate console flushing
print = functools.partial(print, flush=True)

logger = logging.getLogger("LeadFinder.Accumulator")


def extract_dedup_key(candidate_data: Dict[str, Any], source_url: str) -> str:
    """Creates a deterministic deduplication hash from candidate data or URL."""
    name = (
        candidate_data.get("company_name")
        or candidate_data.get("name")
        or candidate_data.get("title")
        or ""
    )
    clean_name = re.sub(r'[^a-z0-9]', '', str(name).lower())
    clean_url = re.sub(r'https?://(www\.)?', '', str(source_url).lower()).split('/')[0]
    return f"{clean_name}::{clean_url}" if clean_name else clean_url


async def run_universal_lead_finder(
    user_prompt: str,
    target_count_override: Optional[int] = None,
    max_rounds: int = 4,
    serpapi_key: str = "",
    openrouter_jev_key: str = "",
    jev_model: str = "typesafe/jev-1.14",
    on_event: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> UniversalLeadReport:
    """
    Universal, zero-hardcoding dynamic lead generation loop:
    1. Planner (gpt-4.1-mini) dynamically synthesizes LeadSpec from ANY prompt.
    2. Search Worker (gpt-4.1-nano) finds real entities using SerpAPI + search snippets.
    3. Parallel Website Resolver: Resolves official company homepages in parallel (~0.8s).
    4. Bulk Critic (gpt-5-mini) rapidly audits candidate batches with pragmatic validation.
    5. Feedback Loop: Critic search guidance & suggested queries immediately refine subsequent search rounds.
    6. TypeSafe JEV-1.14 delivers an uncompromised audit verdict.
    """
    def emit(event: Dict[str, Any]):
        if on_event:
            try:
                on_event(event)
            except Exception as e:
                logger.debug(f"Event callback error: {e}")

    emit({"type": "status", "message": f"Step 1: Planning specification for prompt: '{user_prompt}'..."})

    # Step 1: Dynamic Specification Planning (gpt-4.1-mini)
    try:
        plan_res = await planner_agent.run(f"User Request: '{user_prompt}'")
        spec: UniversalLeadSpec = plan_res.output
    except Exception as e:
        logger.error(f"Planner failed: {e}")
        spec = UniversalLeadSpec(
            target_count=target_count_override or 10,
            entity_description=user_prompt,
            required_fields=["company_name", "website", "summary"],
            constraints=[],
            preferred_engine="google",
            initial_search_queries=[user_prompt],
        )

    if target_count_override and target_count_override > 0:
        spec.target_count = target_count_override

    target = spec.target_count
    emit({
        "type": "status",
        "message": (
            f"Specification Synthesized: Target={target} | "
            f"Fields={spec.required_fields} | "
            f"Constraints={len(spec.constraints)} | "
            f"Engine={spec.preferred_engine}"
        ),
    })

    unique_leads: List[UniversalLead] = []
    seen_keys: Set[str] = set()
    current_round = 0
    stopped_reason = "RUNNING"

    queries_pool = list(spec.initial_search_queries)
    if not queries_pool:
        queries_pool = [user_prompt]

    async with httpx.AsyncClient(timeout=30.0) as http_client:
        while len(unique_leads) < target and current_round < max_rounds:
            current_round += 1
            needed = target - len(unique_leads)

            current_query = queries_pool[(current_round - 1) % len(queries_pool)]
            # Add progressive pagination or variation
            start_offset = ((current_round - 1) // len(queries_pool)) * 10

            emit({
                "type": "status",
                "message": f"Round {current_round}/{max_rounds}: Searching {spec.preferred_engine} for '{current_query}' (offset={start_offset})...",
            })

            # Search SerpAPI
            if spec.preferred_engine == "google_maps":
                search_data = await search_google_maps(current_query, serpapi_key, client=http_client)
            else:
                search_data = await search_google_web(current_query, serpapi_key, start=start_offset, client=http_client)

            results_list = search_data.get("results", [])
            emit({
                "type": "status",
                "message": f"Retrieved {len(results_list)} raw search results. Inspecting & extracting fields...",
            })

            # Emit sites visited for live feedback
            for item in results_list:
                url = item.get("link") or item.get("primary_url") or ""
                title = item.get("title", "")
                if url:
                    emit({"type": "site_visited", "title": title, "url": url})

            # Step 2: Extract candidate data with Worker (gpt-4.1-nano)
            extract_prompt = (
                f"Target Entity: {spec.entity_description}\n"
                f"Required Fields to Extract: {json.dumps(spec.required_fields)}\n"
                f"User Constraints: {json.dumps(spec.constraints)}\n"
                f"Raw Search Results:\n{json.dumps(results_list[:12], ensure_ascii=False)}\n\n"
                f"Extract all candidate entities matching the target. If search results list multiple companies, extract each company as a candidate."
            )

            try:
                extract_res = await worker_agent.run(extract_prompt)
                candidate_batch = extract_res.output.candidates
                source_urls = extract_res.output.source_urls
            except Exception as e:
                logger.error(f"Worker extraction failed: {e}")
                candidate_batch = []
                source_urls = []

            emit({
                "type": "status",
                "message": f"Extracted {len(candidate_batch)} candidates from search.",
            })

            # Step 2.5: Parallel Official Website Resolver
            # If the user asked for 'website' and we have candidates from directories/articles,
            # resolve their actual official homepages concurrently in parallel (~0.8s total).
            if "website" in spec.required_fields and serpapi_key and candidate_batch:
                emit({
                    "type": "status",
                    "message": f"Resolving official websites in parallel for candidates...",
                })
                candidate_batch = await resolve_candidates_websites(
                    candidates=candidate_batch,
                    api_key=serpapi_key,
                    client=http_client,
                )

            emit({
                "type": "status",
                "message": f"Auditing candidates with Bulk Critic (gpt-5-mini)...",
            })

            # Step 3: Fast Pragmatic Bulk Critic Audit (gpt-5-mini)
            # Sends all candidates in a single bulk request - takes ~2 seconds!
            bulk_verdict: BulkCriticVerdict = await evaluate_candidates_bulk(
                candidates=candidate_batch,
                source_urls=source_urls,
                spec=spec,
                web_snippets=f"Search Query: {current_query}\nTop Results: {json.dumps(results_list[:5], ensure_ascii=False)}",
            )

            added_this_round = 0
            for approved in bulk_verdict.approved_leads:
                lead_data = approved.data
                official_site = lead_data.get("website") or ""
                source_link = approved.source_url or official_site or ""
                dedup_key = extract_dedup_key(lead_data, official_site or source_link)

                if dedup_key in seen_keys:
                    continue

                seen_keys.add(dedup_key)
                lead = UniversalLead(
                    data=lead_data,
                    source_url=source_link,
                    critic_verdict=approved.reason or "Approved by Critic",
                )
                unique_leads.append(lead)
                added_this_round += 1

                emit({
                    "type": "lead_discovered",
                    "lead": lead.model_dump(),
                })

                lead_name = (
                    lead_data.get("company_name")
                    or lead_data.get("name")
                    or lead_data.get("title")
                    or "Lead"
                )
                emit({
                    "type": "status",
                    "message": f"[Critic Approved] {lead_name} ({official_site or 'Verified'})",
                })

                if len(unique_leads) >= target:
                    break

            if bulk_verdict.rejection_summary and bulk_verdict.rejection_summary.lower() not in ("none", "n/a", ""):
                emit({
                    "type": "status",
                    "message": f"[Critic Review] Rejections: {bulk_verdict.rejection_summary}",
                })

            emit({
                "type": "status",
                "message": f"Round {current_round} complete. Added {added_this_round} verified leads (Total: {len(unique_leads)}/{target}).",
            })

            if len(unique_leads) >= target:
                stopped_reason = "TARGET_REACHED"
                break

            # Step 4: Feedback Loop - Inject Critic guidance & suggested queries into search pool
            if bulk_verdict.suggested_queries:
                for sq in bulk_verdict.suggested_queries:
                    if sq and sq not in queries_pool:
                        queries_pool.insert(0, sq)  # Prioritize critic's refined query
                emit({
                    "type": "status",
                    "message": f"[Search Feedback] Added Critic's refined query for next round: '{queries_pool[0]}'",
                })
            elif bulk_verdict.search_guidance:
                emit({
                    "type": "status",
                    "message": f"[Search Guidance] Critic advice: {bulk_verdict.search_guidance}",
                })

            await asyncio.sleep(0.3)

        if len(unique_leads) >= target:
            stopped_reason = "TARGET_REACHED"
        elif current_round >= max_rounds:
            stopped_reason = "MAX_ROUNDS_REACHED"

    # Step 5: Real TypeSafe JEV-1.14 Audit (No fake 95% fallbacks)
    jev_telemetry = None
    if openrouter_jev_key and unique_leads:
        emit({
            "type": "status",
            "message": "Auditing final leads with TypeSafe JEV-1.14 Decisions API...",
        })
        leads_dump = [l.model_dump() for l in unique_leads]
        jev_telemetry = await audit_report_with_jev(
            user_prompt=user_prompt,
            target_count=target,
            leads=leads_dump,
            required_fields=spec.required_fields,
            constraints=spec.constraints,
            api_key=openrouter_jev_key,
            model=jev_model,
        )
        emit({
            "type": "jev",
            "telemetry": jev_telemetry,
        })

    report = UniversalLeadReport(
        user_prompt=user_prompt,
        target_count=target,
        total_found=len(unique_leads),
        required_fields=spec.required_fields,
        constraints_enforced=spec.constraints,
        rounds_executed=current_round,
        stopped_reason=stopped_reason,
        leads=unique_leads,
        jev_telemetry=jev_telemetry,
    )

    return report
