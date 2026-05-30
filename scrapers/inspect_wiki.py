"""Quick inspector to understand the wiki HTML structure."""
import requests
from bs4 import BeautifulSoup
import time

BASE_URL = "https://satisfactory.wiki.gg"
HEADERS = {"User-Agent": "SatisfactoryDesignTool/1.0 (educational project)"}

def fetch(url):
    r = requests.get(url, headers=HEADERS, timeout=15)
    r.raise_for_status()
    return BeautifulSoup(r.text, "html.parser")

# --- Recipes page ---
print("=== RECIPES PAGE ===")
soup = fetch(f"{BASE_URL}/wiki/Recipes")

tables = soup.find_all("table", class_=lambda c: c and "wikitable" in c)
print(f"Found {len(tables)} wikitables")

if tables:
    t = tables[0]
    rows = t.find_all("tr")
    print(f"\nFirst table: {len(rows)} rows")
    print("--- Header row ---")
    print(rows[0].prettify()[:2000])
    if len(rows) > 1:
        print("--- First data row ---")
        print(rows[1].prettify()[:3000])

time.sleep(0.5)

# --- Buildings page ---
print("\n=== BUILDINGS PAGE ===")
soup2 = fetch(f"{BASE_URL}/wiki/Buildings")

tables2 = soup2.find_all("table")
print(f"Found {len(tables2)} tables total")
for i, t in enumerate(tables2[:5]):
    cls = t.get("class", [])
    print(f"  Table {i}: class={cls}, rows={len(t.find_all('tr'))}")

# Show a section heading + first table
h2s = soup2.find_all("h2")
print(f"\nH2 headings: {[h.get_text(strip=True) for h in h2s[:10]]}")

# Show raw structure around first table
if tables2:
    print("\n--- First table header ---")
    rows = tables2[0].find_all("tr")
    if rows:
        print(rows[0].prettify()[:1500])
