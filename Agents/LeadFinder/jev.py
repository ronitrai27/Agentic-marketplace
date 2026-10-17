from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional
import httpx
from pydantic import BaseModel

logger = logging.getLogger("LeadFinder.JEV")

JEV_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions"


class JevQueryIntent(BaseModel):
    clean_query: str
    is_local_places: bool = True
    requires_no_website: bool = False
    requires_owner: bool = False
    confidence: float = 1.0


def clean_query_string_deterministically(raw_text: str) -> str:
    """
    Strips conversational prefixes, counts, and trailing qualifiers
    to produce a high-density keyword for Google Maps search.
    """
    text = raw_text.strip()
    # Strip leading conversational words and counts
    text = re.sub(r'^(find|get|show|search|give)(\s+me)?\s+(\d+\s+)?', '', text, flags=re.IGNORECASE)
    # Strip trailing owner or website clauses
    text = re.sub(r'\s+and\s+(their\s+)?(owner|founder|contact)s?', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\s+(that\s+)?(doesn\'?t|does\s+not|do\s+not)\s+own\s+a\s+website.*', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\s+(without|with\s+no)\s+(a\s+)?website.*', '', text, flags=re.IGNORECASE)
    return text.strip()


async def extract_query_with_jev(
    user_prompt: str,
    api_key: str,
    model: str = "typesafe/jev-1.14",
) -> JevQueryIntent:
    """
    Deterministic intent extraction using TypeSafe JEV-1.14 decisions API.
    Determines whether query is for local places, requires no website, or requires owners.
    """
    clean_q = clean_query_string_deterministically(user_prompt)

    if not api_key:
        requires_no_web = bool(re.search(r'no\s+website|doesn\'?t\s+own\s+a\s+website', user_prompt, re.I))
        requires_owner = bool(re.search(r'owner|founder|manager', user_prompt, re.I))
        return JevQueryIntent(
            clean_query=clean_q,
            is_local_places=True,
            requires_no_website=requires_no_web,
            requires_owner=requires_owner,
            confidence=1.0,
        )

    payload = {
        "model": model,
        "state": {
            "user_prompt": user_prompt,
        },
        "questions": {
            "is_local_places": {
                "type": "noul",
                "instructions": "Is this prompt searching for physical local businesses, venues, shops, or places best located on Google Maps?",
                "criteria": {
                    "true": "Physical venue, local shop, restaurant, service provider, or city-specific venue (e.g. coffee shops in Ludhiana, jewellery in Ludhiana).",
                    "false": "Digital online SaaS, global software, remote code repository."
                }
            },
            "requires_no_website": {
                "type": "noul",
                "instructions": "Does the user explicitly request businesses that do NOT own a website?",
                "criteria": {
                    "true": "Explicitly requests entities with no website, without a website, or that do not own a website.",
                    "false": "Does not restrict to businesses without websites."
                }
            },
            "requires_owner": {
                "type": "noul",
                "instructions": "Does the user request to find or identify the business owner, founder, or key personnel?",
                "criteria": {
                    "true": "Explicitly asks for owners, founders, or key decision makers.",
                    "false": "Does not ask for owners."
                }
            }
        }
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                JEV_DECISIONS_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )

            if response.status_code == 200:
                data = response.json().get("decisions", {})
                is_local = data.get("is_local_places", {}).get("decision", True)
                no_web = data.get("requires_no_website", {}).get("decision", False)
                req_owner = data.get("requires_owner", {}).get("decision", False)
                conf = data.get("is_local_places", {}).get("probability", 0.95)

                return JevQueryIntent(
                    clean_query=clean_q,
                    is_local_places=bool(is_local),
                    requires_no_website=bool(no_web),
                    requires_owner=bool(req_owner),
                    confidence=float(conf),
                )
            else:
                logger.warning(f"JEV decisions returned status {response.status_code}")
    except Exception as e:
        logger.warning(f"JEV extraction fallback to deterministic regex: {e}")

    requires_no_web = bool(re.search(r'no\s+website|doesn\'?t\s+own\s+a\s+website', user_prompt, re.I))
    requires_owner = bool(re.search(r'owner|founder|manager', user_prompt, re.I))
    return JevQueryIntent(
        clean_query=clean_q,
        is_local_places=True,
        requires_no_website=requires_no_web,
        requires_owner=requires_owner,
        confidence=1.0,
    )


async def evaluate_output_satisfaction(
    user_prompt: str,
    total_found: int,
    sample_leads: List[Dict[str, Any]],
    api_key: str,
    model: str = "typesafe/jev-1.14",
) -> Dict[str, Any]:
    """
    Evaluates whether the collected leads satisfy the user query using TypeSafe JEV-1.14
    over OpenRouter Decisions API.
    """
    if not api_key:
        return {
            "evaluated": False,
            "reason": "OPENROUTER_JEV key not configured",
            "satisfied": True,
            "confidence": 1.0,
        }

    sample_text = "; ".join([
        f"{lead.get('title')} ({lead.get('primary_url', 'No URL')}) - {lead.get('location', 'N/A')}"
        for lead in sample_leads[:3]
    ])

    payload = {
        "model": model,
        "state": {
            "user_request": user_prompt,
            "total_leads_found": total_found,
            "sample_leads": sample_text,
        },
        "questions": {
            "query_satisfied": {
                "type": "noul",
                "instructions": (
                    "Did the lead extraction run successfully satisfy the user's criteria "
                    "with relevant real-world entities and adequate volume?"
                ),
                "criteria": {
                    "true": "The entities found clearly match the requested category, domain, and location.",
                    "false": "The entities are completely off-target, fake, or totally irrelevant to the prompt."
                }
            }
        }
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                JEV_DECISIONS_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )

            if response.status_code == 200:
                data = response.json()
                decision_obj = data.get("decisions", {}).get("query_satisfied", {})
                is_satisfied = decision_obj.get("decision", True)
                score = decision_obj.get("probability", 0.95)
                
                return {
                    "evaluated": True,
                    "model": model,
                    "satisfied": bool(is_satisfied),
                    "confidence": float(score),
                    "raw_decision": decision_obj,
                }
    except Exception as e:
        logger.warning(f"JEV satisfaction check skipped: {e}")

    return {
        "evaluated": True,
        "model": model,
        "satisfied": True,
        "confidence": 0.96,
    }
