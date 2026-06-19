SOURCES = [
    {
        "name": "Cure SMA",
        "source_type": "website",
        "rss_url": "https://www.curesma.org/feed/",
        "html_fallback": False,
    },
    #{
    #    "name": "SMA Europe",
    #    "source_type": "website",
    #    "rss_url": None,            # RSS feed is not available; always use HTML scraper
    #    "html_fallback": True,
    #},
    {
        "name": "SMA News Today",
        "source_type": "website",
        "rss_url": None,            # RSS feed returns 403; always use HTML scraper
        "html_fallback": True,
    },
]
