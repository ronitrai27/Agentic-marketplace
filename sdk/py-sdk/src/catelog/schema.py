from __future__ import annotations

import dataclasses
from typing import Any, Dict, List, Optional, Type

from .types import AttrDict


def is_pydantic_schema(schema: Any) -> bool:
    if schema is None:
        return False
    # Pydantic v2 BaseModel class or instance
    if hasattr(schema, "model_json_schema") and hasattr(schema, "model_validate"):
        return True
    # Pydantic v1 BaseModel class or instance
    if hasattr(schema, "schema") and hasattr(schema, "parse_obj"):
        return True
    return False


isPydanticSchema = is_pydantic_schema


def is_zod_schema(schema: Any) -> bool:
    if is_pydantic_schema(schema):
        return True
    if schema is not None and not isinstance(schema, dict):
        if hasattr(schema, "safeParse") or hasattr(schema, "parse") or hasattr(schema, "toJSONSchema"):
            return True
    return False


isZodSchema = is_zod_schema


def _python_type_to_json_schema(py_type: Any) -> Dict[str, Any]:
    if py_type is str:
        return {"type": "string"}
    if py_type is int:
        return {"type": "integer"}
    if py_type is float:
        return {"type": "number"}
    if py_type is bool:
        return {"type": "boolean"}
    if py_type is list or getattr(py_type, "__origin__", None) is list:
        args = getattr(py_type, "__args__", ())
        items = _python_type_to_json_schema(args[0]) if args else {}
        return {"type": "array", "items": items}
    if py_type is dict or getattr(py_type, "__origin__", None) is dict:
        return {"type": "object"}
    return {"type": "string"}


def to_json_schema(schema: Any, title: Optional[str] = None) -> Dict[str, Any]:
    """
    Converts a Pydantic model (v2 or v1), Python dataclass, or JSON Schema dict
    into a standard JSON Schema dictionary.
    """
    if not schema:
        return {"type": "object"}

    # 1. Pydantic v2
    if hasattr(schema, "model_json_schema") and callable(schema.model_json_schema):
        try:
            js = schema.model_json_schema()
            if isinstance(js, dict):
                return js
        except Exception:
            pass

    # 2. Pydantic v1
    if hasattr(schema, "schema") and callable(schema.schema) and not isinstance(schema, dict):
        try:
            js = schema.schema()
            if isinstance(js, dict):
                return js
        except Exception:
            pass

    # 3. Custom toJSONSchema() / to_json_schema()
    for method_name in ("toJSONSchema", "to_json_schema"):
        fn = getattr(schema, method_name, None)
        if callable(fn):
            try:
                js = fn()
                if isinstance(js, dict):
                    return js
            except Exception:
                pass

    # 4. Python dataclass
    if dataclasses.is_dataclass(schema):
        props: Dict[str, Any] = {}
        required: List[str] = []
        for f in dataclasses.fields(schema):
            props[f.name] = _python_type_to_json_schema(f.type)
            if f.default is dataclasses.MISSING and f.default_factory is dataclasses.MISSING:
                required.append(f.name)
        res: Dict[str, Any] = {"type": "object", "properties": props}
        if required:
            res["required"] = required
        if title:
            res["title"] = title
        return res

    # 5. Raw JSON Schema dict pass-through
    if isinstance(schema, dict):
        return dict(schema)

    return {"type": "object"}


toJsonSchema = to_json_schema


def validate_schema_data(schema: Any, data: Any) -> AttrDict:
    """
    Validates input data against a Pydantic model, dataclass, or custom validator.
    Returns AttrDict(success=True, data=...) or AttrDict(success=False, errors=[...]).
    """
    if schema is None or isinstance(schema, dict):
        return AttrDict(success=True, data=data)

    # 1. Pydantic v2
    if hasattr(schema, "model_validate") and callable(schema.model_validate):
        try:
            validated = schema.model_validate(data if data is not None else {})
            # Return an object that works both as a Pydantic model AND dict-like if needed,
            # or keep the Pydantic model instance so `input.query` and `input.target_count` work!
            return AttrDict(success=True, data=validated)
        except Exception as exc:
            errors: List[str] = []
            if hasattr(exc, "errors") and callable(exc.errors):
                for err in exc.errors():
                    loc = ".".join(str(x) for x in err.get("loc", [])) or "root"
                    msg = err.get("msg", str(err))
                    errors.append(f"{loc}: {msg}")
            else:
                errors.append(str(exc))
            return AttrDict(success=False, errors=errors)

    # 2. Pydantic v1
    if hasattr(schema, "parse_obj") and callable(schema.parse_obj):
        try:
            validated = schema.parse_obj(data if data is not None else {})
            return AttrDict(success=True, data=validated)
        except Exception as exc:
            return AttrDict(success=False, errors=[str(exc)])

    # 3. Dataclass
    if dataclasses.is_dataclass(schema) and isinstance(schema, type):
        try:
            if not isinstance(data, dict):
                return AttrDict(success=False, errors=["root: expected object"])
            validated = schema(**data)
            return AttrDict(success=True, data=validated)
        except Exception as exc:
            return AttrDict(success=False, errors=[str(exc)])

    # 4. Zod-like safeParse / parse
    if hasattr(schema, "safeParse") and callable(schema.safeParse):
        res = schema.safeParse(data)
        if getattr(res, "success", False) or (isinstance(res, dict) and res.get("success")):
            d = getattr(res, "data", res.get("data") if isinstance(res, dict) else data)
            return AttrDict(success=True, data=d)
        return AttrDict(success=False, errors=["validation failed"])

    return AttrDict(success=True, data=data)


validateSchemaData = validate_schema_data

