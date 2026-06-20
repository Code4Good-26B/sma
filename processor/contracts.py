from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


@dataclass(frozen=True)
class FieldError:
    code: str
    message: str
    field: str

    def as_dict(self) -> Dict[str, str]:
        return {"code": self.code, "message": self.message, "field": self.field}


REQUIRED_TOP_LEVEL_FIELDS: Tuple[str, ...] = (
    "id",
    "title",
    "source",
    "url",
    "published_at",
    "language",
    "content",
    "snippet",
    "collected_at",
    "metadata",
)


def now_iso8601_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _ensure_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def _ensure_list_of_str(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [_ensure_str(v) for v in value]
    return [_ensure_str(value)]


def normalize_article_input(raw: Any) -> Tuple[Dict[str, Any], List[FieldError]]:
    """
    Normalize an incoming article-like object into our v1 input contract shape.
    Never raises; returns normalized dict + list of errors.
    """
    errors: List[FieldError] = []

    if not isinstance(raw, dict):
        return (
            {
                "id": "",
                "title": "",
                "source": "",
                "url": "",
                "published_at": "",
                "language": "",
                "content": "",
                "snippet": "",
                "collected_at": "",
                "metadata": {"author": "", "tags": []},
            },
            [
                FieldError(
                    code="bad_input_type",
                    message=f"Expected top-level object, got {type(raw).__name__}.",
                    field="$",
                )
            ],
        )

    normalized: Dict[str, Any] = {}
    for key in REQUIRED_TOP_LEVEL_FIELDS:
        if key not in raw:
            errors.append(
                FieldError(code="missing_field", message="Field is missing; default applied.", field=key)
            )
        normalized[key] = raw.get(key)

    # Strings
    for key in ("id", "title", "source", "url", "published_at", "language", "content", "snippet", "collected_at"):
        normalized[key] = _ensure_str(normalized.get(key))

    # Metadata
    metadata_raw = raw.get("metadata")
    if metadata_raw is None or not isinstance(metadata_raw, dict):
        if "metadata" in raw and not isinstance(metadata_raw, dict):
            errors.append(
                FieldError(
                    code="bad_field_type",
                    message=f"Expected object, got {type(metadata_raw).__name__}; default applied.",
                    field="metadata",
                )
            )
        normalized["metadata"] = {"author": "", "tags": []}
        errors.append(
            FieldError(code="missing_field", message="Field is missing; default applied.", field="metadata.author")
        )
        errors.append(
            FieldError(code="missing_field", message="Field is missing; default applied.", field="metadata.tags")
        )
    else:
        author = metadata_raw.get("author")
        tags = metadata_raw.get("tags")

        if "author" not in metadata_raw:
            errors.append(
                FieldError(code="missing_field", message="Field is missing; default applied.", field="metadata.author")
            )
        if "tags" not in metadata_raw:
            errors.append(
                FieldError(code="missing_field", message="Field is missing; default applied.", field="metadata.tags")
            )

        normalized["metadata"] = {"author": _ensure_str(author), "tags": _ensure_list_of_str(tags)}

    return normalized, errors


def build_output_envelope(
    *,
    normalized_input: Dict[str, Any],
    validation_errors: List[FieldError],
    processor_version: str,
    status_override: Optional[str] = None,
    outputs: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    status = status_override or ("failed" if validation_errors else "processed")
    output_fields = {
        "title_he": "",
        "summary_he": "",
        "publication_text_he": "",
    }
    if outputs:
        output_fields.update(
            {
                "title_he": _ensure_str(outputs.get("title_he")),
                "summary_he": _ensure_str(outputs.get("summary_he")),
                "publication_text_he": _ensure_str(outputs.get("publication_text_he")),
            }
        )

    return {
        **normalized_input,
        "processor": {"version": processor_version, "processed_at": now_iso8601_utc()},
        "status": status,
        "errors": [e.as_dict() for e in validation_errors],
        "outputs": output_fields,
    }
