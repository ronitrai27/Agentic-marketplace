from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class UniversalLeadSpec(BaseModel):
    """
    Dynamically planned specification extracted from ANY user prompt.
    Zero hardcoding.
    """
    target_count: int = Field(default=10, description="Number of leads requested by user")
    entity_description: str = Field(description="Description of what is being searched for")
    required_fields: List[str] = Field(
        description="Exact fields/columns the user wants extracted (e.g. ['company_name', 'website', 'careers_page', 'employee_range'])"
    )
    constraints: List[str] = Field(
        default_factory=list,
        description="Every condition, filter, and negative/positive rule the Critic must strictly verify"
    )
    preferred_engine: str = Field(
        default="google",
        description="'google_maps' for local/city physical venues, 'google' for companies, startups, SaaS, digital, funds"
    )
    initial_search_queries: List[str] = Field(
        default_factory=list,
        description="Initial search query strings tailored to find these entities"
    )


class UniversalLead(BaseModel):
    """
    A single lead containing dynamic fields matching exactly what the user asked for.
    """
    data: Dict[str, Any] = Field(
        description="Key-value pairs matching exactly the user's required fields"
    )
    source_url: str = Field(
        default="",
        description="Primary evidence or source URL where this entity was found/verified"
    )
    critic_verdict: str = Field(
        default="",
        description="Explanation from the Critic confirming why this lead satisfies all user constraints"
    )


class UniversalLeadReport(BaseModel):
    """Final aggregated report containing dynamic leads and telemetry."""
    user_prompt: str
    target_count: int
    total_found: int
    required_fields: List[str]
    constraints_enforced: List[str]
    rounds_executed: int
    stopped_reason: str
    leads: List[UniversalLead]
    jev_telemetry: Optional[Dict[str, Any]] = None
