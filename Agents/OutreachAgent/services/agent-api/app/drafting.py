"""AI-assisted per-recipient email drafting for bulk sends.

When the user does not supply their own template, each recipient row is
drafted individually by Sarvam using the run objective, the selected tone and
language, and every field parsed from the Excel row (company, city, role, ...).

Drafts are cached on a hash of everything that influences the text, so the
preview (parse) and the actual run return the exact same email for a
recipient — what the user reviewed is what gets sent.
"""

import asyncio
import hashlib
import json
import uuid
from collections import OrderedDict
from typing import Iterable

from pydantic import ValidationError

from .adapters import SarvamEmailComposer
from .models import OutreachInput, Recipient

MAX_CONCURRENT_DRAFTS = 5
_DRAFT_CACHE_LIMIT = 500
_DRAFT_CACHE: OrderedDict[str, tuple[str, str] | None] = OrderedDict()


def clear_draft_cache() -> None:
    _DRAFT_CACHE.clear()


def _cache_key(
    recipient: Recipient,
    objective: str,
    tone: str,
    language: str,
    sender_name: str,
    sender_signature: str,
) -> str:
    payload = json.dumps(
        {
            "email": str(recipient.email),
            "name": recipient.name,
            "fields": recipient.attributes.get("fields"),
            "objective": objective,
            "tone": tone,
            "language": language,
            "sender_name": sender_name,
            "sender_signature": sender_signature,
        },
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _remember(key: str, value: tuple[str, str] | None) -> None:
    _DRAFT_CACHE[key] = value
    _DRAFT_CACHE.move_to_end(key)
    while len(_DRAFT_CACHE) > _DRAFT_CACHE_LIMIT:
        _DRAFT_CACHE.popitem(last=False)


async def draft_bulk_emails(
    recipients: Iterable[Recipient],
    *,
    tenant_id: str,
    objective: str,
    tone: str,
    language: str,
    sender_name: str,
    sender_signature: str,
    connection_id: str = "",
) -> tuple[dict[str, tuple[str, str]], list[str]]:
    """Draft one personalized email per recipient; returns drafts and warnings."""
    recipients = list(recipients)
    if not recipients:
        return {}, []

    keys = {
        recipient.recipient_id: _cache_key(
            recipient, objective, tone, language, sender_name, sender_signature
        )
        for recipient in recipients
    }
    warnings: list[str] = []
    pending = [r for r in recipients if keys[r.recipient_id] not in _DRAFT_CACHE]

    if pending:
        try:
            draft_request = OutreachInput(
                tenant_id=tenant_id,
                workflow_run_id=f"bulk-draft-{uuid.uuid4()}",
                agent_instance_id="universal-outreach-bulk",
                idempotency_key=f"bulk-draft-{uuid.uuid4()}",
                channel="email",
                objective=objective,
                language=language,
                tone=tone,
                recipients=pending[:1],
                sender_name=sender_name or None,
                sender_signature=sender_signature or None,
                connection_id=connection_id or None,
                config_version="1.0.0",
                dry_run=True,
            )
        except ValidationError as error:
            return {}, [f"AI drafting is unavailable for this configuration: {error}"]

        composer = SarvamEmailComposer()
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_DRAFTS)

        async def draft_one(recipient: Recipient) -> tuple[str, tuple[str, str] | None]:
            key = keys[recipient.recipient_id]
            async with semaphore:
                try:
                    subject, body = await composer.compose(draft_request, recipient)
                except Exception:  # noqa: BLE001 - drafting is best-effort per row
                    return recipient.recipient_id, None
            return recipient.recipient_id, (subject, body)

        drafted = await asyncio.gather(*(draft_one(recipient) for recipient in pending))
        failed = 0
        for recipient_id, text in drafted:
            _remember(keys[recipient_id], text)
            if text is None:
                failed += 1
        if failed:
            warnings.append(
                f"{failed} email(s) could not be drafted by the AI and are excluded from the preview."
            )

    drafts: dict[str, tuple[str, str]] = {}
    for recipient in recipients:
        text = _DRAFT_CACHE.get(keys[recipient.recipient_id])
        if text is not None:
            drafts[recipient.recipient_id] = text
    return drafts, warnings
