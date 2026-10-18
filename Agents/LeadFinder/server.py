from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import sys
from typing import AsyncGenerator
import uuid
from starlette.applications import Starlette
from starlette.responses import HTMLResponse, Response, StreamingResponse
from starlette.routing import Route, Mount
from starlette.staticfiles import StaticFiles

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from dotenv import load_dotenv

# Load local environment
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)

os.environ["PYDANTIC_AI_NO_BANNER"] = "1"
if not os.getenv("OPENAI_API_KEY") and os.getenv("OPENAPI_KEY"):
    os.environ["OPENAI_API_KEY"] = os.environ["OPENAPI_KEY"]

from models import UniversalLeadReport
from accumulator import run_universal_lead_finder
from exporter import export_to_csv, export_to_json

PUBLIC_DIR = Path(__file__).parent / "public"
REPORTS_CACHE: dict[str, UniversalLeadReport] = {}


async def sse_event_generator(query: str, target: int) -> AsyncGenerator[str, None]:
    """Streams live SSE events during universal lead search."""
    run_id = str(uuid.uuid4())[:8]
    serpapi_key = os.getenv("SERPAPI_KEY", "")
    openrouter_jev = os.getenv("OPENROUTER_JEV", "")
    jev_model = os.getenv("JEV_MODEL", "typesafe/jev-1.14")

    queue: asyncio.Queue = asyncio.Queue()

    def on_event_callback(event: dict):
        queue.put_nowait(event)

    async def run_engine():
        try:
            report = await run_universal_lead_finder(
                user_prompt=query,
                target_count_override=target if target > 0 else None,
                max_rounds=4,
                serpapi_key=serpapi_key,
                openrouter_jev_key=openrouter_jev,
                jev_model=jev_model,
                on_event=on_event_callback,
            )
            REPORTS_CACHE[run_id] = report

            # Save to disk
            out_dir = Path(__file__).parent
            export_to_json(report, out_dir / "leads_result.json")
            export_to_csv(report, out_dir / "leads_result.csv")

            queue.put_nowait({
                "type": "complete",
                "run_id": run_id,
                "report": report.model_dump(),
            })
        except Exception as e:
            queue.put_nowait({"type": "error", "message": str(e)})

    engine_task = asyncio.create_task(run_engine())

    while True:
        try:
            event = await asyncio.wait_for(queue.get(), timeout=45.0)
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            if event.get("type") in ("complete", "error"):
                break
        except asyncio.TimeoutError:
            # Heartbeat ping
            yield "data: {\"type\": \"heartbeat\"}\n\n"
            if engine_task.done():
                break

    await engine_task


async def stream_endpoint(request):
    query = request.query_params.get("query", "").strip()
    target_str = request.query_params.get("target", "10")
    try:
        target = int(target_str)
    except ValueError:
        target = 10

    if not query:
        query = "Find 10 B2B SaaS companies in the USA"

    return StreamingResponse(
        sse_event_generator(query, target),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def download_csv_endpoint(request):
    run_id = request.query_params.get("id")
    report = REPORTS_CACHE.get(run_id)
    if not report:
        csv_file = Path(__file__).parent / "leads_result.csv"
        if csv_file.exists():
            return Response(csv_file.read_text(encoding="utf-8-sig"), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="leads.csv"'})
        return Response("Not found", status_code=404)

    tmp_path = Path(__file__).parent / f"export_{run_id}.csv"
    export_to_csv(report, tmp_path)
    content = tmp_path.read_text(encoding="utf-8-sig")
    tmp_path.unlink(missing_ok=True)
    return Response(content, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="leads.csv"'})


async def download_json_endpoint(request):
    run_id = request.query_params.get("id")
    report = REPORTS_CACHE.get(run_id)
    if not report:
        json_file = Path(__file__).parent / "leads_result.json"
        if json_file.exists():
            return Response(json_file.read_text(encoding="utf-8"), media_type="application/json", headers={"Content-Disposition": 'attachment; filename="leads.json"'})
        return Response("Not found", status_code=404)

    return Response(json.dumps(report.model_dump(), indent=2, ensure_ascii=False), media_type="application/json", headers={"Content-Disposition": 'attachment; filename="leads.json"'})


async def homepage_endpoint(request):
    index_file = PUBLIC_DIR / "index.html"
    return HTMLResponse(index_file.read_text(encoding="utf-8"))


routes = [
    Route("/", endpoint=homepage_endpoint),
    Route("/api/stream", endpoint=stream_endpoint),
    Route("/api/download/csv", endpoint=download_csv_endpoint),
    Route("/api/download/json", endpoint=download_json_endpoint),
    Mount("/", app=StaticFiles(directory=str(PUBLIC_DIR)), name="static"),
]

app = Starlette(debug=True, routes=routes)

if __name__ == "__main__":
    import uvicorn
    print("\n" + "=" * 65)
    print("[*] Universal LeadFinder UI Server: http://localhost:8000")
    print("=" * 65 + "\n")
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False)
