from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, Optional

from starlette.applications import Starlette
from starlette.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from starlette.routing import Route
import uvicorn

from agent import UxConversionAuditor
from models import TestTier, UxTestInput, UxTestReport

START_TIME = time.time()
TASKS_STORE: Dict[str, Dict[str, Any]] = {}


def get_agent_manifest() -> Dict[str, Any]:
    """Returns the MAPS 1.0.0 protocol AgentManifest instance."""
    return {
        "id": "website-ux-and-conversion-tester",
        "name": "Website UX & Conversion Tester",
        "version": "1.0.0",
        "description": "Opens a website like a real visitor, tests navigation, forms, checkout flows, and identifies dead ends with Browserbase replays.",
        "protocol_version": "1.0.0",
        "capabilities": {
            "streaming": True,
            "delta_stream": True,
            "max_timeout_seconds": 600,
            "execution_modes": ["sync", "async"],
            "max_concurrency": 10
        },
        "pricing": {
            "model": "tiered_and_unit_metered",
            "tiers": {
                "quick": {"price_usd": 0.50, "description": "Landing page & basic navigation"},
                "standard": {"price_usd": 2.50, "description": "Menus, forms, conversion CTAs"},
                "comprehensive": {"price_usd": 5.00, "description": "Full site depth, checkout flows, multi-journey"}
            }
        },
        "input_schema": {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "required": ["target_url"],
            "properties": {
                "target_url": {
                    "type": "string",
                    "title": "Target Website URL",
                    "description": "The URL of the website to test (e.g. https://stripe.com)",
                    "format": "uri"
                },
                "tier": {
                    "type": "string",
                    "enum": ["quick", "standard", "comprehensive"],
                    "default": "standard",
                    "title": "Audit Tier"
                },
                "test_navigation": {
                    "type": "boolean",
                    "default": True,
                    "title": "Test Menus & Navigation"
                },
                "test_forms": {
                    "type": "boolean",
                    "default": True,
                    "title": "Test Signup & Contact Forms"
                },
                "test_checkout": {
                    "type": "boolean",
                    "default": True,
                    "title": "Test Checkout Flow (Safe Mode)"
                },
                "safe_mode": {
                    "type": "boolean",
                    "default": True,
                    "title": "Safe Test Environment Mode"
                }
            }
        },
        "output_schema": {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "required": ["overall_score", "failed_user_journeys", "ux_recommendations", "replayable_browser_sessions"],
            "properties": {
                "target_url": {"type": "string"},
                "overall_score": {"type": "integer", "minimum": 0, "maximum": 100},
                "total_journeys_tested": {"type": "integer"},
                "journeys_passed": {"type": "integer"},
                "journeys_failed": {"type": "integer"},
                "failed_user_journeys": {"type": "array"},
                "screenshots": {"type": "array"},
                "replayable_browser_sessions": {"type": "array"},
                "ux_recommendations": {"type": "array"}
            }
        }
    }


async def health_endpoint(request) -> JSONResponse:
    """MAPS Liveness & Protocol probe."""
    return JSONResponse({
        "status": "ready",
        "protocol_version": "1.0.0",
        "uptime_seconds": round(time.time() - START_TIME, 1),
        "environment_ready": True,
        "framework": "Google ADK (google.adk) + Browserbase + Playwright",
        "active_tasks": len(TASKS_STORE)
    })


async def schema_endpoint(request) -> JSONResponse:
    """MAPS AgentManifest endpoint."""
    return JSONResponse(get_agent_manifest())


async def execute_endpoint(request) -> Response:
    """MAPS Execute endpoint (handles both streaming SSE and JSON batch)."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"code": "INVALID_INPUT", "message": "Malformed JSON payload", "retryable": False}, status_code=400)

    run_id = request.headers.get("X-Marketplace-Run-Id") or body.get("run_id") or f"run_{uuid.uuid4().hex[:12]}"
    input_data = body.get("input", body)
    target_url = input_data.get("target_url")

    if not target_url:
        return JSONResponse({
            "code": "INVALID_INPUT",
            "message": "Field 'target_url' is required in input payload",
            "retryable": False
        }, status_code=400)

    tier_str = input_data.get("tier", "standard")
    tier = TestTier(tier_str.lower()) if tier_str in [t.value for t in TestTier] else TestTier.STANDARD

    test_input = UxTestInput(
        target_url=target_url,
        tier=tier,
        test_navigation=input_data.get("test_navigation", True),
        test_forms=input_data.get("test_forms", True),
        test_checkout=input_data.get("test_checkout", True),
        safe_mode=input_data.get("safe_mode", True),
        session_id=run_id
    )

    accept_header = request.headers.get("accept", "")
    is_streaming = "text/event-stream" in accept_header

    # Create task record
    TASKS_STORE[run_id] = {
        "run_id": run_id,
        "status": "working",
        "percent": 0,
        "message": "Initializing test session...",
        "created_at": time.time(),
        "report": None
    }

    if is_streaming:
        return StreamingResponse(
            stream_execution_events(run_id, test_input),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}
        )

    # Batch Execution
    auditor = UxConversionAuditor()
    report = await auditor.execute_audit(test_input)
    TASKS_STORE[run_id]["status"] = "completed"
    TASKS_STORE[run_id]["report"] = report.model_dump()

    return JSONResponse({
        "run_id": run_id,
        "status": "succeeded",
        "duration_ms": int(report.telemetry.get("duration_seconds", 0) * 1000),
        "output": report.model_dump(),
        "telemetry": report.telemetry
    })


async def stream_execution_events(run_id: str, test_input: UxTestInput) -> AsyncGenerator[str, None]:
    """Generates SSE events matching the Catelog MAPS protocol."""
    queue: asyncio.Queue = asyncio.Queue()

    # Initial start event
    await queue.put({
        "event": "run.started",
        "run_id": run_id,
        "timestamp": int(time.time() * 1000)
    })

    def on_progress(pct: int, msg: str):
        TASKS_STORE[run_id]["percent"] = pct
        TASKS_STORE[run_id]["message"] = msg
        queue.put_nowait({
            "event": "step.started",
            "run_id": run_id,
            "step_index": pct,
            "label": msg,
            "timestamp": int(time.time() * 1000)
        })

    async def run_worker():
        try:
            auditor = UxConversionAuditor()
            report: UxTestReport = await auditor.execute_audit(test_input, on_progress=on_progress)
            TASKS_STORE[run_id]["status"] = "completed"
            TASKS_STORE[run_id]["report"] = report.model_dump()

            await queue.put({
                "event": "run.succeeded",
                "run_id": run_id,
                "duration_ms": int(report.telemetry.get("duration_seconds", 0) * 1000),
                "output": report.model_dump(),
                "telemetry": report.telemetry
            })
        except Exception as e:
            TASKS_STORE[run_id]["status"] = "failed"
            await queue.put({
                "event": "run.failed",
                "run_id": run_id,
                "duration_ms": 1000,
                "error": {
                    "code": "INTERNAL_CRASH",
                    "message": str(e),
                    "retryable": False
                }
            })

    worker_task = asyncio.create_task(run_worker())

    while True:
        try:
            event = await asyncio.wait_for(queue.get(), timeout=15.0)
            yield f"event: {event.get('event')}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
            if event.get("event") in ("run.succeeded", "run.failed"):
                break
        except asyncio.TimeoutError:
            # MAPS required heartbeat every 15s
            yield f"event: heartbeat\ndata: {json.dumps({'event': 'heartbeat', 'timestamp': int(time.time()*1000)})}\n\n"
            if worker_task.done():
                break

    await worker_task


async def get_task_endpoint(request) -> JSONResponse:
    """MAPS Async polling endpoint: GET /tasks/:id."""
    task_id = request.path_params.get("id")
    task = TASKS_STORE.get(task_id)
    if not task:
        return JSONResponse({"error": "Task not found"}, status_code=404)
    return JSONResponse(task)


async def dashboard_endpoint(request) -> HTMLResponse:
    """Interactive visual dashboard for testing and demonstrations."""
    html_content = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Website UX & Conversion Tester — Google ADK</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; }
    .container { max-width: 900px; margin: 0 auto; }
    .card { background: #1e293b; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; border: 1px solid #334155; }
    h1 { color: #38bdf8; margin-top: 0; }
    input, select, button { padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: white; font-size: 1rem; }
    input[type="text"] { width: 60%; }
    button { background: #0284c7; font-weight: 600; cursor: pointer; border: none; transition: background 0.2s; }
    button:hover { background: #0369a1; }
    .badge { display: inline-block; padding: 0.25rem 0.6rem; border-radius: 9999px; font-size: 0.8rem; font-weight: 600; }
    .badge-crit { background: #ef4444; color: white; }
    .badge-high { background: #f97316; color: white; }
    .badge-med { background: #eab308; color: black; }
    .score-box { font-size: 3rem; font-weight: 800; color: #38bdf8; text-align: center; }
    pre { background: #0f172a; padding: 1rem; border-radius: 8px; overflow-x: auto; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 Website UX & Conversion Tester</h1>
    <p>Powered by <strong>Google ADK (google.adk)</strong> + <strong>Browserbase</strong> + <strong>Playwright</strong></p>
    
    <div class="card">
      <h3>Run Autonomous UX & Conversion Audit</h3>
      <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
        <input type="text" id="targetUrl" value="https://example.com" placeholder="https://your-website.com">
        <select id="tier">
          <option value="quick">Quick Tier ($0.50)</option>
          <option value="standard" selected>Standard Tier ($2.50)</option>
          <option value="comprehensive">Comprehensive ($5.00)</option>
        </select>
        <button id="runBtn" onclick="runAudit()">Start Test</button>
      </div>
      <div id="progress" style="display: none; color: #38bdf8; font-weight: 500;">Running test...</div>
    </div>

    <div id="results" style="display: none;">
      <div class="card" style="text-align: center;">
        <h3>Overall UX & Conversion Score</h3>
        <div class="score-box" id="scoreVal">--</div>
        <p id="journeysSummary">--</p>
      </div>
      <div class="card">
        <h3>Prioritized Recommendations</h3>
        <div id="recsList"></div>
      </div>
      <div class="card">
        <h3>Browser Replay Sessions</h3>
        <div id="replaysList"></div>
      </div>
    </div>
  </div>

  <script>
    async function runAudit() {
      const url = document.getElementById('targetUrl').value;
      const tier = document.getElementById('tier').value;
      const btn = document.getElementById('runBtn');
      const progress = document.getElementById('progress');
      const results = document.getElementById('results');

      btn.disabled = true;
      progress.style.display = 'block';
      progress.innerText = 'Connecting to browser session...';
      results.style.display = 'none';

      try {
        const res = await fetch('/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: { target_url: url, tier: tier } })
        });
        const data = await res.json();
        const report = data.output || data;

        document.getElementById('scoreVal').innerText = report.overall_score + '/100';
        document.getElementById('journeysSummary').innerText = 
          `${report.journeys_passed} journeys passed, ${report.journeys_failed} failed of ${report.total_journeys_tested} total.`;

        const recsDiv = document.getElementById('recsList');
        recsDiv.innerHTML = report.ux_recommendations.map(r => `
          <div style="border-bottom: 1px solid #334155; padding: 0.75rem 0;">
            <span class="badge ${r.severity === 'CRITICAL' ? 'badge-crit' : (r.severity === 'HIGH' ? 'badge-high' : 'badge-med')}">${r.severity}</span>
            <strong style="margin-left: 0.5rem;">${r.title}</strong>
            <p style="margin: 0.25rem 0; color: #94a3b8;">${r.issue_description}</p>
            <div style="color: #38bdf8; font-size: 0.9rem;"><strong>Fix:</strong> ${r.recommended_fix}</div>
          </div>
        `).join('') || '<p>No critical issues detected!</p>';

        const replaysDiv = document.getElementById('replaysList');
        replaysDiv.innerHTML = report.replayable_browser_sessions.map(s => `
          <div>
            <p><strong>Session:</strong> ${s.session_id} (${s.browser_type})</p>
            <p><a href="${s.replay_url}" target="_blank" style="color: #38bdf8;">▶ Watch Session Replay & Live View</a></p>
          </div>
        `).join('') || '<p>No replays recorded.</p>';

        results.style.display = 'block';
      } catch (err) {
        alert('Error: ' + err.message);
      } finally {
        btn.disabled = false;
        progress.style.display = 'none';
      }
    }
  </script>
</body>
</html>
"""
    return HTMLResponse(html_content)


routes = [
    Route("/health", endpoint=health_endpoint, methods=["GET"]),
    Route("/schema", endpoint=schema_endpoint, methods=["GET"]),
    Route("/execute", endpoint=execute_endpoint, methods=["POST"]),
    Route("/tasks/{id}", endpoint=get_task_endpoint, methods=["GET"]),
    Route("/", endpoint=dashboard_endpoint, methods=["GET"]),
]

app = Starlette(debug=True, routes=routes)

if __name__ == "__main__":
    port = int(os.getenv("PORT", "3008"))
    print("\n" + "=" * 65)
    print(f"🚀 [Website UX & Conversion Tester] Server running at http://localhost:{port}")
    print(f"   - GET  /health   -> Liveness probe")
    print(f"   - GET  /schema   -> AgentManifest")
    print(f"   - POST /execute  -> Streaming SSE / JSON batch")
    print(f"   - GET  /         -> Interactive visual dashboard")
    print("=" * 65 + "\n")
    uvicorn.run(app, host="0.0.0.0", port=port)
