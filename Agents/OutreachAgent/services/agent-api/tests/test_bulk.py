import io
import json
import os

os.environ.setdefault("INTERNAL_API_TOKEN", "test-internal-token")

from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.main import app
from app.bulk import MAX_BULK_RECIPIENTS

client = TestClient(app)

XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def make_workbook(header: list[str], rows: list[list[object]]) -> bytes:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.append(header)
    for row in rows:
        worksheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def default_rows(count: int) -> list[list[object]]:
    return [[f"Recipient {index}", f"recipient{index}@example.com", "Agency context"] for index in range(count)]


def upload_parse(data: bytes, filename: str = "recipients.xlsx", form: dict[str, str] | None = None):
    return client.post(
        "/api/v1/outreach/bulk/parse",
        files={"file": (filename, data, XLSX_CONTENT_TYPE)},
        data=form or {},
    )


def upload_run(data: bytes, *, filename: str = "recipients.xlsx", form: dict[str, object] | None = None):
    fields: dict[str, str] = {
        "objective": "Request an introductory meeting.",
        "sender_name": "Test Sender",
        "sender_email": "sender@example.com",
        "dry_run": "true",
    }
    if form:
        fields.update({key: str(value) for key, value in form.items()})
    return client.post(
        "/api/v1/outreach/bulk",
        files={"file": (filename, data, XLSX_CONTENT_TYPE)},
        data=fields,
    )


def test_bulk_parse_returns_recipients_and_skips_invalid_rows() -> None:
    data = make_workbook(
        ["Name", "Email", "Context"],
        [
            ["Jane Doe", "jane@example.com", "Agency A"],
            ["Bad Email", "not-an-email", ""],
            ["No Email", "", ""],
            ["No Name", "", "missing name on purpose"],
            ["John Roe", "john@example.com", ""],
        ],
    )
    response = upload_parse(data)
    assert response.status_code == 200
    payload = response.json()
    assert payload["total_rows"] == 5
    assert payload["recipient_count"] == 2
    assert payload["max_recipients"] == MAX_BULK_RECIPIENTS
    assert [item["email"] for item in payload["recipients"]] == ["jane@example.com", "john@example.com"]
    assert payload["recipients"][0]["name"] == "Jane Doe"
    assert payload["recipients"][0]["row"] == 2
    assert len(payload["skipped"]) == 3
    assert payload["skipped"][0]["row"] == 3
    assert "not a valid email" in payload["skipped"][0]["reason"]


def test_bulk_parse_rejects_more_than_fifty_rows() -> None:
    data = make_workbook(["Name", "Email"], default_rows(MAX_BULK_RECIPIENTS + 1))
    response = upload_parse(data)
    assert response.status_code == 400
    assert str(MAX_BULK_RECIPIENTS) in response.json()["detail"]


def test_bulk_parse_accepts_fifty_rows() -> None:
    data = make_workbook(["Name", "Email"], default_rows(MAX_BULK_RECIPIENTS))
    response = upload_parse(data)
    assert response.status_code == 200
    assert response.json()["recipient_count"] == MAX_BULK_RECIPIENTS


def test_bulk_parse_rejects_missing_email_column() -> None:
    data = make_workbook(["Name", "Phone"], [["Jane", "+911234567890"]])
    response = upload_parse(data)
    assert response.status_code == 400
    assert "'email' column" in response.json()["detail"]


def test_bulk_parse_rejects_non_excel_file() -> None:
    response = upload_parse(b"name,email\nJane,jane@example.com\n", filename="recipients.csv")
    assert response.status_code == 400
    assert ".xlsx" in response.json()["detail"]


def test_bulk_parse_rejects_workbook_without_rows() -> None:
    data = make_workbook(["Name", "Email"], [])
    response = upload_parse(data)
    assert response.status_code == 400
    assert "No recipient rows" in response.json()["detail"]


def test_bulk_dry_run_returns_recipient_directory() -> None:
    data = make_workbook(
        ["Name", "Email"],
        [["Jane Doe", "jane@example.com"], ["John Roe", "john@example.com"]],
    )
    response = upload_run(data)
    assert response.status_code == 200
    payload = response.json()
    assert payload["dry_run"] is True
    assert payload["status"] == "succeeded"
    assert payload["recipient_count"] == 2
    directory = {item["email"]: item for item in payload["results"]}
    assert set(directory) == {"jane@example.com", "john@example.com"}
    assert directory["jane@example.com"]["name"] == "Jane Doe"
    assert directory["jane@example.com"]["status"] == "drafted"
    assert directory["jane@example.com"]["row"] == 2


def test_bulk_live_send_requires_approval() -> None:
    data = make_workbook(["Name", "Email"], default_rows(1))
    response = upload_run(
        data,
        form={"dry_run": "false", "approval_granted": "false", "connection_id": "connection-1"},
    )
    assert response.status_code == 400
    assert "approval" in response.json()["detail"].lower()


def test_bulk_live_send_requires_connection() -> None:
    data = make_workbook(["Name", "Email"], default_rows(1))
    response = upload_run(data, form={"dry_run": "false", "approval_granted": "true"})
    assert response.status_code == 400
    assert "Gmail" in response.json()["detail"]


def test_bulk_run_rejects_invalid_tone() -> None:
    data = make_workbook(["Name", "Email"], default_rows(1))
    response = upload_run(data, form={"tone": "sarcastic"})
    assert response.status_code == 422


def test_bulk_parse_detects_flexible_headers() -> None:
    data = make_workbook(
        ["Author Name", "E-Mail Address", "Company", "Campaign City"],
        [["Aarav Sharma", "aarav@example.com", "Sarvam Labs", "Pune"]],
    )
    response = upload_parse(data)
    assert response.status_code == 200
    payload = response.json()
    roles = {item["token"]: item["role"] for item in payload["columns"]}
    assert roles["name"] == "name"
    assert roles["email"] == "email"
    assert roles["company"] == "company"
    assert roles["campaign_city"] == "extra"
    assert payload["recipients"][0]["email"] == "aarav@example.com"
    assert payload["recipients"][0]["name"] == "Aarav Sharma"


def test_bulk_parse_derives_name_from_email_when_name_column_missing() -> None:
    data = make_workbook(["Email"], [["aarav.sharma@example.com"]])
    response = upload_parse(data)
    assert response.status_code == 200
    assert response.json()["recipients"][0]["name"] == "Aarav Sharma"


def test_bulk_parse_renders_personalized_email_per_row() -> None:
    data = make_workbook(
        ["Name", "Email", "Company"],
        [
            ["Aarav Sharma", "aarav@example.com", "Sarvam Labs"],
            ["Priya Patel", "priya@example.com", "Bright Agency"],
        ],
    )
    response = upload_parse(
        data,
        form={
            "subject_template": "{{name}}, quick intro from {{sender_name}}",
            "body_template": (
                "Hi {{first_name}},\n\nI am reaching out on behalf of our team. "
                "{{objective}}\n\nCompany on file: {{company}}. Unknown: {{nothing_here}}\n\n"
                "Best regards,\n{{sender_signature}}"
            ),
            "objective": "Request an introductory meeting.",
            "sender_name": "Madhav",
            "sender_signature": "Madhav",
        },
    )
    assert response.status_code == 200
    recipients = response.json()["recipients"]
    first, second = recipients[0], recipients[1]
    assert first["subject"] == "Aarav Sharma, quick intro from Madhav"
    assert "Hi Aarav," in first["body"]
    assert "Company on file: Sarvam Labs." in first["body"]
    assert "{{" not in first["body"]
    assert "Unknown:" in first["body"]  # empty value, but text stays clean
    assert "Hi Priya," in second["body"]
    assert "Company on file: Bright Agency." in second["body"]
    assert second["subject"] == "Priya Patel, quick intro from Madhav"


def test_bulk_run_uses_template_emails_in_dry_run() -> None:
    data = make_workbook(
        ["Name", "Email"],
        [["Jane Doe", "jane@example.com"], ["John Roe", "john@example.com"]],
    )
    response = upload_run(
        data,
        form={
            "subject_template": "Hello {{first_name}}",
            "body_template": "Hi {{first_name}},\n\n{{objective}}\n\nThanks,\n{{sender_name}}",
            "objective": "Request an introductory meeting.",
            "sender_name": "Test Sender",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "succeeded"
    by_email = {item["email"]: item for item in payload["results"]}
    assert by_email["jane@example.com"]["subject"] == "Hello Jane"
    assert "Hi Jane," in by_email["jane@example.com"]["body"]
    assert by_email["john@example.com"]["subject"] == "Hello John"
    assert "{{" not in (by_email["jane@example.com"]["body"] or "")


def test_bulk_run_without_template_keeps_generic_dry_outcome() -> None:
    data = make_workbook(["Name", "Email"], [["Jane Doe", "jane@example.com"]])
    response = upload_run(data, form={"ai_draft": "false"})
    assert response.status_code == 200
    item = response.json()["results"][0]
    assert item["status"] == "drafted"
    assert item["subject"] is None
    assert item["body"] is None


class _FakeComposer:
    async def compose(self, request, recipient):
        return (
            f"Role for {recipient.name}",
            f"Hello {recipient.name},\n\n{request.objective}\n\nRegards,\n{request.sender_name}",
        )


def test_bulk_parse_ai_drafts_each_row(monkeypatch) -> None:
    from app import drafting

    drafting.clear_draft_cache()
    monkeypatch.setattr(drafting, "SarvamEmailComposer", lambda: _FakeComposer())
    data = make_workbook(
        ["Name", "Email", "Company"],
        [["Aarav Sharma", "aarav@example.com", "Sarvam Labs"], ["Priya Patel", "priya@example.com", "X"]],
    )
    response = upload_parse(
        data,
        form={"ai_draft": "true", "objective": "Applying for the Python developer role.", "sender_name": "Madhav"},
    )
    assert response.status_code == 200
    recipients = response.json()["recipients"]
    assert recipients[0]["subject"] == "Role for Aarav Sharma"
    assert "Applying for the Python developer role." in recipients[0]["body"]
    assert recipients[1]["subject"] == "Role for Priya Patel"
    assert response.json()["warnings"] == []


def test_bulk_parse_template_wins_over_ai_draft(monkeypatch) -> None:
    from app import drafting

    drafting.clear_draft_cache()

    class _Boom:
        def compose(self, *args, **kwargs):  # pragma: no cover - must not run
            raise AssertionError("composer should not be called when a template is given")

    monkeypatch.setattr(drafting, "SarvamEmailComposer", lambda: _Boom())
    data = make_workbook(["Name", "Email"], [["Jane Doe", "jane@example.com"]])
    response = upload_parse(
        data,
        form={
            "ai_draft": "true",
            "objective": "Intro",
            "sender_name": "Madhav",
            "subject_template": "Hi {{first_name}}",
            "body_template": "Hello {{first_name}},\n\n{{objective}}",
        },
    )
    assert response.status_code == 200
    assert response.json()["recipients"][0]["subject"] == "Hi Jane"


def test_bulk_run_ai_drafts_are_attached_to_results(monkeypatch) -> None:
    from app import drafting

    drafting.clear_draft_cache()
    monkeypatch.setattr(drafting, "SarvamEmailComposer", lambda: _FakeComposer())
    data = make_workbook(["Name", "Email"], [["Jane Roe", "jane@example.com"]])
    response = upload_run(
        data,
        form={"ai_draft": "true", "objective": "Request a demo.", "sender_name": "Madhav"},
    )
    assert response.status_code == 200
    item = response.json()["results"][0]
    assert item["status"] == "drafted"
    assert item["subject"] == "Role for Jane Roe"
    assert "Request a demo." in (item["body"] or "")


def _text_attachment(filename: str = "resume.txt", content: str = "hello") -> str:
    import base64 as _base64

    return json.dumps(
        [
            {
                "filename": filename,
                "content_type": "text/plain",
                "content_base64": _base64.b64encode(content.encode()).decode(),
            }
        ]
    )


def test_bulk_run_accepts_attachments() -> None:
    data = make_workbook(["Name", "Email"], [["Jane Doe", "jane@example.com"]])
    response = upload_run(data, form={"attachments_json": _text_attachment()})
    assert response.status_code == 200
    payload = response.json()
    assert payload["attachments"] == ["resume.txt"]
    assert payload["status"] == "succeeded"


def test_bulk_run_rejects_malformed_attachments_json() -> None:
    data = make_workbook(["Name", "Email"], [["Jane Doe", "jane@example.com"]])
    response = upload_run(data, form={"attachments_json": "not-json"})
    assert response.status_code == 400
    assert "JSON array" in response.json()["detail"]


def test_bulk_run_rejects_unsupported_attachment_type_via_policy() -> None:
    import base64 as _base64

    bad = json.dumps(
        [
            {
                "filename": "payload.exe",
                "content_type": "application/x-msdownload",
                "content_base64": _base64.b64encode(b"MZ").decode(),
            }
        ]
    )
    data = make_workbook(["Name", "Email"], [["Jane Doe", "jane@example.com"]])
    response = upload_run(data, form={"attachments_json": bad})
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "failed"
    assert payload["results"][0]["error_code"] == "unsupported_attachment_type"
