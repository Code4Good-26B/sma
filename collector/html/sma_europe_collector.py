import requests
from bs4 import BeautifulSoup

URL = "https://www.sma-europe.eu/news"

headers = {
    "User-Agent": "Mozilla/5.0"
}

response = requests.get(URL, headers=headers, timeout=10)

print("Status:", response.status_code)
print("Length:", len(response.text))

soup = BeautifulSoup(response.text, "html.parser")

from urllib.parse import urljoin
import json
import uuid
from datetime import datetime

def parse_sma_europe_date(date_text):
    return datetime.strptime(date_text, "%b %d, %Y").strftime("%Y-%m-%d")

BASE_URL = "https://www.sma-europe.eu"

articles = []
links = soup.find_all("a")

for link in links:
    text = link.get_text(strip=True)
    href = link.get("href")

    if text.lower() == "read" and href and href.startswith("/news/"):
        article_block = link.find_parent().find_parent().find_parent()
        block_text = article_block.get_text(" ", strip=True)

        parts = block_text.split(" ", 3)

        published_at_raw = " ".join(parts[:3])
        title_and_snippet = parts[3] if len(parts) > 3 else ""

        title_tag = article_block.find(["h2", "h3"])
        title = title_tag.get_text(" ", strip=True) if title_tag else ""

        snippet = title_and_snippet.replace(title, "", 1).strip()
        snippet = snippet.replace("Full publication", "").strip()

        if snippet.endswith(" read"):
            snippet = snippet[:-5].strip()

        full_url = urljoin(BASE_URL, href.split("?")[0])

        article = {
            "id": str(uuid.uuid4()),
            "title": title,
            "source": "SMA Europe",
            "url": full_url,
            "published_at": parse_sma_europe_date(published_at_raw),
            "language": "en",
            "content": "",
            "snippet": snippet,
            "collected_at": datetime.utcnow().isoformat() + "Z",
            "posted_at": "",
            "metadata": {
                "author": "",
                "tags": []
            }
        }

        articles.append(article)

for article in articles:
    print(json.dumps(article, indent=2))