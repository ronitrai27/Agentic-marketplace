from __future__ import annotations

import asyncio
import os
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

from google.adk.agents import Agent

from browser import BrowserbasePlaywrightEngine
from models import (
    ErrorCategory,
    ReplaySession,
    Severity,
    TestTier,
    UserJourneyResult,
    UxRecommendation,
    UxTestInput,
    UxTestReport,
)

UX_INSTRUCTIONS = """You are an elite Website UX and Conversion Rate Optimization (CRO) Auditor.
Your mission is to evaluate websites from the perspective of a real first-time visitor.
You inspect navigation menus, test signup and contact forms, follow conversion and checkout funnels,
and uncover confusing dead ends, layout traps, or broken user journeys.
Always output clear, actionable, and prioritized UX improvement recommendations with expected conversion impact."""


def create_ux_tester_agent(model_name: str = "gemini-2.5-flash") -> Agent:
    """Creates a Google ADK Agent configured for UX and Conversion Testing."""
    return Agent(
        name="website_ux_and_conversion_tester",
        model=model_name,
        instruction=UX_INSTRUCTIONS,
        description="Opens a website like a real visitor, tests navigation, forms, checkout flows, and detects dead ends.",
    )


class UxConversionAuditor:
    """
    Orchestrates the Google ADK Agent and Browserbase/Playwright engine
    to produce structured UX Audit Reports.
    """

    def __init__(self, api_key: Optional[str] = None):
        self.browser_engine = BrowserbasePlaywrightEngine(api_key=api_key)
        self.adk_agent = create_ux_tester_agent()

    async def execute_audit(
        self,
        test_input: UxTestInput,
        on_progress: Optional[Callable[[int, str], None]] = None,
    ) -> UxTestReport:
        """Runs the complete UX and conversion test sequence."""
        session_id = test_input.session_id or f"ux_session_{uuid.uuid4().hex[:8]}"
        start_time = time.time()

        def notify(pct: int, msg: str):
            if on_progress:
                on_progress(pct, msg)
            print(f"[{pct}%] {msg}")

        notify(10, f"Initializing Browserbase cloud session ({session_id})...")
        session_info = await self.browser_engine.initialize(session_id)

        passed_journeys: List[UserJourneyResult] = []
        failed_journeys: List[UserJourneyResult] = []
        recommendations: List[UxRecommendation] = []

        try:
            # Phase 1: Real Visitor Navigation & Popups
            notify(25, f"Opening target website like a real visitor: {test_input.target_url}")
            nav_ok, nav_msg, nav_steps = await self.browser_engine.navigate_like_real_visitor(test_input.target_url)

            landing_journey = UserJourneyResult(
                journey_name="Landing Page Initial Engagement",
                goal="Load homepage cleanly, handle cookie/GDPR modals, and observe above-the-fold content",
                passed=nav_ok,
                steps=nav_steps,
                failure_reason=None if nav_ok else nav_msg,
                error_category=None if nav_ok else ErrorCategory.DEAD_END
            )
            if nav_ok:
                passed_journeys.append(landing_journey)
            else:
                failed_journeys.append(landing_journey)
                recommendations.append(UxRecommendation(
                    id="rec_initial_load",
                    title="Website Initial Load Failure",
                    severity=Severity.CRITICAL,
                    category="Performance & Availability",
                    issue_description=nav_msg,
                    impact="Visitors cannot reach the website. Total conversion drop-off.",
                    recommended_fix="Verify DNS, SSL certificates, and web server health.",
                    affected_url=test_input.target_url
                ))

            # If landing page loaded, proceed with deep journey audits
            if nav_ok:
                # Phase 2: Navigation & Menu Exploration
                if test_input.test_navigation:
                    notify(45, "Testing primary navigation menus and header links...")
                    menu_journey = await self.browser_engine.test_navigation_menus()
                    if menu_journey.passed:
                        passed_journeys.append(menu_journey)
                    else:
                        failed_journeys.append(menu_journey)
                        recommendations.append(UxRecommendation(
                            id="rec_nav_failure",
                            title="Broken or Missing Navigation Menu",
                            severity=Severity.HIGH,
                            category="Navigation",
                            issue_description=menu_journey.failure_reason or "Menu navigation issue",
                            impact="Users fail to find secondary pages, products, or service offerings.",
                            recommended_fix="Ensure all header links resolve to valid, active 200 OK routes with clear labels.",
                            affected_url=test_input.target_url
                        ))

                # Phase 3: Forms & Signup Testing
                if test_input.test_forms and test_input.tier != TestTier.QUICK:
                    notify(65, "Testing signup, contact, and lead generation forms...")
                    form_journey = await self.browser_engine.test_signup_and_contact_forms()
                    if form_journey.passed:
                        passed_journeys.append(form_journey)
                    else:
                        failed_journeys.append(form_journey)
                        recommendations.append(UxRecommendation(
                            id="rec_form_error",
                            title="Form Validation or Submission Friction",
                            severity=Severity.HIGH,
                            category="Forms",
                            issue_description=form_journey.failure_reason or "Form validation failed",
                            impact="Leads and signups fail silently; lost revenue.",
                            recommended_fix="Provide immediate inline validation feedback and clear success states.",
                            affected_url=test_input.target_url
                        ))

                # Phase 4: Checkout & Conversion Flow Testing
                if test_input.test_checkout:
                    notify(80, "Auditing checkout funnels and conversion CTAs...")
                    checkout_journey = await self.browser_engine.test_checkout_and_conversion_flow(
                        safe_mode=test_input.safe_mode
                    )
                    if checkout_journey.passed:
                        passed_journeys.append(checkout_journey)
                    else:
                        failed_journeys.append(checkout_journey)
                        recommendations.append(UxRecommendation(
                            id="rec_checkout_issue",
                            title="Conversion CTA or Checkout Funnel Obstacle",
                            severity=Severity.CRITICAL if not test_input.safe_mode else Severity.HIGH,
                            category="Checkout",
                            issue_description=checkout_journey.failure_reason or "Conversion CTA inaccessible",
                            impact="High checkout abandonment rate. Visitors bounce without converting.",
                            recommended_fix="Make the primary CTA button prominent above the fold with high contrast.",
                            affected_url=test_input.target_url
                        ))

                # Phase 5: Dead-end & Confusion Scans
                notify(90, "Scanning for dead ends, unlinked elements, and UX confusion...")
                dead_end_recs = await self.browser_engine.detect_confusing_navigation_and_dead_ends()
                recommendations.extend(dead_end_recs)

        finally:
            await self.browser_engine.close()

        notify(98, "Synthesizing UX audit score and compiling evidence report...")

        # Calculate Overall Conversion Score (0-100)
        total_journeys = len(passed_journeys) + len(failed_journeys)
        pass_ratio = (len(passed_journeys) / total_journeys) if total_journeys > 0 else 0.5
        crit_count = sum(1 for r in recommendations if r.severity == Severity.CRITICAL)
        high_count = sum(1 for r in recommendations if r.severity == Severity.HIGH)

        penalty = (crit_count * 25) + (high_count * 10)
        base_score = int(pass_ratio * 100)
        overall_score = max(5, min(100, base_score - penalty))

        duration_sec = round(time.time() - start_time, 2)
        if session_info:
            session_info.duration_seconds = duration_sec

        report = UxTestReport(
            target_url=test_input.target_url,
            overall_score=overall_score,
            total_journeys_tested=total_journeys,
            journeys_passed=len(passed_journeys),
            journeys_failed=len(failed_journeys),
            failed_user_journeys=failed_journeys,
            passed_user_journeys=passed_journeys,
            screenshots=self.browser_engine.captured_screenshots,
            replayable_browser_sessions=[session_info] if session_info else [],
            ux_recommendations=recommendations,
            telemetry={
                "duration_seconds": duration_sec,
                "browserbase_session_id": session_info.browserbase_session_id if session_info else None,
                "framework": "Google ADK + Browserbase + Stagehand + Playwright",
                "tier": test_input.tier.value,
                "score": overall_score,
            }
        )

        notify(100, f"UX & Conversion Audit Complete! Final Score: {overall_score}/100")
        return report
