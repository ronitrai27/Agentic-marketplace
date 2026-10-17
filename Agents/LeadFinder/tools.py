from __future__ import annotations

import logging
from typing import Any, Dict, List
import httpx

logger = logging.getLogger("LeadFinder.Tools")

SERPAPI_URL = "https://serpapi.com/search"


async def search_google_maps(
    query: str,
    api_key: str,
    start: int = 0,
    client: httpx.AsyncClient | None = None,
) -> Dict[str, Any]:
    """
    Search places and businesses using SerpAPI's Google Maps engine (engine=google_maps).
    Returns rich local business data (names, websites, addresses, phones, ratings).
    """
    params = {
        "engine": "google_maps",
        "q": query,
        "start": start,
        "api_key": api_key,
    }
    
    close_client = False
    if client is None:
        client = httpx.AsyncClient(timeout=30.0)
        close_client = True

    try:
        response = await client.get(SERPAPI_URL, params=params)
        response.raise_for_status()
        data = response.json()
        
        raw_results = data.get("local_results", [])
        formatted_places: List[Dict[str, Any]] = []

        for place in raw_results[:10]:
            ext_website = place.get("website")
            maps_link = place.get("link") or place.get("place_id_search")
            formatted_places.append({
                "title": place.get("title"),
                "has_website": bool(ext_website),
                "primary_url": ext_website or maps_link,
                "phone": place.get("phone"),
                "address": place.get("address"),
                "rating": place.get("rating"),
            })

        return {
            "engine": "google_maps",
            "query": query,
            "start": start,
            "count": len(formatted_places),
            "results": formatted_places,
        }
    except Exception as e:
        logger.error(f"Error executing Google Maps search for '{query}': {e}")
        return {"engine": "google_maps", "query": query, "error": str(e), "results": []}
    finally:
        if close_client:
            await client.aclose()


async def search_google_web(
    query: str,
    api_key: str,
    start: int = 0,
    client: httpx.AsyncClient | None = None,
) -> Dict[str, Any]:
    """
    Standard Google Web search using SerpAPI (engine=google).
    Useful for finding company websites, directories, and articles.
    """
    params = {
        "engine": "google",
        "q": query,
        "start": start,
        "api_key": api_key,
    }
    
    close_client = False
    if client is None:
        client = httpx.AsyncClient(timeout=30.0)
        close_client = True

    try:
        response = await client.get(SERPAPI_URL, params=params)
        response.raise_for_status()
        data = response.json()
        
        raw_results = data.get("organic_results", [])
        formatted_results: List[Dict[str, Any]] = []

        for item in raw_results[:8]:
            formatted_results.append({
                "title": item.get("title"),
                "link": item.get("link"),
                "snippet": (item.get("snippet") or "")[:120],
            })

        return {
            "engine": "google",
            "query": query,
            "start": start,
            "count": len(formatted_results),
            "results": formatted_results,
        }
    except Exception as e:
        logger.error(f"Error executing Google Web search for '{query}': {e}")
        return {"engine": "google", "query": query, "error": str(e), "results": []}
    finally:
        if close_client:
            await client.aclose()
