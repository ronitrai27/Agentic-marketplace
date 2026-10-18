from __future__ import annotations

import logging
import re
from typing import Any, Dict, List
import httpx

logger = logging.getLogger("LeadFinder.Tools")

SERPAPI_URL = "https://serpapi.com/search"


async def search_google_web(
    query: str,
    api_key: str,
    start: int = 0,
    client: httpx.AsyncClient | None = None,
) -> Dict[str, Any]:
    """
    Standard Google Web search using SerpAPI.
    Supports search operators (e.g. site:linkedin.com, "careers", inurl:about).
    """
    params = {
        "engine": "google",
        "q": query,
        "start": start,
        "api_key": api_key,
    }

    close_client = False
    if client is None:
        client = httpx.AsyncClient(timeout=25.0)
        close_client = True

    try:
        response = await client.get(SERPAPI_URL, params=params)
        response.raise_for_status()
        data = response.json()

        raw_results = data.get("organic_results", [])
        formatted: List[Dict[str, Any]] = []

        for item in raw_results[:12]:
            snippet_text = item.get("snippet") or item.get("description") or ""
            formatted.append({
                "title": item.get("title", ""),
                "link": item.get("link", ""),
                "snippet": snippet_text[:500],
            })

        return {
            "engine": "google_web",
            "query": query,
            "count": len(formatted),
            "results": formatted,
        }
    except Exception as e:
        logger.error(f"Google Web search error for '{query}': {e}")
        return {"engine": "google_web", "query": query, "error": str(e), "results": []}
    finally:
        if close_client:
            await client.aclose()


async def search_google_maps(
    query: str,
    api_key: str,
    client: httpx.AsyncClient | None = None,
) -> Dict[str, Any]:
    """
    Google Maps place search using SerpAPI.
    Best for local physical venues, clinics, local stores, contractors.
    """
    params = {
        "engine": "google_maps",
        "q": query,
        "api_key": api_key,
    }

    close_client = False
    if client is None:
        client = httpx.AsyncClient(timeout=25.0)
        close_client = True

    try:
        response = await client.get(SERPAPI_URL, params=params)
        response.raise_for_status()
        data = response.json()

        raw_results = data.get("local_results", [])
        formatted: List[Dict[str, Any]] = []

        for place in raw_results[:12]:
            ext_web = place.get("website")
            maps_link = place.get("link") or place.get("place_id_search")
            formatted.append({
                "title": place.get("title", ""),
                "has_website": bool(ext_web),
                "website": ext_web,
                "maps_url": maps_link,
                "primary_url": ext_web or maps_link,
                "phone": place.get("phone"),
                "address": place.get("address"),
                "rating": place.get("rating"),
                "reviews_count": place.get("reviews"),
            })

        return {
            "engine": "google_maps",
            "query": query,
            "count": len(formatted),
            "results": formatted,
        }
    except Exception as e:
        logger.error(f"Google Maps search error for '{query}': {e}")
        return {"engine": "google_maps", "query": query, "error": str(e), "results": []}
    finally:
        if close_client:
            await client.aclose()


async def fetch_page_snippet(
    url: str,
    client: httpx.AsyncClient | None = None,
    max_chars: int = 1500,
) -> str:
    """
    Lightweight, fast direct page fetcher.
    Extracts text snippet from a company's website, /careers, /about, or /contact.
    Capped at max_chars to keep token consumption and latency minimal.
    """
    if not url or not url.startswith("http"):
        return ""

    close_client = False
    if client is None:
        client = httpx.AsyncClient(timeout=8.0, follow_redirects=True)
        close_client = True

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }

    try:
        response = await client.get(url, headers=headers)
        if response.status_code == 200:
            html = response.text
            # Basic tag stripping to clean text
            clean_text = re.sub(r'<(script|style).*?</\1>', '', html, flags=re.DOTALL | re.IGNORECASE)
            clean_text = re.sub(r'<[^>]+>', ' ', clean_text)
            clean_text = re.sub(r'\s+', ' ', clean_text).strip()
            return clean_text[:max_chars]
        return ""
    except Exception as e:
        logger.debug(f"Page fetch skipped for {url}: {e}")
        return ""
    finally:
        if close_client:
            await client.aclose()
