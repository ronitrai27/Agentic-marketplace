from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from catelog import SecurityManager, ed25519_sign


def _b64u(data: bytes | str) -> str:
    b = data.encode("utf-8") if isinstance(data, str) else data
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def main() -> None:
    raw = os.environ.get("CATELOG_SIGNING_KEY")
    if not raw:
        env_path = Path(__file__).resolve().parents[3] / "client" / ".env.local"
        if env_path.exists():
            text = env_path.read_text(encoding="utf-8")
            m = re.search(r'CATELOG_SIGNING_KEY="([\s\S]*?)"', text)
            if m:
                raw = m.group(1)
    if not raw:
        print("SKIP: No CATELOG_SIGNING_KEY found")
        return

    pem = raw.replace("\\n", "\n")
    pub = "cat_pub_live_testcreator"

    def mint(sub: str, ttl: int, iat_offset: int = 0) -> str:
        iat = int(time.time()) + iat_offset
        h = _b64u(json.dumps({"alg": "EdDSA", "typ": "JWT", "kid": "k1"}, separators=(",", ":")))
        p = _b64u(
            json.dumps(
                {
                    "iss": "catelog",
                    "sub": sub,
                    "scope": "test",
                    "iat": iat,
                    "exp": iat + ttl,
                    "jti": str(uuid.uuid4()),
                },
                separators=(",", ":"),
            )
        )
        sig = _b64u(ed25519_sign(pem, f"{h}.{p}".encode("utf-8")))
        return f"cat_test_{h}.{p}.{sig}"

    sec = SecurityManager({"secret": "cat_sec_live_x", "publicKey": pub})

    def auth(token: str):
        return sec.authenticate_request(
            method="POST",
            path="/execute",
            headers={"authorization": f"Bearer {token}"},
            raw_body=b"{}",
        )

    cases = [
        ("valid token", mint(pub, 60), True),
        ("other creator", mint("cat_pub_live_someoneelse", 60), False),
        ("expired", mint(pub, 60, -600), False),
        ("ttl too long", mint(pub, 3600), False),
        ("tampered", mint(pub, 60)[:-3] + "AAA", False),
    ]

    failed = 0
    for name, token, should_pass in cases:
        ok = False
        msg = ""
        try:
            ok = auth(token).authMode == "test"
        except Exception as e:
            msg = str(e)
        good = ok == should_pass
        if not good:
            failed += 1
        print(f"{'PASS' if good else 'FAIL'}  {name}{f'  ({msg})' if msg else ''}")

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()

