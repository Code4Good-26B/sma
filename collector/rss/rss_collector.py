import feedparser
import json
from datetime import datetime
import uuid
import html


SOURCES = [
    {
        "name": "Cure SMA",
        "url": "https://www.curesma.org/feed/"
    },
    {
        "name": "SMA Europe",
        "url": "https://www.sma-europe.eu/feed/"
    }
]


def parse_date(entry):
    if hasattr(entry, "published_parsed") and entry.published_parsed:
        return datetime(*entry.published_parsed[:6]).strftime("%Y-%m-%d")
    return None


def fetch_articles():
    articles = []

    for source in SOURCES:
        feed = feedparser.parse(
            source["url"],
            request_headers={
                "User-Agent": "Mozilla/5.0"
            }
        )

        print("Source:", source["name"])
        print("Feed status:", feed.get("status"))
        print("Feed title:", feed.feed.get("title"))
        print("Entries found:", len(feed.entries))
        print("Bozo:", feed.bozo)

        for entry in feed.entries:
            article = {
                "id": str(uuid.uuid4()),
                "title": entry.get("title"),
                "source": source["name"],
                "url": entry.get("link"),
                "published_at": parse_date(entry),
                "language": "en",
                "content": "",
                "snippet": html.unescape(entry.get("summary", "")),
                "collected_at": datetime.utcnow().isoformat() + "Z",
                "posted_at": "",
                "metadata": {
                    "author": entry.get("author", ""),
                    "tags": [tag.term for tag in entry.get("tags", [])] if "tags" in entry else []
                }
            }

            articles.append(article)

    return articles


def save_articles(articles):
    with open("data/normalized/collected_items.json", "w") as f:
        json.dump(articles, f, indent=2)


if __name__ == "__main__":
    articles = fetch_articles()
    save_articles(articles)
    print(f"Saved {len(articles)} articles.")