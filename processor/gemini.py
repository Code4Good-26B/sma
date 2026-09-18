from __future__ import annotations

import json
import re
import ssl
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import certifi


# Google retires specific model versions on its own schedule, outside this
# project's control. `gemini-2.5-flash` used to be pinned here as
# DEFAULT_MODEL; Google has since retired it (HTTP 404, "no longer
# available to new users"), which would have taken the whole pipeline down
# silently — and stayed down, since nobody maintains this project. The
# `-latest` alias below keeps working across model generations with no
# code change required; the pinned entries under it are a backstop only
# for the unlikely case the alias itself is ever withdrawn. The trade-off
# is that output wording may drift, without warning, whenever the alias
# moves to a new model generation. That is acceptable here: Michal reviews
# and edits every summary before anything is published, so drifting prose
# is a minor annoyance, while a dead model is a total, silent outage. If
# every candidate below ever fails with 404, Google's own error message
# names the replacement model to use — add it to the top of this list.
MODEL_CANDIDATES = [
    "gemini-flash-latest",   # alias — survives version retirements
    "gemini-3.6-flash",      # pinned fallback if the alias ever disappears
    "gemini-2.5-flash",      # older pinned fallback
]

MAX_CONTENT_CHARS = 12000


@dataclass(frozen=True)
class GeminiResult:
    outputs: Dict[str, str]
    error: str | None = None
    # The model that actually produced `outputs` (None on failure), so the
    # caller can log it — this is what makes a wording drift, after the
    # `-latest` alias moves to a new generation, diagnosable instead of
    # mysterious.
    model: str | None = None


@dataclass(frozen=True)
class _CallResult:
    """Internal: the result of one HTTP call to one specific model."""
    outputs: Optional[Dict[str, str]]
    error: Optional[str]
    http_status: Optional[int]


def clean_article_text(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if len(cleaned) <= MAX_CONTENT_CHARS:
        return cleaned
    return cleaned[:MAX_CONTENT_CHARS].rsplit(" ", 1)[0] + "..."


def build_prompt(article: Dict[str, Any]) -> str:
    title = clean_article_text(str(article.get("title", "")))
    source = clean_article_text(str(article.get("source", "")))
    published_at = clean_article_text(str(article.get("published_at", "")))
    content = clean_article_text(str(article.get("content", "")))
    snippet = clean_article_text(str(article.get("snippet", "")))

    return f"""
You are triaging English-language SMA (spinal muscular atrophy) news for Michal, the
director of an Israeli SMA patient association. She will read only what you produce
here — not the source article — to decide whether this is interesting enough to
follow up on. This is not the published version of the article; that is written
separately, later, only for items she chooses to follow up on. Your only job here is
to give her enough to make that "interesting or not" call accurately.

Return only valid JSON with exactly these string fields:
- title_he: a short, accurate Hebrew headline. Not clickbait, not more dramatic than
  the article itself.
- summary_he: a Hebrew summary of exactly 3 to 4 sentences.

What summary_he must do:
- State what happened, who it concerns (which patients — age group or SMA type, if
  the article says), and what kind of item this is: a research finding, a
  regulatory decision, a treatment update, a community or advocacy item, or
  something else.
- Be accurate above everything else. If the finding is preliminary, from an animal
  model (e.g. mice), or from a small study, say so explicitly. Never present
  something as more advanced, certain, or significant than the source material
  supports — Michal must not approve something as a breakthrough that isn't one.
- Contain only facts present in the article content below. Do not add, infer, or
  guess anything the article does not say.
- Be written in plain, natural Hebrew for a non-medical reader — not academic
  language, not press-release language.
- Use the Hebrew form commonly used for any drug or gene names, with the Latin name
  in parentheses on first mention where that helps a Hebrew reader recognize it.

Article:
Title: {title}
Source: {source}
Published at: {published_at}
Snippet: {snippet}
Content: {content}
""".strip()


def _call_gemini(
    article: Dict[str, Any],
    *,
    api_key: str,
    model: str,
    timeout_seconds: int,
) -> _CallResult:
    """Make one HTTP call to one specific model. Never raises."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "contents": [{"role": "user", "parts": [{"text": build_prompt(article)}]}],
        "generationConfig": {
            "temperature": 0.3,
            "responseMimeType": "application/json",
        },
    }
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST",
    )
    ssl_context = ssl.create_default_context(cafile=certifi.where())

    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds, context=ssl_context) as response:
            response_body = response.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        details = e.read().decode("utf-8", errors="replace")
        return _CallResult(outputs=None, error=f"Gemini HTTP {e.code}: {details}", http_status=e.code)
    except (urllib.error.URLError, TimeoutError) as e:
        return _CallResult(outputs=None, error=f"Gemini request failed: {e}", http_status=None)

    try:
        data = json.loads(response_body)
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        outputs = _parse_outputs(text)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as e:
        return _CallResult(outputs=None, error=f"Could not parse Gemini response: {e}", http_status=None)

    missing = [key for key, value in outputs.items() if not value.strip()]
    if missing:
        return _CallResult(
            outputs=outputs,
            error=f"Gemini response had empty fields: {', '.join(missing)}",
            http_status=None,
        )

    return _CallResult(outputs=outputs, error=None, http_status=None)


def generate_hebrew_outputs(
    article: Dict[str, Any],
    *,
    api_key: str,
    model: Optional[str] = None,
    timeout_seconds: int = 60,
) -> GeminiResult:
    """Generate Hebrew triage outputs, trying MODEL_CANDIDATES in order.

    If `model` is given explicitly, only that model is tried — no
    fallback — so a specific model can still be tested deliberately.
    """
    if not api_key:
        return GeminiResult(outputs={}, error="GEMINI_API_KEY is not set.")

    candidates: List[str] = [model] if model else list(MODEL_CANDIDATES)

    last_error = "No Gemini model candidates configured."
    for candidate in candidates:
        call = _call_gemini(article, api_key=api_key, model=candidate, timeout_seconds=timeout_seconds)
        if call.error is None:
            return GeminiResult(outputs=call.outputs, model=candidate)

        last_error = call.error

        if call.http_status != 404:
            # A real failure — rate limiting, quota, a transient 5xx, an
            # auth problem, or a malformed response. Switching models
            # would not help, would burn quota against a second model for
            # nothing, and would hide the actual cause. Let this fail the
            # article normally; the existing 3-attempt retry in
            # process_from_db.py handles it on a later run.
            return GeminiResult(outputs=call.outputs or {}, error=call.error)

        # Only a 404 ("this model does not exist / is not available") is
        # worth trying the next candidate for — that is exactly the
        # failure mode a retired pinned model produces.
        print(f"    [gemini] model '{candidate}' returned 404 (not available) — trying next candidate")

    return GeminiResult(outputs={}, error=last_error)


def mock_hebrew_outputs(article: Dict[str, Any]) -> Dict[str, str]:
    title = clean_article_text(str(article.get("title", ""))) or "SMA update"
    source = clean_article_text(str(article.get("source", ""))) or "unknown source"
    content = clean_article_text(str(article.get("content", "")))
    short_content = content[:220].rsplit(" ", 1)[0] if len(content) > 220 else content

    return {
        "title_he": f"[MOCK] {title}",
        "summary_he": f"[MOCK] Summary placeholder for Hebrew output from {source}. {short_content}",
    }


def _parse_outputs(text: str) -> Dict[str, str]:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end < start:
            raise
        parsed = json.loads(text[start : end + 1])

    return {
        "title_he": str(parsed.get("title_he", "")),
        "summary_he": str(parsed.get("summary_he", "")),
    }
