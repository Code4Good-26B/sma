SOURCES = [
    {
        "name": "Cure SMA",
        "source_type": "website",
        "rss_url": "https://www.curesma.org/feed/",
        "html_fallback": False,
    },
    # Commented out 2026-09: ~85% of its articles had zero SMA mentions.
    #{
    #    "name": "MDA Quest",
    #    "source_type": "website",
    #    "rss_url": "https://mdaquest.org/feed/",
    #    "html_fallback": False,
    #},
    #{
    #    "name": "SMA Europe",
    #    "source_type": "website",
    #    "rss_url": None,            # RSS feed is not available; always use HTML scraper
    #    "html_fallback": True,
    #},
    {
        "name": "SMA News Today",
        "source_type": "website",
        "rss_url": None,            # RSS feed returns 200 now, not 403, but the
                                    # HTML scraper is kept regardless (unchanged for now)
        "html_fallback": True,
    },
]
