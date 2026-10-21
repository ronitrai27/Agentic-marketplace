"""Helpers for turning LLM prose into real JSON.

CrewAI is asked for bare JSON, but models still wrap things in markdown fences
or add a sentence of preamble. This module recovers the payload instead of
blowing up the whole analysis.
"""

from __future__ import annotations

import json
import re
from typing import Any, TypeVar, get_args, get_origin

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

_FENCE_RE = re.compile(r"```(?:json|JSON)?\s*(.*?)```", re.S)


def _balanced_slice(text: str) -> str | None:
    """Return the first balanced ``{...}`` / ``[...]`` span found in *text*."""
    starts = [i for i, ch in enumerate(text) if ch in "{["]
    if not starts:
        return None

    for start in starts:
        opener = text[start]
        closer = "}" if opener == "{" else "]"
        depth = 0
        in_string = False
        escaped = False
        for i in range(start, len(text)):
            ch = text[i]
            if in_string:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
            elif ch == opener:
                depth += 1
            elif ch == closer:
                depth -= 1
                if depth == 0:
                    return text[start : i + 1]
    return None


def extract_json(text: Any) -> Any:
    """Best-effort parse of *text* into a ``dict`` or ``list``.

    Raises ``ValueError`` when nothing parseable can be recovered.
    """
    if isinstance(text, (dict, list)):
        return text
    if text is None:
        raise ValueError("empty model output")

    s = str(text).strip()
    if not s:
        raise ValueError("empty model output")

    fence = _FENCE_RE.search(s)
    candidates: list[str] = []
    if fence:
        candidates.append(fence.group(1).strip())
    candidates.append(s)
    balanced = _balanced_slice(s)
    if balanced:
        candidates.append(balanced)

    for candidate in candidates:
        if not candidate:
            continue
        for attempt in (candidate, re.sub(r",\s*([}\]])", r"\1", candidate)):
            try:
                return json.loads(attempt)
            except json.JSONDecodeError:
                continue

    raise ValueError(f"could not extract JSON from model output: {s[:200]!r}")


def _coerce(annotation: Any, value: Any) -> Any:
    """Coerce *value* toward *annotation* — models often answer
    ``"one risk"`` where a ``list[str]`` was expected."""
    if value is None:
        return value

    origin = get_origin(annotation)
    if origin is list:
        inner = get_args(annotation)[0] if get_args(annotation) else Any
        if isinstance(value, str):
            return [value] if value.strip() else []
        if isinstance(value, (list, tuple, set)):
            return [_coerce(inner, item) for item in value]
        return [value]
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return _coerce_model(annotation, value)
    return value


def _coerce_model(model: type[BaseModel], value: Any) -> Any:
    if isinstance(value, model) or value is None:
        return value
    if not isinstance(value, dict):
        return {}
    return {
        key: _coerce(model.model_fields[key].annotation, item) if key in model.model_fields else item
        for key, item in value.items()
    }


def _normalize(model: type[BaseModel], data: dict) -> dict:
    """Pre-validation pass that fixes scalar-vs-list mismatches per field."""
    return {
        key: _coerce(model.model_fields[key].annotation, value) if key in model.model_fields else value
        for key, value in data.items()
    }


def as_model(data: Any, model: type[T]) -> T:
    """Validate *data* against *model*, tolerating missing/oddly-typed keys.

    Every field in the result schemas carries a default, so a partial payload
    still validates — partial answers beat a failed analysis.
    """
    if isinstance(data, model):
        return data
    if not isinstance(data, dict):
        # A bare string/list where an object was expected.
        data = {"refined_idea": str(data)} if model.__name__ == "IdeaValidation" else {}
    try:
        return model.model_validate(_normalize(model, data))
    except Exception:
        known = {k: v for k, v in data.items() if k in model.model_fields}
        return model.model_validate(_normalize(model, known))
