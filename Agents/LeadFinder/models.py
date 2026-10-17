from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class LeadItem(BaseModel):
    """
    Domain-agnostic lead representation.
    Only title, primary_url, and match_reason are mandatory.
    All other contact/location fields and attributes are optional.
    """
    # Mandatory core fields
    title: str = Field(
        ...,
        description="Name of the company, business, shop, organization, or individual.",
    )
    primary_url: str = Field(
        ...,
        description="Official website URL, Google Maps place link, or canonical social profile.",
    )
    match_reason: str = Field(
        ...,
        description="Short 1-2 sentence evidence explaining why this lead matches the search criteria.",
    )

    # Optional contact & location fields
    contact_name: Optional[str] = Field(
        default=None,
        description="Key contact person, founder, or manager if identifiable.",
    )
    email: Optional[str] = Field(
        default=None,
        description="Contact email address if found in listing or site.",
    )
    phone: Optional[str] = Field(
        default=None,
        description="Contact phone number with area/country code.",
    )
    location: Optional[str] = Field(
        default=None,
        description="Physical address, city, neighborhood, or operational region.",
    )
    social_links: List[str] = Field(
        default_factory=list,
        description="Associated social profile URLs (Instagram, Facebook, LinkedIn, X).",
    )

    # Domain-agnostic flexible attributes
    attributes: Dict[str, Any] = Field(
        default_factory=dict,
        description="Domain-specific key-values (e.g. rating, reviews, price_level, open_hours, categories).",
    )


class BatchExtractionResult(BaseModel):
    """Structured output returned by the Pydantic AI agent on each iteration."""
    query_used: str = Field(
        ...,
        description="The query string and parameters used during this batch.",
    )
    leads: List[LeadItem] = Field(
        default_factory=list,
        description="List of verified leads extracted from search results in this batch.",
    )


class FinalLeadReport(BaseModel):
    """Aggregated final report returned to the caller."""
    search_criteria: str
    target_count: int
    total_found: int
    rounds_executed: int
    stopped_reason: str
    leads: List[LeadItem]
    jev_telemetry: Optional[Dict[str, Any]] = None
