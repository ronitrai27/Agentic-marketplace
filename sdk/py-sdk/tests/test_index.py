from __future__ import annotations

import asyncio
import os
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pydantic import BaseModel, Field

from catelog import SecurityManager, create_agent, create_marketplace_agent


async def run_tests() -> None:
    print("🧪 Starting catelog Python SDK test suite (v2 — refined architecture)...\n")

    passed = 0
    failed = 0

    def check(condition: bool, label: str) -> None:
        nonlocal passed, failed
        if condition:
            passed += 1
            print(f"   ✅ {label}")
        else:
            failed += 1
            print(f"   ❌ {label}")

    # ─── Test 1: Minimal Agent (Zero Config) ───
    print("1️⃣  Minimal agent — no schema, no keys, just execute...")
    minimal_agent = create_agent(
        max_timeout_minute=1,
        name="Minimal Agent",
        execute=lambda ctx: {"greeting": f"Hello, {ctx.input.get('name', 'world')}!"},
    )

    health = minimal_agent.get_health()
    check(health.status == "ready", "Health status = ready")
    check(health.protocol_version == "1.0.0", "Protocol version = 1.0.0")
    check("sync" in health.capabilities.execution_modes, "Capabilities include sync mode")
    check(isinstance(health.uptime_seconds, int), "Uptime is a number")

    manifest = minimal_agent.get_manifest()
    check(manifest.id == "minimal-agent", "Auto-slugified ID = minimal-agent")
    check(manifest.input_schema.get("type") == "object", "Input schema defaults to { type: object }")
    check(manifest.output_schema.get("type") == "object", "Output schema defaults to { type: object }")

    # ─── Test 2: Agent with Pydantic Schemas ───
    print("\n2️⃣  Agent with Pydantic schemas...")

    class InputSchema(BaseModel):
        query: str = Field(..., min_length=3)
        target_count: int = 5

    class OutputSchema(BaseModel):
        results: list[str]
        count: int

    async def schema_exec(ctx):
        return {
            "output": {
                "results": [f"Result for {ctx.input.query}"],
                "count": 1,
            },
            "telemetry": {
                "model_used": "gpt-4o-mini",
                "llm_tokens": {"prompt": 100, "completion": 50, "total": 150},
            },
        }

    schema_agent = create_agent(
        max_timeout_minute=1,
        name="Schema Agent",
        input_schema=InputSchema,
        output_schema=OutputSchema,
        execute=schema_exec,
    )

    schema_manifest = schema_agent.get_manifest()
    check(bool(schema_manifest.input_schema.get("properties")), "Input schema has properties from Pydantic")
    check(schema_manifest.id == "schema-agent", "Schema agent ID correct")

    # ─── Test 3: Backward Compatibility (create_marketplace_agent) ───
    print("\n3️⃣  Backward compat — create_marketplace_agent still works...")

    async def legacy_exec(ctx):
        ctx.stream.step("Processing")
        ctx.stream.delta("Hello")
        return {"output": {"done": True}}

    legacy_agent = create_marketplace_agent(
        max_timeout_minute=1,
        name="Legacy Agent",
        execute=legacy_exec,
    )
    check(legacy_agent.name == "Legacy Agent", "Legacy factory creates agent correctly")

    # ─── Test 4: Dual-Mode Security — Bearer Auth ───
    print("\n4️⃣  Dual-mode security — Bearer token auth...")
    secret_key = "cat_sec_live_test123456789abcdef"
    security_agent = create_agent(
        max_timeout_minute=1,
        name="Secure Agent",
        secret_key=secret_key,
        execute=lambda ctx: {"secure": True},
    )

    bearer_result = security_agent.security.authenticate_request(
        method="POST",
        path="/execute",
        headers={"authorization": f"Bearer {secret_key}"},
        raw_body=b"{}",
    )
    check(bearer_result.authMode == "bearer", "Bearer auth mode detected")
    check(isinstance(bearer_result.runId, str), "RunId generated for Bearer")

    try:
        security_agent.security.authenticate_request(
            method="POST",
            path="/execute",
            headers={"authorization": "Bearer cat_sec_live_wrongkey999999"},
            raw_body=b"{}",
        )
        check(False, "Invalid Bearer should have thrown")
    except Exception as err:
        check(getattr(err, "code", None) == "AUTH_INVALID_KEY", "Invalid Bearer rejected with AUTH_INVALID_KEY")

    # ─── Test 5: Dual-Mode Security — HMAC Auth ───
    print("\n5️⃣  Dual-mode security — HMAC-SHA256 auth...")
    hmac_secret = "test-hmac-secret-key-1234567890"
    security = SecurityManager({"secret": hmac_secret})

    run_id = f"run_{uuid.uuid4().hex[:8]}"
    nonce = f"nonce_{uuid.uuid4().hex[:8]}"
    timestamp = int(time.time() * 1000)
    raw_body = f'{{"run_id": "{run_id}", "input": {{"query": "test"}}}}'

    body_hash = security.compute_body_hash(raw_body)
    canonical = security.build_canonical_string("POST", "/execute", timestamp, nonce, run_id, body_hash)
    signature = security.calculate_signature(canonical, hmac_secret)

    hmac_result = security.authenticate_request(
        method="POST",
        path="/execute",
        headers={
            "x-marketplace-timestamp": str(timestamp),
            "x-marketplace-nonce": nonce,
            "x-marketplace-run-id": run_id,
            "x-marketplace-signature": signature,
        },
        raw_body=raw_body,
    )
    check(hmac_result.authMode == "hmac", "HMAC auth mode detected")
    check(hmac_result.runId == run_id, "HMAC returns correct runId")

    # ─── Test 6: Anti-Replay (Duplicate Nonce) ───
    print("\n6️⃣  Anti-replay — duplicate nonce protection...")
    try:
        security.authenticate_request(
            method="POST",
            path="/execute",
            headers={
                "x-marketplace-timestamp": str(timestamp),
                "x-marketplace-nonce": nonce,
                "x-marketplace-run-id": "run_other",
                "x-marketplace-signature": signature,
            },
            raw_body=raw_body,
        )
        check(False, "Replay should have been detected")
    except Exception as err:
        check(getattr(err, "code", None) == "AUTH_REPLAY_DETECTED", "Duplicate nonce blocked with AUTH_REPLAY_DETECTED")

    # ─── Test 7: Dev Mode (No Keys) ───
    print("\n7️⃣  Dev mode — no keys, permissive...")
    os.environ["PYTHON_ENV"] = "test"
    dev_security = SecurityManager()
    dev_result = dev_security.authenticate_request(
        method="POST",
        path="/execute",
        headers={},
        raw_body=b"{}",
    )
    check(dev_result.authMode == "dev", "Dev mode detected when no keys")
    check(isinstance(dev_result.runId, str), "Dev mode generates runId")

    # ─── Test 8: Execution Modes ───
    print("\n8️⃣  Execution modes — sync, async, conversational...")
    sync_agent = create_agent(max_timeout_minute=1, name="Sync", execute=lambda ctx: {"ok": True})
    check(sync_agent.mode == "sync", "Default mode is sync")

    async_agent = create_agent(
        max_timeout_minute=1, name="Async", mode="async", execute=lambda ctx: {"ok": True}
    )
    check(async_agent.mode == "async", "Async mode set correctly")
    check("async" in async_agent.capabilities.execution_modes, "Capabilities include async")

    conv_agent = create_agent(
        max_timeout_minute=1, name="Conv", mode="conversational", execute=lambda ctx: {"ok": True}
    )
    check(conv_agent.mode == "conversational", "Conversational mode set correctly")

    # ─── Test 9: Health Check includes capabilities ───
    print("\n9️⃣  Health check includes capabilities for registration probe...")
    rich_health = async_agent.get_health()
    check(bool(rich_health.capabilities), "Health response includes capabilities")
    check("async" in rich_health.capabilities.execution_modes, "Health shows async in capabilities")

    # ─── Test 10: Public Key Auth ───
    print("\n🔟 Public key auth (cat_pub_live_...)...")
    pub_key = "cat_pub_live_testpublickey123456"
    pub_security = SecurityManager(public_key=pub_key)

    pub_result = pub_security.authenticate_request(
        method="GET",
        path="/schema",
        headers={"authorization": f"Bearer {pub_key}"},
        raw_body=b"",
    )
    check(pub_result.authMode == "public", "Public key auth mode detected")

    print(f"\n{'─' * 50}")
    if failed == 0:
        print(f"🎉 All {passed} tests passed!")
    else:
        print(f"⚠️  {passed} passed, {failed} failed")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(run_tests())

