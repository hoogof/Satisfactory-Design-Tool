# Optim — Satisfactory Factory Planner

A visual factory chain planner for [Satisfactory](https://www.satisfactorygame.com/), built with React and React Flow.

> **⚠️ Actively in development.** If you run into any bugs or have feature requests, please [leave feedback here](https://forms.gle/j8RU9Yzc2E9ixHsa7).

---

## How it works

### ⚙ Nodes — Machines
Each node represents a production machine (Smelter, Constructor, Assembler, etc.). Pick a recipe from the dropdown, set how many machines are running, and connect inputs/outputs to other nodes. Edge colour shows whether supply meets demand — **green** means satisfied, **red** means a deficit.

### 🪨 Sources — Raw Resources
Source nodes represent raw resource extractors (miners, pumps). Set the resource type and extraction rate. Every production chain should start from a source. Drag one from the sidebar or click the **+ Source** button.

### ⇌ Router — Splitter / Merger
The Router node lets you split one stream into many outputs, or merge multiple streams into one. Once an input is connected the item type is locked — all inputs must carry the same resource. Set the output rate for each port manually; the summary bar warns you if the total output exceeds total input.

### 🏭 Factories — Compartmentalise
Select multiple nodes (click-and-drag or **Shift-click**), then press **New Factory** in the sidebar. The selected nodes are wrapped in a labelled factory block. Factory border handles let you connect the encapsulated outputs directly to external nodes or routers, keeping large designs tidy.

### 🔍 Recipe Search — `N`
Press **N** anywhere on the canvas (or use the search bar in the left sidebar) to open the quick-search modal. Search by recipe name or output item — results are grouped by the item produced. Click any result to instantly add that machine node to the canvas.

### ⛓ Auto-Scale
When enabled, changing a node's machine count automatically scales all connected downstream (and upstream) nodes by the same ratio, keeping your production chain balanced. Toggle it off if you want to adjust counts manually without cascading changes.

### 🗺 MiniMap Navigation
Click anywhere on the minimap (bottom-right corner) to jump the viewport to that area. You can also scroll on the minimap to zoom the main canvas.

### 💾 Saves
Your canvas is **auto-saved in the browser** every time you make a change — refreshing the page restores your last session. Use the **Saves** panel in the sidebar to keep multiple named save slots, load a previous session, or export/import JSON to share a design with someone else.

---

## Running locally

```bash
cd planner
npm install
npm run dev       # starts the Vite dev server
npm run build     # type-check + production build
```

Recipe and machine data is scraped from the [Satisfactory Wiki](https://satisfactory.wiki.gg):

```bash
cd scrapers
pip install requests beautifulsoup4
python scraper.py   # writes ../recipes.json and ../machines.json
```

---

## Tech stack

- **React 19** + **TypeScript**
- **React Flow v12** (`@xyflow/react`) — canvas and node graph
- **Zustand** — state management
- **Vite** — build tooling
- **GitHub Pages** — hosting (`npm run deploy`)

---

## Feedback

Found a bug? Have a suggestion? → **[Submit feedback](https://forms.gle/j8RU9Yzc2E9ixHsa7)**
