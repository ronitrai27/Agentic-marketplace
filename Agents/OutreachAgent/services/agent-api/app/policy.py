import base64
from dataclasses import dataclass

from .models import OutreachInput, Recipient


@dataclass(frozen=True)
class PolicyDecision:
    allowed: bool
    code: str | None = None
    message: str | None = None


def evaluate_request(request: OutreachInput) -> PolicyDecision:
    allowed_types = {
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/plain",
        "text/csv",
        "image/png",
        "image/jpeg",
    }
    for attachment in request.attachments:
        if attachment.content_type.lower() not in allowed_types:
            return PolicyDecision(False, "unsupported_attachment_type", "This attachment type is not supported.")
        try:
            decoded_size = len(base64.b64decode(attachment.content_base64, validate=True))
        except (ValueError, TypeError):
            return PolicyDecision(False, "invalid_attachment", "An attachment is invalid.")
        if decoded_size > 10 * 1024 * 1024:
            return PolicyDecision(False, "attachment_too_large", "Each attachment must be 10 MB or smaller.")
    if not request.sender_name or not request.sender_name.strip() or request.sender_email is None:
        return PolicyDecision(
            allowed=False,
            code="missing_sender_identity",
            message="Email sender name and verified sender email are required.",
        )
    if not request.dry_run and request.require_approval and not request.approval_granted:
        return PolicyDecision(
            allowed=False,
            code="approval_required",
            message="Live external actions require an approval decision before dispatch.",
        )

    for recipient in request.recipients:
        decision = evaluate_recipient(recipient)
        if not decision.allowed:
            return decision

    return PolicyDecision(allowed=True)


def evaluate_recipient(recipient: Recipient) -> PolicyDecision:
    if recipient.email is None:
        return PolicyDecision(
            allowed=False,
            code="missing_email",
            message=f"Recipient {recipient.recipient_id} has no email address.",
        )
    if not recipient.name or not recipient.name.strip():
        return PolicyDecision(
            allowed=False,
            code="missing_name",
            message=f"Recipient {recipient.recipient_id} has no recipient name.",
        )
    if recipient.attributes.get("suppressed") is True:
        return PolicyDecision(
            allowed=False,
            code="suppressed_recipient",
            message=f"Recipient {recipient.recipient_id} is suppressed.",
        )
    if recipient.attributes.get("consent") is False:
        return PolicyDecision(
            allowed=False,
            code="missing_consent",
            message=f"Recipient {recipient.recipient_id} does not have required consent.",
        )
    return PolicyDecision(allowed=True)
