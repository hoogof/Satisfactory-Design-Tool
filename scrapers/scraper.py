"""
Satisfactory wiki scraper — fetches recipes and machines from wiki.gg
Outputs: recipes.json, machines.json
"""

import json
import re
import time
from dataclasses import dataclass, asdict
from typing import Optional
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://satisfactory.wiki.gg"
HEADERS = {"User-Agent": "SatisfactoryDesignTool/1.0 (educational project)"}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)


def fetch(url: str) -> BeautifulSoup:
    resp = SESSION.get(url, timeout=15)
    resp.raise_for_status()
    time.sleep(0.4)
    return BeautifulSoup(resp.text, "html.parser")


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def parse_rate(text: str) -> float:
    """Extract a number from strings like '4 /\xa0min', '100 / min', '1.5/min'."""
    clean = text.replace("\xa0", " ").replace(",", "")
    m = re.search(r"([\d.]+)\s*/\s*min", clean)
    if m:
        return float(m.group(1))
    # Fallback: first number
    m = re.search(r"[\d.]+", clean)
    return float(m.group(0)) if m else 0.0


# ---------------------------------------------------------------------------
# Recipe scraping
# ---------------------------------------------------------------------------

def parse_item_group(cell) -> list[dict]:
    """
    Parse a recipe-items div containing recipe-item divs.
    Each recipe-item has:
      <span class="item-name">Iron Ingot</span>
      <span class="item-minute">30 /min</span>
    """
    items = []
    for div in cell.find_all("div", class_="recipe-item"):
        name_el = div.find("span", class_="item-name")
        rate_el = div.find("span", class_="item-minute")
        if name_el and rate_el:
            items.append({
                "item": name_el.get_text(strip=True),
                "ratePerMin": parse_rate(rate_el.get_text(strip=True)),
            })
    return items


def parse_machines_from_cell(cell) -> list[str]:
    """Extract machine names from a recipe-building div."""
    machines = []
    for a in cell.find_all("a", title=True):
        title = a["title"].strip()
        if title and title not in machines:
            machines.append(title)
    if not machines:
        # Fallback: text
        text = cell.get_text(" ", strip=True)
        if text:
            machines = [text]
    return machines


def parse_recipes_page() -> list[dict]:
    print("Fetching /wiki/Recipes ...")
    soup = fetch(f"{BASE_URL}/wiki/Recipes")
    recipes = []

    table = soup.find("table", class_=lambda c: c and "wikitable" in " ".join(c if isinstance(c, list) else [c]))
    if not table:
        print("  WARNING: no wikitable found on recipes page")
        return []

    rows = table.find_all("tr")
    print(f"  Found {len(rows) - 1} data rows")

    # Column order: Recipe | Ingredients | Produced in | Products | Unlocked by
    for row in rows[1:]:
        cells = row.find_all("td")
        if len(cells) < 4:
            continue

        # Recipe name (col 0)
        raw_name = cells[0].get_text(" ", strip=True)
        if not raw_name:
            continue

        is_alt = "Alternate" in raw_name
        clean_name = re.sub(r"^Alternate\s*:?\s*", "", raw_name, flags=re.I).strip()

        # Ingredients (col 1)
        inputs = parse_item_group(cells[1])

        # Produced in (col 2)
        machines = parse_machines_from_cell(cells[2])

        # Products (col 3)
        outputs = parse_item_group(cells[3])

        # Unlocked by (col 4, optional)
        unlock = cells[4].get_text(" ", strip=True) if len(cells) > 4 else ""

        recipes.append({
            "id": slugify(clean_name),
            "name": clean_name,
            "isAlternate": is_alt,
            "machines": machines,
            "inputs": inputs,
            "outputs": outputs,
            "unlockMethod": unlock,
        })

    return recipes


# ---------------------------------------------------------------------------
# Machine scraping
# We get machine data from each machine's own wiki page.
# The list of production buildings comes from the Buildings navbox.
# ---------------------------------------------------------------------------

# Known production machines — we'll scrape their individual pages
PRODUCTION_MACHINES = [
    "Smelter",
    "Foundry",
    "Constructor",
    "Assembler",
    "Manufacturer",
    "Refinery",
    "Blender",
    "Packager",
    "Particle Accelerator",
    "Quantum Encoder",
    "Converter",
    "Nuclear Power Plant",
    "Biomass Burner",
    "Coal Generator",
    "Fuel Generator",
    "Geothermal Generator",
    "Water Extractor",
    "Oil Extractor",
    "Resource Well Pressurizer",
    "Miner Mk.1",
    "Miner Mk.2",
    "Miner Mk.3",
]

# Machine category mapping
MACHINE_CATEGORIES = {
    "Smelter": "Smelting",
    "Foundry": "Smelting",
    "Constructor": "Production",
    "Assembler": "Production",
    "Manufacturer": "Production",
    "Refinery": "Refining",
    "Blender": "Refining",
    "Packager": "Packaging",
    "Particle Accelerator": "Advanced",
    "Quantum Encoder": "Advanced",
    "Converter": "Advanced",
    "Nuclear Power Plant": "Power",
    "Biomass Burner": "Power",
    "Coal Generator": "Power",
    "Fuel Generator": "Power",
    "Geothermal Generator": "Power",
    "Water Extractor": "Extraction",
    "Oil Extractor": "Extraction",
    "Resource Well Pressurizer": "Extraction",
    "Miner Mk.1": "Extraction",
    "Miner Mk.2": "Extraction",
    "Miner Mk.3": "Extraction",
}


def scrape_machine_page(name: str) -> dict:
    url = f"{BASE_URL}/wiki/{name.replace(' ', '_')}"
    print(f"  Fetching {name} ...")
    try:
        soup = fetch(url)
    except Exception as e:
        print(f"    ERROR: {e}")
        return _default_machine(name)

    power = 0.0
    tier = 0
    description = ""

    # Power comes from the clock-speed table: rows are "Clock speed" and "Consumption (MW)"
    # We want the value at 100% (index 4 in the header row: 25/50/75/100/150/200/250)
    for table in soup.find_all("table", class_="wikitable"):
        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all(["th", "td"])
            header = cells[0].get_text(strip=True).lower() if cells else ""
            if "consumption" in header and "mw" in header and len(cells) >= 5:
                # cells[1..] correspond to 25%, 50%, 75%, 100%, ...
                # 100% is at index 4
                val_text = cells[4].get_text(strip=True).replace(",", "")
                m = re.search(r"[\d.]+", val_text)
                if m:
                    power = float(m.group(0))
                break

    # Tier from the recipetable "Unlocked by" column, or any mention of "Tier N"
    content = soup.find("div", class_="mw-parser-output")
    if content:
        text = content.get_text(" ")
        # Look for "Tier N" pattern
        tier_matches = re.findall(r"\bTier\s+(\d+)\b", text)
        if tier_matches:
            tier = min(int(t) for t in tier_matches)  # earliest tier

        # Description: first <p> that isn't a short stub
        for p in content.find_all("p"):
            pt = p.get_text(" ", strip=True)
            if len(pt) > 40:
                description = pt[:300]
                break

    return {
        "id": slugify(name),
        "name": name,
        "category": MACHINE_CATEGORIES.get(name, "Other"),
        "powerConsumptionMW": power,
        "tier": tier,
        "description": description,
    }


def _default_machine(name: str) -> dict:
    return {
        "id": slugify(name),
        "name": name,
        "category": MACHINE_CATEGORIES.get(name, "Other"),
        "powerConsumptionMW": 0.0,
        "tier": 0,
        "description": "",
    }


def collect_machines_from_recipes(recipes: list[dict]) -> list[str]:
    """Also collect any machine names that appear in recipes but not in our hardcoded list."""
    seen = set(PRODUCTION_MACHINES)
    extras = []
    for r in recipes:
        for m in r.get("machines", []):
            if m not in seen and m != "Unknown":
                seen.add(m)
                extras.append(m)
    return extras


def parse_machines(recipes: list[dict]) -> list[dict]:
    print("\nScraping machine pages ...")
    extra = collect_machines_from_recipes(recipes)
    all_machines = PRODUCTION_MACHINES + extra
    machines = []
    for name in all_machines:
        machines.append(scrape_machine_page(name))
    return machines


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=== Satisfactory Wiki Scraper ===\n")

    recipes = parse_recipes_page()

    # Deduplicate by id — if same id appears twice keep the non-alternate
    # (alternates share the output item name but have isAlternate=True)
    seen: dict[str, dict] = {}
    for r in recipes:
        key = r["id"]
        if key not in seen or r["isAlternate"]:
            seen[key] = r
    unique_recipes = list(seen.values())

    with open("recipes.json", "w", encoding="utf-8") as f:
        json.dump(unique_recipes, f, indent=2, ensure_ascii=False)
    print(f"\nWrote {len(unique_recipes)} recipes to recipes.json")

    machines = parse_machines(unique_recipes)

    with open("machines.json", "w", encoding="utf-8") as f:
        json.dump(machines, f, indent=2, ensure_ascii=False)
    print(f"Wrote {len(machines)} machines to machines.json")

    # Quick validation
    with_inputs = sum(1 for r in unique_recipes if r["inputs"])
    with_outputs = sum(1 for r in unique_recipes if r["outputs"])
    print(f"\nRecipes with inputs:  {with_inputs}/{len(unique_recipes)}")
    print(f"Recipes with outputs: {with_outputs}/{len(unique_recipes)}")

    # Sample
    sample = next((r for r in unique_recipes if r["inputs"]), unique_recipes[0])
    print("\nSample recipe:")
    print(json.dumps(sample, indent=2))


if __name__ == "__main__":
    main()
