from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path

# Add current folder to path
sys.path.insert(0, str(Path(__file__).parent))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from models import TestTier, UxTestInput, UxTestReport
from sdk import UxConversionTester
from server import get_agent_manifest


class TestWebsiteUxTester(unittest.IsolatedAsyncioTestCase):

    def test_agent_manifest(self):
        """Verify the agent manifest adheres to MAPS 1.0.0."""
        manifest = get_agent_manifest()
        self.assertEqual(manifest["id"], "website-ux-and-conversion-tester")
        self.assertEqual(manifest["protocol_version"], "1.0.0")
        self.assertIn("input_schema", manifest)
        self.assertIn("output_schema", manifest)
        self.assertIn("pricing", manifest)

    async def test_ux_tester_live_execution(self):
        """Runs the UX tester on a real web page and asserts complete report generation."""
        tester = UxConversionTester()

        progress_events = []
        def on_progress(pct: int, msg: str):
            progress_events.append((pct, msg))

        # Test against a standard website
        report: UxTestReport = await tester.test_website_async(
            url="https://example.com",
            tier="quick",
            test_navigation=True,
            test_forms=False,
            test_checkout=False,
            on_progress=on_progress
        )

        self.assertIsInstance(report, UxTestReport)
        self.assertGreaterEqual(report.overall_score, 0)
        self.assertLessEqual(report.overall_score, 100)
        self.assertGreater(report.total_journeys_tested, 0)
        self.assertIsInstance(report.replayable_browser_sessions, list)
        self.assertGreaterEqual(len(report.replayable_browser_sessions), 1)

        session = report.replayable_browser_sessions[0]
        self.assertIsNotNone(session.replay_url)
        self.assertIsNotNone(session.live_view_url)

        print("\n✅ test_ux_tester_live_execution passed!")
        print(f"   - Score: {report.overall_score}/100")
        print(f"   - Progress events captured: {len(progress_events)}")
        print(f"   - Session Replay URL: {session.replay_url}")


if __name__ == "__main__":
    unittest.main()
