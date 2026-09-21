from __future__ import annotations

import json
import re
import ssl
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import certifi


# Ordered by QUALITY, not availability — a change from an earlier version of
# this list, and deliberate. Two days of live runs gave every one of these
# four models a turn at being the worst performer:
#
#            day 1        day 2
#   flash-latest   0/8          1/3
#   3.6-flash      1/8          0/2
#   3.5-flash      3/7          0/2
#   3.7-flash      0/3          0/2
#
# Availability swings more, day to day, than any real difference between
# these models — so ranking by "which one answered most yesterday" is
# ranking on noise. When candidates can't be meaningfully separated by
# availability, the sound criterion is quality: try the best model first,
# and fall back only when the better ones are genuinely unreachable. Also
# worth naming plainly: all four names above are labels on ONE congested
# capacity pool on the free tier — a run of four consecutive 503s in a few
# seconds is common, and no ordering of these four alone fixes that. This
# is not a defect on our side; Google's own rate-limit docs say specified
# limits are "not guaranteed", and paying Tier-2 customers report the same
# 503s on Google's developer forum. The fix is to widen the chain across
# genuinely different endpoints, which is what the lite tier below is for.
#
# 1. gemini-flash-latest — the full-flash alias. Newest full Flash, Google
#    re-points it as models are released, and it can never 404 on
#    retirement. Under a quality ordering this is the primary, not
#    insurance — that was backwards in the previous version of this list.
# 2-3. Explicit full-flash names, newest first — a safety net for the case
#    where the alias itself misbehaves (observed: 0/8 on day 1). Pinned
#    names will eventually be retired (404); the alias is Google
#    maintaining freshness on our behalf, which is why it leads.
# 4. gemini-flash-lite-latest — the flash-lite alias. Confirmed to exist via
#    a live models-endpoint call (Part 0 of the task that added this
#    comment) rather than assumed from documentation, which goes stale.
# 5. An older explicit flash-lite name — the least popular endpoint of the
#    five, and therefore the most likely to answer when everything above is
#    congested.
#
# Including a lite model at all reverses an earlier decision to exclude
# `-lite` on quality grounds. That reasoning had it backwards too: the
# alternative to a lite-model summary is NO summary at all, not a better
# one — and Michal reviews and edits every text in the dashboard before
# anything is published, so she is the quality gate, not the model. The
# log records which model produced each result, so a lite-generated text
# is traceable after the fact if it ever needs a second look.
#
# Every name below was confirmed with a real generateContent call before
# being added (a 404 here is a silently useless candidate — see Part 0).
# If every candidate below ever fails with 404, Google's own error message
# names the current replacement model — add it in the matching tier above.
MODEL_CANDIDATES = [
    "gemini-flash-latest",
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite",
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
    # True only for a network-level failure (couldn't reach the server, or
    # it didn't respond in time) — as opposed to the server responding with
    # an error status, or responding with something unusable. Distinct from
    # http_status because it is the one failure kind where retrying another
    # candidate is actively harmful (see _generate), not just unhelpful.
    is_network_error: bool = False


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
  When the article gives a specific number or percentage, report it plainly — do
  not add a quantifier that overstates it (e.g. do not write "almost all" for 83%).
- Contain only facts present in the article content below. Do not add, infer, or
  guess anything the article does not say.
- Be written in plain, natural Hebrew for a non-medical reader — not academic
  language, not press-release language. Strip promotional framing from the source:
  phrasing like "first-of-its-kind", "breakthrough", "revolutionary", or
  "dual-mechanism approach" belongs to a company's announcement, not to this text —
  state plainly what the treatment does instead.
- Use the Hebrew form commonly used for any drug or gene names, with the Latin name
  in parentheses on first mention where that helps a Hebrew reader recognize it.
  Strip trademark symbols (™, ®) from drug and product names — they render badly
  in right-to-left text.
- Proofread the Hebrew before returning it: no missing spaces between words, no
  doubled punctuation, no stray characters.

Article:
Title: {title}
Source: {source}
Published at: {published_at}
Snippet: {snippet}
Content: {content}
""".strip()


def build_newsletter_prompt(article: Dict[str, Any]) -> str:
    title = clean_article_text(str(article.get("title", "")))
    source = clean_article_text(str(article.get("source", "")))
    published_at = clean_article_text(str(article.get("published_at", "")))
    content = clean_article_text(str(article.get("content", "")))
    snippet = clean_article_text(str(article.get("snippet", "")))

    return f"""
You are writing the Hebrew text that will be published in the newsletter of an
Israeli SMA (spinal muscular atrophy) patient association, and pasted as-is onto
their website. Most readers cannot comfortably read the English source article, so
for them this text IS the article, not a teaser pointing to it. It must stand
entirely on its own.

Return only valid JSON with exactly this string field:
- newsletter_text_he: an original Hebrew piece conveying the article's content to a
  general Israeli audience with no medical background. Publishable as-is.

This is NOT a translation. Write an original summary in your own words — do not
mirror the article's structure or paragraph order, and do not quote it. The facts
must come from the article; the writing must not.

Register:
- Explain medical and scientific terms in plain Hebrew the first time they appear,
  briefly and inline. Prefer words people actually use over precise technical
  register.
- For a drug name, gene, or other term a reader might encounter elsewhere in English
  or Latin, give the Hebrew and put the original in parentheses on first mention.
  Strip trademark symbols (™, ®) from drug and product names — they render badly
  in right-to-left text.
- No academic phrasing, no press-release phrasing, no statistical notation. Strip
  promotional framing from the source: phrasing like "first-of-its-kind",
  "breakthrough", "revolutionary", or "dual-mechanism approach" belongs to the
  company's announcement, not to this newsletter — state plainly what the treatment
  does instead. Where the article gives numbers that matter to a reader (how many
  participants, what proportion improved), state them in plain language.

Accuracy:
- Contain only facts present in the article content below. Never add, infer, or
  guess anything the article does not say. When the article gives a specific number
  or percentage, report it plainly — do not add a quantifier that overstates it
  (e.g. do not write "almost all" for 83%).
- If a finding is preliminary, from an animal model, from a small study, or not yet
  approved for use, say so plainly. This community makes real decisions about
  treatment — overstating a result is the worst failure this text could make.
- Do not soften bad news and do not inflate good news.
- Proofread the Hebrew before returning it: no missing spaces between words, no
  doubled punctuation, no stray characters.

Length: let the content decide. Write what is needed to convey the article's main
message completely and accessibly, and no more — in practice this is usually about
150-250 words. A thin source article (e.g. a short link-out post) should produce a
short text; that is correct, never pad it out to reach a length. Do NOT:
- open by restating the headline in different words,
- add general background about SMA that is not in the article,
- close with an inflated sentence about what this means for the community,
- repeat the same point in two places.

Do not include URLs, "read more", a call to action, or a sign-off — the newsletter
template adds the source name and link separately.

Article:
Title: {title}
Source: {source}
Published at: {published_at}
Snippet: {snippet}
Content: {content}
""".strip()


def _call_gemini(
    prompt: str,
    *,
    api_key: str,
    model: str,
    timeout_seconds: int,
    expected_fields: tuple[str, ...],
) -> _CallResult:
    """Make one HTTP call to one specific model. Never raises.

    Shared by both passes: only the prompt text and the JSON field names
    expected back differ between them. Everything else — the HTTP call, the
    model fallback loop that uses this, the timeout, and the error/empty-
    field handling — is common.
    """
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
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
        return _CallResult(
            outputs=None, error=f"Gemini request failed: {e}", http_status=None,
            is_network_error=True,
        )

    try:
        data = json.loads(response_body)
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        outputs = _parse_outputs(text, expected_fields)
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


def _generate(
    prompt: str,
    *,
    expected_fields: tuple[str, ...],
    api_key: str,
    model: Optional[str],
    timeout_seconds: int,
) -> GeminiResult:
    """Try MODEL_CANDIDATES in order for one prompt.

    The default is to try the next candidate, unless another attempt
    cannot possibly help: either the failure is identical for every model
    (401/403 — the same API key is used for every candidate, so every one
    of them will return the same thing), or retrying costs too much
    wall-clock time (a network error or timeout, at up to `timeout_seconds`
    per attempt, cascading through every candidate). Everything else is
    worth a second opinion from a different model: a retired model (404),
    an exhausted quota (429 — quota is per-model, so another model has its
    own), a transient overload (5xx), a status this rule's author never
    anticipated, or a response that came back but was unusable (bad JSON,
    a missing or empty field) — a different model may well succeed where
    this one didn't. An allow-list of "safe to retry" codes was tried here
    twice before and broke both times on a code nobody had seen yet; a
    short deny-list of "definitely won't help" is the safer default.

    If `model` is given explicitly, only that model is tried — no
    fallback — so a specific model can still be tested deliberately.
    """
    if not api_key:
        return GeminiResult(outputs={}, error="GEMINI_API_KEY is not set.")

    candidates: List[str] = [model] if model else list(MODEL_CANDIDATES)

    last_error = "No Gemini model candidates configured."
    for i, candidate in enumerate(candidates):
        call = _call_gemini(
            prompt, api_key=api_key, model=candidate,
            timeout_seconds=timeout_seconds, expected_fields=expected_fields,
        )
        if call.error is None:
            return GeminiResult(outputs=call.outputs, model=candidate)

        last_error = call.error
        is_last_candidate = i == len(candidates) - 1

        # The only two cases where another attempt cannot help.
        unrecoverable = call.is_network_error or call.http_status in (401, 403)

        reason = (
            "network error/timeout" if call.is_network_error
            else f"HTTP {call.http_status}" if call.http_status is not None
            else "unusable response (bad JSON or missing/empty field)"
        )
        # One line per attempt, always, so a chain of failures reads as a
        # diagnosis (e.g. five 403s in a row = "the API key is the
        # problem") rather than a mystery.
        if unrecoverable:
            print(f"    [gemini] {candidate}: {reason} — stopping, another model would not help")
            return GeminiResult(outputs=call.outputs or {}, error=call.error)
        elif is_last_candidate:
            print(f"    [gemini] {candidate}: {reason} — no more candidates to try")
        else:
            print(f"    [gemini] {candidate}: {reason} — trying next candidate")

    return GeminiResult(outputs={}, error=last_error)


def generate_hebrew_outputs(
    article: Dict[str, Any],
    *,
    api_key: str,
    model: Optional[str] = None,
    timeout_seconds: int = 60,
) -> GeminiResult:
    """Pass 1 (triage): generate title_he + summary_he."""
    return _generate(
        build_prompt(article),
        expected_fields=("title_he", "summary_he"),
        api_key=api_key, model=model, timeout_seconds=timeout_seconds,
    )


def generate_newsletter_text(
    article: Dict[str, Any],
    *,
    api_key: str,
    model: Optional[str] = None,
    timeout_seconds: int = 60,
) -> GeminiResult:
    """Pass 2 (publication text): generate newsletter_text_he."""
    return _generate(
        build_newsletter_prompt(article),
        expected_fields=("newsletter_text_he",),
        api_key=api_key, model=model, timeout_seconds=timeout_seconds,
    )


def mock_hebrew_outputs(article: Dict[str, Any]) -> Dict[str, str]:
    title = clean_article_text(str(article.get("title", ""))) or "SMA update"
    source = clean_article_text(str(article.get("source", ""))) or "unknown source"
    content = clean_article_text(str(article.get("content", "")))
    short_content = content[:220].rsplit(" ", 1)[0] if len(content) > 220 else content

    return {
        "title_he": f"[MOCK] {title}",
        "summary_he": f"[MOCK] Summary placeholder for Hebrew output from {source}. {short_content}",
    }


def mock_newsletter_text(article: Dict[str, Any]) -> Dict[str, str]:
    title = clean_article_text(str(article.get("title", ""))) or "SMA update"
    source = clean_article_text(str(article.get("source", ""))) or "unknown source"
    content = clean_article_text(str(article.get("content", "")))
    short_content = content[:400].rsplit(" ", 1)[0] if len(content) > 400 else content

    return {
        "newsletter_text_he": f"[MOCK] Newsletter placeholder for '{title}' from {source}. {short_content}",
    }


def _parse_outputs(text: str, fields: tuple[str, ...]) -> Dict[str, str]:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end < start:
            raise
        parsed = json.loads(text[start : end + 1])

    return {field: str(parsed.get(field, "")) for field in fields}
