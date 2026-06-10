# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A two-part tool for planning Satisfactory factory chains:
1. **`scrapers/`** — Python BeautifulSoup scrapers that pull recipe, machine, and icon data from `satisfactory.wiki.gg`.
2. **`planner/`** — React + React Flow visual canvas app that consumes those JSON files.

## Commands

All commands run from `planner/`:

```bash
npm run dev       # dev server (Vite, hot reload)
npm run build     # tsc -b && vite build  (use this to type-check)
npm run lint      # ESLint
npm test          # vitest — store logic tests in src/store.test.ts
```

Tests cover the Zustand store only (autoscale propagation, conservation check, rounding); UI components are untested. `npm run build` is the primary way to verify TypeScript correctness.

To re-scrape data:
```bash
cd scrapers
pip install requests beautifulsoup4
python scraper.py        # recipes + machines → recipes.json / machines.json
python icon_scraper.py   # icons → planner/public/icons/, icons.json, adds "icon" fields
```

`scraper.py` writes to the repo root only; the app reads the copies in `planner/src/data/`, so copy them over after re-scraping. `icon_scraper.py` updates both locations itself and is idempotent (skips already-downloaded icons).

## Architecture

### Data flow
`planner/src/data/recipes.json` / `machines.json` → imported statically in `store.ts` → exposed as `allRecipes`, `allMachines`, `recipeMap`, `machineMap` — all components read from these, never from the JSON directly. `planner/src/data/icons.json` (slug → `icons/{slug}.png` under `public/`) is consumed only by `src/components/ItemIcon.tsx`.

### State management — `src/store.ts` (Zustand)
Single store holds `nodes: Node[]` and `edges: Edge[]`. Key actions:
- `addRecipeNode`, `addSourceNode`, `addSplitterMergerNode`, `addFactoryNode`, `addToFactory`
- `updateNodeData(nodeId, patch)` — unified updater for all node types
- `scaleConnectedNodes(startNodeId, ratio)` — autoscale entry point (see below)
- `deleteNode` — for factory nodes, frees children to absolute positions first
- `exportJSON` / `importJSON` — serialise/deserialise the whole workspace

### Sheets
The workspace holds multiple independent sheets (`SheetData[]` + `activeSheetId`); the tab bar is `SheetTabs` in `App.tsx`. **The active sheet's nodes/edges are canonical in `state.nodes`/`state.edges`** — the entry in `sheets[]` is stale until synced via `syncedSheets()`, which every sheet operation, autosave write, and export must go through. Persistence format is `{ sheets, activeSheetId }`; `parseWorkspace()` still accepts the legacy `{ nodes, edges }` single-canvas format (autosave + import).

### Clipboard — `copySelection` / `cutSelection` / `pasteClipboard` in `src/store.ts`
Bound to Ctrl/Cmd+C/X/V in `App.tsx` (skipped while typing in inputs). The clipboard lives in the store so it survives sheet switches. Copying a selected factory implicitly includes its members; a child copied without its factory is converted to a free node at absolute position. **Paste assigns new node IDs and must rewrite edge `sourceHandle`/`targetHandle` too, because handle IDs embed the node ID.** Repeated pastes cascade by +48px (the stored clipboard is re-offset after each paste).

`sortNodes()` keeps factory nodes at the front of the array — React Flow requires parents to appear before their children.

### Autoscale — `propagateScale()` in `src/store.ts`
When a node's amount changes, the ratio propagates across the edge graph (DFS with a visited set): `machineCount` on recipe nodes, `ratePerMin` on sources, every entry of `outputRates` on splitter/mergers. Manual edits propagate **bidirectionally** (`scaleConnectedNodes`, called from `RecipeNode.commitCount` and `SourceNode.commitRate`); new connections propagate downstream only (`onConnect`). Gated by the `autoScale` store flag. If you add a new node type that carries an amount, it must get a case in `propagateScale.scaleOne`.

**Conservation check**: `checkConservation()` runs automatically after every scale pass — for each recipe node it compares delivered supply vs. consumption; for each splitter/merger, inflow vs. allocated outflow. Comparison is epsilon-based (`conservationOk`, never strict float equality). Failures populate `conservationIssues` in the store, which drives a red outline on offending nodes (`.node--conservation-error`) and the `ConservationWarning` toast in `App.tsx`.

**Rounding rule**: every amount *written* to node data must pass through `round4()` (4 decimal places) to keep float tails out of stored state. The conservation epsilon (0.005) is sized to absorb worst-case 4-dp rounding — don't tighten one without the other.

### Node types

| Type | File | Data interface |
|------|------|----------------|
| `recipeNode` | `src/nodes/RecipeNode.tsx` | `RecipeNodeData` |
| `sourceNode` | `src/nodes/SourceNode.tsx` | `SourceNodeData` |
| `factoryNode` | `src/nodes/FactoryNode.tsx` | `FactoryNodeData` |
| `splitterMergerNode` | `src/nodes/SplitterMergerNode.tsx` | `SplitterMergerNodeData` |
| `sinkNode` | `src/nodes/SinkNode.tsx` | `SinkNodeData` |

**Sink nodes** are terminal consumers — a single type-agnostic input handle (`{id}-sink-in`, deliberately *not* the `{id}-in-{slug}` form so `connectionItemsMatch` lets any item in), no output, and no stored amount. What they consume is derived at render time by resolving incoming edges via `deriveFlowFromHandle`. They carry no amount, so they need no `propagateScale.scaleOne` case and are skipped by the conservation check.

**React Flow v12 constraint**: Node `data` must satisfy `Record<string, unknown>`. All data interfaces extend it. Access node data with `node.data as unknown as MyType`.

**Factory nodes** use React Flow's `parentId` + `extent: 'parent'` to contain children. Member positions are stored relative to the factory origin; `addFactoryNode` and `deleteNode` convert between absolute and relative coords. `FactoryNode` derives its member list at render time from `nodes.filter(n => n.parentId === id)` — `memberIds` is not stored in data.

**Handle IDs** follow a strict convention used by both `RecipeNode` and `App.tsx` edge-colouring logic:
```
{nodeId}-in-{item-slug}   // input handle
{nodeId}-out-{item-slug}  // output handle
{nodeId}-out              // source node single output
{nodeId}-sm-in-{index}    // splitter/merger input (0-based)
{nodeId}-sm-out-{index}   // splitter/merger output (0-based)
{factoryId}-factory-in-{item-slug}   // factory border input
{factoryId}-factory-out-{item-slug}  // factory border output
```
where `item-slug = item.toLowerCase().replace(/[^a-z0-9]/g, '-')`.

**Handle vertical layout**: handles keep a small fixed gap between them — never percentage-of-height spreading, which drifts apart on tall boxes. `FactoryNode` centers the cluster on the box midpoint (`calc(50% + offset)`); `SplitterMergerNode` uses fixed pixel offsets from the top aligned to its port rows. `RecipeNode` is the exception: its handles are percentage-based but derived from fixed row heights so they align with port rows.

### Connection validation — `connectionItemsMatch()` in `src/store.ts`
A link is only allowed when the item flowing out of the source handle (resolved via `deriveFlowFromHandle`) matches the item the target handle expects — recipe and factory inputs encode it in the handle ID slug; splitter/merger inputs are locked to whatever item already flows in. Enforced in two places: React Flow's `isValidConnection` prop in `App.tsx` (live feedback while dragging) and `onConnect` (final gate — mismatches are silently dropped). Unresolvable sources (e.g. a recipe node with no recipe picked) are allowed rather than blocked.

### Edge handling — `src/edges/DeletableEdge.tsx`
Custom edge with a wide (16px) transparent hit-area path. The × delete button lives inside `EdgeLabelRenderer` (a portal — not a DOM child of the SVG edge). Hover state is tracked with React `useState` on the hit-area path's `onMouseEnter`/`onMouseLeave`; CSS `:hover` selectors on `.react-flow__edge` cannot reach the portal.

### Edge colouring — `useEdgeStyles()` in `src/App.tsx`
Runs on every render, computes green/red per edge by comparing produced rate vs. needed rate. Green = sufficient supply; red = deficit. Source-node edges are always green.

### Icons — `src/components/ItemIcon.tsx`
`<ItemIcon name={...} />` renders the scraped icon to the left of an item/machine name (16–18 px). It slugifies the name (collapsing runs of non-alphanumerics — this must stay in sync with `slugify()` in `scrapers/icon_scraper.py`, and differs slightly from the handle-ID slug), looks it up in `icons.json`, and prefixes `import.meta.env.BASE_URL` (the app deploys under `/Satisfactory-Design-Tool/`). Missing entries render nothing; a 404 hides the `<img>` via `onError` — there are never broken-image icons. Legacy name renames (e.g. "SAM Ore" → "SAM") live in its `SLUG_ALIASES` map.

### Math expression input
`RecipeNode` (machine count), `SourceNode` (rate), and `SplitterMergerNode` (output rates) support math expressions (`+`, `-`, `*`, `/`, `^`). Implemented via `evalMath()` — a `new Function()` evaluator guarded by a character whitelist. Evaluation happens on blur or Enter; raw string is kept in local state while typing.

### Theming
CSS custom properties in `src/App.css` under `:root` (light) and `[data-theme="dark"]` (dark). The `data-theme` attribute is set on `<html>` by `App.tsx`. Dark mode is the default.

### Drag handle
`DRAG_HANDLE = '.node-drag-handle'` is set on every node so dragging only works from the header. Interactive children (inputs, selects, buttons) override `cursor` back to their default so they remain clickable without triggering drag.
