# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A two-part tool for planning Satisfactory factory chains:
1. **`scrapers/`** — Python BeautifulSoup scrapers that pull recipe and machine data from `satisfactory.wiki.gg` and emit `recipes.json` / `machines.json` at the repo root.
2. **`planner/`** — React + React Flow visual canvas app that consumes those JSON files.

## Commands

All commands run from `planner/`:

```bash
npm run dev       # dev server (Vite, hot reload)
npm run build     # tsc -b && vite build  (use this to type-check)
npm run lint      # ESLint
```

There are no tests. `npm run build` is the primary way to verify TypeScript correctness.

To re-scrape data:
```bash
cd scrapers
pip install requests beautifulsoup4
python scraper.py   # writes ../recipes.json and ../machines.json
```

## Architecture

### Data flow
`recipes.json` / `machines.json` → imported statically in `store.ts` → exposed as `allRecipes`, `allMachines`, `recipeMap`, `machineMap` — all components read from these, never from the JSON directly.

### State management — `src/store.ts` (Zustand)
Single store holds `nodes: Node[]` and `edges: Edge[]`. Key actions:
- `addRecipeNode`, `addSourceNode`, `addFactoryNode`, `addToFactory`
- `updateNodeData(nodeId, patch)` — unified updater for all node types
- `deleteNode` — for factory nodes, frees children to absolute positions first
- `exportJSON` / `importJSON` — serialise/deserialise the canvas

`sortNodes()` keeps factory nodes at the front of the array — React Flow requires parents to appear before their children.

### Node types

| Type | File | Data interface |
|------|------|----------------|
| `recipeNode` | `src/nodes/RecipeNode.tsx` | `RecipeNodeData` |
| `sourceNode` | `src/nodes/SourceNode.tsx` | `SourceNodeData` |
| `factoryNode` | `src/nodes/FactoryNode.tsx` | `FactoryNodeData` |

**React Flow v12 constraint**: Node `data` must satisfy `Record<string, unknown>`. All data interfaces extend it. Access node data with `node.data as unknown as MyType`.

**Factory nodes** use React Flow's `parentId` + `extent: 'parent'` to contain children. Member positions are stored relative to the factory origin; `addFactoryNode` and `deleteNode` convert between absolute and relative coords. `FactoryNode` derives its member list at render time from `nodes.filter(n => n.parentId === id)` — `memberIds` is not stored in data.

**Handle IDs** follow a strict convention used by both `RecipeNode` and `App.tsx` edge-colouring logic:
```
{nodeId}-in-{item-slug}   // input handle
{nodeId}-out-{item-slug}  // output handle
{nodeId}-out              // source node single output
{factoryId}-factory-in-{item-slug}   // factory border input
{factoryId}-factory-out-{item-slug}  // factory border output
```
where `item-slug = item.toLowerCase().replace(/[^a-z0-9]/g, '-')`.

### Edge handling — `src/edges/DeletableEdge.tsx`
Custom edge with a wide (16px) transparent hit-area path. The × delete button lives inside `EdgeLabelRenderer` (a portal — not a DOM child of the SVG edge). Hover state is tracked with React `useState` on the hit-area path's `onMouseEnter`/`onMouseLeave`; CSS `:hover` selectors on `.react-flow__edge` cannot reach the portal.

### Edge colouring — `useEdgeStyles()` in `src/App.tsx`
Runs on every render, computes green/red per edge by comparing produced rate vs. needed rate. Green = sufficient supply; red = deficit. Source-node edges are always green.

### Math expression input
Both `RecipeNode` (machine count) and `SourceNode` (rate) support math expressions (`+`, `-`, `*`, `/`, `^`). Implemented via `evalMath()` — a `new Function()` evaluator guarded by a character whitelist. Evaluation happens on blur or Enter; raw string is kept in local state while typing.

### Theming
CSS custom properties in `src/App.css` under `:root` (light) and `[data-theme="dark"]` (dark). The `data-theme` attribute is set on `<html>` by `App.tsx`. Dark mode is the default.

### Drag handle
`DRAG_HANDLE = '.node-drag-handle'` is set on every node so dragging only works from the header. Interactive children (inputs, selects, buttons) override `cursor` back to their default so they remain clickable without triggering drag.
