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

# Ensure OPENAI_API_KEY is available if OPENAPI_KEY is set in .env
if not os.getenv("OPENAI_API_KEY") and os.getenv("OPENAPI_KEY"):
    os.environ["OPENAI_API_KEY"] = os.environ["OPENAPI_KEY"]

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from accumulator import run_lead_accumulator
from enricher import enrich_leads_batch
from exporter import export_to_csv, export_to_json


async def main():
    parser = argparse.ArgumentParser(description="Pydantic AI Lead Finder Agent (Phase 1 & 2)")
    parser.add_argument(
        "--query",
        type=str,
        default="coffee shops in ludhiana",
        help="Search criteria for leads (default: 'coffee shops in ludhiana')",
    )
    parser.add_argument(
        "--target",
        type=int,
        default=20,
        help="Target number of unique leads to collect (default: 20)",
    )
    parser.add_argument(
        "--max-rounds",
        type=int,
        default=3,
        help="Safety ceiling for agent loop rounds to prevent budget burn (default: 3)",
    )
    parser.add_argument(
        "--output-json",
        type=str,
        default="leads_result.json",
        help="File path to save the JSON report",
    )
    parser.add_argument(
        "--output-csv",
        type=str,
        default="leads_result.csv",
        help="File path to save the outreach CSV file",
    )
    parser.add_argument(
        "--skip-enrich",
        action="store_true",
        help="Skip Phase 2 Firecrawl website enrichment",
    )
    args = parser.parse_args()

    serpapi_key = os.getenv("SERPAPI_KEY", "")
    if not serpapi_key:
        print("[!] Error: SERPAPI_KEY not found in environment or .env file.")
        return

    firecrawl_key = os.getenv("FIRECRAWL_API_KEY", "")
    openrouter_jev = os.getenv("OPENROUTER_JEV", "")
    jev_model = os.getenv("JEV_MODEL", "typesafe/jev-1.14")

    print("=" * 65)
    print("[*] Pydantic AI Lead Finder — Phase 1 & Phase 2 Pipeline")
    print(f"[*] Criteria:       {args.query}")
    print(f"[*] Target Volume:  {args.target} leads")
    print(f"[*] Max Rounds:     {args.max_rounds} (Safety budget ceiling)")
    print(f"[*] Model Strategy: Groq (gpt-oss-120b) + OpenAI (gpt-5.1-mini)")
    print("=" * 65)

    # ---------------------------------------------------------------
    # PHASE 1: Discovery, Batch Accumulation & Deduplication
    # ---------------------------------------------------------------
    report = await run_lead_accumulator(
        search_criteria=args.query,
        target_count=args.target,
        max_rounds=args.max_rounds,
        serpapi_key=serpapi_key,
        openrouter_jev_key=openrouter_jev,
        jev_model=jev_model,
    )

    # ---------------------------------------------------------------
    # PHASE 2: Deep Scraping & Contact Enrichment via Firecrawl + Groq
    # ---------------------------------------------------------------
    if not args.skip_enrich and firecrawl_key and report.leads:
        report.leads = await enrich_leads_batch(
            leads=report.leads,
            firecrawl_key=firecrawl_key,
            max_concurrency=3,
        )

    # ---------------------------------------------------------------
    # EXPORTS: Formatted JSON and Outreach-Ready CSV
    # ---------------------------------------------------------------
    json_path = Path(__file__).parent / args.output_json
    csv_path = Path(__file__).parent / args.output_csv

    export_to_json(report, json_path)
    export_to_csv(report, csv_path)

    print("\n" + "=" * 65)
    print(f"[+] Lead Generation & Enrichment Complete!")
    print(f"[+] Total Leads Verified:  {len(report.leads)}/{report.target_count}")
    print(f"[+] Rounds Taken:          {report.rounds_executed}")
    print(f"[+] Stopped Reason:        {report.stopped_reason}")
    print(f"[+] JSON Export:           {json_path.resolve()}")
    print(f"[+] CSV Export:            {csv_path.resolve()}")

    if report.jev_telemetry:
        print(f"[+] JEV Output Match:      {report.jev_telemetry.get('satisfied', 'N/A')} "
              f"(Confidence: {report.jev_telemetry.get('confidence', 0):.2f})")

    # Metrics on enriched fields
    with_phone = sum(1 for l in report.leads if l.phone)
    with_email = sum(1 for l in report.leads if l.email)
    with_socials = sum(1 for l in report.leads if l.social_links)

    print(f"\n[+] Contact Coverage:")
    print(f"    - Phone Numbers:  {with_phone}/{len(report.leads)}")
    print(f"    - Email Contacts: {with_email}/{len(report.leads)}")
    print(f"    - Social Links:   {with_socials}/{len(report.leads)}")

    print("\nSample Leads Preview:")
    for idx, lead in enumerate(report.leads[:5], 1):
        phone_str = f" | Phone: {lead.phone}" if lead.phone else ""
        email_str = f" | Email: {lead.email}" if lead.email else ""
        loc_str = f" | Loc: {lead.location}" if lead.location else ""
        print(f"  {idx}. {lead.title} -> {lead.primary_url}{phone_str}{email_str}{loc_str}")
    if len(report.leads) > 5:
        print(f"  ... and {len(report.leads) - 5} more in CSV/JSON.")
    print("=" * 65)


if __name__ == "__main__":
    asyncio.run(main())
