from __future__ import annotations

import asyncio
from typing import Callable, Optional
from pathlib import Path

from agent import UxConversionAuditor
from models import TestTier, UxTestInput, UxTestReport


class UxConversionTester:
    """
    Website UX & Conversion Tester SDK.
    
    Allows developers and QA engineers to run autonomous UX tests, form validation
    audits, and checkout flow verifications either programmatically in CI/CD or in production.

    Example:
    ```python
    from website_ux_tester import UxConversionTester

    tester = UxConversionTester()
    report = tester.test_website("https://example.com")
    print(f"UX Score: {report.overall_score}/100")
    for rec in report.ux_recommendations:
        print(f"[{rec.severity}] {rec.title}: {rec.recommended_fix}")
    ```
    """

    def __init__(self, browserbase_api_key: Optional[str] = None):
        self.browserbase_api_key = browserbase_api_key

    async def test_website_async(
        self,
        url: str,
        tier: str = "standard",
        test_navigation: bool = True,
        test_forms: bool = True,
        test_checkout: bool = True,
        safe_mode: bool = True,
        on_progress: Optional[Callable[[int, str], None]] = None,
    ) -> UxTestReport:
        """Runs the website UX and conversion audit asynchronously."""
        parsed_tier = TestTier(tier.lower()) if tier in [t.value for t in TestTier] else TestTier.STANDARD
        test_input = UxTestInput(
            target_url=url,
            tier=parsed_tier,
            test_navigation=test_navigation,
            test_forms=test_forms,
            test_checkout=test_checkout,
            safe_mode=safe_mode,
        )

        auditor = UxConversionAuditor(api_key=self.browserbase_api_key)
        return await auditor.execute_audit(test_input, on_progress=on_progress)

    def test_website(
        self,
        url: str,
        tier: str = "standard",
        test_navigation: bool = True,
        test_forms: bool = True,
        test_checkout: bool = True,
        safe_mode: bool = True,
        on_progress: Optional[Callable[[int, str], None]] = None,
    ) -> UxTestReport:
        """Synchronous convenience wrapper for test_website_async."""
        return asyncio.run(
            self.test_website_async(
                url=url,
                tier=tier,
                test_navigation=test_navigation,
                test_forms=test_forms,
                test_checkout=test_checkout,
                safe_mode=safe_mode,
                on_progress=on_progress,
            )
        )


def test_website_ux(
    url: str,
    tier: str = "standard",
    on_progress: Optional[Callable[[int, str], None]] = None,
) -> UxTestReport:
    """Quick one-line SDK invocation."""
    tester = UxConversionTester()
    return tester.test_website(url=url, tier=tier, on_progress=on_progress)
