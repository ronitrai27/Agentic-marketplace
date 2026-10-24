from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from sdk import UxConversionTester


def main():
    parser = argparse.ArgumentParser(
        description="Website UX & Conversion Tester — Powered by Google ADK, Browserbase, and Playwright"
    )
    parser.add_argument("url", help="Target website URL to test (e.g. https://example.com)")
    parser.add_argument(
        "--tier",
        choices=["quick", "standard", "comprehensive"],
        default="standard",
        help="Audit workload tier (default: standard)",
    )
    parser.add_argument(
        "--no-safe-mode",
        action="store_true",
        help="Disable safe test environment mode",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output raw JSON report",
    )
    parser.add_argument(
        "--out",
        type=str,
        default=None,
        help="Path to save the JSON report file",
    )

    args = parser.parse_args()

    print("\n" + "=" * 65)
    print("🚀 Website UX & Conversion Tester (Google ADK + Browserbase)")
    print(f"🎯 Target URL: {args.url}")
    print(f"📦 Tier:       {args.tier}")
    print("=" * 65 + "\n")

    def print_progress(pct: int, msg: str):
        print(f"[{pct:3d}%] {msg}")

    tester = UxConversionTester()
    report = tester.test_website(
        url=args.url,
        tier=args.tier,
        safe_mode=not args.no_safe_mode,
        on_progress=print_progress,
    )

    if args.json:
        print(json.dumps(report.model_dump(), indent=2))
    else:
        print("\n" + "─" * 65)
        print(f"📊 Overall UX & Conversion Score: {report.overall_score}/100")
        print(f"🔍 Journeys Tested: {report.total_journeys_tested} | Passed: {report.journeys_passed} | Failed: {report.journeys_failed}")
        print("─" * 65)

        if report.failed_user_journeys:
            print("\n❌ Failed User Journeys:")
            for j in report.failed_user_journeys:
                print(f"  • {j.journey_name}: {j.failure_reason} (Category: {j.error_category})")

        if report.ux_recommendations:
            print("\n💡 Actionable UX Recommendations:")
            for r in report.ux_recommendations:
                print(f"  [{r.severity}] {r.title}")
                print(f"     Issue:  {r.issue_description}")
                print(f"     Fix:    {r.recommended_fix}")
                print(f"     Impact: {r.impact}\n")

        if report.replayable_browser_sessions:
            print("🎥 Replayable Browser Sessions:")
            for s in report.replayable_browser_sessions:
                print(f"  • Session ID: {s.session_id} ({s.browser_type})")
                print(f"    Replay Link: {s.replay_url}")
                print(f"    Live View:   {s.live_view_url}\n")

    if args.out:
        out_path = Path(args.out)
        out_path.write_text(json.dumps(report.model_dump(), indent=2), encoding="utf-8")
        print(f"💾 Report saved to: {out_path.resolve()}")


if __name__ == "__main__":
    main()
