from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class Recipient(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recipient_id: str = Field(min_length=1)
    name: str | None = None
    email: EmailStr | None = None
    locale: str | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)


class EmailAttachment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1, max_length=180)
    content_type: str = Field(min_length=1, max_length=120)
    content_base64: str = Field(min_length=1)


class OutreachInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["1.0"] = "1.0"
    tenant_id: str = Field(min_length=1)
    workflow_run_id: str = Field(min_length=1)
    agent_instance_id: str = Field(min_length=1)
    idempotency_key: str = Field(min_length=1)
    channel: Literal["email"]
    objective: str = Field(min_length=1, max_length=2000)
    language: str = Field(default="en", min_length=2, max_length=20)
    tone: Literal[
        "professional",
        "warm",
        "concise",
        "friendly",
        "persuasive",
        "empathetic",
        "formal",
        "casual",
        "direct",
    ] = "professional"
    recipients: list[Recipient] = Field(min_length=1, max_length=500)
    sender_name: str | None = Field(default=None, max_length=120)
    sender_email: EmailStr | None = None
    sender_signature: str | None = Field(default=None, max_length=500)
    connection_id: str | None = Field(default=None, min_length=1)
    config_version: str = Field(min_length=1)
    require_approval: bool = True
    approval_granted: bool = False
    dry_run: bool = True
    attachments: list[EmailAttachment] = Field(default_factory=list, max_length=5)


RecipientStatus = Literal[
    "drafted",
    "awaiting_approval",
    "queued",
    "submitted",
    "delivered",
    "failed",
    "suppressed",
    "unknown",
]
RunStatus = Literal["accepted", "running", "partial", "succeeded", "failed", "cancelled"]


class RecipientResult(BaseModel):
    recipient_id: str
    status: RecipientStatus
    provider_reference: str | None = None
    outcome: dict[str, Any] = Field(default_factory=dict)
    error_code: str | None = None
    error_message_safe: str | None = None
    completed_at: datetime | None = None
    warnings: list[str] = Field(default_factory=list)


class OutreachResult(BaseModel):
    contract_version: Literal["1.0"] = "1.0"
    workflow_run_id: str
    agent_instance_id: str
    status: RunStatus
    results: list[RecipientResult]
    warnings: list[str] = Field(default_factory=list)


class BulkColumn(BaseModel):
    token: str
    column: str
    role: str


class BulkRecipientPreview(BaseModel):
    row: int
    name: str
    email: EmailStr
    subject: str | None = None
    body: str | None = None


class BulkSkippedRow(BaseModel):
    row: int
    reason: str


class BulkParseResponse(BaseModel):
    filename: str
    total_rows: int
    recipient_count: int
    max_recipients: int
    recipients: list[BulkRecipientPreview]
    skipped: list[BulkSkippedRow] = Field(default_factory=list)
    columns: list[BulkColumn] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class BulkRecipientResult(BaseModel):
    row: int
    name: str
    email: str
    status: str
    error_code: str | None = None
    error_message_safe: str | None = None
    subject: str | None = None
    body: str | None = None


class BulkRunResponse(BaseModel):
    status: RunStatus
    dry_run: bool
    recipient_count: int
    results: list[BulkRecipientResult]
    skipped: list[BulkSkippedRow] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    attachments: list[str] = Field(default_factory=list)


class OutreachConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    channel: Literal["email"] = "email"
    objective: str = Field(default="", max_length=2000)
    language: str = "en"
    tone: Literal[
        "professional", "warm", "concise", "friendly", "persuasive",
        "empathetic", "formal", "casual", "direct",
    ] = "professional"
    require_approval: bool = True
    dry_run: bool = True
    max_actions_per_recipient: int = Field(default=1, ge=1, le=5)


class AgentManifest(BaseModel):
    agent_id: str
    version: str
    name: str
    category: str
    capabilities: list[str]
    input_schema_ref: str
    config_schema_ref: str
    output_schema_ref: str
    modes: list[dict[str, str]]
    side_effects: bool
    approval_policy: str
    runtime: dict[str, Any]


class ProviderEvent(BaseModel):
    provider: str
    event_id: str = Field(min_length=1)
    event_type: str = Field(min_length=1)
    provider_reference: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class EmailConnection(BaseModel):
    id: str
    tenant_id: str
    provider: Literal["gmail"]
    email: EmailStr
    display_name: str
    status: Literal["connected", "revoked", "error"]
    scopes: list[str] = Field(default_factory=list)


class EmailConnectionStart(BaseModel):
    tenant_id: str = Field(min_length=1)
    provider: Literal["gmail"]
    return_url: str = Field(min_length=1)


class AgentInstanceCreate(BaseModel):
    tenant_id: str = Field(min_length=1)
    agent_id: str = Field(min_length=1)
    config: OutreachConfig


class AgentInstance(BaseModel):
    id: str
    tenant_id: str
    agent_id: str
    version: str
    status: Literal["draft", "published", "archived"]
    config: OutreachConfig
    warnings: list[str] = Field(default_factory=list)


class ConfigValidationResponse(BaseModel):
    valid: bool
    warnings: list[str] = Field(default_factory=list)
    errors: list[dict[str, str]] = Field(default_factory=list)
    config: OutreachConfig


class PublishResponse(BaseModel):
    instance: AgentInstance
    published: bool


class WorkflowNode(BaseModel):
    id: str = Field(min_length=1)
    agent_id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    config: dict[str, Any] = Field(default_factory=dict)


class WorkflowEdge(BaseModel):
    id: str = Field(min_length=1)
    source: str = Field(min_length=1)
    target: str = Field(min_length=1)
    condition: str | None = None


class WorkflowDraft(BaseModel):
    tenant_id: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=120)
    nodes: list[WorkflowNode] = Field(min_length=1)
    edges: list[WorkflowEdge] = Field(default_factory=list)


class WorkflowRecord(WorkflowDraft):
    id: str
    version: int = 1
    status: Literal["draft", "published"] = "draft"


class WorkflowValidation(BaseModel):
    valid: bool
    errors: list[dict[str, str]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
