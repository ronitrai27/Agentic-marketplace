from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from .adapters import (
    ProviderDispatchError,
    ProviderNotConfiguredError,
    adapter_for,
    normalized_outcome,
)
from .models import (
    AgentInstance,
    AgentInstanceCreate,
    ConfigValidationResponse,
    EmailConnection,
    OutreachConfig,
    OutreachInput,
    OutreachResult,
    PublishResponse,
    RecipientResult,
    WorkflowDraft,
    WorkflowRecord,
    WorkflowValidation,
)
from .policy import evaluate_recipient, evaluate_request
from .persistence import PersistentStore
from .registry import get_manifest


class OutreachService:
    def __init__(self) -> None:
        self.runs: dict[str, OutreachResult] = {}
        self.provider_events: set[tuple[str, str]] = set()
        self.instances: dict[str, AgentInstance] = {}
        self.workflows: dict[str, WorkflowRecord] = {}
        self.email_connections: dict[str, EmailConnection] = {}
        self.email_tokens: dict[str, dict[str, str | None]] = {}
        self.store = PersistentStore()

    def list_email_connections(self, tenant_id: str) -> list[EmailConnection]:
        persisted = [
            EmailConnection.model_validate(item)
            for item in self.store.load_connections(tenant_id)
        ]
        current = [item for item in self.email_connections.values() if item.tenant_id == tenant_id]
        return persisted + [item for item in current if item.id not in {record.id for record in persisted}]

    def save_email_connection(
        self,
        connection: EmailConnection,
        *,
        access_token: str,
        refresh_token: str | None = None,
    ) -> EmailConnection:
        self.email_connections[connection.id] = connection
        self.email_tokens[connection.id] = {
            "access_token": access_token,
            "refresh_token": refresh_token,
        }
        self.store.save_connection(connection.model_dump(), access_token, refresh_token)
        return connection

    def get_email_connection(self, connection_id: str, tenant_id: str) -> EmailConnection | None:
        connection = self.email_connections.get(connection_id)
        if connection is not None and connection.tenant_id == tenant_id:
            return connection
        for persisted in self.store.load_connections(tenant_id):
            if persisted["id"] == connection_id:
                return EmailConnection.model_validate(persisted)
        return None

    def get_email_access_token(self, connection_id: str, tenant_id: str) -> str | None:
        if self.get_email_connection(connection_id, tenant_id) is None:
            return None
        token = self.email_tokens.get(connection_id, {}).get("access_token")
        if not token:
            persisted = self.store.load_token(connection_id)
            token = persisted.get("access_token") if persisted else None
        return token if isinstance(token, str) and token else None

    def create_instance(self, payload: AgentInstanceCreate) -> AgentInstance:
        instance = AgentInstance(
            id=str(uuid4()),
            tenant_id=payload.tenant_id,
            agent_id=payload.agent_id,
            version="1.0.0",
            status="draft",
            config=payload.config,
            warnings=self._config_warnings(payload.config),
        )
        self.instances[instance.id] = instance
        self.store.save_instance(instance.model_dump())
        self.store.audit(instance.tenant_id, instance.tenant_id, "agent.created", instance.id, {"status": instance.status})
        return instance

    def get_instance(self, instance_id: str, tenant_id: str = "demo-tenant") -> AgentInstance | None:
        instance = self.instances.get(instance_id)
        if instance is not None:
            return instance
        for persisted in self.store.load_instances(tenant_id):
            if persisted["id"] == instance_id:
                return AgentInstance.model_validate(persisted)
        return None

    def list_instances(self, tenant_id: str) -> list[AgentInstance]:
        current = [item for item in self.instances.values() if item.tenant_id == tenant_id]
        persisted = [AgentInstance.model_validate(item) for item in self.store.load_instances(tenant_id)]
        known = {item.id for item in current}
        return persisted + [item for item in current if item.id not in {record.id for record in persisted}]

    def validate_config(self, config: OutreachConfig) -> ConfigValidationResponse:
        warnings = self._config_warnings(config)
        errors: list[dict[str, str]] = []
        if not config.objective.strip():
            errors.append({"field": "objective", "message": "Objective is required."})
        return ConfigValidationResponse(
            valid=not errors,
            warnings=warnings,
            errors=errors,
            config=config,
        )

    def publish_instance(self, instance_id: str, tenant_id: str = "demo-tenant") -> PublishResponse:
        instance = self.instances.get(instance_id)
        if instance is None:
            instance = self.get_instance(instance_id, tenant_id)
        if instance is None:
            raise KeyError(instance_id)
        validation = self.validate_config(instance.config)
        if not validation.valid:
            raise ValueError("Configuration must pass validation before publishing.")
        published = instance.model_copy(update={"status": "published"})
        self.instances[instance_id] = published
        self.store.save_instance(published.model_dump())
        self.store.audit(published.tenant_id, published.tenant_id, "agent.published", instance_id, {})
        return PublishResponse(instance=published, published=True)

    @staticmethod
    def _config_warnings(config: OutreachConfig) -> list[str]:
        warnings: list[str] = []
        if config.dry_run:
            warnings.append("Dry run is enabled; no provider side effect can occur.")
        if not config.dry_run and config.require_approval:
            warnings.append("A separate approval decision is required before live dispatch.")
        return warnings

    def create_workflow(self, draft: WorkflowDraft) -> WorkflowRecord:
        workflow = WorkflowRecord(id=str(uuid4()), **draft.model_dump())
        self.workflows[workflow.id] = workflow
        return workflow

    def validate_workflow(self, workflow: WorkflowDraft) -> WorkflowValidation:
        errors: list[dict[str, str]] = []
        node_ids = {node.id for node in workflow.nodes}
        if len(node_ids) != len(workflow.nodes):
            errors.append({"field": "nodes", "message": "Node IDs must be unique."})
        for node in workflow.nodes:
            if get_manifest(node.agent_id) is None:
                errors.append({"field": f"nodes.{node.id}", "message": "Agent is not registered."})
        for edge in workflow.edges:
            if edge.source not in node_ids or edge.target not in node_ids:
                errors.append({"field": f"edges.{edge.id}", "message": "Edge references an unknown node."})
            if edge.source == edge.target:
                errors.append({"field": f"edges.{edge.id}", "message": "Self-referencing edges are not allowed."})
        return WorkflowValidation(
            valid=not errors,
            errors=errors,
            warnings=["Workflow execution is available after the graph is published."],
        )

    def publish_workflow(self, workflow_id: str) -> WorkflowRecord:
        workflow = self.workflows.get(workflow_id)
        if workflow is None:
            raise KeyError(workflow_id)
        validation = self.validate_workflow(workflow)
        if not validation.valid:
            raise ValueError("Workflow must pass validation before publishing.")
        published = workflow.model_copy(update={"status": "published", "version": workflow.version + 1})
        self.workflows[workflow_id] = published
        return published

    async def execute(self, request: OutreachInput) -> OutreachResult:
        existing = self.runs.get(request.idempotency_key)
        if existing is not None:
            return existing

        policy = evaluate_request(request)
        if not policy.allowed:
            result = OutreachResult(
                workflow_run_id=request.workflow_run_id,
                agent_instance_id=request.agent_instance_id,
                status="failed",
                results=[
                    RecipientResult(
                        recipient_id=recipient.recipient_id,
                        status="failed",
                        error_code=policy.code,
                        error_message_safe=policy.message,
                    )
                    for recipient in request.recipients
                ],
                warnings=["No external provider action was attempted."],
            )
            self.runs[request.idempotency_key] = result
            self._persist_result(request, result)
            return result

        connection = None
        access_token = None
        if request.connection_id:
            connection = self.get_email_connection(request.connection_id, request.tenant_id)
            access_token = self.get_email_access_token(request.connection_id, request.tenant_id)
            if connection is None or access_token is None:
                result = OutreachResult(
                    workflow_run_id=request.workflow_run_id,
                    agent_instance_id=request.agent_instance_id,
                    status="failed",
                    results=[
                        RecipientResult(
                            recipient_id=recipient.recipient_id,
                            status="failed",
                            error_code="email_connection_unavailable",
                            error_message_safe="The selected email connection is unavailable.",
                        )
                        for recipient in request.recipients
                    ],
                    warnings=["No external provider action was attempted."],
                )
                self.runs[request.idempotency_key] = result
                self._persist_result(request, result)
                return result
            if request.sender_email and str(request.sender_email).lower() != str(connection.email).lower():
                result = OutreachResult(
                    workflow_run_id=request.workflow_run_id,
                    agent_instance_id=request.agent_instance_id,
                    status="failed",
                    results=[
                        RecipientResult(
                            recipient_id=recipient.recipient_id,
                            status="failed",
                            error_code="sender_identity_mismatch",
                            error_message_safe="The sender email must match the selected connected account.",
                        )
                        for recipient in request.recipients
                    ],
                    warnings=["No external provider action was attempted."],
                )
                self.runs[request.idempotency_key] = result
                self._persist_result(request, result)
                return result

        adapter = adapter_for(connection=connection, access_token=access_token)
        results: list[RecipientResult] = []
        for recipient in request.recipients:
            recipient_policy = evaluate_recipient(recipient)
            if not recipient_policy.allowed:
                results.append(
                    RecipientResult(
                        recipient_id=recipient.recipient_id,
                        status="suppressed" if recipient_policy.code == "suppressed_recipient" else "failed",
                        error_code=recipient_policy.code,
                        error_message_safe=recipient_policy.message,
                    )
                )
                continue

            if request.dry_run:
                results.append(
                    RecipientResult(
                        recipient_id=recipient.recipient_id,
                        status="drafted",
                        outcome=normalized_outcome(recipient, request.attachments),
                        warnings=["Dry run: no external provider call was made."],
                    )
                )
                continue

            try:
                provider_reference, provider_status, outcome = await adapter.dispatch(request, recipient)
                status = "delivered"
                if provider_status == "submitted":
                    status = "submitted"
                elif provider_status != "delivered":
                    status = "unknown"
                results.append(
                    RecipientResult(
                        recipient_id=recipient.recipient_id,
                        status=status,
                        provider_reference=provider_reference,
                        outcome=outcome,
                        completed_at=datetime.now(timezone.utc),
                    )
                )
            except ProviderNotConfiguredError as error:
                results.append(
                    RecipientResult(
                        recipient_id=recipient.recipient_id,
                        status="failed",
                        error_code="provider_not_configured",
                        error_message_safe=str(error),
                    )
                )
            except ProviderDispatchError as error:
                results.append(
                    RecipientResult(
                        recipient_id=recipient.recipient_id,
                        status="failed",
                        error_code="provider_dispatch_failed",
                        error_message_safe=str(error),
                    )
                )

        statuses = {item.status for item in results}
        if statuses and statuses <= {"drafted"}:
            run_status = "succeeded"
        elif "unknown" in statuses or "failed" in statuses or "suppressed" in statuses:
            run_status = "partial" if any(
                item.status in {"drafted", "delivered"} for item in results
            ) else "failed"
        else:
            run_status = "succeeded"

        result = OutreachResult(
            workflow_run_id=request.workflow_run_id,
            agent_instance_id=request.agent_instance_id,
            status=run_status,
            results=results,
            warnings=[],
        )
        self.runs[request.idempotency_key] = result
        self._persist_result(request, result)
        return result

    def get_run(self, idempotency_key: str) -> OutreachResult | None:
        return self.runs.get(idempotency_key)

    def list_logs(self, tenant_id: str) -> list[dict[str, Any]]:
        return self.store.load_logs(tenant_id)

    def _persist_result(self, request: OutreachInput, result: OutreachResult) -> None:
        self.store.save_run(
            request.tenant_id,
            request.agent_instance_id,
            request.idempotency_key,
            result.status,
            result.model_dump(mode="json"),
        )
        self.store.audit(
            request.tenant_id,
            request.tenant_id,
            "outreach.run",
            request.workflow_run_id,
            {"status": result.status, "agent_instance_id": request.agent_instance_id},
        )

    def ingest_event(self, provider: str, event_id: str) -> dict[str, Any]:
        key = (provider, event_id)
        duplicate = key in self.provider_events
        self.provider_events.add(key)
        return {"accepted": True, "duplicate": duplicate}
