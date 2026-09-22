#!/usr/bin/env python3
"""Trigger sending the generated newsletter through Brevo.

Reads the rendered HTML from `output/` and pushes it to Brevo as an email
campaign. The API key is read from `BREVO_API_KEY` (the project-root `.env`, or
the environment). Stdlib only — no extra dependencies.

Safe by default: with no action flag it does a DRY RUN (prints what it would do,
touches nothing). Pass exactly one action flag to actually do something:

    # dry run — show resolved config, no API call
    python3 src/send_brevo.py --language he

    # send directly to one or more addresses (transactional)
    python3 src/send_brevo.py --language he --to you@example.com

    # create a draft campaign in Brevo (nothing is sent)
    python3 src/send_brevo.py --language he --create

    # REAL send to the configured list
    python3 src/send_brevo.py --language he --send

Run `src/publisher.py` first so the HTML exists.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BREVO_API = "https://api.brevo.com/v3"
HERE = Path(__file__).resolve().parent          # src/
PROJECT_ROOT = HERE.parent                       # sma-publisher/

# Defaults (overridable via .env keys of the same upper-case name, or CLI flags).
DEFAULT_TO = "ran.mahalal@gmail.com"             # default recipient for --to
DEFAULT_SENDER_EMAIL = "ran.mahalal@gmail.com"   # must be a verified Brevo sender
DEFAULT_SENDER_NAME = "עמותת SMA ישראל"
DEFAULT_LIST_ID = 2                              # "SMA Newsletter"
SUBJECT_BASE = {"he": "עלון הקהילה", "en": "Community Newsletter"}


def load_env(path: Path) -> dict:
    """Minimal .env parser (KEY=VALUE lines, ignores comments/quotes)."""
    env = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            env[key.strip()] = val.strip().strip('"').strip("'")
    return env


def brevo(method: str, path: str, key: str, payload: dict | None = None):
    """Call the Brevo API; returns (status_code, parsed_json)."""
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        BREVO_API + path,
        data=data,
        method=method,
        headers={
            "api-key": key,
            "accept": "application/json",
            "content-type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, (json.loads(body) if body.strip() else {})
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        try:
            return exc.code, json.loads(body)
        except ValueError:
            return exc.code, {"raw": body}


def issue_subject(language: str) -> str:
    base = SUBJECT_BASE.get(language, SUBJECT_BASE["he"])
    try:
        sys.path.insert(0, str(HERE))
        from publisher import issue_date  # reuse the same date logic

        return f"{base} · {issue_date(language)}"
    except Exception:
        return base


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--language", choices=("he", "en"), default="he")
    parser.add_argument("--html", type=Path, help="HTML file to send (default: output/newsletter_<lang>.html).")
    parser.add_argument("--subject", help="Email subject (default: derived from language + issue date).")
    parser.add_argument("--list-id", type=int, help=f"Brevo list id (default: {DEFAULT_LIST_ID} or BREVO_LIST_ID).")
    parser.add_argument("--sender-email", help="Verified Brevo sender email.")
    parser.add_argument("--sender-name", help="Sender display name.")
    # actions (mutually exclusive; omit all = dry run)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--to", nargs="?", const=DEFAULT_TO, metavar="EMAILS",
                        help=f"Send directly (transactional) to EMAILS (comma-separated). "
                             f"With no value, sends to the default recipient ({DEFAULT_TO}).")
    action.add_argument("--create", action="store_true", help="Create a draft campaign (no send).")
    action.add_argument("--test", metavar="EMAILS", help="Create a draft and send a test copy to EMAILS (comma-separated, must be Brevo contacts).")
    action.add_argument("--send", action="store_true", help="Create and send NOW to the list.")
    args = parser.parse_args()

    env = {**load_env(PROJECT_ROOT / ".env"), **os.environ}
    key = env.get("BREVO_API_KEY", "").strip()
    if not key:
        print("Error: BREVO_API_KEY not found in .env or environment.", file=sys.stderr)
        return 1

    html_path = args.html or (PROJECT_ROOT / "output" / f"newsletter_{args.language}.html")
    if not html_path.exists():
        print(f"Error: {html_path} not found. Run publisher.py first.", file=sys.stderr)
        return 1
    html = html_path.read_text(encoding="utf-8")

    subject = args.subject or issue_subject(args.language)
    sender_email = args.sender_email or env.get("BREVO_SENDER_EMAIL", DEFAULT_SENDER_EMAIL)
    sender_name = args.sender_name or env.get("BREVO_SENDER_NAME", DEFAULT_SENDER_NAME)
    list_id = args.list_id or int(env.get("BREVO_LIST_ID", DEFAULT_LIST_ID))

    print(f"Newsletter: {html_path.name} ({len(html):,} bytes)")
    print(f"Subject:    {subject}")
    print(f"Sender:     {sender_name} <{sender_email}>")
    print(f"List id:    {list_id}")

    if not (args.to or args.create or args.test or args.send):
        print("\n[dry run] No action flag given — nothing sent. "
              "Use --to EMAILS, --create, --test EMAILS, or --send.")
        return 0

    # Transactional send to explicit addresses (no list/contact requirement).
    if args.to:
        recipients = [e.strip() for e in args.to.split(",") if e.strip()]
        ok = True
        for r in recipients:
            status, resp = brevo("POST", "/smtp/email", key, {
                "sender": {"name": sender_name, "email": sender_email},
                "to": [{"email": r}],
                "subject": subject,
                "htmlContent": html,
            })
            if status in (200, 201, 202):
                print(f"Sent to {r}  (messageId={resp.get('messageId')})")
            else:
                ok = False
                print(f"Failed to {r} (HTTP {status}): {resp}", file=sys.stderr)
        return 0 if ok else 1

    # Create the campaign (draft) for any real action.
    campaign = {
        "name": f"SMA Newsletter {args.language} — {subject}",
        "subject": subject,
        "sender": {"name": sender_name, "email": sender_email},
        "htmlContent": html,
        "recipients": {"listIds": [list_id]},
    }
    status, resp = brevo("POST", "/emailCampaigns", key, campaign)
    if status not in (200, 201):
        print(f"\nFailed to create campaign (HTTP {status}): {resp}", file=sys.stderr)
        return 1
    campaign_id = resp.get("id")
    print(f"\nCreated draft campaign id={campaign_id}")

    if args.test:
        recipients = [e.strip() for e in args.test.split(",") if e.strip()]
        status, resp = brevo("POST", f"/emailCampaigns/{campaign_id}/sendTest", key, {"emailTo": recipients})
        if status in (200, 201, 204):
            print(f"Sent test to {', '.join(recipients)}. Check the inbox(es).")
            return 0
        print(f"Test send failed (HTTP {status}): {resp}", file=sys.stderr)
        return 1

    if args.send:
        status, resp = brevo("POST", f"/emailCampaigns/{campaign_id}/sendNow", key, None)
        if status in (200, 201, 204):
            print(f"Campaign {campaign_id} sent to list {list_id}.")
            return 0
        print(f"Send failed (HTTP {status}): {resp}", file=sys.stderr)
        return 1

    # --create only
    print("Draft left in Brevo (not sent). Review/send it from the Brevo dashboard, "
          "or re-run with --send.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
