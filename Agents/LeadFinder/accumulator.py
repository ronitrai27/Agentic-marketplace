from __future__ import annotations

import functools
import json
import logging
import re
from typing import Dict, List, Set, Tuple
from urllib.parse import urlparse
import httpx

from models import FinalLeadReport, LeadItem, BatchExtractionResult
from agent import LeadFinderDeps, worker_agent, verifier_agent
from jev import evaluate_output_satisfaction

# Force real-time flushing
print = functools.partial(print, flush=True)

logger = logging.getLogger("LeadFinder.Accumulator")


def normalize_lead_key(lead: LeadItem) -> Tuple[str, str]:
    """Returns (domain_key, clean_name_key) for deduplication."""
    url_str = str(lead.primary_url or "").strip().lower()
    parsed = urlparse(url_str)
    domain = parsed.netloc.replace("www.", "").strip()
    clean_name = re.sub(r"[^a-z0-9]", "", lead.title.lower().strip())
    return domain, clean_name


async def run_lead_accumulator(
    search_criteria: str,
    target_count: int = 20,
    max_rounds: int = 4,
    serpapi_key: str = "",
    openrouter_jev_key: str = "",
    jev_model: str = "typesafe/jev-1.14",
) -> FinalLeadReport:
    """
    Durable Accumulator Loop:
    - Worker: openai:gpt-4.1-nano (Handles multi-page SerpAPI extraction with no rate-limit choke).
    - Verifier: openai:gpt-5.1-mini (Validates final batch quality).
    """
    unique_leads: List[LeadItem] = []
    seen_domains: Set[str] = set()
    seen_names: Set[str] = set()

    stopped_reason = "RUNNING"
    current_round = 0

    print("[*] Engine Initialized:")
    print("    - Primary Search Worker: OpenAI (gpt-4.1-nano) [High Speed, No TPM bottleneck]")
    print("    - Precision Verifier:    OpenAI (gpt-5.1-mini)")

    async with httpx.AsyncClient(timeout=40.0) as http_client:
        deps = LeadFinderDeps(
            serpapi_key=serpapi_key,
            http_client=http_client,
            excluded_domains=seen_domains,
            excluded_names=seen_names,
        )

        while len(unique_leads) < target_count and current_round < max_rounds:
            current_round += 1
            needed = target_count - len(unique_leads)
            start_offset = (current_round - 1) * 20

            print(f"\n[Round {current_round}/{max_rounds}] Collected: {len(unique_leads)}/{target_count} | Needed: {needed} (Search offset: {start_offset})")

            sample_exclusions = list(seen_names)[-10:] if seen_names else []
            worker_prompt = (
                f"Search request: '{search_criteria}'.\n"
                f"We currently have {len(unique_leads)} unique leads and need {needed} more to hit our target of {target_count}.\n"
                f"Exclude already recorded names: {sample_exclusions}.\n"
                f"Call `search_maps` (for local businesses) or `search_web`. Use start={start_offset} for pagination.\n"
                f"Extract as many valid, matching unique leads as possible."
            )

            try:
                worker_result = await worker_agent.run(worker_prompt, deps=deps)
                batch = worker_result.output.leads
                print(f"  -> gpt-4.1-nano extracted {len(batch)} candidates")
            except Exception as e:
                logger.error(f"Worker run failed in round {current_round}: {e}")
                print(f"  [!] Worker error: {e}")
                break

            # Deduplication pass
            added_this_round = 0
            for item in batch:
                domain_key, name_key = normalize_lead_key(item)
                is_dup = (name_key and name_key in seen_names) or (
                    domain_key and domain_key in seen_domains and "google.com" not in domain_key
                )
                if not is_dup:
                    unique_leads.append(item)
                    if domain_key and "google.com" not in domain_key:
                        seen_domains.add(domain_key)
                    if name_key:
                        seen_names.add(name_key)
                    added_this_round += 1

                    if len(unique_leads) >= target_count:
                        break

            print(f"  -> Added {added_this_round} unique leads (Total now: {len(unique_leads)}/{target_count})")

            if added_this_round == 0 and len(batch) > 0 and current_round >= max_rounds:
                stopped_reason = "EXHAUSTED_SEARCH_SPACE"
                break

        # Tier 2: Final Quality Pass with gpt-5.1-mini
        if unique_leads:
            print(f"\n[*] Running precision verification on {len(unique_leads)} leads using gpt-5.1-mini...")
            try:
                leads_dump = json.dumps([lead.model_dump() for lead in unique_leads], ensure_ascii=False)
                verifier_prompt = (
                    f"Search criteria: '{search_criteria}'.\n"
                    f"Verify and filter these candidate leads:\n{leads_dump}\n"
                    f"Ensure they match criteria and return clean results."
                )
                verified_res = await verifier_agent.run(verifier_prompt)
                if verified_res.output.leads:
                    unique_leads = verified_res.output.leads
                print(f"  -> Verified {len(unique_leads)} high-confidence leads")
            except Exception as e:
                logger.warning(f"Precision verification fallback: {e}")

        if len(unique_leads) >= target_count:
            stopped_reason = "TARGET_REACHED"
        elif current_round >= max_rounds:
            stopped_reason = "MAX_ROUNDS_BUDGET_LIMIT"

    print(f"\n[Finished] Total verified unique leads: {len(unique_leads)} | Reason: {stopped_reason}")

    # Output satisfaction check via TypeSafe JEV-1.14
    jev_telemetry = None
    if openrouter_jev_key and unique_leads:
        print("\n[*] Evaluating satisfaction with TypeSafe JEV-1.14...")
        sample_dicts = [lead.model_dump() for lead in unique_leads[:3]]
        jev_telemetry = await evaluate_output_satisfaction(
            user_prompt=search_criteria,
            total_found=len(unique_leads),
            sample_leads=sample_dicts,
            api_key=openrouter_jev_key,
            model=jev_model,
        )
        if jev_telemetry.get("evaluated"):
            print(f"  - JEV Decision: {jev_telemetry.get('satisfied')} (Score: {jev_telemetry.get('confidence'):.2f})")

    return FinalLeadReport(
        search_criteria=search_criteria,
        target_count=target_count,
        total_found=len(unique_leads),
        rounds_executed=current_round,
        stopped_reason=stopped_reason,
        leads=unique_leads,
        jev_telemetry=jev_telemetry,
    )
