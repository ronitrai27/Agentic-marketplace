"""TinyFish MCP client — the Competitor Agent's live web access.

Talks JSON-RPC to the TinyFish MCP server over streamable HTTP, using the same
``X-API-Key`` header the TinyFish CLI registers with your coding agents. Two
tools matter here: ``search`` (find competitors, market signal) and
``fetch_content`` (read a competitor's actual product/pricing page).

No CrewAI imports on purpose — the API layer can check whether TinyFish is
configured without paying LiteLLM's import cost.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger("competitor.tinyfish")

DEFAULT_MCP_URL = "https://agent.tinyfish.ai/mcp"
CLI_CONFIG_PATH = Path.home() / ".tinyfish" / "config.json"

PROTOCOL_VERSION = "2025-06-18"
CLIENT_INFO = {"name": "competitor-agent", "version": "1.0.0"}


class TinyFishError(RuntimeError):
    """Any transport / protocol / tool-level failure."""


# ─────────────────────────── credentials ───────────────────────────

def cli_api_key() -> str:
    """Key stored by `tinyfish connect` — lets the agent work with zero config."""
    try:
        data = json.loads(CLI_CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ""
    key = data.get("api_key")
    return key.strip() if isinstance(key, str) else ""


def resolve_api_key() -> str:
    """TINYFISH_API_KEY wins; otherwise fall back to the TinyFish CLI config."""
    return os.getenv("TINYFISH_API_KEY", "").strip() or cli_api_key()


def mcp_url() -> str:
    return os.getenv("TINYFISH_MCP_URL", "").strip() or DEFAULT_MCP_URL


def is_configured() -> bool:
    return bool(resolve_api_key())


# ─────────────────────────── protocol ───────────────────────────

def parse_payload(text: str) -> dict:
    """Parse an MCP streamable-HTTP body: either plain JSON or an SSE stream."""
    stripped = (text or "").strip()
    if not stripped:
        raise TinyFishError("empty response from TinyFish")
    if stripped.startswith("{"):
        return json.loads(stripped)
    for line in stripped.splitlines():
        if line.startswith("data:"):
            return json.loads(line[5:].strip())
    raise TinyFishError(f"unrecognised TinyFish response: {stripped[:200]!r}")


class TinyFishClient:
    """Minimal MCP client: initialize once, then tools/call.

    Sessions are cached per instance and re-created once if the server drops
    one — the MCP spec lets a server expire an idle session at any time.
    """

    def __init__(
        self,
        url: str | None = None,
        api_key: str | None = None,
        timeout: float = 45.0,
    ) -> None:
        self._url = url or mcp_url()
        key = api_key if api_key is not None else resolve_api_key()
        if not key:
            raise TinyFishError(
                "No TinyFish API key. Set TINYFISH_API_KEY in .env, or run "
                "`npx @tiny-fish/cli connect` so the key is stored for you."
            )
        self._http = httpx.Client(
            timeout=timeout,
            follow_redirects=True,
            headers={
                "X-API-Key": key,
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
            },
        )
        # RLock, not Lock: _ensure_session() holds it while calling _bump().
        self._lock = threading.RLock()
        self._session_id: str | None = None
        self._next_id = 0

    # ── plumbing ──

    def _post(self, payload: dict) -> dict:
        headers = {"mcp-session-id": self._session_id} if self._session_id else {}
        try:
            response = self._http.post(self._url, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            raise TinyFishError(f"network error: {exc}") from exc

        session = response.headers.get("mcp-session-id")
        if session:
            self._session_id = session

        if response.status_code >= 400:
            raise TinyFishError(f"HTTP {response.status_code} from TinyFish")
        return parse_payload(response.text)

    def _ensure_session(self) -> None:
        if self._session_id:
            return
        with self._lock:
            if self._session_id:
                return
            self._post(
                {
                    "jsonrpc": "2.0",
                    "id": self._bump(),
                    "method": "initialize",
                    "params": {
                        "protocolVersion": PROTOCOL_VERSION,
                        "capabilities": {},
                        "clientInfo": CLIENT_INFO,
                    },
                }
            )
            # Notification: no id, and the server may not reply with a body.
            headers = {"mcp-session-id": self._session_id} if self._session_id else {}
            try:
                self._http.post(
                    self._url,
                    json={"jsonrpc": "2.0", "method": "notifications/initialized"},
                    headers=headers,
                )
            except httpx.HTTPError:
                pass  # already initialised far enough to try a tool call

    def _bump(self) -> int:
        with self._lock:
            self._next_id += 1
            return self._next_id

    def _session_lost(self, payload: dict, status: int) -> bool:
        if status == 404:
            return True
        error = payload.get("error") or {}
        message = str(error.get("message", "")).lower()
        return "session" in message and ("not found" in message or "expired" in message)

    # ── public ──

    def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        """Call one MCP tool and return the text of its first content block."""
        for attempt in (1, 2):
            self._ensure_session()
            try:
                payload = self._post(
                    {
                        "jsonrpc": "2.0",
                        "id": self._bump(),
                        "method": "tools/call",
                        "params": {"name": name, "arguments": arguments},
                    }
                )
            except TinyFishError as exc:
                if attempt == 1:
                    logger.debug("retrying %s after transport error: %s", name, exc)
                    self._session_id = None
                    continue
                raise

            error = payload.get("error")
            if error:
                message = str(error.get("message", "unknown error"))
                if attempt == 1 and self._session_lost(payload, 200):
                    self._session_id = None
                    continue
                raise TinyFishError(f"{name} failed: {message}")

            result = payload.get("result") or {}
            if result.get("isError"):
                text = _block_text(result)
                raise TinyFishError(f"{name} returned an error: {text[:300]}")
            return _block_text(result)

        raise TinyFishError(f"{name} failed after retry")  # pragma: no cover

    def close(self) -> None:
        self._http.close()


def _block_text(result: dict) -> str:
    """Join the text content blocks of an MCP tool result."""
    blocks = result.get("content") or []
    parts = [block.get("text", "") for block in blocks if block.get("type") == "text"]
    if parts:
        return "\n".join(parts)
    structured = result.get("structuredContent")
    return json.dumps(structured, ensure_ascii=False) if structured else ""


# ─────────────────────────── tools the crew uses ───────────────────────────

MAX_RESULTS = int(os.getenv("MAX_SEARCH_RESULTS", "6"))
MAX_FETCH_CHARS = int(os.getenv("MAX_FETCH_CHARS", "6000"))

_client: TinyFishClient | None = None
_client_lock = threading.Lock()


def client() -> TinyFishClient:
    """Process-wide client so the MCP session is initialised once, not per search."""
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                _client = TinyFishClient()
    return _client


def search(query: str, purpose: str | None = None, max_results: int | None = None) -> dict[str, Any]:
    """Run one TinyFish search. Returns ``{ok, results, error}``."""
    count = max_results or MAX_RESULTS
    arguments: dict[str, Any] = {"query": query}
    if purpose:
        arguments["purpose"] = purpose
    try:
        text = client().call_tool("search", arguments)
        payload = json.loads(text)
        raw = payload.get("results") or []
        results = [
            {
                "title": str(item.get("title", "")),
                "url": str(item.get("url", "")),
                "snippet": str(item.get("snippet", "")),
                "site": str(item.get("site_name", "")),
            }
            for item in raw[:count]
        ]
        return {"ok": True, "results": results, "error": None}
    except (TinyFishError, ValueError) as exc:
        logger.warning("search failed for %r: %s", query, exc)
        return {"ok": False, "results": [], "error": str(exc)[:400]}


def fetch(url: str, purpose: str | None = None) -> dict[str, Any]:
    """Fetch one page's readable content. Returns ``{ok, text, error}``."""
    arguments: dict[str, Any] = {
        "urls": [url],
        "format": "markdown",
        "links": False,
        "image_links": False,
        "iframe_links": False,
        "page_metadata": False,
        "per_url_timeout_ms": 45000,
    }
    if purpose:
        arguments["purpose"] = purpose
    try:
        text = client().call_tool("fetch_content", arguments)
        return {"ok": True, "text": text[:MAX_FETCH_CHARS], "error": None}
    except TinyFishError as exc:
        logger.warning("fetch failed for %r: %s", url, exc)
        return {"ok": False, "text": "", "error": str(exc)[:400]}
