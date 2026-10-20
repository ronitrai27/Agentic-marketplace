import os
import base64

os.environ.setdefault("INTERNAL_API_TOKEN", "test-internal-token")

from fastapi.testclient import TestClient
from app.main import app


client = TestClient(app)
AUTH_HEADERS = {"Authorization": "Bearer test-internal-token"}


def valid_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "tenant_id": "tenant_demo",
        "workflow_run_id": "workflow_demo",
        "agent_instance_id": "outreach_demo",
        "idempotency_key": "run_demo",
        "channel": "email",
        "objective": "Request an introductory meeting.",
        "recipients": [{"recipient_id": "recipient_1", "name": "Jane", "email": "jane@example.com"}],
        "sender_name": "Test Sender",
        "sender_email": "sender@example.com",
        "sender_signature": "Test Sender",
        "config_version": "1.0.0",
        "require_approval": True,
        "dry_run": True,
    }
    payload.update(overrides)
    return payload


def test_health_and_manifest() -> None:
    assert client.get("/health").json()["status"] == "ok"
    response = client.get("/api/v1/agents")
    assert response.status_code == 200
    assert response.json()[0]["agent_id"] == "universal-outreach-agent"


def test_session_cookie_and_dashboard_are_available() -> None:
    with TestClient(app) as session_client:
        response = session_client.post("/api/v1/session")
        assert response.status_code == 200
        assert "outreach_session=" in response.headers["set-cookie"]
        dashboard = session_client.get("/api/v1/dashboard?tenant_id=demo-tenant")
        assert dashboard.status_code == 200
        assert {"agents", "logs", "connections"} <= dashboard.json().keys()


def test_dry_run_is_safe_and_idempotent() -> None:
    first = client.post(
        "/internal/agents/universal-outreach-agent/execute",
        json=valid_payload(),
        headers=AUTH_HEADERS,
    )
    second = client.post(
        "/internal/agents/universal-outreach-agent/execute",
        json=valid_payload(),
        headers=AUTH_HEADERS,
    )
    assert first.status_code == 200
    assert first.json()["results"][0]["status"] == "drafted"
    assert second.json() == first.json()


def test_missing_channel_contact_fails_closed() -> None:
    response = client.post(
        "/internal/agents/universal-outreach-agent/execute",
        json=valid_payload(
            idempotency_key="run_missing_email",
            recipients=[{"recipient_id": "recipient_1"}],
        ),
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "failed"
    assert response.json()["results"][0]["error_code"] == "missing_email"


def test_email_requires_recipient_name() -> None:
    response = client.post(
        "/internal/agents/universal-outreach-agent/execute",
        json=valid_payload(
            idempotency_key="run_missing_name",
            recipients=[{"recipient_id": "recipient_1", "email": "recipient@example.com"}],
        ),
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200
    assert response.json()["results"][0]["error_code"] == "missing_name"


def test_unconfigured_live_provider_fails_closed(monkeypatch) -> None:
    monkeypatch.delenv("SARVAM_API_KEY", raising=False)
    monkeypatch.delenv("BREVO_API_KEY", raising=False)
    monkeypatch.delenv("BREVO_SENDER_EMAIL", raising=False)
    response = client.post(
        "/internal/agents/universal-outreach-agent/execute",
        json=valid_payload(
            idempotency_key="run_live_without_provider",
            require_approval=False,
            dry_run=False,
        ),
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "failed"
    assert response.json()["results"][0]["error_code"] == "provider_not_configured"


def test_internal_endpoint_requires_bearer_token() -> None:
    response = client.post(
        "/internal/agents/universal-outreach-agent/execute",
        json=valid_payload(idempotency_key="run_missing_token"),
    )
    assert response.status_code == 401


def test_browser_preview_is_safe_without_internal_token() -> None:
    response = client.post(
        "/api/v1/outreach/preview",
        json=valid_payload(
            idempotency_key="browser-preview",
            dry_run=True,
        ),
    )
    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "drafted"


def test_email_attachment_is_accepted_for_dry_run() -> None:
    response = client.post(
        "/api/v1/outreach/preview",
        json=valid_payload(
            idempotency_key="browser-preview-attachment",
            attachments=[{
                "filename": "brief.txt",
                "content_type": "text/plain",
                "content_base64": base64.b64encode(b"hello").decode(),
            }],
        ),
    )
    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "drafted"


def test_browser_preview_rejects_live_dispatch() -> None:
    response = client.post(
        "/api/v1/outreach/preview",
        json=valid_payload(
            idempotency_key="browser-live-rejected",
            dry_run=False,
            require_approval=False,
        ),
    )
    assert response.status_code == 400


def test_browser_send_requires_explicit_approval() -> None:
    response = client.post(
        "/api/v1/outreach/send",
        json=valid_payload(
            idempotency_key="browser-send-without-approval",
            dry_run=False,
            require_approval=True,
            approval_granted=False,
        ),
    )
    assert response.status_code == 400


def test_browser_send_requires_connected_email_account() -> None:
    response = client.post(
        "/api/v1/outreach/send",
        json=valid_payload(
            idempotency_key="browser-send-without-connection",
            dry_run=False,
            require_approval=True,
            approval_granted=True,
        ),
    )
    assert response.status_code == 400
    assert "connect" in response.json()["detail"].lower()


def test_browser_send_rejects_dry_run() -> None:
    response = client.post(
        "/api/v1/outreach/send",
        json=valid_payload(
            idempotency_key="browser-send-dry-run",
            dry_run=True,
            approval_granted=True,
        ),
    )
    assert response.status_code == 400


def test_duplicate_provider_events_are_deduplicated() -> None:
    event = {"provider": "email", "event_id": "evt_1", "event_type": "completed"}
    assert client.post("/api/v1/webhooks/email", json=event).json()["duplicate"] is False
    assert client.post("/api/v1/webhooks/email", json=event).json()["duplicate"] is True


def test_instance_can_validate_and_publish() -> None:
    created = client.post(
        "/api/v1/agent-instances",
        json={
            "tenant_id": "tenant_publish",
            "agent_id": "universal-outreach-agent",
            "config": {
                "channel": "email",
                "objective": "Request a meeting",
                "dry_run": True,
            },
        },
    )
    assert created.status_code == 200
    instance_id = created.json()["id"]
    assert created.json()["status"] == "draft"
    published = client.post(f"/api/v1/agent-instances/{instance_id}/publish")
    assert published.status_code == 200
    assert published.json()["published"] is True
    assert published.json()["instance"]["status"] == "published"


def test_workflow_can_validate_and_publish() -> None:
    draft = {
        "tenant_id": "tenant_workflow",
        "name": "Lead to outreach",
        "nodes": [
            {"id": "outreach", "agent_id": "universal-outreach-agent", "label": "Universal Outreach"},
        ],
        "edges": [],
    }
    validation = client.post("/api/v1/workflows/validate", json=draft)
    assert validation.status_code == 200
    assert validation.json()["valid"] is True
    created = client.post("/api/v1/workflows", json=draft)
    workflow_id = created.json()["id"]
    published = client.post(f"/api/v1/workflows/{workflow_id}/publish")
    assert published.status_code == 200
    assert published.json()["status"] == "published"
