from __future__ import annotations

import json
import logging
from typing import Any, Dict, List
import httpx

logger = logging.getLogger("LeadFinder.JEV")

JEV_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions"


async def audit_report_with_jev(
    user_prompt: str,
    target_count: int,
    leads: List[Dict[str, Any]],
    required_fields: List[str],
    constraints: List[str],
    api_key: str,
    model: str = "typesafe/jev-1.14",
) -> Dict[str, Any]:
    """
    Real, audited TypeSafe JEV-1.14 satisfaction evaluation via OpenRouter Decisions API.
    Zero fake fallbacks. Returns genuine boolean decisions and probability scores.
    """
    if not api_key:
        return {
            "evaluated": False,
            "reason": "OPENROUTER_JEV key not configured in .env",
            "satisfied": None,
            "confidence": 0.0,
        }

    if not leads:
        return {
            "evaluated": True,
            "model": model,
            "satisfied": False,
            "confidence": 1.0,
            "reason": "Zero leads were approved by Critic",
        }

    # Prepare real lead samples showing their exact fields
    sample_leads_summary = json.dumps([
        {
            "data": lead.get("data", {}),
            "source": lead.get("source_url", ""),
            "critic_verdict": lead.get("critic_verdict", ""),
        }
        for lead in leads[:4]
    ], indent=1, ensure_ascii=False)

    payload = {
        "model": model,
        "state": {
            "user_prompt": user_prompt,
            "target_count": target_count,
            "total_delivered": len(leads),
            "required_fields": json.dumps(required_fields),
            "constraints": json.dumps(constraints),
            "sample_verified_leads": sample_leads_summary,
        },
        "questions": {
            "requirements_satisfied": {
                "type": "noul",
                "instructions": (
                    "Did the lead generation engine successfully fulfill the user's specific request, "
                    "honoring the constraints and populating the required data fields?"
                ),
                "criteria": {
                    "true": "The leads genuinely match the requested entity type, fulfill all explicit constraints (location, size, hiring, etc.), and provide the requested fields.",
                    "false": "The leads violate explicit constraints, are missing requested fields, or are completely off-target."
                }
            }
        }
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
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
                decision_obj = data.get("decisions", {}).get("requirements_satisfied", {})
                decision = decision_obj.get("decision")
                prob = decision_obj.get("probability", 0.0)

                return {
                    "evaluated": True,
                    "model": model,
                    "satisfied": bool(decision),
                    "confidence": float(prob),
                    "decision_detail": decision_obj,
                }
            else:
                logger.error(f"JEV API returned status {response.status_code}: {response.text}")
                return {
                    "evaluated": False,
                    "reason": f"JEV API Error (HTTP {response.status_code})",
                    "satisfied": None,
                    "confidence": 0.0,
                }
    except Exception as e:
        logger.error(f"JEV evaluation failed: {e}")
        return {
            "evaluated": False,
            "reason": f"Connection error: {str(e)}",
            "satisfied": None,
            "confidence": 0.0,
        }
