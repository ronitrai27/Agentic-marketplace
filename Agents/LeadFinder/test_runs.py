from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path
import sys
from dotenv import load_dotenv

# Load local environment
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)

os.environ["PYDANTIC_AI_NO_BANNER"] = "1"

if not os.getenv("OPENAI_API_KEY") and os.getenv("OPENAPI_KEY"):
    os.environ["OPENAI_API_KEY"] = os.environ["OPENAPI_KEY"]

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from accumulator import run_lead_accumulator
from enricher import enrich_leads_batch
from exporter import export_to_csv, export_to_json


async def execute_test(query: str, target: int, prefix: str, max_rounds: int = 3):
    serpapi_key = os.getenv("SERPAPI_KEY", "")
    firecrawl_key = os.getenv("FIRECRAWL_API_KEY", "")
    openrouter_jev = os.getenv("OPENROUTER_JEV", "")
    jev_model = os.getenv("JEV_MODEL", "typesafe/jev-1.14")

    print("\n" + "#" * 70)
    print(f"[*] STARTING TEST: {query}")
    print(f"[*] Target Count:  {target} leads | Max Rounds: {max_rounds}")
    print("#" * 70)

    # Phase 1: Accumulate & Deduplicate
    report = await run_lead_accumulator(
        search_criteria=query,
        target_count=target,
        max_rounds=max_rounds,
        serpapi_key=serpapi_key,
        openrouter_jev_key=openrouter_jev,
        jev_model=jev_model,
    )

    # Phase 2: Firecrawl Deep Scraping (if applicable)
    if firecrawl_key and report.leads:
        report.leads = await enrich_leads_batch(
            leads=report.leads,
            firecrawl_key=firecrawl_key,
            max_concurrency=3,
        )

    # Export both JSON and CSV
    json_path = Path(__file__).parent / f"{prefix}.json"
    csv_path = Path(__file__).parent / f"{prefix}.csv"

    export_to_json(report, json_path)
    export_to_csv(report, csv_path)

    print("\n" + "=" * 70)
    print(f"[+] TEST RESULT: {query}")
    print(f"[+] Total Leads Found:  {len(report.leads)}/{target}")
    print(f"[+] Stopped Reason:     {report.stopped_reason}")
    print(f"[+] Saved JSON:         {json_path.name}")
    print(f"[+] Saved CSV:          {csv_path.name}")

    if report.jev_telemetry:
        print(f"[+] JEV Output Satisfied: {report.jev_telemetry.get('satisfied')} "
              f"(Confidence: {report.jev_telemetry.get('confidence', 0):.2f})")

    print("\nAll Collected Leads:")
    for idx, lead in enumerate(report.leads, 1):
        phone = f" | Phone: {lead.phone}" if lead.phone else ""
        email = f" | Email: {lead.email}" if lead.email else ""
        owner = f" | Contact/Owner: {lead.contact_name}" if lead.contact_name else ""
        print(f" {idx:2d}. {lead.title}")
        print(f"     URL: {lead.primary_url}{phone}{email}{owner}")
        print(f"     Why: {lead.match_reason}")
    print("=" * 70)
    return report


async def main():
    parser = argparse.ArgumentParser(description="Run Lead Finder Automated Tests")
    parser.add_argument("--run", choices=["1", "2", "all"], default="all", help="Which test to run: 1, 2, or all")
    args = parser.parse_args()

    if args.run in ("1", "all"):
        print("\n>>> EXECUTION: TEST 1 <<<")
        await execute_test(
            query="find 20 coffee shops and their owner in ludhiana",
            target=20,
            prefix="test1_coffee_shops",
            max_rounds=3,
        )

    if args.run in ("2", "all"):
        print("\n>>> EXECUTION: TEST 2 <<<")
        await execute_test(
            query="find me 6 jewellery business in ludhiana that doesn't own a website",
            target=6,
            prefix="test2_jewellery_no_website",
            max_rounds=2,
        )


if __name__ == "__main__":
    asyncio.run(main())
