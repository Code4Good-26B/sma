from __future__ import annotations

import json
import re
import ssl
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict

import certifi


DEFAULT_MODEL = "gemini-2.5-flash"
MAX_CONTENT_CHARS = 12000


@dataclass(frozen=True)
class GeminiResult:
    outputs: Dict[str, str]
    error: str | None = None


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
You are preparing SMA news updates for a Hebrew-speaking patient and family audience.
Write in natural, clear Hebrew. Keep it accurate, warm, concise, and not too academic.

Return only valid JSON with exactly these string fields:
- title_he: a Hebrew title
- summary_he: a 2-3 sentence Hebrew summary
- publication_text_he: a short Hebrew paragraph suitable for publication

Article:
Title: {title}
Source: {source}
Published at: {published_at}
Snippet: {snippet}
Content: {content}
""".strip()


def generate_hebrew_outputs(
    article: Dict[str, Any],
    *,
    api_key: str,
    model: str = DEFAULT_MODEL,
    timeout_seconds: int = 60,
) -> GeminiResult:
    if not api_key:
        return GeminiResult(outputs={}, error="GEMINI_API_KEY is not set.")

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
        return GeminiResult(outputs={}, error=f"Gemini HTTP {e.code}: {details}")
    except (urllib.error.URLError, TimeoutError) as e:
        return GeminiResult(outputs={}, error=f"Gemini request failed: {e}")

    try:
        data = json.loads(response_body)
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        outputs = _parse_outputs(text)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as e:
        return GeminiResult(outputs={}, error=f"Could not parse Gemini response: {e}")

    missing = [key for key, value in outputs.items() if not value.strip()]
    if missing:
        return GeminiResult(outputs=outputs, error=f"Gemini response had empty fields: {', '.join(missing)}")

    return GeminiResult(outputs=outputs)


def mock_hebrew_outputs(article: Dict[str, Any]) -> Dict[str, str]:
    title = clean_article_text(str(article.get("title", ""))) or "SMA update"
    source = clean_article_text(str(article.get("source", ""))) or "unknown source"
    content = clean_article_text(str(article.get("content", "")))
    short_content = content[:220].rsplit(" ", 1)[0] if len(content) > 220 else content

    return {
        "title_he": f"[MOCK] {title}",
        "summary_he": f"[MOCK] Summary placeholder for Hebrew output from {source}. {short_content}",
        "publication_text_he": f"[MOCK] Publication placeholder based on the article: {short_content}",
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
        "publication_text_he": str(parsed.get("publication_text_he", "")),
    }
