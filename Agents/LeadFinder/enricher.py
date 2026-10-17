from __future__ import annotations

import asyncio
import logging
from typing import List, Optional
from urllib.parse import urlparse
import httpx
from pydantic import BaseModel, Field
from pydantic_ai import Agent

from models import LeadItem

logger = logging.getLogger("LeadFinder.Enricher")

FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape"


class ExtractedContactData(BaseModel):
    """Tolerant, flexible contact data parsed from scraped website."""
    email: Optional[str] = Field(default=None, description="Contact email if found.")
    phone: Optional[str] = Field(default=None, description="Contact phone if found.")
    contact_name: Optional[str] = Field(default=None, description="Owner, founder, or key contact.")
    social_links: List[str] = Field(default_factory=list, description="Social profile URLs.")


# Fast, cost-efficient nano extractor
markdown_extractor = Agent(
    "openai:gpt-4.1-nano",
    output_type=ExtractedContactData,
    system_prompt="""Extract public contact details from the provided website markdown.
Extract any public email, phone, owner/manager name, or social profile links.
Return clean data, leave fields None if not found.
"""
)


def is_scrapeable_website(url: str) -> bool:
    """Checks if URL is a valid external website."""
    if not url or not url.startswith("http"):
        return False
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    if "google.com" in domain or "maps.google" in domain or "goo.gl" in domain:
        return False
    return True


async def scrape_site_firecrawl(
    url: str,
    api_key: str,
    http_client: httpx.AsyncClient,
    max_chars: int = 3000,
) -> str:
    """Calls Firecrawl v1 scrape endpoint with a generous, resilient timeout."""
    if not api_key:
        return ""

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "url": url,
        "formats": ["markdown"],
        "onlyMainContent": True,
    }

    try:
        response = await http_client.post(FIRECRAWL_SCRAPE_URL, headers=headers, json=payload, timeout=15.0)
        if response.status_code == 200:
            data = response.json()
            markdown = data.get("data", {}).get("markdown") or data.get("markdown") or ""
            return markdown[:max_chars]
        else:
            return ""
    except Exception as e:
        logger.warning(f"Firecrawl scrape failed for {url}: {e}")
        return ""


async def enrich_single_lead(
    lead: LeadItem,
    firecrawl_key: str,
    http_client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
) -> LeadItem:
    """Enriches a single lead without breaking if scraping fails."""
    if not is_scrapeable_website(lead.primary_url):
        return lead

    # If it already has email and contact_name, keep as is
    if lead.email and lead.contact_name:
        return lead

    async with semaphore:
        try:
            markdown = await scrape_site_firecrawl(lead.primary_url, firecrawl_key, http_client)
            if markdown and len(markdown.strip()) > 40:
                prompt = f"Extract public contact info for {lead.title} from this page markdown:\n\n{markdown}"
                result = await markdown_extractor.run(prompt)
                data: ExtractedContactData = result.output

                if not lead.email and data.email:
                    lead.email = data.email
                if not lead.phone and data.phone:
                    lead.phone = data.phone
                if not lead.contact_name and data.contact_name:
                    lead.contact_name = data.contact_name
                if data.social_links:
                    for link in data.social_links:
                        if link not in lead.social_links:
                            lead.social_links.append(link)
        except Exception as e:
            logger.warning(f"Resilient fallback: skipping scrape for {lead.title} ({e})")

    return lead


async def enrich_leads_batch(
    leads: List[LeadItem],
    firecrawl_key: str,
    max_concurrency: int = 4,
) -> List[LeadItem]:
    """Runs resilient concurrent scraping bounded by asyncio.Semaphore."""
    if not firecrawl_key:
        return leads

    candidates = [l for l in leads if is_scrapeable_website(l.primary_url) and not (l.email and l.contact_name)]
    if not candidates:
        return leads

    print(f"\n[*] Firecrawl Deep Scraping: Enriching {len(candidates)} websites (Concurrency: {max_concurrency})...", flush=True)

    semaphore = asyncio.Semaphore(max_concurrency)
    async with httpx.AsyncClient(timeout=20.0) as http_client:
        tasks = [
            enrich_single_lead(lead, firecrawl_key, http_client, semaphore)
            for lead in leads
        ]
        enriched_leads = await asyncio.gather(*tasks, return_exceptions=True)

    # Filter out any unexpected exceptions
    final_leads: List[LeadItem] = []
    for item in enriched_leads:
        if isinstance(item, LeadItem):
            final_leads.append(item)

    return final_leads if len(final_leads) == len(leads) else leads
