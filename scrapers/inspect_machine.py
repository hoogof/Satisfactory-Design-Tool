import requests
from bs4 import BeautifulSoup

BASE_URL = "https://satisfactory.wiki.gg"
HEADERS = {"User-Agent": "SatisfactoryDesignTool/1.0"}

soup = BeautifulSoup(requests.get(f"{BASE_URL}/wiki/Smelter", headers=HEADERS, timeout=15).text, "html.parser")

# Find any table
for i, table in enumerate(soup.find_all("table")[:6]):
    cls = table.get("class", [])
    rows = table.find_all("tr")
    print(f"\n--- Table {i} class={cls} rows={len(rows)} ---")
    for row in rows[:6]:
        print(row.get_text(" | ", strip=True)[:200])
