import feedparser
import json
from datetime import datetime
import uuid

RSS_URL = "https://smanewstoday.com/feed/"
SOURCE_NAME = "SMA News Today"


def parse_date(entry):
    if hasattr(entry, "published_parsed") and entry.published_parsed:
        return datetime(*entry.published_parsed[:6]).strftime("%Y-%m-%d")
    return None


def fetch_articles():
    feed = feedparser.parse(RSS_URL)
    articles = []

    for entry in feed.entries:
        article = {
            "id": str(uuid.uuid4()),  # temporary unique id

            "title": entry.get("title"),

            "source": SOURCE_NAME,

            "url": entry.get("link"),

            "published_at": parse_date(entry),

            "language": "en",

            "content": "",  # Sprint 1 → leave empty

            "snippet": entry.get("summary", ""),

            "collected_at": datetime.utcnow().isoformat() + "Z",

            "posted_at": None,

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