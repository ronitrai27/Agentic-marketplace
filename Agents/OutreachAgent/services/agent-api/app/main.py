import hmac
import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse, urlunparse
from uuid import uuid4

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from dotenv import dotenv_values, load_dotenv
import httpx
from pydantic import ValidationError
from starlette.responses import RedirectResponse, Response

env_path = Path(__file__).resolve().parents[3] / ".env"
load_dotenv(env_path)
local_env = dotenv_values(env_path)
for oauth_key in (
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
):
    value = local_env.get(oauth_key)
    if value:
        os.environ[oauth_key] = value


from .bulk import (
    MAX_BULK_FILE_BYTES,
    MAX_BULK_RECIPIENTS,
    BulkParseError,
    BulkParseResult,
    parse_bulk_workbook,
    render_bulk_email,
)
from .drafting import draft_bulk_emails
from .models import (
    AgentInstance,
    AgentInstanceCreate,
    AgentManifest,
    BulkColumn,
    BulkParseResponse,
    BulkRecipientPreview,
    BulkRecipientResult,
    BulkRunResponse,
    BulkSkippedRow,
    ConfigValidationResponse,
    OutreachConfig,
    OutreachInput,
    OutreachResult,
    EmailAttachment,
    EmailConnection,
    EmailConnectionStart,
    ProviderEvent,
    PublishResponse,
    Recipient,
    WorkflowDraft,
    WorkflowRecord,
    WorkflowValidation,
)
from .registry import get_manifest, list_manifests
from .service import OutreachService

app = FastAPI(
    title="Universal Outreach Agent API",
    version="1.0.0",
    description="Provider-neutral email outreach execution boundary.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

service = OutreachService()
oauth_states: dict[str, dict[str, str]] = {}
SESSION_COOKIE = "outreach_session"
DEFAULT_TENANT = "demo-tenant"


def session_tenant(session_id: str | None, tenant_id: str) -> str:
    if session_id:
        expires = service.store.touch_session(session_id, tenant_id)
        if expires is None:
            raise HTTPException(status_code=401, detail="Your session has expired. Start a new session.")
    return tenant_id


def verify_internal_token(authorization: str | None) -> None:
    expected = os.getenv("INTERNAL_API_TOKEN")
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Internal API authentication is not configured.",
        )
    scheme, _, supplied = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid internal API credentials are required.",
            headers={"WWW-Authenticate": "Bearer"},
        )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "universal-outreach-agent"}


@app.post("/api/v1/session")
async def create_session(response: Response) -> dict[str, str]:
    session_id, expires_at = service.store.create_session(DEFAULT_TENANT)
    response.set_cookie(
        SESSION_COOKIE,
        session_id,
        max_age=3600,
        httponly=True,
        secure=False,
        samesite="lax",
    )
    return {"tenant_id": DEFAULT_TENANT, "session_id": session_id, "expires_at": expires_at.isoformat()}


@app.get("/api/v1/agents", response_model=list[AgentManifest])
async def agents() -> list[AgentManifest]:
    return list_manifests()


@app.get("/api/v1/agents/{agent_id}", response_model=AgentManifest)
async def agent(agent_id: str) -> AgentManifest:
    manifest = get_manifest(agent_id)
    if manifest is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found.")
    return manifest


@app.get("/api/v1/agent-instances/config-schema")
async def config_schema() -> dict[str, Any]:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "universal_outreach.config.v1",
        "type": "object",
        "additionalProperties": False,
        "required": ["channel", "objective"],
        "properties": {
            "channel": {"type": "string", "enum": ["email"], "default": "email"},
            "objective": {"type": "string", "minLength": 1, "maxLength": 2000},
            "sender_name": {"type": "string", "minLength": 1, "maxLength": 120},
            "sender_email": {"type": "string", "format": "email"},
            "sender_signature": {"type": "string", "maxLength": 500},
            "language": {"type": "string", "default": "en"},
            "tone": {
                "type": "string",
                "enum": ["professional", "warm", "concise"],
                "default": "professional",
            },
            "require_approval": {"type": "boolean", "default": True},
            "approval_granted": {"type": "boolean", "default": False},
            "dry_run": {"type": "boolean", "default": True},
            "max_actions_per_recipient": {"type": "integer", "minimum": 1, "maximum": 5, "default": 1},
        },
    }


@app.get("/api/v1/email-connections", response_model=list[EmailConnection])
async def list_email_connections(
    request: Request,
    tenant_id: str = DEFAULT_TENANT,
    x_session_id: str | None = Header(default=None),
) -> list[EmailConnection]:
    session_tenant(request.cookies.get(SESSION_COOKIE) or x_session_id, tenant_id)
    return service.list_email_connections(tenant_id)


@app.post("/api/v1/email-connections/connect")
async def start_email_connection(
    payload: EmailConnectionStart,
    request: Request,
    x_session_id: str | None = Header(default=None),
) -> dict[str, str]:
    session_tenant(request.cookies.get(SESSION_COOKIE) or x_session_id, payload.tenant_id)
    state = str(uuid4())
    if payload.provider != "gmail":
        raise HTTPException(status_code=400, detail="Only Gmail connections are supported.")
    oauth_states[state] = {
        "tenant_id": payload.tenant_id,
        "provider": payload.provider,
        "return_url": payload.return_url,
    }
    client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
    if not client_id:
        raise HTTPException(status_code=503, detail="Google OAuth is not configured.")
    query = urlencode({
        "client_id": client_id,
        "redirect_uri": os.getenv("GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:8010/api/v1/email-connections/callback"),
        "response_type": "code",
        "scope": "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email",
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    })
    return {"authorization_url": f"https://accounts.google.com/o/oauth2/v2/auth?{query}"}


@app.get("/api/v1/email-connections/callback")
async def email_connection_callback(code: str, state: str) -> RedirectResponse:
    context = oauth_states.pop(state, None)
    if context is None or context["provider"] != "gmail":
        raise HTTPException(status_code=400, detail="Invalid or expired Gmail OAuth state.")
    provider = context["provider"]
    if provider == "gmail":
        token_url = "https://oauth2.googleapis.com/token"
        client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
        client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")
        redirect_uri = os.getenv("GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:8010/api/v1/email-connections/callback")
    if not client_id or not client_secret:
        raise HTTPException(status_code=503, detail=f"{provider} OAuth is not configured.")
    token_data = {
        "code": code,
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }
    token_data["client_secret"] = client_secret
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            token_url,
            data=token_data,
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"{provider} OAuth token exchange failed.")
    token = response.json()
    access_token = token.get("access_token")
    if not access_token:
        raise HTTPException(status_code=502, detail=f"{provider} returned no access token.")
    async with httpx.AsyncClient(timeout=30.0) as client:
        if provider == "gmail":
            profile = await client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if profile.status_code >= 400:
                raise HTTPException(status_code=502, detail="Gmail did not return the connected identity.")
            identity = profile.json()
            email = identity.get("email")
            display_name = identity.get("name") or email
        else:
            profile = await client.get(
                "https://api.brevo.com/v3/account",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if profile.status_code >= 400:
                raise HTTPException(status_code=502, detail="Brevo did not return the connected identity.")
            identity = profile.json()
            email = identity.get("email")
            display_name = identity.get("companyName") or email
    if not email:
        raise HTTPException(status_code=502, detail=f"{provider} returned no sender identity.")
    connection = EmailConnection(
        id=str(uuid4()),
        tenant_id=context["tenant_id"],
        provider=provider,
        email=email,
        display_name=display_name,
        status="connected",
        scopes=["send", "userinfo.email"] if provider == "gmail" else ["send"],
    )
    service.save_email_connection(
        connection,
        access_token=access_token,
        refresh_token=token.get("refresh_token"),
    )
    return_url = context["return_url"]
    parsed_return_url = urlparse(return_url)
    query = urlencode({"email_connected": "1"})
    redirect_url = urlunparse(parsed_return_url._replace(query=query, fragment=""))
    return RedirectResponse(url=redirect_url, status_code=status.HTTP_303_SEE_OTHER)


@app.post("/api/v1/agent-instances", response_model=AgentInstance)
async def create_instance(payload: AgentInstanceCreate, request: Request, x_session_id: str | None = Header(default=None)) -> AgentInstance:
    session_tenant(request.cookies.get(SESSION_COOKIE) or x_session_id, payload.tenant_id)
    if get_manifest(payload.agent_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent template not found.")
    return service.create_instance(payload)


@app.get("/api/v1/agent-instances/{instance_id}", response_model=AgentInstance)
async def get_instance(instance_id: str, tenant_id: str = DEFAULT_TENANT) -> AgentInstance:
    instance = service.get_instance(instance_id, tenant_id)
    if instance is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent instance not found.")
    return instance


@app.get("/api/v1/dashboard")
async def dashboard(tenant_id: str = DEFAULT_TENANT) -> dict[str, Any]:
    return {
        "agents": [item.model_dump(mode="json") for item in service.list_instances(tenant_id)],
        "logs": service.list_logs(tenant_id),
        "connections": [item.model_dump(mode="json") for item in service.list_email_connections(tenant_id)],
    }


@app.post("/api/v1/agent-instances/validate", response_model=ConfigValidationResponse)
async def validate_config(config: OutreachConfig) -> ConfigValidationResponse:
    return service.validate_config(config)


@app.post("/api/v1/agent-instances/{instance_id}/publish", response_model=PublishResponse)
async def publish_instance(instance_id: str, request: Request, tenant_id: str = DEFAULT_TENANT, x_session_id: str | None = Header(default=None)) -> PublishResponse:
    session_tenant(request.cookies.get(SESSION_COOKIE) or x_session_id, tenant_id)
    try:
        return service.publish_instance(instance_id, tenant_id)
    except KeyError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent instance not found.") from error
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error


@app.post("/api/v1/workflows", response_model=WorkflowRecord)
async def create_workflow(draft: WorkflowDraft) -> WorkflowRecord:
    return service.create_workflow(draft)


@app.post("/api/v1/workflows/validate", response_model=WorkflowValidation)
async def validate_workflow(draft: WorkflowDraft) -> WorkflowValidation:
    return service.validate_workflow(draft)


@app.post("/api/v1/workflows/{workflow_id}/publish", response_model=WorkflowRecord)
async def publish_workflow(workflow_id: str) -> WorkflowRecord:
    try:
        return service.publish_workflow(workflow_id)
    except KeyError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found.") from error
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error


@app.post("/internal/agents/universal-outreach-agent/execute", response_model=OutreachResult)
async def execute_outreach(
    request: OutreachInput,
    authorization: str | None = Header(default=None),
) -> OutreachResult:
    verify_internal_token(authorization)
    return await service.execute(request)


@app.post("/api/v1/outreach/preview", response_model=OutreachResult)
async def preview_outreach(
    request: OutreachInput,
    http_request: Request,
    x_session_id: str | None = Header(default=None),
) -> OutreachResult:
    session_tenant(http_request.cookies.get(SESSION_COOKIE) or x_session_id, request.tenant_id)
    if not request.dry_run:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Browser preview endpoint only accepts dry_run=true.",
        )
    return await service.execute(request)


@app.post("/api/v1/outreach/send", response_model=OutreachResult)
async def send_outreach(
    request: OutreachInput,
    http_request: Request,
    x_session_id: str | None = Header(default=None),
) -> OutreachResult:
    session_tenant(http_request.cookies.get(SESSION_COOKIE) or x_session_id, request.tenant_id)
    if request.dry_run:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Live send endpoint requires dry_run=false.",
        )
    if not request.require_approval or not request.approval_granted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Explicit approval is required before live sending.",
        )
    if not request.connection_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Connect and select a Gmail account before live sending.",
        )
    return await service.execute(request)


def parse_uploaded_bulk(file: UploadFile) -> BulkParseResult:
    filename = file.filename or ""
    data = file.file.read(MAX_BULK_FILE_BYTES + 1)
    if len(data) > MAX_BULK_FILE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The workbook is too large. The maximum file size is 2 MB.",
        )
    try:
        return parse_bulk_workbook(filename, data)
    except BulkParseError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


def bulk_token_context(objective: str, sender_name: str, sender_signature: str) -> dict[str, str]:
    return {
        "objective": objective.strip(),
        "sender_name": sender_name.strip(),
        "sender_signature": (sender_signature.strip() or sender_name.strip()),
    }


def parse_bulk_attachments(attachments_json: str) -> list[EmailAttachment]:
    """Parse the optional attachments JSON field for bulk runs.

    Same shape as the single-recipient contract: a list of base64
    ``EmailAttachment`` objects. The shared policy checks (type, size,
    count) still run per request before any dispatch.
    """
    raw = attachments_json.strip()
    if not raw:
        return []
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Attachments must be a JSON array of base64-encoded files.",
        ) from error
    if not isinstance(payload, list):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Attachments must be a JSON array of base64-encoded files.",
        )
    attachments: list[EmailAttachment] = []
    for item in payload:
        try:
            attachments.append(EmailAttachment.model_validate(item))
        except ValidationError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Each attachment needs a filename, content type, and base64 content.",
            ) from error
    return attachments


@app.post("/api/v1/outreach/bulk/parse", response_model=BulkParseResponse)
async def bulk_parse(
    http_request: Request,
    file: UploadFile = File(...),
    subject_template: str = Form(default=""),
    body_template: str = Form(default=""),
    ai_draft: bool = Form(default=False),
    objective: str = Form(default=""),
    tone: str = Form(default="professional"),
    language: str = Form(default="en"),
    sender_name: str = Form(default=""),
    sender_signature: str = Form(default=""),
    x_session_id: str | None = Header(default=None),
) -> BulkParseResponse:
    session_tenant(http_request.cookies.get(SESSION_COOKIE) or x_session_id, DEFAULT_TENANT)
    parsed = parse_uploaded_bulk(file)
    context = bulk_token_context(objective, sender_name, sender_signature)
    previews: list[BulkRecipientPreview] = []
    warnings: list[str] = []
    ai_drafts: dict[str, tuple[str, str]] = {}
    if ai_draft and not body_template.strip() and objective.strip():
        ai_drafts, warnings = await draft_bulk_emails(
            parsed.recipients,
            tenant_id=DEFAULT_TENANT,
            objective=objective.strip(),
            tone=tone,
            language=language,
            sender_name=sender_name.strip(),
            sender_signature=(sender_signature.strip() or sender_name.strip()),
        )
    for item in parsed.rows:
        subject, body = "", ""
        if body_template.strip():
            subject, body = render_bulk_email(subject_template, body_template, item.fields, context)
        else:
            subject, body = ai_drafts.get(item.recipient.recipient_id, ("", ""))
        previews.append(
            BulkRecipientPreview(
                row=item.row,
                name=item.recipient.name or "",
                email=str(item.recipient.email),
                subject=subject or None,
                body=body or None,
            )
        )
    return BulkParseResponse(
        filename=file.filename or "recipients.xlsx",
        total_rows=parsed.total_rows,
        recipient_count=len(parsed.rows),
        max_recipients=MAX_BULK_RECIPIENTS,
        recipients=previews,
        skipped=[BulkSkippedRow(row=item.row, reason=item.reason) for item in parsed.skipped],
        columns=[BulkColumn(token=item.token, column=item.column, role=item.role) for item in parsed.columns],
        warnings=warnings,
    )


@app.post("/api/v1/outreach/bulk", response_model=BulkRunResponse)
async def bulk_outreach(
    http_request: Request,
    file: UploadFile = File(...),
    dry_run: bool = Form(default=True),
    approval_granted: bool = Form(default=False),
    objective: str = Form(...),
    language: str = Form(default="en"),
    tone: str = Form(default="professional"),
    sender_name: str = Form(default=""),
    sender_email: str = Form(default=""),
    sender_signature: str = Form(default=""),
    connection_id: str = Form(default=""),
    subject_template: str = Form(default=""),
    body_template: str = Form(default=""),
    ai_draft: bool = Form(default=False),
    attachments_json: str = Form(default=""),
    x_session_id: str | None = Header(default=None),
) -> BulkRunResponse:
    session_tenant(http_request.cookies.get(SESSION_COOKIE) or x_session_id, DEFAULT_TENANT)
    if not dry_run:
        if not approval_granted:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Explicit approval is required before live sending.",
            )
        if not connection_id.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Connect and select a Gmail account before live sending.",
            )

    parsed = parse_uploaded_bulk(file)
    # Validate attachments before any AI drafting so a bad payload never
    # spends Sarvam tokens or reaches the provider.
    attachments = parse_bulk_attachments(attachments_json)
    context = bulk_token_context(objective, sender_name, sender_signature)
    ai_drafts: dict[str, tuple[str, str]] = {}
    ai_warnings: list[str] = []
    if ai_draft and not body_template.strip() and objective.strip():
        ai_drafts, ai_warnings = await draft_bulk_emails(
            parsed.recipients,
            tenant_id=DEFAULT_TENANT,
            objective=objective.strip(),
            tone=tone,
            language=language,
            sender_name=sender_name.strip(),
            sender_signature=(sender_signature.strip() or sender_name.strip()),
            connection_id=connection_id.strip(),
        )
    recipients: list[Recipient] = []
    for item in parsed.rows:
        recipient = item.recipient
        subject, body = ("", "")
        if body_template.strip():
            subject, body = render_bulk_email(subject_template, body_template, item.fields, context)
        else:
            subject, body = ai_drafts.get(item.recipient.recipient_id, ("", ""))
        if subject and body:
            attributes = dict(recipient.attributes)
            attributes["email_subject"] = subject
            attributes["email_body"] = body
            recipient = recipient.model_copy(update={"attributes": attributes})
        recipients.append(recipient)
    try:
        request = OutreachInput(
            tenant_id=DEFAULT_TENANT,
            workflow_run_id=f"bulk-{uuid4()}",
            agent_instance_id="universal-outreach-bulk",
            idempotency_key=f"bulk-{uuid4()}",
            channel="email",
            objective=objective,
            language=language,
            tone=tone,
            recipients=recipients,
            sender_name=sender_name.strip() or None,
            sender_email=sender_email.strip() or None,
            sender_signature=sender_signature.strip() or None,
            connection_id=connection_id.strip() or None,
            config_version="1.0.0",
            require_approval=True,
            approval_granted=approval_granted,
            dry_run=dry_run,
            attachments=attachments,
        )
    except ValidationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="The bulk run configuration is invalid. Check the objective, language, and tone values.",
        ) from error

    result = await service.execute(request)
    parsed_by_id = {item.recipient.recipient_id: item for item in parsed.rows}

    def outcome_text(item: Any, key: str) -> str | None:
        value = item.outcome.get(key) if isinstance(item.outcome, dict) else None
        return value if isinstance(value, str) and value else None

    return BulkRunResponse(
        status=result.status,
        dry_run=dry_run,
        recipient_count=len(result.results),
        results=[
            BulkRecipientResult(
                row=parsed_by_id[item.recipient_id].row if item.recipient_id in parsed_by_id else 0,
                name=parsed_by_id[item.recipient_id].recipient.name or "",
                email=str(parsed_by_id[item.recipient_id].recipient.email)
                if item.recipient_id in parsed_by_id
                else "",
                status=item.status,
                error_code=item.error_code,
                error_message_safe=item.error_message_safe,
                subject=outcome_text(item, "subject"),
                body=outcome_text(item, "body"),
            )
            for item in result.results
        ],
        skipped=[BulkSkippedRow(row=item.row, reason=item.reason) for item in parsed.skipped],
        warnings=[*ai_warnings, *result.warnings],
        attachments=[attachment.filename for attachment in attachments],
    )


@app.get("/api/v1/runs/{idempotency_key}", response_model=OutreachResult)
async def get_run(idempotency_key: str) -> OutreachResult:
    result = service.get_run(idempotency_key)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found.")
    return result


@app.post("/api/v1/webhooks/{provider}")
async def provider_webhook(provider: str, event: ProviderEvent) -> dict[str, Any]:
    if event.provider != provider:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provider mismatch.")
    return service.ingest_event(provider, event.event_id)
