from __future__ import annotations

import asyncio
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from catelog import (
    MemoryJobStore,
    RedisJobStore,
    SqliteJobStore,
    create_agent,
)

passed = 0
failed = 0


def check(condition: bool, label: str) -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"   ✅ {label}")
    else:
        failed += 1
        print(f"   ❌ {label}")


async def start(agent: Any) -> Tuple[str, Any]:
    server = agent.listen({"port": 0, "host": "127.0.0.1", "silent": True, "handleSignals": False})
    await asyncio.sleep(0.02)
    return f"http://127.0.0.1:{server.port}", server


def _sync_http(
    url: str,
    method: str = "GET",
    body: Any = None,
    headers: Dict[str, str] | None = None,
) -> Tuple[int, Dict[str, str], str]:
    hdrs = headers or {}
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp_hdrs = {k.lower(): v for k, v in resp.headers.items()}
            return resp.status, resp_hdrs, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        resp_hdrs = {k.lower(): v for k, v in e.headers.items()}
        return e.code, resp_hdrs, e.read().decode("utf-8")


async def post(base: str, body: Any) -> Tuple[int, Dict[str, str], Dict[str, Any]]:
    status, hdrs, text = await asyncio.to_thread(
        _sync_http,
        f"{base}/execute",
        "POST",
        body,
        {"Content-Type": "application/json", "Accept": "application/json"},
    )
    return status, hdrs, json.loads(text) if text else {}


async def get_json(url: str) -> Tuple[int, Dict[str, Any]]:
    status, _, text = await asyncio.to_thread(_sync_http, url, "GET")
    return status, json.loads(text) if text else {}


async def main() -> None:
    print("🧪 Feature tests: job stores, limits, shutdown\n")

    # ─── 1. Async job survives an agent "restart" via a shared store ───
    print("1️⃣  Async job persisted in a shared store...")
    store = MemoryJobStore()

    async def exec_a1(ctx: Any) -> Any:
        ctx.stream.step("working")
        await asyncio.sleep(0.05)
        return {"output": {"ok": True}}

    a1 = create_agent(
        max_timeout_minute=1,
        name="Async A",
        mode="async",
        job_store=store,
        execute=exec_a1,
    )
    base1, s1 = await start(a1)
    _, _, accepted = await post(base1, {"input": {}})
    check(accepted.get("status") == "working", "202 body says working")
    await asyncio.sleep(0.2)
    _, done = await get_json(f"{base1}/tasks/{accepted['run_id']}")
    check(done.get("status") == "completed" and done.get("output", {}).get("ok") is True, "Job completes")
    check(isinstance(done.get("events"), list) and len(done["events"]) > 0, "Events included in poll")
    s1.close()

    a2 = create_agent(
        max_timeout_minute=1,
        name="Async B",
        mode="async",
        job_store=store,
        execute=lambda ctx: {},
    )
    base2, s2 = await start(a2)
    _, after_restart = await get_json(f"{base2}/tasks/{accepted['run_id']}")
    check(
        after_restart.get("status") == "completed" and after_restart.get("output", {}).get("ok") is True,
        "New agent instance reads finished job",
    )
    missing_status, _ = await get_json(f"{base2}/tasks/nope")
    check(missing_status == 404, "Unknown job -> 404")

    # ─── 2. Stale "working" job from a dead process ───
    print("\n2️⃣  Orphaned working job...")
    now_ms = int(time.time() * 1000)
    await store.set(
        {
            "runId": "dead_1",
            "status": "working",
            "createdAt": now_ms - 60_000,
            "updatedAt": now_ms - 60_000,
        }
    )
    _, orphan = await get_json(f"{base2}/tasks/dead_1")
    check(
        orphan.get("status") == "failed" and orphan.get("error", {}).get("code") == "TASK_INTERRUPTED",
        "Reported as TASK_INTERRUPTED",
    )
    check(orphan.get("error", {}).get("retryable") is True, "Marked retryable")
    s2.close()

    # ─── 3. Redis + SQLite adapters ───
    print("\n3️⃣  Redis + SQLite adapters...")
    kv: Dict[str, str] = {}
    redis = RedisJobStore(
        {
            "get": lambda k: kv.get(k),
            "set": lambda k, v: kv.__setitem__(k, v),
            "expire": lambda k, s: 1,
        }
    )
    job = {
        "runId": "r1",
        "status": "completed",
        "output": {"x": 1},
        "createdAt": now_ms,
        "updatedAt": now_ms,
    }
    await redis.set(job)
    r_got = await redis.get("r1")
    check(r_got is not None and r_got.output.x == 1, "RedisJobStore round-trip")
    check((await redis.get("zzz")) is None, "RedisJobStore miss -> None")

    sqlite = SqliteJobStore({"path": ":memory:"})
    await sqlite.set(job)
    s_got = await sqlite.get("r1")
    check(s_got is not None and s_got.output.x == 1, "SqliteJobStore round-trip")
    await sqlite.close()

    # ─── 4. Limits ───
    print("\n4️⃣  Limits...")
    open_agent = create_agent(max_timeout_minute=1, name="Open", execute=lambda ctx: {"ok": 1})
    base_o, so = await start(open_agent)
    st_o, _, _ = await post(base_o, {"input": {"pad": "x" * 5000}})
    check(st_o == 200, "No limits by default")
    so.close()

    limited = create_agent(
        max_timeout_minute=1,
        name="Limited",
        limits={"maxBodyBytes": 200, "rateLimit": {"max": 3, "windowMs": 60_000}},
        execute=lambda ctx: {"ok": 1},
    )
    base_l, sl = await start(limited)
    big_st, _, big_body = await post(base_l, {"input": {"pad": "x" * 1000}})
    check(big_st == 413, "Oversized body -> 413")
    check(big_body.get("error", {}).get("code") == "PAYLOAD_TOO_LARGE", "413 has PAYLOAD_TOO_LARGE code")
    ok_st, _, _ = await post(base_l, {"input": {}})
    check(ok_st == 200, "Small body passes")
    third_st, _, _ = await post(base_l, {"input": {}})
    fourth_st, fourth_hdrs, _ = await post(base_l, {"input": {}})
    check(third_st == 200 and fourth_st == 429, "4th request in window -> 429")
    check(fourth_hdrs.get("retry-after") is not None, "429 has Retry-After")
    sl.close()

    gate = asyncio.Event()

    async def busy_exec(ctx: Any) -> Any:
        await gate.wait()
        return {"ok": 1}

    busy = create_agent(
        max_timeout_minute=1,
        name="Busy",
        limits={"maxConcurrent": 1},
        execute=busy_exec,
    )
    base_b, sb = await start(busy)
    first_task = asyncio.create_task(post(base_b, {"input": {}}))
    await asyncio.sleep(0.05)
    sec_st, _, sec_body = await post(base_b, {"input": {}})
    check(
        sec_st == 429 and sec_body.get("error", {}).get("code") == "SERVER_BUSY",
        "Over maxConcurrent -> SERVER_BUSY",
    )
    gate.set()
    first_st, _, _ = await first_task
    check(first_st == 200, "First request still completes")
    after_st, _, _ = await post(base_b, {"input": {}})
    check(after_st == 200, "Slot is released afterwards")
    sb.close()

    # ─── 5. Graceful shutdown ───
    print("\n5️⃣  Graceful shutdown...")

    async def slow_exec(ctx: Any) -> Any:
        await asyncio.sleep(0.3)
        return {"output": {"done": True}}

    slow = create_agent(max_timeout_minute=1, name="Slow", execute=slow_exec)
    base_s, ss = await start(slow)
    inflight_task = asyncio.create_task(post(base_s, {"input": {}}))
    await asyncio.sleep(0.05)
    t0 = time.time()
    shutdown_task = asyncio.create_task(slow.shutdown(5000))
    await asyncio.sleep(0.01)
    ref_st, _, ref_body = await post(base_s, {"input": {}})
    check(
        ref_st == 503 and ref_body.get("error", {}).get("code") == "SHUTTING_DOWN",
        "New runs refused while draining",
    )
    fin_st, _, fin_body = await inflight_task
    check(fin_st == 200 and fin_body.get("status") == "completed", "In-flight run finishes")
    await shutdown_task
    check((time.time() - t0) < 2.0, "Shutdown returns once idle (no full timeout wait)")
    ss.close()

    async def stuck_exec(ctx: Any) -> Any:
        await ctx.signal.wait()
        return {}

    stuck = create_agent(max_timeout_minute=1, name="Stuck", mode="async", execute=stuck_exec)
    base_k, sk = await start(stuck)
    _, _, acc = await post(base_k, {"input": {}})
    await asyncio.sleep(0.05)
    await stuck.shutdown(100)
    _, killed = await get_json(f"{base_k}/tasks/{acc['run_id']}")
    check(
        killed.get("status") == "failed" and killed.get("error", {}).get("code") == "TASK_INTERRUPTED",
        "Overdue async job marked TASK_INTERRUPTED",
    )
    sk.close()

    # ─── 6. Enforced timeout (maxTimeoutMinute) ───
    print("\n6️⃣  Timeout enforcement...")
    threw = ""
    try:
        create_agent(name="NoTimeout", execute=lambda ctx: {})
    except Exception as e:
        threw = str(e)
    check("maxTimeoutMinute missing" in threw, "Missing maxTimeoutMinute throws a clear error")

    async def hang_exec(ctx: Any) -> Any:
        await asyncio.sleep(5.0)
        return {"output": {"late": True}}

    def make_hang(extra: Dict[str, Any] | None = None) -> Any:
        return create_agent(
            {
                "name": "Hang",
                "maxTimeoutMinute": 0.01,
                **(extra or {}),
                "execute": hang_exec,
            }
        )

    hs_agent = make_hang()
    base_hs, hs = await start(hs_agent)
    t_start = time.time()
    _, _, timed_out = await post(base_hs, {"input": {}})
    check(
        timed_out.get("status") == "failed"
        and timed_out.get("error", {}).get("code") == "EXECUTION_TIMEOUT"
        and timed_out.get("error", {}).get("retryable") is True,
        "Sync JSON: ignored-signal agent fails with retryable EXECUTION_TIMEOUT",
    )
    check((time.time() - t_start) < 2.5, "Sync JSON: returns at the limit, not when the agent finishes")

    _, _, sse_text = await asyncio.to_thread(
        _sync_http,
        f"{base_hs}/execute",
        "POST",
        {"input": {}},
        {"Content-Type": "application/json", "Accept": "text/event-stream"},
    )
    check(
        "EXECUTION_TIMEOUT" in sse_text and "task.failed" in sse_text,
        "SSE: emits task.failed with EXECUTION_TIMEOUT",
    )
    hs.close()

    ha = make_hang({"mode": "async"})
    base_as, as_srv = await start(ha)
    _, _, hung_job = await post(base_as, {"input": {}})
    await asyncio.sleep(0.9)
    _, polled = await get_json(f"{base_as}/tasks/{hung_job['run_id']}")
    check(
        polled.get("status") == "failed" and polled.get("error", {}).get("code") == "EXECUTION_TIMEOUT",
        "Async: hung job ends as EXECUTION_TIMEOUT",
    )
    as_srv.close()

    long_agent = create_agent(
        name="ShortDeadline",
        max_timeout_minute=5,
        execute=hang_exec,
    )
    base_ls, ls = await start(long_agent)
    _, _, dl = await post(base_ls, {"input": {}, "deadline_ms": int(time.time() * 1000) + 300})
    check(dl.get("error", {}).get("code") == "EXECUTION_TIMEOUT", "Caller deadline_ms can shorten the limit")
    check(
        long_agent.capabilities.max_timeout_seconds == 300,
        "Manifest advertises maxTimeoutMinute in seconds",
    )
    ls.close()

    print(f"\n{'─' * 50}")
    if failed == 0:
        print(f"🎉 All {passed} feature tests passed!")
    else:
        print(f"⚠️  {passed} passed, {failed} failed")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())

