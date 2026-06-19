# Collector configuration — all tunable parameters are here.

LOOKBACK_DAYS = 3
# How many days back to collect articles.
# Run the collector daily for full coverage with overlap.
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
