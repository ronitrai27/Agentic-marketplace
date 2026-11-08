from __future__ import annotations

import os
from typing import Any, Dict, Literal, Optional

_C = {
    "reset": "\x1b[0m",
    "bold": "\x1b[1m",
    "dim": "\x1b[2m",
    "italic": "\x1b[3m",
    "underline": "\x1b[4m",
    "cyan": "\x1b[36m",
    "brightCyan": "\x1b[96m",
    "magenta": "\x1b[35m",
    "brightMagenta": "\x1b[95m",
    "blue": "\x1b[34m",
    "brightBlue": "\x1b[94m",
    "green": "\x1b[32m",
    "brightGreen": "\x1b[92m",
    "yellow": "\x1b[33m",
    "brightYellow": "\x1b[93m",
    "red": "\x1b[31m",
    "gray": "\x1b[90m",
    "white": "\x1b[97m",
    "bgMagenta": "\x1b[45m",
}

BannerDetails = Dict[str, Any]


def render_banner(
    mode: Literal["install", "startup"] = "install",
    details: Optional[Dict[str, Any]] = None,
) -> None:
    if os.environ.get("CI") or os.environ.get("CATELOG_SILENT"):
        return

    c = _C
    ascii_catelog = (
        f"\n  {c['brightCyan']}  ██████╗ █████╗ ████████╗███████╗██╗      ██████╗  ██████╗ "
        f"\n  {c['brightCyan']} ██╔════╝██╔══██╗╚══██╔══╝██╔════╝██║     ██╔═══██╗██╔════╝ "
        f"\n  {c['brightMagenta']} ██║     ███████║   ██║   █████╗  ██║     ██║   ██║██║  ███╗"
        f"\n  {c['brightMagenta']} ██║     ██╔══██║   ██║   ██╔══╝  ██║     ██║   ██║██║   ██║"
        f"\n  {c['magenta']} ╚██████╗██║  ██║   ██║   ███████╗███████╗╚██████╔╝╚██████╔╝"
        f"\n  {c['magenta']}  ╚═════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚══════╝ ╚═════╝  ╚═════╝ "
    )

    width = 68
    line = c["gray"] + ("─" * width) + c["reset"]
    double_line = c["brightMagenta"] + ("═" * width) + c["reset"]

    print("\n" + double_line)
    print(ascii_catelog)
    print(line)

    print(f"  {c['bgMagenta']}{c['white']}{c['bold']} NOTE FROM TEAM ROX {c['reset']}")
    print(
        f"  {c['brightYellow']}{c['italic']}\"Welcome to the agent economy, where humans and agents rent out intelligence.\"{c['reset']}"
    )
    print(line)

    if mode == "install":
        print(f"  {c['green']}✔{c['reset']} {c['bold']}Catelog Python SDK installed successfully!{c['reset']}")
        print(f"  {c['dim']}Supported runtimes & package managers:{c['reset']}")
        print(
            f"  {c['cyan']}uv{c['reset']} {c['gray']}|{c['reset']} {c['brightBlue']}pip{c['reset']} "
            f"{c['gray']}|{c['reset']} {c['brightMagenta']}poetry{c['reset']} {c['gray']}|{c['reset']} "
            f"{c['brightYellow']}pdm{c['reset']} {c['gray']}• Python 3.10+ • Pydantic v2{c['reset']}"
        )
        print("")
        print(f"  {c['bold']}Quick Start:{c['reset']}")
        print(f"  {c['dim']}from catelog import create_agent{c['reset']}")
        print(f"  {c['dim']}agent = create_agent(name=\"My Agent\", max_timeout_minute=5, execute=...){c['reset']}")
        print(f"  {c['dim']}agent.listen(3000){c['reset']}")
    else:
        d = details or {}
        name = d.get("name") or "Catelog Agent"
        url = d.get("url") or "http://localhost:3000"
        exec_mode = d.get("mode") or "sync"
        has_auth = bool(d.get("authConfigured") or d.get("auth_configured"))

        print(f"  {c['green']}●{c['reset']} {c['bold']}{name}{c['reset']} is active and ready for jobs!")
        print(line)

        auth_str = (
            f"{c['green']}✔ Secret key configured{c['reset']}"
            if has_auth
            else f"{c['yellow']}⚠ Dev mode (no auth){c['reset']}"
        )
        print(f"  {c['dim']}URL:{c['reset']}       {c['brightCyan']}{url}{c['reset']}")
        print(f"  {c['dim']}Mode:{c['reset']}      {c['white']}{exec_mode}{c['reset']}")
        print(f"  {c['dim']}Auth:{c['reset']}      {auth_str}")
        print(line)

        print(f"  {c['bold']}Endpoints:{c['reset']}")
        print(f"    {c['green']}GET {c['reset']} {c['white']}{url}/health{c['reset']}    {c['gray']}← Ping probe{c['reset']}")
        print(f"    {c['green']}GET {c['reset']} {c['white']}{url}/schema{c['reset']}    {c['gray']}← Agent manifest{c['reset']}")
        print(f"    {c['brightMagenta']}POST{c['reset']} {c['white']}{url}/execute{c['reset']}   {c['gray']}← Run agent{c['reset']}")
        if exec_mode == "async":
            print(f"    {c['cyan']}GET {c['reset']} {c['white']}{url}/tasks/:id{c['reset']} {c['gray']}← Poll async job{c['reset']}")

    print(double_line + "\n")


renderBanner = render_banner

