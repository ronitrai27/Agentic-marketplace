"""Unit tests for the TinyFish MCP client — protocol parsing only, no network."""

import json

import pytest

from crew import tinyfish
from crew.tinyfish import TinyFishError, parse_payload


def test_parse_plain_json():
    assert parse_payload('{"a": 1}') == {"a": 1}


def test_parse_sse_stream():
    body = (
        "event: message\n"
        'data: {"jsonrpc": "2.0", "id": 1, "result": {"ok": true}}\n'
        "\n"
    )
    assert parse_payload(body) == {"jsonrpc": "2.0", "id": 1, "result": {"ok": True}}


def test_parse_ignores_non_data_sse_lines():
    body = "event: ping\n: keepalive\ndata: {\"x\": 1}\n"
    assert parse_payload(body) == {"x": 1}


def test_parse_empty_raises():
    with pytest.raises(TinyFishError):
        parse_payload("   ")


def test_parse_garbage_raises():
    with pytest.raises(TinyFishError):
        parse_payload("not a payload at all")


def test_search_shapes_result(monkeypatch):
    """The MCP text block becomes {title,url,site,snippet} and respects the cap."""
    payload = {
        "results": [
            {
                "title": f"Rival {i}",
                "url": f"https://rival{i}.example",
                "snippet": "does things",
                "site_name": "rival.example",
                "extra_field": "ignored",
            }
            for i in range(10)
        ]
    }

    class FakeClient:
        def call_tool(self, name, arguments):
            assert name == "search"
            assert arguments == {"query": "cold email tools"}
            return json.dumps(payload)

    monkeypatch.setattr(tinyfish, "client", lambda: FakeClient())

    result = tinyfish.search("cold email tools", max_results=3)
    assert result["ok"] is True
    assert result["error"] is None
    assert len(result["results"]) == 3
    assert result["results"][0] == {
        "title": "Rival 0",
        "url": "https://rival0.example",
        "snippet": "does things",
        "site": "rival.example",
    }


def test_search_failure_is_soft(monkeypatch):
    """A TinyFish outage must not kill the run — it degrades to a message."""

    class FakeClient:
        def call_tool(self, name, arguments):
            raise tinyfish.TinyFishError("HTTP 500 from TinyFish")

    monkeypatch.setattr(tinyfish, "client", lambda: FakeClient())

    result = tinyfish.search("anything")
    assert result["ok"] is False
    assert result["results"] == []
    assert "500" in result["error"]


def test_fetch_truncates_and_flags_failure(monkeypatch):
    class OkClient:
        def call_tool(self, name, arguments):
            assert name == "fetch_content"
            assert arguments["urls"] == ["https://x.example"]
            assert arguments["format"] == "markdown"
            return "x" * 10_000

    monkeypatch.setattr(tinyfish, "client", lambda: OkClient())
    ok = tinyfish.fetch("https://x.example")
    assert ok["ok"] is True
    assert len(ok["text"]) == tinyfish.MAX_FETCH_CHARS

    class BadClient:
        def call_tool(self, name, arguments):
            raise tinyfish.TinyFishError("timeout")

    monkeypatch.setattr(tinyfish, "client", lambda: BadClient())
    bad = tinyfish.fetch("https://x.example")
    assert bad["ok"] is False
    assert bad["text"] == ""


def test_session_lost_detection():
    client = tinyfish.TinyFishClient(api_key="sk-tinyfish-test", url="https://example.test/mcp")
    assert client._session_lost({}, 404) is True
    assert client._session_lost({"error": {"message": "session not found"}}, 200) is True
    assert client._session_lost({"error": {"message": "Session expired"}}, 200) is True
    assert client._session_lost({"error": {"message": "bad query"}}, 200) is False
    assert client._session_lost({}, 200) is False
    client.close()


def test_ensure_session_does_not_deadlock(monkeypatch):
    """Regression: _ensure_session holds the lock while calling _bump().

    With a plain Lock that deadlocks the first search of every run.
    """
    import threading

    client = tinyfish.TinyFishClient(api_key="sk-tinyfish-test", url="https://example.test/mcp")
    methods: list[str] = []

    class FakeHTTP:
        def post(self, url, json=None, headers=None):
            methods.append(json.get("method", ""))
            response = type("R", (), {"headers": {}, "status_code": 200, "text": "{}"})()
            return response

        def close(self):
            pass

    def fake_post(payload):
        methods.append(payload["method"])
        if payload["method"] == "initialize":
            client._session_id = "sess-1"
        return {}

    monkeypatch.setattr(client, "_post", fake_post)
    monkeypatch.setattr(client, "_http", FakeHTTP())

    worker = threading.Thread(target=client._ensure_session, daemon=True)
    worker.start()
    worker.join(timeout=5)

    assert not worker.is_alive(), "_ensure_session deadlocked on its own lock"
    assert client._session_id == "sess-1"
    assert methods == ["initialize", "notifications/initialized"]
    client.close()


def test_client_requires_a_key(monkeypatch):
    monkeypatch.delenv("TINYFISH_API_KEY", raising=False)
    monkeypatch.setattr(tinyfish, "cli_api_key", lambda: "")
    with pytest.raises(TinyFishError):
        tinyfish.TinyFishClient(url="https://example.test/mcp")


def test_key_falls_back_to_cli_config(monkeypatch):
    monkeypatch.delenv("TINYFISH_API_KEY", raising=False)
    monkeypatch.setattr(tinyfish, "cli_api_key", lambda: "sk-tinyfish-from-cli")
    assert tinyfish.resolve_api_key() == "sk-tinyfish-from-cli"
    assert tinyfish.is_configured() is True

    monkeypatch.setenv("TINYFISH_API_KEY", "sk-tinyfish-from-env")
    assert tinyfish.resolve_api_key() == "sk-tinyfish-from-env"
