"""Result schemas for the competitor analysis.

Every field has a default: the crew is prompted for exact JSON, but a missing
key should degrade to an empty answer, never crash the run.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class IdeaValidation(BaseModel):
    """Stage 1 — is this idea worth researching at all?"""

    refined_idea: str = ""
    category: str = ""
    target_audience: str = ""
    problem_solved: str = ""
    demand_signals: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    search_queries: list[str] = Field(default_factory=list)
    novelty_score: int = 0
    feasibility_score: int = 0
    verdict: str = "unclear"  # promising | crowded-but-viable | saturated | unclear
    summary: str = ""


class ScoutCandidate(BaseModel):
    """Stage 2 — raw shortlist entry before deep research."""

    name: str = ""
    website: str = ""
    one_liner: str = ""
    source_url: str = ""


class ScoutResult(BaseModel):
    competitors: list[ScoutCandidate] = Field(default_factory=list)
    notes: str = ""


class Competitor(BaseModel):
    """Stage 3 — what this competitor does and how."""

    name: str = ""
    website: str = ""
    one_liner: str = ""
    what_they_do: str = ""
    how_they_do_it: str = ""
    pricing_model: str = ""
    target_users: str = ""
    threat_level: str = "medium"  # low | medium | high
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)


class AnalystResult(BaseModel):
    competitors: list[Competitor] = Field(default_factory=list)
    notes: str = ""


class MarketGap(BaseModel):
    gap: str = ""
    how_to_capitalize: str = ""


class Verdict(BaseModel):
    """Stage 4 — head-to-head comparison and recommendation."""

    overall_score: int = 0
    recommendation: str = "no-go"  # go | pivot | niche | no-go
    summary: str = ""
    gaps: list[MarketGap] = Field(default_factory=list)
    differentiators: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)


class AnalysisResult(BaseModel):
    """The full persisted payload for one idea analysis."""

    idea: str = ""
    audience: str = ""
    model: str = ""
    search_provider: str = "none"
    validation: IdeaValidation = Field(default_factory=IdeaValidation)
    competitors: list[Competitor] = Field(default_factory=list)
    verdict: Verdict = Field(default_factory=Verdict)
    warnings: list[str] = Field(default_factory=list)
