# Collector configuration — all tunable parameters are here.

LOOKBACK_DAYS = 14
# How many days back to collect articles.
#
# The window is deliberately much wider than the daily run interval — this
# is a self-healing margin, not a duplicate-fetching risk. The collector can
# be broken for up to two weeks (a source down, GitHub Actions misconfigured,
# nobody noticing for a while — this project has no maintainer) and still
# lose nothing once it is fixed. It costs almost nothing to keep this wide:
# the DB is checked for existing source_urls before any article page is
# downloaded, so re-scanning old listings is cheap — only genuinely new
# articles trigger a fetch.
# Change this value to adjust the collection window.

MAX_PAGES = 10
# Safety cap on pagination for sources that have dates on listing cards
# (Cure SMA RSS, SMA Europe HTML). Stops even if the date cutoff hasn't
# been reached yet, to prevent infinite loops.

MAX_PAGES_NO_DATE = 2
# Page cap for sources that don't show dates on listing cards (SMA News Today).
# Kept small because early stopping (once we start seeing old articles) handles
# most cases — these pages are a backup safety cap only.

REQUEST_DELAY_SECONDS = 1.0
# Sleep between HTTP requests (both page fetches and individual article fetches)
# to avoid rate limiting (429 errors).
