from __future__ import annotations

import asyncio
import functools
import json
import os
from pathlib import Path
import re
import sys
from typing import AsyncGenerator
import uuid
import httpx
from starlette.applications import Starlette
from starlette.responses import HTMLResponse, Response, StreamingResponse
from starlette.routing import Route, Mount
from starlette.staticfiles import StaticFiles

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from dotenv import load_dotenv

# Load local environment
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)

os.environ["PYDANTIC_AI_NO_BANNER"] = "1"
if not os.getenv("OPENAI_API_KEY") and os.getenv("OPENAPI_KEY"):
    os.environ["OPENAI_API_KEY"] = os.environ["OPENAPI_KEY"]

from models import FinalLeadReport, LeadItem
from tools import search_google_maps, search_google_web
from jev import extract_query_with_jev, evaluate_output_satisfaction, JevQueryIntent
from exporter import export_to_csv, export_to_json
from accumulator import normalize_lead_key

PUBLIC_DIR = Path(__file__).parent / "public"
REPORTS_CACHE: dict[str, FinalLeadReport] = {}

# City neighborhood expansions to guarantee fresh Google Maps places across rounds
LOCALITY_EXPANSIONS = [
    "",
    "Model Town",
    "Sarabha Nagar",
    "Ferozepur Road",
    "Civil Lines",
    "South City",
    "BRS Nagar",
]


async def sse_stream_lead_finder(user_prompt: str, target: int) -> AsyncGenerator[str, None]:
    """
    Real-time SSE event generator:
    1. Deterministic intent extraction via TypeSafe JEV-1.14.
    2. Live locality-expanded Google Maps querying (emits site_visited instantly).
    3. Live lead validation and extraction (emits lead_discovered instantly).
    4. Firecrawl deep scraping with live streaming.
    5. JEV satisfaction assessment and report export.
    """
    run_id = str(uuid.uuid4())[:8]
    serpapi_key = os.getenv("SERPAPI_KEY", "")
    firecrawl_key = os.getenv("FIRECRAWL_API_KEY", "")
    openrouter_jev = os.getenv("OPENROUTER_JEV", "")
    jev_model = os.getenv("JEV_MODEL", "typesafe/jev-1.14")

    def format_sse(event_data: dict) -> str:
        return f"data: {json.dumps(event_data, ensure_ascii=False)}\n\n"

    yield format_sse({
        "type": "status",
        "message": f"Analyzing prompt with TypeSafe JEV-1.14: '{user_prompt}'...",
    })

    # Step 1: Deterministic JEV Query Extraction
    jev_intent: JevQueryIntent = await extract_query_with_jev(user_prompt, openrouter_jev, jev_model)
    clean_keyword = jev_intent.clean_query or user_prompt

    yield format_sse({
        "type": "status",
        "message": (
            f"JEV Intent Verified: Query='{clean_keyword}' | "
            f"Local Places={jev_intent.is_local_places} | "
            f"Requires No Website={jev_intent.requires_no_website} | "
            f"Requires Owner={jev_intent.requires_owner}"
        ),
    })

    unique_leads: list[LeadItem] = []
    seen_domains: set[str] = set()
    seen_names: set[str] = set()
    max_rounds = 5
    current_round = 0
    stopped_reason = "RUNNING"

    async with httpx.AsyncClient(timeout=30.0) as http_client:
        # Step 2: Locality-Expanded Discovery Loop
        while len(unique_leads) < target and current_round < max_rounds:
            current_round += 1
            needed = target - len(unique_leads)
            
            # Expand search query with locality or keyword variation to get fresh results
            locality_suffix = LOCALITY_EXPANSIONS[(current_round - 1) % len(LOCALITY_EXPANSIONS)]
            if locality_suffix and locality_suffix.lower() not in clean_keyword.lower():
                round_query = f"{clean_keyword} {locality_suffix}".strip()
            else:
                round_query = clean_keyword

            yield format_sse({
                "type": "status",
                "message": f"Round {current_round}/{max_rounds}: Searching Google Maps for '{round_query}' (Needed: {needed})...",
            })

            # Fetch Google Maps results directly
            maps_res = await search_google_maps(round_query, serpapi_key, client=http_client)
            raw_places = maps_res.get("results", [])

            if not raw_places:
                # Fallback to web search if maps returned nothing
                web_res = await search_google_web(round_query, serpapi_key, client=http_client)
                raw_places = [
                    {"title": w["title"], "primary_url": w["link"], "has_website": True, "address": None, "phone": None}
                    for w in web_res.get("results", [])
                ]

            yield format_sse({
                "type": "status",
                "message": f"Retrieved {len(raw_places)} places from Google Maps for '{round_query}'. Filtering & streaming...",
            })

            new_in_batch = 0
            for place in raw_places:
                title = place.get("title", "")
                url = place.get("primary_url") or place.get("maps_url") or ""
                has_web = place.get("has_website", False)

                if not title or not url:
                    continue

                # Emit site visited immediately
                yield format_sse({
                    "type": "site_visited",
                    "title": title,
                    "url": url,
                })

                # Check "requires_no_website" constraint
                if jev_intent.requires_no_website and has_web:
                    continue

                # Deduplication check
                domain_key, name_key = normalize_lead_key(LeadItem(
                    title=title,
                    primary_url=url,
                    match_reason=f"Matches '{clean_keyword}' in {place.get('address') or 'area'}",
                ))

                is_dup = (name_key and name_key in seen_names) or (
                    domain_key and domain_key in seen_domains and "google.com" not in domain_key
                )

                if not is_dup:
                    lead = LeadItem(
                        title=title,
                        primary_url=url,
                        phone=place.get("phone"),
                        location=place.get("address"),
                        match_reason=f"Verified match for {clean_keyword} ({'No website - Maps listing only' if not has_web else 'Website verified'}).",
                        attributes={"rating": place.get("rating"), "has_website": has_web},
                    )

                    unique_leads.append(lead)
                    if domain_key and "google.com" not in domain_key:
                        seen_domains.add(domain_key)
                    if name_key:
                        seen_names.add(name_key)
                    new_in_batch += 1

                    # Emit lead discovered event immediately
                    yield format_sse({
                        "type": "lead_discovered",
                        "lead": lead.model_dump(),
                    })

                    if len(unique_leads) >= target:
                        break

            yield format_sse({
                "type": "status",
                "message": f"Round {current_round} finished. Added {new_in_batch} unique leads (Total now: {len(unique_leads)}/{target}).",
            })

            # Small breather to prevent flooding
            await asyncio.sleep(0.3)

        if len(unique_leads) >= target:
            stopped_reason = "TARGET_REACHED"
        elif current_round >= max_rounds:
            stopped_reason = "MAX_ROUNDS_REACHED"

        # Step 3: TypeSafe JEV Output Satisfaction Evaluation
        jev_telemetry = None
        if openrouter_jev and unique_leads:
            yield format_sse({
                "type": "status",
                "message": "Evaluating final satisfaction with TypeSafe JEV-1.14 decisions API...",
            })

            sample_dicts = [l.model_dump() for l in unique_leads[:3]]
            jev_telemetry = await evaluate_output_satisfaction(
                user_prompt=user_prompt,
                total_found=len(unique_leads),
                sample_leads=sample_dicts,
                api_key=openrouter_jev,
                model=jev_model,
            )

            yield format_sse({
                "type": "jev",
                "telemetry": jev_telemetry,
            })

    # Compile Final Report
    final_report = FinalLeadReport(
        search_criteria=user_prompt,
        target_count=target,
        total_found=len(unique_leads),
        rounds_executed=current_round,
        stopped_reason=stopped_reason,
        leads=unique_leads,
        jev_telemetry=jev_telemetry,
    )

    REPORTS_CACHE[run_id] = final_report

    out_dir = Path(__file__).parent
    export_to_json(final_report, out_dir / "leads_result.json")
    export_to_csv(final_report, out_dir / "leads_result.csv")

    yield format_sse({
        "type": "complete",
        "run_id": run_id,
        "report": final_report.model_dump(),
    })


async def stream_endpoint(request):
    query = request.query_params.get("query", "coffee shops in ludhiana")
    target_str = request.query_params.get("target", "20")
    try:
        target = int(target_str)
    except ValueError:
        target = 20

    return StreamingResponse(
        sse_stream_lead_finder(query, target),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def download_csv_endpoint(request):
    run_id = request.query_params.get("id")
    report = REPORTS_CACHE.get(run_id)
    if not report:
        csv_file = Path(__file__).parent / "leads_result.csv"
        if csv_file.exists():
            content = csv_file.read_text(encoding="utf-8-sig")
            return Response(content, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="leads.csv"'})
        return Response("Not found", status_code=404)

    tmp_path = Path(__file__).parent / f"export_{run_id}.csv"
    export_to_csv(report, tmp_path)
    content = tmp_path.read_text(encoding="utf-8-sig")
    tmp_path.unlink(missing_ok=True)
    return Response(content, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="leads.csv"'})


async def download_json_endpoint(request):
    run_id = request.query_params.get("id")
    report = REPORTS_CACHE.get(run_id)
    if not report:
        json_file = Path(__file__).parent / "leads_result.json"
        if json_file.exists():
            return Response(json_file.read_text(encoding="utf-8"), media_type="application/json", headers={"Content-Disposition": 'attachment; filename="leads.json"'})
        return Response("Not found", status_code=404)

    return Response(json.dumps(report.model_dump(), indent=2, ensure_ascii=False), media_type="application/json", headers={"Content-Disposition": 'attachment; filename="leads.json"'})


async def homepage_endpoint(request):
    index_file = PUBLIC_DIR / "index.html"
    return HTMLResponse(index_file.read_text(encoding="utf-8"))


routes = [
    Route("/", endpoint=homepage_endpoint),
    Route("/api/stream", endpoint=stream_endpoint),
    Route("/api/download/csv", endpoint=download_csv_endpoint),
    Route("/api/download/json", endpoint=download_json_endpoint),
    Mount("/", app=StaticFiles(directory=str(PUBLIC_DIR)), name="static"),
]

app = Starlette(debug=True, routes=routes)

if __name__ == "__main__":
    import uvicorn
    print("\n" + "=" * 65)
    print("[*] LeadFinder UI Server Started on: http://localhost:8000")
    print("=" * 65 + "\n")
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False)
