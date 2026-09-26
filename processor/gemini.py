from __future__ import annotations

import json
import re
import ssl
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional

import certifi

# A small closed set, not a free string, so a caller (a processor pass
# deciding whether to alert) can switch on it exhaustively instead of
# parsing an error message — which must never happen, since a message-
# format change would then silently break alerting.
#
#   "transient"     — another attempt, later, can succeed without anyone
#                      doing anything: a network error/timeout, HTTP 429
#                      (rate limit — the quota window moves on), or any HTTP
#                      5xx (the server's own problem, not the request's).
#   "not_transient"  — the system will not recover by itself; a human must
#                      act: HTTP 401/403 (the key itself), any other 4xx
#                      (the request itself is somehow wrong), or a response
#                      that came back but was unusable (bad JSON, a missing
#                      or empty field — retrying the exact same request
#                      against the exact same model is not expected to fix
#                      that either).
#
# This distinction — not a success count — is what a caller uses to decide
# whether an email is sent. See docs/project_notes.md on why a success count
# is a bad proxy for "systemic" at this project's volume.
FailureKind = Literal["transient", "not_transient"]


# Two separate lists, not one, because the two passes have different failure
# tolerances and this observably matters for output quality:
#
#   Pass 1 (triage summaries): availability wins.
#   Michal reads these only to decide "interesting or not", so a rougher
#   summary still does its job — while a MISSING summary makes the article
#   invisible to her, and Pass 1 has a hard deadline of
#   MAX_PROCESSING_ATTEMPTS days before the article is lost for good. The
#   lite tier is here because it demonstrably rescues articles when every
#   full-flash model is returning 503 (observed live: two real articles one
#   attempt from being lost, rescued by gemini-flash-lite-latest).
#
#   Pass 2 (publication text): quality wins.
#   This text IS the article families read in the association's newsletter —
#   the community cannot read the English source, so this is not a teaser.
#   Lite models were observed producing a garbled word, a Cyrillic character
#   inside a Hebrew word, a mistranslation, and a number-agreement error
#   across two short summaries, while full-flash output was clean; both
#   prompts already forbid exactly these defects, and the lite models
#   ignore it. Deliberately shorter, and that is affordable: Pass 2 has NO
#   attempt limit. Its selection query (newsletter_text_he IS NULL)
#   re-selects the article every run until it succeeds, and nobody is
#   waiting on any particular day's output. If every full-flash model is
#   busy today, there is simply no text today and there will be one
#   tomorrow.
#
# Shared reasoning for both lists:
# - The `-latest` alias leads: Google re-points it as models are released
#   and it can never 404 on retirement, so under a quality ordering it is
#   the primary, not insurance. Explicit pinned names after it are a safety
#   net for the case where the alias itself misbehaves (observed: 0/8 on
#   one day) — they will eventually be retired (404) themselves, which is
#   exactly why the self-refreshing alias leads instead.
# - Every name in both lists was confirmed with a real generateContent call
#   before being added (a 404 here is a silently useless candidate).
#   *-latest aliases were confirmed to exist via a live models-endpoint
#   call rather than assumed from documentation, which goes stale.
# - If every candidate in a list ever fails with 404, Google's own error
#   message usually names the current replacement model — add it in the
#   matching tier of the matching list. No other change needed.
TRIAGE_MODEL_CANDIDATES = [
    "gemini-flash-latest",
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite",
]

PUBLICATION_MODEL_CANDIDATES = [
    "gemini-flash-latest",
    "gemini-3.8-flash",
    "gemini-3.7-flash",
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
    # None on success. On failure, always one of FailureKind — see that
    # type's comment above for the rule. Defaulted to None so every existing
    # construction site (including the success path, which never sets this)
    # keeps working unchanged.
    failure_kind: FailureKind | None = None


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
here, not the source article, to decide whether this is interesting enough to
follow up on. This is not the published version of the article; that is written
separately, later, only for items she chooses to follow up on. Your only job here is
to give her enough to make that "interesting or not" call accurately.

Return only valid JSON with exactly these string fields:
- title_he: a short, accurate Hebrew headline. Not clickbait, not more dramatic than
  the article itself.
- summary_he: a Hebrew summary of exactly 3 to 4 sentences.

What summary_he must do:
- State what happened, who it concerns (which patients - age group or SMA type, if
  the article says), and what kind of item this is: a research finding, a
  regulatory decision, a treatment update, a community or advocacy item, or
  something else.
- Be accurate above everything else. If the finding is preliminary, from an animal
  model (e.g. mice), or from a small study, say so explicitly. Never present
  something as more advanced, certain, or significant than the source material
  supports - Michal must not approve something as a breakthrough that isn't one.
  When the article gives a specific number or percentage, report it plainly, and do
  not add a quantifier that overstates it (e.g. do not write "almost all" for 83%).
- Contain only facts present in the article content below. Do not add, infer, or
  guess anything the article does not say.
- Be written in plain, natural Hebrew for a non-medical reader, not academic
  language, not press-release language. Strip promotional framing from the source:
  phrasing like "first-of-its-kind", "breakthrough", "revolutionary", or
  "dual-mechanism approach" belongs to a company's announcement, not to this text,
  so state plainly what the treatment does instead.
- Use the Hebrew form commonly used for any drug or gene names, with the Latin name
  in parentheses on first mention where that helps a Hebrew reader recognize it.
  Strip trademark symbols (™, ®) from drug and product names - they render badly
  in right-to-left text.
- Use a plain hyphen (-) for any dash in the Hebrew text; never an em dash. An em
  dash reads as machine-translated to a Hebrew reader, not natural writing.
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

This is NOT a translation. Write an original summary in your own words; do not
mirror the article's structure or paragraph order, and do not quote it. The facts
must come from the article; the writing must not.

Register:
- Explain medical and scientific terms in plain Hebrew the first time they appear,
  briefly and inline. Prefer words people actually use over precise technical
  register.
- For a drug name, gene, or other term a reader might encounter elsewhere in English
  or Latin, give the Hebrew and put the original in parentheses on first mention.
  Strip trademark symbols (™, ®) from drug and product names - they render badly
  in right-to-left text.
- No academic phrasing, no press-release phrasing, no statistical notation. Strip
  promotional framing from the source: phrasing like "first-of-its-kind",
  "breakthrough", "revolutionary", or "dual-mechanism approach" belongs to the
  company's announcement, not to this newsletter, so state plainly what the
  treatment does instead. Where the article gives numbers that matter to a reader
  (how many participants, what proportion improved), state them in plain language.
- Use a plain hyphen (-) for any dash in the Hebrew text; never an em dash. An em
  dash reads as machine-translated to a Hebrew reader, not natural writing, and
  this text goes directly to families.

Accuracy:
- Contain only facts present in the article content below. Never add, infer, or
  guess anything the article does not say. When the article gives a specific number
  or percentage, report it plainly, and do not add a quantifier that overstates it
  (e.g. do not write "almost all" for 83%).
- If a finding is preliminary, from an animal model, from a small study, or not yet
  approved for use, say so plainly. This community makes real decisions about
  treatment, so overstating a result is the worst failure this text could make.
- Do not soften bad news and do not inflate good news.
- Proofread the Hebrew before returning it: no missing spaces between words, no
  doubled punctuation, no stray characters.

Length: let the content decide. Write what is needed to convey the article's main
message completely and accessibly, and no more, in practice this is usually about
150-250 words. A thin source article (e.g. a short link-out post) should produce a
short text; that is correct, never pad it out to reach a length. Do NOT:
- open by restating the headline in different words,
- add general background about SMA that is not in the article,
- close with an inflated sentence about what this means for the community,
- repeat the same point in two places.

Do not include URLs, "read more", a call to action, or a sign-off - the newsletter
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


def _classify_failure(call: _CallResult) -> FailureKind:
    """Classify one failed call as transient or not — see FailureKind above.

    A network error/timeout, 429 (rate limit), or any 5xx is transient.
    Everything else — 401/403, any other 4xx, or a call that came back with
    no http_status at all (an unusable response: bad JSON or a missing/empty
    field, see _call_gemini) — is not transient: retrying the identical
    request against the identical model is not expected to change the
    outcome.
    """
    if call.is_network_error:
        return "transient"
    if call.http_status == 429 or (call.http_status is not None and 500 <= call.http_status < 600):
        return "transient"
    return "not_transient"


def _generate(
    prompt: str,
    *,
    expected_fields: tuple[str, ...],
    api_key: str,
    model: Optional[str],
    timeout_seconds: int,
    model_candidates: List[str],
) -> GeminiResult:
    """Try model_candidates in order for one prompt.

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
    fallback, and model_candidates is ignored — so a specific model can
    still be tested deliberately.
    """
    if not api_key:
        # Nobody's next attempt fixes a missing key — a human must set one.
        return GeminiResult(outputs={}, error="GEMINI_API_KEY is not set.", failure_kind="not_transient")

    candidates: List[str] = [model] if model else list(model_candidates)

    last_error = "No Gemini model candidates configured."
    # Same reasoning as above: an empty candidates list is a configuration
    # problem, not a transient one, if this line is ever actually reached.
    last_failure_kind: FailureKind = "not_transient"
    for i, candidate in enumerate(candidates):
        call = _call_gemini(
            prompt, api_key=api_key, model=candidate,
            timeout_seconds=timeout_seconds, expected_fields=expected_fields,
        )
        if call.error is None:
            return GeminiResult(outputs=call.outputs, model=candidate)

        last_error = call.error
        # The classification describes the failure that actually ends this
        # call's attempt — set on every iteration so whichever branch below
        # returns (the unrecoverable one immediately, or the loop falling
        # through after the last candidate) carries the right one.
        last_failure_kind = _classify_failure(call)
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
            return GeminiResult(outputs=call.outputs or {}, error=call.error, failure_kind=last_failure_kind)
        elif is_last_candidate:
            print(f"    [gemini] {candidate}: {reason} — no more candidates to try")
        else:
            print(f"    [gemini] {candidate}: {reason} — trying next candidate")

    return GeminiResult(outputs={}, error=last_error, failure_kind=last_failure_kind)


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
        model_candidates=TRIAGE_MODEL_CANDIDATES,
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
        model_candidates=PUBLICATION_MODEL_CANDIDATES,
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
