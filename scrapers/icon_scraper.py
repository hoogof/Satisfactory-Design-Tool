"""
Satisfactory wiki icon scraper — downloads item & machine icons from wiki.gg

Reads:   ../recipes.json, ../machines.json  (output of scraper.py)
Writes:  ../planner/public/icons/{slug}.png          (one icon per item/machine)
         ../planner/src/data/icons.json              (slug -> relative icon path)
         adds an "icon" field to each machine entry and each recipe entry
         in both the repo-root and planner/src/data JSON copies.

Idempotent: already-downloaded icons are skipped, so re-runs only fetch
whatever is missing.
"""

import json
import os
import re
import time
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://satisfactory.wiki.gg"
HEADERS = {"User-Agent": "SatisfactoryDesignTool/1.0 (educational project)"}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)

REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
ICONS_DIR = os.path.join(REPO_ROOT, "planner", "public", "icons")
ICON_MAP_PATH = os.path.join(REPO_ROOT, "planner", "src", "data", "icons.json")

# Both copies of the scraped data get the new "icon" fields
DATA_FILES = {
    "recipes":  [os.path.join(REPO_ROOT, "recipes.json"),
                 os.path.join(REPO_ROOT, "planner", "src", "data", "recipes.json")],
    "machines": [os.path.join(REPO_ROOT, "machines.json"),
                 os.path.join(REPO_ROOT, "planner", "src", "data", "machines.json")],
}


def fetch(url: str) -> BeautifulSoup:
    resp = SESSION.get(url, timeout=15)
    resp.raise_for_status()
    time.sleep(0.4)
    return BeautifulSoup(resp.text, "html.parser")


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path: str, data) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def download_icon(url: str, slug: str) -> bool:
    """Download one icon to ICONS_DIR/{slug}.png. Skips existing files."""
    dest = os.path.join(ICONS_DIR, f"{slug}.png")
    if os.path.exists(dest):
        return True
    try:
        resp = SESSION.get(url, timeout=15)
        resp.raise_for_status()
        if not resp.headers.get("Content-Type", "").startswith("image"):
            return False
        with open(dest, "wb") as f:
            f.write(resp.content)
        time.sleep(0.4)
        return True
    except Exception as e:
        print(f"    icon FAILED for {slug}: {e}")
        return False


# ---------------------------------------------------------------------------
# Item icons — all of them appear on the single /wiki/Recipes page as
#   <div class="recipe-item"><a><img src="/images/thumb/..."></a>
#                            <span class="item-name">Name</span> ...</div>
# ---------------------------------------------------------------------------

def collect_item_icon_urls() -> dict[str, str]:
    print("Fetching /wiki/Recipes for item icons ...")
    soup = fetch(f"{BASE_URL}/wiki/Recipes")
    urls: dict[str, str] = {}
    for div in soup.find_all("div", class_="recipe-item"):
        name_el = div.find("span", class_="item-name")
        img = div.find("img")
        if not name_el or not img or not img.get("src"):
            continue
        name = name_el.get_text(strip=True)
        if name and name not in urls:
            urls[name] = BASE_URL + img["src"]
    print(f"  Found icon URLs for {len(urls)} items")
    return urls


def guess_icon_url(name: str) -> str:
    """Fallback: the wiki serves most full-size icons at /images/{Page_Name}.png"""
    return f"{BASE_URL}/images/{name.replace(' ', '_')}.png"


# ---------------------------------------------------------------------------
# Machine icons — each machine page exposes its icon via <meta property="og:image">
# ---------------------------------------------------------------------------

def machine_icon_url(name: str) -> str | None:
    url = f"{BASE_URL}/wiki/{name.replace(' ', '_')}"
    try:
        soup = fetch(url)
    except Exception as e:
        print(f"    page FAILED for {name}: {e}")
        return None
    og = soup.find("meta", property="og:image")
    return og["content"] if og and og.get("content") else None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=== Satisfactory Wiki Icon Scraper ===\n")
    os.makedirs(ICONS_DIR, exist_ok=True)

    recipes = load_json(DATA_FILES["recipes"][0])
    machines = load_json(DATA_FILES["machines"][0])

    # Every item referenced by any recipe
    item_names: set[str] = set()
    for r in recipes:
        for io in r.get("inputs", []) + r.get("outputs", []):
            item_names.add(io["item"])

    icon_map: dict[str, str] = {}   # slug -> path relative to public/

    # ── Items ────────────────────────────────────────────────────
    item_urls = collect_item_icon_urls()
    print(f"\nDownloading {len(item_names)} item icons ...")
    for name in sorted(item_names):
        slug = slugify(name)
        url = item_urls.get(name) or guess_icon_url(name)
        if download_icon(url, slug):
            icon_map[slug] = f"icons/{slug}.png"
        elif name not in item_urls:
            print(f"  no icon found for item: {name}")

    # ── Machines ─────────────────────────────────────────────────
    print(f"\nDownloading {len(machines)} machine icons ...")
    for m in machines:
        slug = slugify(m["name"])
        if slug in icon_map:
            continue
        dest = os.path.join(ICONS_DIR, f"{slug}.png")
        if os.path.exists(dest):                      # idempotent re-run
            icon_map[slug] = f"icons/{slug}.png"
            continue
        print(f"  Fetching {m['name']} ...")
        url = machine_icon_url(m["name"]) or guess_icon_url(m["name"])
        if download_icon(url, slug):
            icon_map[slug] = f"icons/{slug}.png"
        else:
            print(f"  no icon found for machine: {m['name']}")

    # ── Write icon map ───────────────────────────────────────────
    save_json(ICON_MAP_PATH, dict(sorted(icon_map.items())))
    print(f"\nWrote {len(icon_map)} entries to {ICON_MAP_PATH}")

    # ── Add "icon" fields to the scraped data files ─────────────
    for m in machines:
        m["icon"] = icon_map.get(slugify(m["name"]))
    for r in recipes:
        # A recipe's icon is its primary (first) output's icon
        first_out = r["outputs"][0]["item"] if r.get("outputs") else None
        r["icon"] = icon_map.get(slugify(first_out)) if first_out else None

    for path in DATA_FILES["machines"]:
        save_json(path, machines)
    for path in DATA_FILES["recipes"]:
        save_json(path, recipes)
    print("Added icon fields to recipes.json and machines.json (root + planner copies)")

    missing = [n for n in sorted(item_names) if slugify(n) not in icon_map]
    if missing:
        print(f"\nItems without icons ({len(missing)}): {', '.join(missing)}")


if __name__ == "__main__":
    main()
