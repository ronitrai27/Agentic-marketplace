from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path
from typing import Dict, List, Optional

__version__ = "1.3.0"

GUIDES: Dict[str, Dict[str, str]] = {
    "py": {"label": "Python", "file": "Catelog-PY.md"},
    "ts": {"label": "TypeScript", "file": "Catelog-TS.md"},
}


def print_help() -> None:
    print(
        f"""catelog v{__version__}

Usage:
  catelog init [--lang py|ts] [--yes] [--force]   Add the Catelog setup guide to the current project
  catelog --version                               Print the version
  catelog --help                                  Show this help

Options:
  -l, --lang <py|ts>   Pick the guide language (Catelog-PY.md or Catelog-TS.md)
  -y, --yes            Don't ask; install the guide (Python unless --lang is given)
  -f, --force          Overwrite an existing guide"""
    )


def _flag_value(args: List[str], name: str) -> Optional[str]:
    for a in args:
        if a.startswith(f"{name}="):
            return a[len(name) + 1 :]
    if name in args:
        idx = args.index(name)
        if idx + 1 < len(args):
            return args[idx + 1]
    return None


def _ask(question: str) -> str:
    try:
        return input(question).strip().lower()
    except EOFError:
        return ""


def _confirm(question: str, default_yes: bool = True) -> bool:
    suffix = "(Y/n)" if default_yes else "(y/N)"
    ans = _ask(f"{question} {suffix} ")
    if ans == "":
        return default_yes
    return ans in ("y", "yes")


def _choose_language() -> str:
    while True:
        ans = _ask("Which SDK are you using? [1] Python  [2] TypeScript (default: 1) ")
        if ans in ("", "1", "py", "python"):
            return "py"
        if ans in ("2", "ts", "typescript"):
            return "ts"
        print("Please type 1 or 2.")


def _find_guide_source(filename: str) -> Optional[Path]:
    pkg_dir = Path(__file__).resolve().parent
    candidates = [
        pkg_dir / filename,
        pkg_dir.parent.parent / filename,
        pkg_dir.parent.parent.parent / "ts-sdk" / filename,
    ]
    for c in candidates:
        if c.is_file():
            return c
    return None


def init_cmd(args: List[str]) -> None:
    flags = {a for a in args if a.startswith("-") and "=" not in a}
    yes = "-y" in flags or "--yes" in flags
    force = "-f" in flags or "--force" in flags
    lang_flag = (_flag_value(args, "--lang") or _flag_value(args, "-l"))
    if lang_flag:
        lang_flag = lang_flag.lower()

    if lang_flag and lang_flag not in GUIDES:
        print(f'Unknown language "{lang_flag}". Use "py" or "ts".', file=sys.stderr)
        sys.exit(1)

    is_tty = sys.stdin.isatty()
    interactive = not yes and is_tty
    if not yes and not is_tty:
        print("Non-interactive shell: skipped. Run `catelog init --yes [--lang py|ts]` to install the guide.")
        return

    if interactive and not _confirm("Add the Catelog setup guide to this project?"):
        print("Skipped. You can run `catelog init` any time.")
        return

    lang = lang_flag or (_choose_language() if interactive else "py")
    guide = GUIDES[lang]
    target = Path(os.environ.get("INIT_CWD") or os.getcwd()) / guide["file"]
    source = _find_guide_source(guide["file"])

    if target.exists() and not force:
        if not interactive or not _confirm(f"{guide['file']} already exists. Overwrite it?", False):
            print(f"Kept your existing {guide['file']}. Use --force to overwrite.")
            return

    if source is not None and source.exists():
        shutil.copyfile(source, target)
    else:
        target.write_text("", encoding="utf-8")

    print(f"✔ Added {target} ({guide['label']})")


def main(argv: Optional[List[str]] = None) -> None:
    args = argv if argv is not None else sys.argv[1:]
    flags = {a for a in args if a.startswith("-") and "=" not in a}
    command = next((a for a in args if not a.startswith("-")), None)

    if "-v" in flags or "--version" in flags:
        print(__version__)
        return
    if "-h" in flags or "--help" in flags or not command:
        print_help()
        return
    if command == "init":
        init_cmd(args)
        return

    print(f"Unknown command: {command}\n", file=sys.stderr)
    print_help()
    sys.exit(1)


if __name__ == "__main__":
    main()

