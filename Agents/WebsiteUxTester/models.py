from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class TestTier(str, Enum):
    QUICK = "quick"              # 1-2 pages, basic navigation & landing page
    STANDARD = "standard"        # Menus, signup/contact forms, responsive check
    COMPREHENSIVE = "comprehensive"  # Full flow: menus, forms, checkout flow, dead-end discovery


class Severity(str, Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class ErrorCategory(str, Enum):
    DEAD_END = "DEAD_END"
    FORM_VALIDATION_ERROR = "FORM_VALIDATION_ERROR"
    BROKEN_LINK = "BROKEN_LINK"
    CHECKOUT_FRICTION = "CHECKOUT_FRICTION"
    CONFUSING_NAVIGATION = "CONFUSING_NAVIGATION"
    TIMEOUT = "TIMEOUT"
    RAGE_CLICK = "RAGE_CLICK"


class UxTestInput(BaseModel):
    target_url: str = Field(..., description="Target website URL to test (e.g., https://example.com)")
    tier: TestTier = Field(default=TestTier.STANDARD, description="Workload package: quick, standard, comprehensive")
    test_navigation: bool = Field(default=True, description="Whether to explore and test header/footer menus")
    test_forms: bool = Field(default=True, description="Whether to test signup, contact, and newsletter forms")
    test_checkout: bool = Field(default=True, description="Whether to test add-to-cart and checkout flows safely")
    safe_mode: bool = Field(default=True, description="Prevent real payment transactions or destructive actions")
    custom_journeys: Optional[List[str]] = Field(default=None, description="Optional custom user journey instructions")
    session_id: Optional[str] = Field(default=None, description="Marketplace buyer session ID for tracking")


class UserJourneyStep(BaseModel):
    step_index: int
    action: str = Field(..., description="Action performed: navigate, click, fill, wait, observe")
    target: str = Field(..., description="Target element selector or description")
    current_url: str
    status: str = Field(default="succeeded", description="succeeded, warning, failed")
    details: Optional[str] = None
    screenshot_url: Optional[str] = None
    duration_ms: int = 0


class UserJourneyResult(BaseModel):
    journey_name: str
    goal: str
    passed: bool
    steps: List[UserJourneyStep] = Field(default_factory=list)
    failure_reason: Optional[str] = None
    error_category: Optional[ErrorCategory] = None
    dead_end_encountered: bool = False
    friction_score: int = Field(default=0, description="0 (frictionless) to 100 (unusable)")


class UxRecommendation(BaseModel):
    id: str
    title: str
    severity: Severity
    category: str = Field(..., description="Navigation, Forms, Checkout, Mobile, Performance")
    issue_description: str
    impact: str
    recommended_fix: str
    affected_url: str


class ReplaySession(BaseModel):
    session_id: str
    browserbase_session_id: Optional[str] = None
    live_view_url: Optional[str] = None
    replay_url: Optional[str] = None
    browser_type: str = "Chromium Cloud"
    duration_seconds: float = 0.0


class UxTestReport(BaseModel):
    target_url: str
    overall_score: int = Field(..., description="0-100 overall UX & conversion health score")
    total_journeys_tested: int
    journeys_passed: int
    journeys_failed: int
    failed_user_journeys: List[UserJourneyResult] = Field(default_factory=list)
    passed_user_journeys: List[UserJourneyResult] = Field(default_factory=list)
    screenshots: List[Dict[str, str]] = Field(default_factory=list, description="Visual evidence of states/errors")
    replayable_browser_sessions: List[ReplaySession] = Field(default_factory=list)
    ux_recommendations: List[UxRecommendation] = Field(default_factory=list)
    telemetry: Dict[str, Any] = Field(default_factory=dict)
