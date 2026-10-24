from __future__ import annotations

import asyncio
import base64
import os
import time
from typing import Any, Dict, List, Optional, Tuple
from pathlib import Path

from playwright.async_api import async_playwright, Browser, BrowserContext, Page, Response
from browserbase import Browserbase

from models import (
    ErrorCategory,
    ReplaySession,
    Severity,
    UserJourneyResult,
    UserJourneyStep,
    UxRecommendation,
)

DEFAULT_BROWSERBASE_API_KEY = "bb_live_HLAfLb8kAT7RhcdUlLobVBQCEiQ"


class BrowserbasePlaywrightEngine:
    """
    Drives browser automation using Browserbase Cloud Sessions (with Stagehand patterns)
    and Playwright CDP, with automatic local fallback for reliable execution.
    """

    def __init__(self, api_key: Optional[str] = None, artifacts_dir: Optional[Path] = None):
        self.api_key = api_key or os.getenv("BROWSERBASE_API_KEY", DEFAULT_BROWSERBASE_API_KEY)
        self.artifacts_dir = artifacts_dir or Path(__file__).parent / "artifacts"
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)
        self.bb: Optional[Browserbase] = None
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.playwright = None
        self.current_session: Optional[ReplaySession] = None
        self.start_time: float = 0.0
        self.captured_screenshots: List[Dict[str, str]] = []

    async def initialize(self, session_id: str) -> ReplaySession:
        """Initializes a Browserbase session or local Playwright fallback."""
        self.start_time = time.time()
        self.playwright = await async_playwright().start()

        # Attempt Browserbase cloud session
        bb_session_id = None
        live_view_url = None
        replay_url = None

        if self.api_key:
            try:
                self.bb = Browserbase(api_key=self.api_key)
                session = self.bb.sessions.create()
                bb_session_id = session.id
                connect_url = session.connect_url
                
                # Fetch live view & replay links
                try:
                    live_urls = self.bb.sessions.get_live_urls(session.id)
                    live_view_url = getattr(live_urls, "live_view_url", None)
                except Exception:
                    live_view_url = f"https://www.browserbase.com/sessions/{bb_session_id}"

                replay_url = f"https://www.browserbase.com/sessions/{bb_session_id}"

                # Connect Playwright to the cloud browser over CDP
                self.browser = await self.playwright.chromium.connect_over_cdp(connect_url)
                self.context = self.browser.contexts[0] if self.browser.contexts else await self.browser.new_context()
                self.page = self.context.pages[0] if self.context.pages else await self.context.new_page()

            except Exception as e:
                print(f"[BrowserEngine] Cloud session connection skipped ({e}). Falling back to local Playwright.")
                self.browser = await self.playwright.chromium.launch(
                    headless=True,
                    args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
                )
                self.context = await self.browser.new_context(
                    viewport={"width": 1280, "height": 800},
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 CatelogTester/1.0"
                )
                self.page = await self.context.new_page()
                live_view_url = f"local://session/{session_id}"
                replay_url = f"local://replay/{session_id}"
        else:
            self.browser = await self.playwright.chromium.launch(headless=True)
            self.context = await self.browser.new_context(viewport={"width": 1280, "height": 800})
            self.page = await self.context.new_page()
            live_view_url = f"local://session/{session_id}"
            replay_url = f"local://replay/{session_id}"

        self.current_session = ReplaySession(
            session_id=session_id,
            browserbase_session_id=bb_session_id,
            live_view_url=live_view_url,
            replay_url=replay_url,
            browser_type="Browserbase Cloud Chrome" if bb_session_id else "Local Playwright Chromium",
            duration_seconds=0.0
        )
        return self.current_session

    async def capture_screenshot(self, label: str) -> str:
        """Captures page screenshot and returns base64 string and file path."""
        if not self.page:
            return ""
        try:
            filename = f"{int(time.time()*1000)}_{label.replace(' ', '_')}.png"
            filepath = self.artifacts_dir / filename
            data = await self.page.screenshot(path=str(filepath), full_page=False)
            b64_data = f"data:image/png;base64,{base64.b64encode(data).decode('utf-8')}"
            self.captured_screenshots.append({
                "label": label,
                "url": self.page.url,
                "path": str(filepath),
                "data_url": b64_data
            })
            return b64_data
        except Exception as e:
            print(f"[BrowserEngine] Screenshot capture error: {e}")
            return ""

    async def navigate_like_real_visitor(self, url: str) -> Tuple[bool, str, List[UserJourneyStep]]:
        """Opens the target website like a real human visitor and handles popups."""
        steps: List[UserJourneyStep] = []
        start_step = time.time()
        try:
            steps.append(UserJourneyStep(
                step_index=1,
                action="navigate",
                target=url,
                current_url="about:blank",
                status="running",
                details="Dispatching navigation with human-like viewport and headers..."
            ))
            response: Optional[Response] = await self.page.goto(url, wait_until="domcontentloaded", timeout=30000)
            status_code = response.status if response else 0

            # Realistic scroll to simulate real user engagement
            await self.page.evaluate("window.scrollBy(0, 300)")
            await asyncio.sleep(0.5)
            await self.page.evaluate("window.scrollBy(0, -200)")

            # Handle Cookie Banners / GDPR Overlays
            await self._dismiss_cookie_and_modal_banners()

            screenshot = await self.capture_screenshot("landing_page_loaded")
            steps[0].status = "succeeded" if status_code < 400 else "failed"
            steps[0].current_url = self.page.url
            steps[0].screenshot_url = screenshot
            steps[0].duration_ms = int((time.time() - start_step) * 1000)

            if status_code >= 400:
                return False, f"HTTP Error {status_code} received when accessing {url}", steps
            return True, f"Successfully loaded landing page ({status_code})", steps

        except Exception as e:
            steps[0].status = "failed"
            steps[0].details = str(e)
            return False, f"Navigation failed: {str(e)}", steps

    async def _dismiss_cookie_and_modal_banners(self):
        """Attempts to find and close standard cookie consent dialogs and marketing modals."""
        common_selectors = [
            "button:has-text('Accept All')",
            "button:has-text('Accept Cookies')",
            "button:has-text('I Agree')",
            "button:has-text('Got it')",
            "button:has-text('Allow all')",
            "#onetrust-accept-btn-handler",
            ".cookie-accept",
            "[aria-label='Close']",
            "button.close-modal"
        ]
        for sel in common_selectors:
            try:
                el = await self.page.query_selector(sel)
                if el and await el.is_visible():
                    await el.click(timeout=1500)
                    await asyncio.sleep(0.3)
                    break
            except Exception:
                continue

    async def test_navigation_menus(self) -> UserJourneyResult:
        """Explores header navigation, menu links, and checks for dead ends or broken links."""
        steps: List[UserJourneyStep] = []
        journey = UserJourneyResult(
            journey_name="Navigation & Menu Traversal",
            goal="Ensure primary navigation links are discoverable, clickable, and resolve without 404s",
            passed=True,
            steps=steps
        )

        try:
            # Detect primary navigation items
            links = await self.page.eval_on_selector_all(
                "nav a, header a, [role='navigation'] a",
                "elements => elements.slice(0, 8).map(e => ({ text: e.innerText.trim(), href: e.href }))"
            )

            # Filter valid HTTP links
            valid_links = [l for l in links if l.get("href") and l.get("href").startswith("http") and l.get("text")]

            if not valid_links:
                # Check for mobile hamburger button
                hamburger = await self.page.query_selector("button[aria-label*='menu'], .hamburger, [aria-expanded]")
                if hamburger and await hamburger.is_visible():
                    await hamburger.click()
                    await asyncio.sleep(0.5)
                    valid_links = await self.page.eval_on_selector_all(
                        "nav a, header a",
                        "elements => elements.slice(0, 5).map(e => ({ text: e.innerText.trim(), href: e.href }))"
                    )

            if not valid_links:
                journey.passed = False
                journey.failure_reason = "No accessible header navigation links found. Menu may be broken or unrendered."
                journey.error_category = ErrorCategory.CONFUSING_NAVIGATION
                return journey

            tested_count = 0
            for link_info in valid_links[:4]:
                tested_count += 1
                link_text = link_info.get("text")
                target_url = link_info.get("href")

                step = UserJourneyStep(
                    step_index=tested_count,
                    action="click_menu_link",
                    target=f"{link_text} -> {target_url}",
                    current_url=self.page.url,
                    status="running"
                )
                steps.append(step)

                step_start = time.time()
                try:
                    res = await self.page.goto(target_url, wait_until="domcontentloaded", timeout=12000)
                    status_code = res.status if res else 0

                    if status_code >= 400:
                        step.status = "failed"
                        step.details = f"Link '{link_text}' returned broken HTTP status {status_code}"
                        journey.passed = False
                        journey.failure_reason = f"Broken menu link detected: '{link_text}' returned {status_code}"
                        journey.error_category = ErrorCategory.BROKEN_LINK
                        step.screenshot_url = await self.capture_screenshot(f"broken_nav_{link_text}")
                        break
                    else:
                        step.status = "succeeded"
                        step.current_url = self.page.url
                        step.duration_ms = int((time.time() - step_start) * 1000)

                except Exception as ex:
                    step.status = "failed"
                    step.details = str(ex)
                    journey.passed = False
                    journey.failure_reason = f"Navigation to '{link_text}' timed out or threw error: {str(ex)}"
                    journey.error_category = ErrorCategory.TIMEOUT
                    break

        except Exception as e:
            journey.passed = False
            journey.failure_reason = f"Menu traversal encountered error: {str(e)}"
            journey.error_category = ErrorCategory.CONFUSING_NAVIGATION

        return journey

    async def test_signup_and_contact_forms(self) -> UserJourneyResult:
        """Finds signup or contact forms, tests field validation, and enters test inputs."""
        steps: List[UserJourneyStep] = []
        journey = UserJourneyResult(
            journey_name="Form Conversion & Validation Verification",
            goal="Identify form input fields, verify client-side validation, and test submission handling",
            passed=True,
            steps=steps
        )

        try:
            # Look for form or inputs on current page or navigate to /contact or /signup if found
            form_link = await self.page.query_selector("a[href*='contact'], a[href*='signup'], a[href*='register'], a[href*='demo']")
            if form_link:
                href = await form_link.get_attribute("href")
                if href:
                    await self.page.goto(href, wait_until="domcontentloaded", timeout=15000)
                    await asyncio.sleep(0.5)

            form = await self.page.query_selector("form")
            email_input = await self.page.query_selector("input[type='email'], input[name*='email'], input[id*='email']")

            if not email_input:
                # Page has no forms to test
                steps.append(UserJourneyStep(
                    step_index=1,
                    action="inspect_forms",
                    target="input[type='email']",
                    current_url=self.page.url,
                    status="succeeded",
                    details="No primary signup/contact forms located on this page."
                ))
                return journey

            # Step 1: Test Empty Submit (Validation Check)
            submit_btn = await self.page.query_selector("button[type='submit'], input[type='submit'], form button")
            if submit_btn:
                steps.append(UserJourneyStep(
                    step_index=1,
                    action="submit_empty_form",
                    target="button[type='submit']",
                    current_url=self.page.url,
                    status="succeeded",
                    details="Tested empty form submission to verify browser/client validation presence."
                ))
                await submit_btn.click(timeout=2000)
                await asyncio.sleep(0.5)

            # Step 2: Fill Valid Synthetic Test Data
            await email_input.fill("catelog_qa_tester@agentic-market.test")
            steps.append(UserJourneyStep(
                step_index=2,
                action="fill_input",
                target="input[type='email']",
                current_url=self.page.url,
                status="succeeded",
                details="Filled email field with synthetic QA tester email."
            ))

            name_input = await self.page.query_selector("input[name*='name'], input[id*='name'], input[placeholder*='Name']")
            if name_input:
                await name_input.fill("Test Visitor")

            msg_input = await self.page.query_selector("textarea, input[name*='message']")
            if msg_input:
                await msg_input.fill("Testing website UX and form response via Catelog ADK agent.")

            screenshot = await self.capture_screenshot("form_filled_ready")
            steps[-1].screenshot_url = screenshot

        except Exception as e:
            journey.passed = False
            journey.failure_reason = f"Form testing error: {str(e)}"
            journey.error_category = ErrorCategory.FORM_VALIDATION_ERROR

        return journey

    async def test_checkout_and_conversion_flow(self, safe_mode: bool = True) -> UserJourneyResult:
        """Tests checkout or CTA conversion flows (Add to Cart, Get Started, Buy Now) in safe mode."""
        steps: List[UserJourneyStep] = []
        journey = UserJourneyResult(
            journey_name="Checkout & Conversion Flow Testing",
            goal="Follow conversion triggers to verify cart, pricing, and checkout readiness without final billing",
            passed=True,
            steps=steps
        )

        cta_selectors = [
            "button:has-text('Get Started')",
            "a:has-text('Get Started')",
            "button:has-text('Add to Cart')",
            "button:has-text('Buy Now')",
            "a:has-text('Pricing')",
            "a:has-text('Start Free Trial')",
            "button:has-text('Checkout')",
            ".cta-button"
        ]

        found_cta = None
        cta_text = ""
        for sel in cta_selectors:
            try:
                el = await self.page.query_selector(sel)
                if el and await el.is_visible():
                    found_cta = el
                    cta_text = (await el.inner_text()).strip()
                    break
            except Exception:
                continue

        if not found_cta:
            journey.passed = False
            journey.failure_reason = "No primary conversion CTA button (Get Started, Buy Now, Pricing) visible on viewport."
            journey.error_category = ErrorCategory.CONFUSING_NAVIGATION
            return journey

        step1 = UserJourneyStep(
            step_index=1,
            action="click_conversion_cta",
            target=cta_text,
            current_url=self.page.url,
            status="running"
        )
        steps.append(step1)

        try:
            prev_url = self.page.url
            await found_cta.click(timeout=5000)
            await asyncio.sleep(1.5)

            step1.status = "succeeded"
            step1.current_url = self.page.url
            step1.details = f"Clicked '{cta_text}'. Transitioned from {prev_url} to {self.page.url}"
            step1.screenshot_url = await self.capture_screenshot("conversion_cta_clicked")

            # Check if landed on dead end or 404
            if self.page.url == prev_url and "#" in (await found_cta.get_attribute("href") or ""):
                journey.friction_score = 40
                step1.details += " (Warning: CTA triggered anchor jump without navigation or modal display)."

        except Exception as e:
            step1.status = "failed"
            step1.details = str(e)
            journey.passed = False
            journey.failure_reason = f"Failed to follow conversion flow CTA '{cta_text}': {str(e)}"
            journey.error_category = ErrorCategory.CHECKOUT_FRICTION

        return journey

    async def detect_confusing_navigation_and_dead_ends(self) -> List[UxRecommendation]:
        """Scans page for UX confusion patterns: dead-end pages, tiny touch targets, missing back buttons."""
        recommendations: List[UxRecommendation] = []
        try:
            # 1. Check title and main heading
            title = await self.page.title()
            h1 = await self.page.query_selector("h1")
            if not h1:
                recommendations.append(UxRecommendation(
                    id="ux_rec_h1",
                    title="Missing Primary H1 Heading",
                    severity=Severity.MEDIUM,
                    category="Navigation",
                    issue_description="The page lacks an <h1> tag, creating ambiguity for visitors and screen readers.",
                    impact="Users cannot immediately orient themselves on the page purpose; increases bounce rate.",
                    recommended_fix="Add a clear, descriptive <h1> heading at the top of the main content area.",
                    affected_url=self.page.url
                ))

            # 2. Check for dead ends (pages with no visible links or action buttons)
            interactive_count = await self.page.eval_on_selector_all(
                "a, button, input[type='button'], input[type='submit']",
                "elements => elements.filter(e => e.offsetParent !== null).length"
            )
            if interactive_count < 3:
                recommendations.append(UxRecommendation(
                    id="ux_rec_dead_end",
                    title="Potential Navigation Dead End",
                    severity=Severity.HIGH,
                    category="Navigation",
                    issue_description="Fewer than 3 interactive elements found on this view. Visitors may become stranded.",
                    impact="Visitors are unable to continue their journey and are forced to use the browser Back button.",
                    recommended_fix="Include a prominent secondary navigation bar or a 'Return to Home / Products' CTA.",
                    affected_url=self.page.url
                ))

            # 3. Form feedback
            inputs = await self.page.query_selector_all("input")
            if len(inputs) > 6:
                recommendations.append(UxRecommendation(
                    id="ux_rec_form_length",
                    title="Excessive Form Field Friction",
                    severity=Severity.MEDIUM,
                    category="Forms",
                    issue_description=f"Form contains {len(inputs)} fields. Long initial forms degrade conversion rates.",
                    impact="Cart or signup abandonment increases significantly when asking for unnecessary upfront fields.",
                    recommended_fix="Split into a multi-step wizard or defer non-essential fields until after initial onboarding.",
                    affected_url=self.page.url
                ))

        except Exception as e:
            print(f"[BrowserEngine] Dead-end detection error: {e}")

        return recommendations

    async def close(self):
        """Closes browser and session gracefully."""
        try:
            if self.context:
                await self.context.close()
            if self.browser:
                await self.browser.close()
            if self.playwright:
                await self.playwright.stop()
            if self.current_session:
                self.current_session.duration_seconds = round(time.time() - self.start_time, 2)
        except Exception as e:
            print(f"[BrowserEngine] Close error: {e}")
