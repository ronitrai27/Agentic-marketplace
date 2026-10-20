from .models import AgentManifest


UNIVERSAL_OUTREACH_MANIFEST = AgentManifest(
    agent_id="universal-outreach-agent",
    version="1.0.0",
    name="Universal Outreach Agent",
    category="outreach",
    capabilities=[
        "email_outreach",
        "personalization",
        "approval_gating",
        "partial_success",
        "delivery_tracking",
    ],
    input_schema_ref="outreach.input.v1",
    config_schema_ref="universal_outreach.config.v1",
    output_schema_ref="outreach.result.v1",
    modes=[
        {"id": "email", "required_integration": "email_provider"},
    ],
    side_effects=True,
    approval_policy="required_by_default",
    runtime={"handler": "universal_outreach", "timeout_seconds": 900},
)


def list_manifests() -> list[AgentManifest]:
    return [UNIVERSAL_OUTREACH_MANIFEST]


def get_manifest(agent_id: str) -> AgentManifest | None:
    if agent_id == UNIVERSAL_OUTREACH_MANIFEST.agent_id:
        return UNIVERSAL_OUTREACH_MANIFEST
    return None
