"""Web tools for the crew, backed by TinyFish MCP.

Two tools reach the agents:

* ``web_search`` — find competitors, market signal, pricing, comparisons
* ``fetch_webpage`` — read one competitor's actual product/pricing page, so the
  analyst describes what they *really* ship instead of repeating a snippet

Every call is audited into the ``search_queries`` table via the logger the API
layer registers. If TinyFish has no key, the tools say so and the crew falls
back to model knowledge rather than dying mid-run.
"""

from __future__ import annotations

import json
import os
from contextvars import ContextVar
from typing import Callable

try:
    from crewai.tools import tool
except ImportError as exc:  # pragma: no cover - dependency problem, not logic
    raise SystemExit(
        "crewai is not installed. Run: pip install -r requirements.txt"
    ) from exc

from . import tinyfish
from .schemas import Competitor

# Set once at startup by the API layer; the run id travels through a ContextVar
# so concurrent analyses never attribute searches to each other.
SearchLogger = Callable[[str | None, str, str, int, bool, str | None], None]
_search_logger: SearchLogger | None = None
_run_id: ContextVar[str | None] = ContextVar("competitor_run_id", default=None)


def set_search_logger(logger: SearchLogger | None) -> None:
    """Register a callback: (run_id, query, provider, count, ok, error)."""
    global _search_logger
    _search_logger = logger


def set_run_id(run_id: str | None) -> None:
    """Bind the current thread/context to one analysis id."""
    _run_id.set(run_id)


def _log(query: str, count: int, ok: bool, error: str | None) -> None:
    if _search_logger:
        try:
            _search_logger(_run_id.get(), query, PROVIDER, count, ok, error)
        except Exception:
            pass  # auditing must never break a run


PROVIDER = "tinyfish"


def provider_name() -> str:
    return PROVIDER if tinyfish.is_configured() else "none"


def is_configured() -> bool:
    """True when a TinyFish API key is available."""
    return tinyfish.is_configured()


@tool("web_search")
def web_search(query: str) -> str:
    """Search the live web and return JSON results.

    Use this for anything about the current market: existing products,
    competitors, pricing, funding, positioning, reviews, comparisons. Input is
    a normal search query string; output is a JSON list of
    [{"title": ..., "url": ..., "site": ..., "snippet": ...}] (max 6).
    """

    if not query or not query.strip():
        return json.dumps({"error": "empty query"})

    payload = tinyfish.search(query.strip(), purpose="Competitor and market research")
    _log(query.strip(), len(payload["results"]), payload["ok"], payload["error"])

    if not payload["ok"]:
        return json.dumps(
            {
                "search_unavailable": True,
                "provider": PROVIDER,
                "error": payload["error"],
                "hint": "Continue from your own knowledge, and say in your answer "
                "that live search was unavailable.",
            }
        )

    results = payload["results"]
    if not results:
        return json.dumps(
            {"results": [], "note": f"no results for {query!r} — try a different phrasing"}
        )

    trimmed = [
        {
            "title": r["title"][:160],
            "url": r["url"][:300],
            "site": r["site"][:80],
            "snippet": r["snippet"][:400],
        }
        for r in results[: tinyfish.MAX_RESULTS]
    ]
    return json.dumps(trimmed, ensure_ascii=False)


@tool("fetch_webpage")
def fetch_webpage(url: str) -> str:
    """Read one webpage and return its readable text (markdown).

    Use this to confirm details about a competitor you already found: their
    product page, pricing page, docs, or a review. Input is a single URL.
    Returns the page text, truncated for context. Do not use this to *find*
    pages — use web_search for that.
    """
    if not url or not url.strip().lower().startswith(("http://", "https://")):
        return json.dumps({"error": "url must start with http:// or https://"})

    payload = tinyfish.fetch(url.strip(), purpose="Read competitor product or pricing details")
    _log(f"fetch {url.strip()}", 1 if payload["ok"] else 0, payload["ok"], payload["error"])

    if not payload["ok"]:
        return json.dumps(
            {
                "fetch_unavailable": True,
                "provider": PROVIDER,
                "url": url.strip(),
                "error": payload["error"],
                "hint": "Answer from web_search snippets or your own knowledge instead.",
            }
        )

    return json.dumps({"url": url.strip(), "content": payload["text"]}, ensure_ascii=False)


def competitor_queries(competitors: list[Competitor], max_queries: int = 10) -> list[str]:
    """Search phrases the analyst runs per competitor."""
    queries: list[str] = []
    for rival in competitors:
        name = rival.name.strip()
        if not name:
            continue
        queries.extend([f"{name} product features", f"{name} pricing plan"])
    return queries[:max_queries]
