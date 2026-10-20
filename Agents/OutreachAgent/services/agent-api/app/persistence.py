import base64
import hashlib
import json
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet

try:
    import psycopg
    from psycopg.rows import dict_row
    from psycopg.types.json import Json
except ImportError:
    psycopg = None
    dict_row = None
    Json = None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PersistentStore:
    def __init__(self) -> None:
        configured_path = os.getenv("OUTREACH_STORE_PATH")
        self.path = Path(configured_path) if configured_path else Path(__file__).resolve().parents[2] / "outreach.local.db"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.database_url = os.getenv("DATABASE_URL", "")
        self.use_postgres = os.getenv("PERSISTENCE_BACKEND", "sqlite").lower() == "postgres"
        if self.use_postgres and psycopg is None:
            raise RuntimeError("PERSISTENCE_BACKEND=postgres requires psycopg[binary].")
        self._fernet = Fernet(self._encryption_key())
        self._initialize()

    def _encryption_key(self) -> bytes:
        configured = os.getenv("OUTREACH_TOKEN_ENCRYPTION_KEY")
        if configured:
            return configured.encode("ascii")
        seed = os.getenv("INTERNAL_API_TOKEN", "local-development-only")
        return base64.urlsafe_b64encode(hashlib.sha256(seed.encode()).digest())

    def _connect(self):
        if self.use_postgres:
            return psycopg.connect(self.database_url, row_factory=dict_row)
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _query(self, connection, query: str, parameters: tuple[Any, ...] = ()):
        if self.use_postgres:
            return connection.execute(query.replace("?", "%s"), parameters)
        return connection.execute(query, parameters)

    def _json(self, value: Any):
        return Json(value) if self.use_postgres else json.dumps(value)

    @staticmethod
    def _decode_json(value: Any):
        return json.loads(value) if isinstance(value, str) else value

    def _initialize(self) -> None:
        if self.use_postgres:
            schema_path = Path(__file__).resolve().parents[3] / "database" / "002_runtime_store.sql"
            with self._connect() as connection:
                connection.execute(schema_path.read_text(encoding="utf-8"))
            return
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                  id TEXT PRIMARY KEY,
                  tenant_id TEXT NOT NULL,
                  expires_at TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  last_seen_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runtime_email_connections (
                  id TEXT PRIMARY KEY,
                  tenant_id TEXT NOT NULL,
                  provider TEXT NOT NULL,
                  email TEXT NOT NULL,
                  display_name TEXT NOT NULL,
                  status TEXT NOT NULL,
                  scopes TEXT NOT NULL,
                  access_token TEXT NOT NULL,
                  refresh_token TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runtime_agent_instances (
                  id TEXT PRIMARY KEY,
                  tenant_id TEXT NOT NULL,
                  agent_id TEXT NOT NULL,
                  version TEXT NOT NULL,
                  status TEXT NOT NULL,
                  config TEXT NOT NULL,
                  warnings TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runtime_run_logs (
                  id TEXT PRIMARY KEY,
                  tenant_id TEXT NOT NULL,
                  agent_instance_id TEXT NOT NULL,
                  idempotency_key TEXT NOT NULL,
                  status TEXT NOT NULL,
                  result TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runtime_audit_events (
                  id TEXT PRIMARY KEY,
                  tenant_id TEXT NOT NULL,
                  actor TEXT NOT NULL,
                  action TEXT NOT NULL,
                  resource_ref TEXT NOT NULL,
                  metadata TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );
                """
            )

    def create_session(self, tenant_id: str) -> tuple[str, datetime]:
        now = utc_now()
        expires = now + timedelta(hours=1)
        session_id = secrets.token_urlsafe(32)
        with self._connect() as connection:
            self._query(connection,
                "INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
                (session_id, tenant_id, expires.isoformat(), now.isoformat(), now.isoformat()),
            )
        return session_id, expires

    def touch_session(self, session_id: str, tenant_id: str) -> datetime | None:
        now = utc_now()
        with self._connect() as connection:
            row = self._query(connection,
                "SELECT expires_at FROM sessions WHERE id = ? AND tenant_id = ?",
                (session_id, tenant_id),
            ).fetchone()
            if not row:
                return None
            expires_value = row["expires_at"]
            expires = (
                datetime.fromisoformat(expires_value)
                if isinstance(expires_value, str)
                else expires_value
            )
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if expires <= now:
                self._query(connection, "DELETE FROM sessions WHERE id = ?", (session_id,))
                return None
            self._query(connection,
                "UPDATE sessions SET last_seen_at = ? WHERE id = ?",
                (now.isoformat(), session_id),
            )
            return expires

    def save_connection(self, connection: dict[str, Any], access_token: str, refresh_token: str | None) -> None:
        now = utc_now().isoformat()
        with self._connect() as database:
            self._query(database,
                """
                INSERT INTO runtime_email_connections
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  status = excluded.status, scopes = excluded.scopes,
                  access_token = excluded.access_token, refresh_token = excluded.refresh_token,
                  updated_at = excluded.updated_at
                """,
                (
                    connection["id"], connection["tenant_id"], connection["provider"],
                    connection["email"], connection["display_name"], connection["status"],
                    self._json(connection.get("scopes", [])),
                    self._fernet.encrypt(access_token.encode()).decode(),
                    self._fernet.encrypt(refresh_token.encode()).decode() if refresh_token else None,
                    now, now,
                ),
            )

    def load_connections(self, tenant_id: str) -> list[dict[str, Any]]:
        with self._connect() as database:
            rows = self._query(database,
                "SELECT id, tenant_id, provider, email, display_name, status, scopes FROM runtime_email_connections WHERE tenant_id = ? ORDER BY updated_at DESC",
                (tenant_id,),
            ).fetchall()
        return [
            {**dict(row), "scopes": self._decode_json(row["scopes"])}
            for row in rows
        ]

    def load_token(self, connection_id: str) -> dict[str, str | None] | None:
        with self._connect() as database:
            row = self._query(database,
                "SELECT access_token, refresh_token FROM runtime_email_connections WHERE id = ?",
                (connection_id,),
            ).fetchone()
        if not row:
            return None
        return {
            "access_token": self._fernet.decrypt(row["access_token"].encode()).decode(),
            "refresh_token": self._fernet.decrypt(row["refresh_token"].encode()).decode()
            if row["refresh_token"] else None,
        }

    def save_instance(self, instance: dict[str, Any]) -> None:
        now = utc_now().isoformat()
        with self._connect() as database:
            self._query(database,
                "INSERT INTO runtime_agent_instances VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, config = EXCLUDED.config, warnings = EXCLUDED.warnings, updated_at = EXCLUDED.updated_at",
                (instance["id"], instance["tenant_id"], instance["agent_id"], instance["version"],
                 instance["status"], self._json(instance["config"]), self._json(instance.get("warnings", [])),
                 instance.get("created_at", now), now),
            )

    def load_instances(self, tenant_id: str) -> list[dict[str, Any]]:
        with self._connect() as database:
            rows = self._query(database,
                "SELECT * FROM runtime_agent_instances WHERE tenant_id = ? ORDER BY updated_at DESC",
                (tenant_id,),
            ).fetchall()
        return [
            {**dict(row), "config": self._decode_json(row["config"]), "warnings": self._decode_json(row["warnings"])}
            for row in rows
        ]

    def save_run(self, tenant_id: str, agent_instance_id: str, idempotency_key: str, status: str, result: dict[str, Any]) -> None:
        with self._connect() as database:
            self._query(database,
                "INSERT INTO runtime_run_logs VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, idempotency_key) DO UPDATE SET status = EXCLUDED.status, result = EXCLUDED.result, created_at = EXCLUDED.created_at",
                (secrets.token_hex(16), tenant_id, agent_instance_id, idempotency_key, status,
                 self._json(result), utc_now().isoformat()),
            )

    def load_logs(self, tenant_id: str, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as database:
            rows = self._query(database,
                "SELECT * FROM runtime_run_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?",
                (tenant_id, limit),
            ).fetchall()
        return [{**dict(row), "result": self._decode_json(row["result"])} for row in rows]

    def audit(self, tenant_id: str, actor: str, action: str, resource_ref: str, metadata: dict[str, Any]) -> None:
        with self._connect() as database:
            self._query(database,
                "INSERT INTO runtime_audit_events VALUES (?, ?, ?, ?, ?, ?, ?)",
                (secrets.token_hex(16), tenant_id, actor, action, resource_ref,
                 self._json(metadata), utc_now().isoformat()),
            )
