from __future__ import annotations

import asyncio
import os
from pathlib import Path
from accumulator import run_universal_lead_finder
from exporter import export_to_csv, export_to_json

async def run_test():
    prompt = "Find 10 AI startups in India with their company name and website."
    print(f"Running Universal Lead Finder on prompt: {prompt}")
    report = await run_universal_lead_finder(
        user_prompt=prompt,
        target_count_override=10,
        max_rounds=3,
        serpapi_key=os.getenv("SERPAPI_KEY", ""),
        openrouter_jev_key=os.getenv("OPENROUTER_JEV", ""),
        jev_model=os.getenv("JEV_MODEL", "typesafe/jev-1.14"),
    )
    export_to_json(report, Path(__file__).parent / "test_ai_startups.json")
    export_to_csv(report, Path(__file__).parent / "test_ai_startups.csv")
    print(f"Completed! Verified {len(report.leads)} leads.")
    if report.jev_telemetry:
        print(f"JEV Satisfaction: {report.jev_telemetry.get('satisfied')} (Confidence: {report.jev_telemetry.get('confidence')})")

if __name__ == "__main__":
    asyncio.run(run_test())
