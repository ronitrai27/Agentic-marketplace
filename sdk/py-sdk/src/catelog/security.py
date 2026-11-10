from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
import time
import uuid
from typing import Any, Dict, Optional, Set, Tuple, Union

from .types import AttrDict

# ─────────────────────────────────────────────────
#  Test tokens (marketplace-signed, short-lived)
# ─────────────────────────────────────────────────

CATELOG_TEST_KEYS: Dict[str, str] = {
    "k1": """-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAAqBmhtzqR7yK6bs6gBVFcTxJ4BfOzAy44eL5bnkr2mY=
-----END PUBLIC KEY-----""",
    "k2": """-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAadt7RamI1So/DxtYtzPvxl4GJ8ccYrP1Y4Mg3wDXfEs=
-----END PUBLIC KEY-----""",
}

TEST_TOKEN_PREFIX = "cat_test_"
TEST_TOKEN_LEEWAY_MS = 30_000
TEST_TOKEN_MAX_TTL_SEC = 300

# ─────────────────────────────────────────────────
#  Pure-Python RFC 8032 Ed25519 (zero C-deps)
# ─────────────────────────────────────────────────

_ED_P = 2**255 - 19
_ED_L = 2**252 + 27742317777372353535851937790883648493
_ED_D = (-121665 * pow(121666, _ED_P - 2, _ED_P)) % _ED_P
_ED_I = pow(2, (_ED_P - 1) // 4, _ED_P)


def _ed_xrecover(y: int) -> int:
    xx = (y * y - 1) * pow(_ED_D * y * y + 1, _ED_P - 2, _ED_P) % _ED_P
    x = pow(xx, (_ED_P + 3) // 8, _ED_P)
    if (x * x - xx) % _ED_P != 0:
        x = (x * _ED_I) % _ED_P
    if x % 2 != 0:
        x = _ED_P - x
    return x


_ED_BY = 4 * pow(5, _ED_P - 2, _ED_P) % _ED_P
_ED_BX = _ed_xrecover(_ED_BY)
_ED_B = (_ED_BX % _ED_P, _ED_BY % _ED_P, 1, (_ED_BX * _ED_BY) % _ED_P)
_ED_IDENT = (0, 1, 1, 0)


def _ed_add(p: Tuple[int, int, int, int], q: Tuple[int, int, int, int]) -> Tuple[int, int, int, int]:
    x1, y1, z1, t1 = p
    x2, y2, z2, t2 = q
    a = ((y1 - x1) * (y2 - x2)) % _ED_P
    b = ((y1 + x1) * (y2 + x2)) % _ED_P
    c = (t1 * 2 * _ED_D * t2) % _ED_P
    d = (z1 * 2 * z2) % _ED_P
    e = (b - a) % _ED_P
    f = (d - c) % _ED_P
    g = (d + c) % _ED_P
    h = (b + a) % _ED_P
    return ((e * f) % _ED_P, (g * h) % _ED_P, (f * g) % _ED_P, (e * h) % _ED_P)


def _ed_scalarmult(p: Tuple[int, int, int, int], e: int) -> Tuple[int, int, int, int]:
    res = _ED_IDENT
    cur = p
    while e > 0:
        if e & 1:
            res = _ed_add(res, cur)
        cur = _ed_add(cur, cur)
        e >>= 1
    return res


def _ed_encodepoint(p: Tuple[int, int, int, int]) -> bytes:
    x, y, z, _ = p
    zi = pow(z, _ED_P - 2, _ED_P)
    x = (x * zi) % _ED_P
    y = (y * zi) % _ED_P
    bits = y | ((x & 1) << 255)
    return bits.to_bytes(32, "little")


def _ed_decodepoint(s: bytes) -> Tuple[int, int, int, int]:
    if len(s) != 32:
        raise ValueError("Invalid Ed25519 point length")
    unclamped = int.from_bytes(s, "little")
    y = unclamped & ((1 << 255) - 1)
    x_sign = unclamped >> 255
    if y >= _ED_P:
        raise ValueError("Invalid y coordinate")
    xx = (y * y - 1) * pow(_ED_D * y * y + 1, _ED_P - 2, _ED_P) % _ED_P
    x = pow(xx, (_ED_P + 3) // 8, _ED_P)
    if (x * x - xx) % _ED_P != 0:
        x = (x * _ED_I) % _ED_P
    if (x * x - xx) % _ED_P != 0:
        raise ValueError("Point is not on curve")
    if x == 0 and x_sign == 1:
        raise ValueError("Invalid x=0 with sign bit")
    if (x & 1) != x_sign:
        x = _ED_P - x
    return (x, y, 1, (x * y) % _ED_P)


def _extract_ed25519_pubkey_bytes(pem: str) -> bytes:
    lines = [line.strip() for line in pem.strip().splitlines() if not line.strip().startswith("-----")]
    der = base64.b64decode("".join(lines))
    # Standard Ed25519 SPKI DER is 44 bytes with 12-byte header (302a300506032b6570032100) + 32-byte key
    if len(der) >= 32:
        return der[-32:]
    raise ValueError("Invalid Ed25519 public key PEM")


def _extract_ed25519_privkey_seed(pem: str) -> bytes:
    lines = [line.strip() for line in pem.strip().splitlines() if not line.strip().startswith("-----")]
    der = base64.b64decode("".join(lines))
    # Standard Ed25519 PKCS#8 DER ends with 04 20 + 32-byte seed
    if len(der) >= 32:
        return der[-32:]
    raise ValueError("Invalid Ed25519 private key PEM")


def ed25519_verify(pem: str, message: bytes, signature: bytes) -> bool:
    try:
        if len(signature) != 64:
            return False
        pub_bytes = _extract_ed25519_pubkey_bytes(pem)
        a_pt = _ed_decodepoint(pub_bytes)
        r_bytes = signature[:32]
        s_int = int.from_bytes(signature[32:], "little")
        if s_int >= _ED_L:
            return False
        r_pt = _ed_decodepoint(r_bytes)
        k = int.from_bytes(hashlib.sha512(r_bytes + pub_bytes + message).digest(), "little") % _ED_L
        lhs = _ed_scalarmult(_ED_B, s_int)
        rhs = _ed_add(r_pt, _ed_scalarmult(a_pt, k))
        return _ed_encodepoint(lhs) == _ed_encodepoint(rhs)
    except Exception:
        return False


def ed25519_sign(private_pem: str, message: bytes) -> bytes:
    """Signs a message with an Ed25519 PKCS#8 PEM private key (used in test token checks)."""
    seed = _extract_ed25519_privkey_seed(private_pem)
    h = hashlib.sha512(seed).digest()
    a = int.from_bytes(h[:32], "little")
    a &= (1 << 254) - 8
    a |= 1 << 254
    prefix = h[32:]
    pub_bytes = _ed_encodepoint(_ed_scalarmult(_ED_B, a))
    r = int.from_bytes(hashlib.sha512(prefix + message).digest(), "little") % _ED_L
    r_bytes = _ed_encodepoint(_ed_scalarmult(_ED_B, r))
    k = int.from_bytes(hashlib.sha512(r_bytes + pub_bytes + message).digest(), "little") % _ED_L
    s = (r + k * a) % _ED_L
    return r_bytes + s.to_bytes(32, "little")


def _b64url_decode(data: str) -> bytes:
    pad = "=" * ((4 - len(data) % 4) % 4)
    return base64.urlsafe_b64decode(data + pad)


# ─────────────────────────────────────────────────
#  Errors
# ─────────────────────────────────────────────────


class SecurityVerificationError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 401) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code

    @property
    def statusCode(self) -> int:
        return self.status_code


# ─────────────────────────────────────────────────
#  SecurityManager
# ─────────────────────────────────────────────────


class SecurityManager:
    def __init__(
        self,
        options: Optional[Dict[str, Any]] = None,
        *,
        secret: Optional[str] = None,
        public_key: Optional[str] = None,
        publicKey: Optional[str] = None,
        max_timestamp_drift_ms: Optional[int] = None,
        maxTimestampDriftMs: Optional[int] = None,
        nonce_ttl_ms: Optional[int] = None,
        nonceTtlMs: Optional[int] = None,
    ) -> None:
        opts = options or {}
        self.secret: Optional[str] = (
            secret or opts.get("secret") or os.environ.get("CATELOG_SECRET_KEY") or None
        )
        self.public_key: Optional[str] = (
            public_key
            or publicKey
            or opts.get("public_key")
            or opts.get("publicKey")
            or os.environ.get("CATELOG_PUBLIC_KEY")
            or None
        )
        self.max_timestamp_drift_ms: int = (
            max_timestamp_drift_ms
            if max_timestamp_drift_ms is not None
            else (
                maxTimestampDriftMs
                if maxTimestampDriftMs is not None
                else opts.get("max_timestamp_drift_ms", opts.get("maxTimestampDriftMs", 300_000))
            )
        )
        self.nonce_ttl_ms: int = (
            nonce_ttl_ms
            if nonce_ttl_ms is not None
            else (
                nonceTtlMs
                if nonceTtlMs is not None
                else opts.get("nonce_ttl_ms", opts.get("nonceTtlMs", 300_000))
            )
        )
        self._seen_nonces: Dict[str, int] = {}
        self._active_run_ids: Set[str] = set()
        self._completed_run_ids: Dict[str, int] = {}

    def get_secret(self) -> Optional[str]:
        return self.secret

    def getSecret(self) -> Optional[str]:
        return self.secret

    def get_public_key(self) -> Optional[str]:
        return self.public_key

    def getPublicKey(self) -> Optional[str]:
        return self.public_key

    def set_secret(self, secret: str) -> None:
        self.secret = secret

    def setSecret(self, secret: str) -> None:
        self.secret = secret

    def set_public_key(self, public_key: str) -> None:
        self.public_key = public_key

    def setPublicKey(self, public_key: str) -> None:
        self.public_key = public_key

    def is_dev_mode(self) -> bool:
        env = (
            os.environ.get("CATELOG_ENV")
            or os.environ.get("PYTHON_ENV")
            or os.environ.get("NODE_ENV")
            or "development"
        )
        return not self.secret and env != "production"

    def isDevMode(self) -> bool:
        return self.is_dev_mode()

    def authenticate_request(
        self,
        params: Optional[Dict[str, Any]] = None,
        *,
        method: Optional[str] = None,
        path: Optional[str] = None,
        headers: Optional[Dict[str, Any]] = None,
        raw_body: Optional[Union[str, bytes]] = None,
        rawBody: Optional[Union[str, bytes]] = None,
    ) -> AttrDict:
        self._cleanup_old_entries()

        p = params or {}
        req_method = method or p.get("method") or "POST"
        req_path = path or p.get("path") or "/execute"
        raw_headers = headers if headers is not None else (p.get("headers") or {})
        body = (
            raw_body
            if raw_body is not None
            else (rawBody if rawBody is not None else p.get("raw_body", p.get("rawBody", b"")))
        )

        # Normalize header keys to lowercase for reliable lookup
        norm_headers: Dict[str, str] = {}
        for k, v in raw_headers.items():
            if v is None:
                continue
            if isinstance(v, list):
                norm_headers[k.lower()] = v[0] if v else ""
            else:
                norm_headers[k.lower()] = str(v)

        sig_header = norm_headers.get("x-marketplace-signature")
        if sig_header:
            return self._verify_hmac(req_method, req_path, norm_headers, body, sig_header)

        auth_header = norm_headers.get("authorization")
        if auth_header:
            return self._verify_bearer(auth_header, norm_headers)

        if self.is_dev_mode():
            run_id = norm_headers.get("x-marketplace-run-id") or f"dev-{uuid.uuid4().hex[:8]}"
            nonce = norm_headers.get("x-marketplace-nonce") or f"dev-{uuid.uuid4().hex[:8]}"
            env = os.environ.get("PYTHON_ENV") or os.environ.get("NODE_ENV") or ""
            if env != "test" and not os.environ.get("CATELOG_SILENT"):
                print(
                    "\x1b[33m⚠ [catelog] Running in dev mode — no authentication required. "
                    "Set CATELOG_SECRET_KEY in production.\x1b[0m",
                    file=sys.stderr,
                )
            now_ms = int(time.time() * 1000)
            return AttrDict(
                run_id=run_id,
                runId=run_id,
                nonce=nonce,
                timestamp=now_ms,
                auth_mode="dev",
                authMode="dev",
            )

        raise SecurityVerificationError(
            "AUTH_MISSING_KEY",
            "No authentication provided. Supply Authorization: Bearer <key> or HMAC signature headers.",
            401,
        )

    def authenticateRequest(self, params: Optional[Dict[str, Any]] = None, **kwargs: Any) -> AttrDict:
        return self.authenticate_request(params, **kwargs)

    def _verify_bearer(self, auth_header: str, headers: Dict[str, str]) -> AttrDict:
        token = auth_header
        if token.lower().startswith("bearer"):
            token = token[6:].strip()
        else:
            token = token.strip()

        if not token:
            raise SecurityVerificationError("AUTH_INVALID_KEY", "Empty Bearer token", 401)

        now_ms = int(time.time() * 1000)

        # Marketplace-signed test token (cat_test_...)
        if token.startswith(TEST_TOKEN_PREFIX):
            if not self.public_key:
                if self.is_dev_mode():
                    run_id = headers.get("x-marketplace-run-id") or f"dev-{uuid.uuid4().hex[:8]}"
                    nonce = headers.get("x-marketplace-nonce") or f"dev-{uuid.uuid4().hex[:8]}"
                    return AttrDict(
                        run_id=run_id,
                        runId=run_id,
                        nonce=nonce,
                        timestamp=now_ms,
                        auth_mode="dev",
                        authMode="dev",
                    )
                raise SecurityVerificationError(
                    "AUTH_MISSING_KEY",
                    "Set CATELOG_PUBLIC_KEY on this agent to accept Catelog test tokens.",
                    401,
                )
            return self._verify_test_token(token, headers)

        # Secret key (cat_sec_live_...)
        if token.startswith("cat_sec_") and self.secret:
            if not hmac.compare_digest(token.encode("utf-8"), self.secret.encode("utf-8")):
                raise SecurityVerificationError("AUTH_INVALID_KEY", "Invalid secret key", 401)
            run_id = headers.get("x-marketplace-run-id") or f"run-{uuid.uuid4().hex[:8]}"
            nonce = headers.get("x-marketplace-nonce") or f"nonce-{uuid.uuid4().hex[:8]}"
            return AttrDict(
                run_id=run_id,
                runId=run_id,
                nonce=nonce,
                timestamp=now_ms,
                auth_mode="bearer",
                authMode="bearer",
            )

        # Public key (cat_pub_live_...)
        if token.startswith("cat_pub_") and self.public_key:
            if not hmac.compare_digest(token.encode("utf-8"), self.public_key.encode("utf-8")):
                raise SecurityVerificationError("AUTH_INVALID_KEY", "Invalid public key", 401)
            run_id = headers.get("x-marketplace-run-id") or f"pub-{uuid.uuid4().hex[:8]}"
            nonce = headers.get("x-marketplace-nonce") or f"pub-{uuid.uuid4().hex[:8]}"
            return AttrDict(
                run_id=run_id,
                runId=run_id,
                nonce=nonce,
                timestamp=now_ms,
                auth_mode="public",
                authMode="public",
            )

        if self.is_dev_mode():
            run_id = headers.get("x-marketplace-run-id") or f"dev-{uuid.uuid4().hex[:8]}"
            nonce = headers.get("x-marketplace-nonce") or f"dev-{uuid.uuid4().hex[:8]}"
            return AttrDict(
                run_id=run_id,
                runId=run_id,
                nonce=nonce,
                timestamp=now_ms,
                auth_mode="dev",
                authMode="dev",
            )

        raise SecurityVerificationError(
            "AUTH_INVALID_KEY",
            "Invalid API key format or key mismatch",
            401,
        )

    def _verify_test_token(self, token: str, headers: Dict[str, str]) -> AttrDict:
        def invalid(msg: str, code: str = "AUTH_INVALID_KEY") -> SecurityVerificationError:
            return SecurityVerificationError(code, msg, 401)

        parts = token[len(TEST_TOKEN_PREFIX) :].split(".")
        if len(parts) != 3:
            raise invalid("Malformed test token")
        h_b64, p_b64, sig_b64 = parts

        try:
            header = json.loads(_b64url_decode(h_b64).decode("utf-8"))
            claims = json.loads(_b64url_decode(p_b64).decode("utf-8"))
            sig_bytes = _b64url_decode(sig_b64)
        except Exception as exc:
            raise invalid("Malformed test token") from exc

        keys = dict(CATELOG_TEST_KEYS)
        env_pub = os.environ.get("CATELOG_TEST_PUBLIC_KEY")
        if env_pub:
            kid = os.environ.get("CATELOG_TEST_KID") or "env"
            keys[kid] = env_pub.replace("\\n", "\n")

        kid = header.get("kid")
        pem = keys.get(kid) if isinstance(kid, str) else None
        if header.get("alg") != "EdDSA" or not pem:
            raise invalid("Unrecognized test token key")

        if not ed25519_verify(pem, f"{h_b64}.{p_b64}".encode("utf-8"), sig_bytes):
            raise invalid("Invalid test token signature", "AUTH_INVALID_SIGNATURE")

        now_ms = int(time.time() * 1000)
        iat = claims.get("iat")
        exp = claims.get("exp")
        iat_ms = int(iat * 1000) if isinstance(iat, (int, float)) else 0
        exp_ms = int(exp * 1000) if isinstance(exp, (int, float)) else 0

        if (
            claims.get("iss") != "catelog"
            or claims.get("scope") != "test"
            or not exp
            or not iat
            or (exp_ms - iat_ms) > TEST_TOKEN_MAX_TTL_SEC * 1000
            or iat_ms > now_ms + TEST_TOKEN_LEEWAY_MS
        ):
            raise invalid("Invalid test token claims")

        if now_ms > exp_ms + TEST_TOKEN_LEEWAY_MS:
            raise invalid("Test token expired. Generate a new one.", "AUTH_TIMESTAMP_OUT_OF_BOUNDS")

        sub = str(claims.get("sub") or "")
        pub = str(self.public_key or "")
        if not hmac.compare_digest(sub.encode("utf-8"), pub.encode("utf-8")):
            raise invalid("Test token was issued for a different creator")

        jti = str(claims.get("jti") or uuid.uuid4().hex)
        run_id = headers.get("x-marketplace-run-id") or f"test-{jti[:8]}"
        nonce = headers.get("x-marketplace-nonce") or f"test-{uuid.uuid4().hex[:8]}"
        return AttrDict(
            run_id=run_id,
            runId=run_id,
            nonce=nonce,
            timestamp=now_ms,
            auth_mode="test",
            authMode="test",
        )

    def _verify_hmac(
        self,
        method: str,
        path: str,
        headers: Dict[str, str],
        raw_body: Union[str, bytes],
        signature_header: str,
    ) -> AttrDict:
        now_ms = int(time.time() * 1000)
        if not self.secret:
            if self.is_dev_mode():
                run_id = headers.get("x-marketplace-run-id") or f"dev-{uuid.uuid4().hex[:8]}"
                nonce = headers.get("x-marketplace-nonce") or f"dev-{uuid.uuid4().hex[:8]}"
                return AttrDict(
                    run_id=run_id,
                    runId=run_id,
                    nonce=nonce,
                    timestamp=now_ms,
                    auth_mode="dev",
                    authMode="dev",
                )
            raise SecurityVerificationError(
                "AUTH_MISSING_KEY",
                "HMAC signature provided but no secret key configured",
                401,
            )

        ts_header = headers.get("x-marketplace-timestamp")
        nonce_header = headers.get("x-marketplace-nonce")
        run_id_header = headers.get("x-marketplace-run-id")

        if not ts_header or not nonce_header or not run_id_header:
            raise SecurityVerificationError(
                "AUTH_INVALID_SIGNATURE",
                "Missing required HMAC headers (timestamp, nonce, run-id)",
                401,
            )

        try:
            timestamp = int(ts_header)
        except ValueError as exc:
            raise SecurityVerificationError(
                "AUTH_TIMESTAMP_OUT_OF_BOUNDS",
                "Malformed X-Marketplace-Timestamp header",
                401,
            ) from exc

        if abs(now_ms - timestamp) > self.max_timestamp_drift_ms:
            raise SecurityVerificationError(
                "AUTH_TIMESTAMP_OUT_OF_BOUNDS",
                f"Timestamp drift exceeds {self.max_timestamp_drift_ms}ms",
                401,
            )

        if nonce_header in self._seen_nonces:
            raise SecurityVerificationError(
                "AUTH_REPLAY_DETECTED",
                "Duplicate nonce (replay guard)",
                401,
            )

        if run_id_header in self._active_run_ids or run_id_header in self._completed_run_ids:
            raise SecurityVerificationError(
                "AUTH_REPLAY_DETECTED",
                f"Run ID {run_id_header} already active or completed",
                401,
            )

        body_hash = self.compute_body_hash(raw_body)
        canonical = self.build_canonical_string(
            method, path, ts_header, nonce_header, run_id_header, body_hash
        )
        expected_sig = self.calculate_signature(canonical, self.secret)

        if not hmac.compare_digest(
            signature_header.lower().encode("utf-8"),
            expected_sig.lower().encode("utf-8"),
        ):
            raise SecurityVerificationError(
                "AUTH_INVALID_SIGNATURE",
                "HMAC-SHA256 signature verification failed",
                401,
            )

        self._seen_nonces[nonce_header] = now_ms
        return AttrDict(
            run_id=run_id_header,
            runId=run_id_header,
            nonce=nonce_header,
            timestamp=timestamp,
            auth_mode="hmac",
            authMode="hmac",
        )

    def compute_body_hash(self, raw_body: Union[str, bytes]) -> str:
        data = raw_body.encode("utf-8") if isinstance(raw_body, str) else bytes(raw_body)
        return hashlib.sha256(data).hexdigest()

    def computeBodyHash(self, raw_body: Union[str, bytes]) -> str:
        return self.compute_body_hash(raw_body)

    def build_canonical_string(
        self,
        method: str,
        path: str,
        timestamp: Union[str, int],
        nonce: str,
        run_id: str,
        body_hash: str,
    ) -> str:
        norm_method = method.upper()
        norm_path = (path.split("?")[0] if path else "") or "/"
        return f"{norm_method}\n{norm_path}\n{timestamp}\n{nonce}\n{run_id}\n{body_hash}"

    def buildCanonicalString(
        self,
        method: str,
        path: str,
        timestamp: Union[str, int],
        nonce: str,
        run_id: str,
        body_hash: str,
    ) -> str:
        return self.build_canonical_string(method, path, timestamp, nonce, run_id, body_hash)

    def calculate_signature(self, canonical_string: str, secret: str) -> str:
        return hmac.new(
            secret.encode("utf-8"),
            canonical_string.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def calculateSignature(self, canonical_string: str, secret: str) -> str:
        return self.calculate_signature(canonical_string, secret)

    def mark_run_started(self, run_id: str) -> None:
        self._active_run_ids.add(run_id)

    def markRunStarted(self, run_id: str) -> None:
        self.mark_run_started(run_id)

    def mark_run_completed(self, run_id: str) -> None:
        self._active_run_ids.discard(run_id)
        self._completed_run_ids[run_id] = int(time.time() * 1000)

    def markRunCompleted(self, run_id: str) -> None:
        self.mark_run_completed(run_id)

    def _cleanup_old_entries(self) -> None:
        now_ms = int(time.time() * 1000)
        expiry = now_ms - self.nonce_ttl_ms
        expired_nonces = [n for n, t in self._seen_nonces.items() if t < expiry]
        for n in expired_nonces:
            self._seen_nonces.pop(n, None)
        expired_runs = [r for r, t in self._completed_run_ids.items() if t < expiry]
        for r in expired_runs:
            self._completed_run_ids.pop(r, None)

