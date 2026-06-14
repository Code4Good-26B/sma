import os
import json
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

with open("data/normalized/collected_items.json", "r") as f:
    articles = json.load(f)

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

for article in articles:
    print(article["title"])
    # later: insert into DB table

cur.close()
conn.close()