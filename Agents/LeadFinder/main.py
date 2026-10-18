from __future__ import annotations

import argparse
import asyncio
import json
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

from accumulator import run_universal_lead_finder
from exporter import export_to_csv, export_to_json


async def main():
    parser = argparse.ArgumentParser(description="Universal Dynamic Lead Finder")
    parser.add_argument(
        "--query",
        type=str,
        default="Find 10 AI startups in India with their company name and website.",
        help="Any user search request",
    )
    parser.add_argument(
        "--target",
        type=int,
        default=10,
        help="Target number of unique leads to collect (default: 10)",
    )
    parser.add_argument(
        "--max-rounds",
        type=int,
        default=4,
        help="Safety budget rounds ceiling (default: 4)",
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
        help="File path to save the CSV report",
    )
    args = parser.parse_args()

    serpapi_key = os.getenv("SERPAPI_KEY", "")
    if not serpapi_key:
        print("[!] Error: SERPAPI_KEY not found in .env")
        return

    openrouter_jev = os.getenv("OPENROUTER_JEV", "")
    jev_model = os.getenv("JEV_MODEL", "typesafe/jev-1.14")

    print("=" * 65)
    print("[*] Universal Lead Finder Engine Active")
    print(f"[*] Prompt:  {args.query}")
    print(f"[*] Target:  {args.target} leads | Max Rounds: {args.max_rounds}")
    print("=" * 65)

    def print_event(e: dict):
        if e.get("type") == "status":
            print(f"  > {e.get('message')}")
        elif e.get("type") == "lead_discovered":
            lead = e.get("lead", {})
            name = list(lead.get("data", {}).values())[0] if lead.get("data") else "Lead"
            print(f"  [+] Discovered & Critic-Approved: {name} ({lead.get('source_url')})")

    report = await run_universal_lead_finder(
        user_prompt=args.query,
        target_count_override=args.target,
        max_rounds=args.max_rounds,
        serpapi_key=serpapi_key,
        openrouter_jev_key=openrouter_jev,
        jev_model=jev_model,
        on_event=print_event,
    )

    json_path = Path(__file__).parent / args.output_json
    csv_path = Path(__file__).parent / args.output_csv

    export_to_json(report, json_path)
    export_to_csv(report, csv_path)

    print("\n" + "=" * 65)
    print(f"[+] Run Complete!")
    print(f"[+] Total Verified Leads: {len(report.leads)}/{report.target_count}")
    print(f"[+] Required Fields:      {report.required_fields}")
    print(f"[+] Constraints Enforced: {report.constraints_enforced}")
    print(f"[+] Stopped Reason:       {report.stopped_reason}")
    print(f"[+] Saved JSON:           {json_path.resolve()}")
    print(f"[+] Saved CSV:            {csv_path.resolve()}")

    if report.jev_telemetry and report.jev_telemetry.get("evaluated"):
        sat = "PASS" if report.jev_telemetry.get("satisfied") else "FAIL"
        print(f"[+] Real JEV Audit:       {sat} (Confidence: {report.jev_telemetry.get('confidence', 0):.2f})")

    print("\nVerified Leads Preview:")
    for idx, lead in enumerate(report.leads, 1):
        fields_summary = ", ".join(f"{k}: {v}" for k, v in lead.data.items())
        print(f"  {idx:2d}. {fields_summary}")
        print(f"      Source: {lead.source_url}")
        print(f"      Critic: {lead.critic_verdict}")
    print("=" * 65)


if __name__ == "__main__":
    asyncio.run(main())
