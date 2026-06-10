import { create } from 'zustand';
import {
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
} from '@xyflow/react';
import type { RecipeNodeData, SourceNodeData, FactoryNodeData, SplitterMergerNodeData, SinkNodeData } from './types';
import recipesRaw from './data/recipes.json';
import machinesRaw from './data/machines.json';
import type { Recipe, Machine } from './types';

export const allRecipes: Recipe[] = recipesRaw as Recipe[];
export const allMachines: Machine[] = machinesRaw as Machine[];

export const recipeMap = new Map<string, Recipe>(allRecipes.map(r => [r.id, r]));
export const machineMap = new Map<string, Machine>(allMachines.map(m => [m.id, m]));

/**
 * Resolve the {item, rate} flowing out of a given source node handle.
 * Handles sourceNode, recipeNode, and chained splitterMergerNode.
 * Returns null if the handle is unresolvable (no recipe selected, etc.)
 */
export function deriveFlowFromHandle(
  sourceNodeId: string,
  sourceHandle: string,
  nodes: Node[],
  edges: Edge[],
  depth = 0
): { item: string; rate: number } | null {
  if (depth > 8) return null;
  const src = nodes.find(n => n.id === sourceNodeId);
  if (!src) return null;

  if (src.type === 'sourceNode') {
    const d = src.data as unknown as SourceNodeData;
    return { item: d.item || '', rate: d.ratePerMin || 0 };
  }

  if (src.type === 'recipeNode') {
    const d = src.data as unknown as RecipeNodeData;
    const recipe = d.recipe ?? recipeMap.get(d.recipeId);
    const slug = sourceHandle.match(/-out-(.+)$/)?.[1];
    if (recipe && slug) {
      const out = recipe.outputs.find(
        o => o.item.toLowerCase().replace(/[^a-z0-9]/g, '-') === slug
      );
      if (out) return { item: out.item, rate: out.ratePerMin * (d.machineCount || 1) };
    }
    return null;
  }

  if (src.type === 'factoryNode') {
    // Handle ID: {factoryId}-factory-out-{item-slug}
    const slug = sourceHandle.match(/factory-out-(.+)$/)?.[1];
    if (!slug) return null;

    // Replicate the same extOutputs logic as FactoryNode:
    // sum unconnected outputs of interior recipe/source nodes that match the slug
    const members   = nodes.filter(n => n.parentId === src.id);
    const memberSet = new Set(members.map(n => n.id));

    let totalRate = 0;
    let foundItem: string | null = null;

    for (const m of members) {
      if (m.type === 'recipeNode') {
        const d      = m.data as unknown as RecipeNodeData;
        const recipe = d.recipe ?? recipeMap.get(d.recipeId);
        if (!recipe) continue;
        const scale = d.machineCount || 1;
        for (const out of recipe.outputs) {
          const outSlug = out.item.toLowerCase().replace(/[^a-z0-9]/g, '-');
          if (outSlug !== slug) continue;
          // Only count if this output isn't consumed internally
          const hid      = `${m.id}-out-${outSlug}`;
          const internal = edges.some(
            e => e.source === m.id && e.sourceHandle === hid && memberSet.has(e.target)
          );
          if (!internal) {
            totalRate += out.ratePerMin * scale;
            foundItem = out.item;
          }
        }
      } else if (m.type === 'sourceNode') {
        const d       = m.data as unknown as SourceNodeData;
        const srcSlug = (d.item || '').toLowerCase().replace(/[^a-z0-9]/g, '-');
        if (srcSlug !== slug) continue;
        const hid      = `${m.id}-out`;
        const internal = edges.some(
          e => e.source === m.id && e.sourceHandle === hid && memberSet.has(e.target)
        );
        if (!internal) {
          totalRate += d.ratePerMin || 0;
          foundItem = d.item;
        }
      }
    }

    if (foundItem) return { item: foundItem, rate: totalRate };
    return null;
  }

  if (src.type === 'splitterMergerNode') {
    const d = src.data as unknown as SplitterMergerNodeData;
    const outIdx = parseInt(sourceHandle.match(/sm-out-(\d+)$/)?.[1] ?? 'NaN');
    if (isNaN(outIdx)) return null;
    // Find the item by tracing upstream through this sm-node's inputs
    const inCount = d.inputCount ?? 1;
    for (let i = 0; i < inCount; i++) {
      const upEdge = edges.find(e => e.targetHandle === `${sourceNodeId}-sm-in-${i}`);
      if (!upEdge) continue;
      const upstream = deriveFlowFromHandle(upEdge.source, upEdge.sourceHandle ?? '', nodes, edges, depth + 1);
      if (upstream) {
        const outRates = d.outputRates as number[] | undefined;
        return { item: upstream.item, rate: outRates?.[outIdx] ?? 0 };
      }
    }
    return null;
  }

  return null;
}

// Colors drawn from authentic Satisfactory item palette
// tai-jee.github.io/satisfactory-colour-table
export const CATEGORY_COLORS: Record<string, string> = {
  Smelting:   '#ae8176',   // Copper tone
  Production: '#5bb0c5',   // FICSIT Blue
  Refining:   '#957e4e',   // Caterium gold
  Packaging:  '#908277',   // Concrete grey
  Advanced:   '#ca6707',   // Ficsite orange
  Power:      '#62b944',   // Resource green
  Extraction: '#6abf4b',   // Leaf green
  Other:      '#606161',   // Iron grey
};

// All raw resources extractable in Satisfactory
export const RAW_RESOURCES: { name: string; defaultRate: number }[] = [
  { name: 'Limestone',    defaultRate: 60  },
  { name: 'Iron Ore',     defaultRate: 60  },
  { name: 'Copper Ore',   defaultRate: 60  },
  { name: 'Caterium Ore', defaultRate: 60  },
  { name: 'Coal',         defaultRate: 60  },
  { name: 'Sulfur',       defaultRate: 60  },
  { name: 'Bauxite',      defaultRate: 60  },
  { name: 'Raw Quartz',   defaultRate: 60  },
  { name: 'Uranium',      defaultRate: 60  },
  { name: 'SAM Ore',      defaultRate: 60  },
  { name: 'Crude Oil',    defaultRate: 60  },
  { name: 'Water',        defaultRate: 120 },
  { name: 'Nitrogen Gas', defaultRate: 60  },
];

// FICSIT-authentic factory palette — Satisfactory item colors
export const FACTORY_PALETTE = [
  '#fa9549',   // FICSIT Orange
  '#5bb0c5',   // FICSIT Blue
  '#62b944',   // Resource Green
  '#ca6707',   // Ficsite
  '#957e4e',   // Caterium
  '#ae8176',   // Copper
  '#808182',   // Iron
  '#d2a736',   // Crystal Oscillator / Gold
];

function getCategoryForMachine(machineName: string): string {
  const m = allMachines.find(m => m.name === machineName);
  return m?.category ?? 'Other';
}

export function getCategoryColor(machineName: string): string {
  return CATEGORY_COLORS[getCategoryForMachine(machineName)] ?? CATEGORY_COLORS.Other;
}

let nodeIdCounter = 1;
export function nextId() {
  return `node_${nodeIdCounter++}`;
}

// Single rounding rule for every written amount — 4 decimal places.
// Keeps float tails (0.30000000000000004) out of stored data while staying
// well inside the conservation-check tolerance.
export function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

/** Advance the counter past the highest numeric ID in the given node list. */
function seedCounter(nodes: Node[]) {
  for (const n of nodes) {
    const num = parseInt(n.id.replace('node_', ''), 10);
    if (!isNaN(num) && num >= nodeIdCounter) nodeIdCounter = num + 1;
  }
}

const itemSlug = (item: string) => item.toLowerCase().replace(/[^a-z0-9]/g, '-');

// ── Connection type check ────────────────────────────────────────
// A link is only valid when the item flowing out of the source handle matches
// the item the target handle expects. Used by both React Flow's
// isValidConnection (live feedback while dragging) and onConnect (final gate).
// When the source item can't be resolved (e.g. recipe not picked yet) we
// allow the connection rather than block the user on unknowns.
export function connectionItemsMatch(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  nodes: Node[],
  edges: Edge[]
): boolean {
  const flow = deriveFlowFromHandle(source, sourceHandle, nodes, edges);
  if (!flow?.item) return true;
  const srcSlug = itemSlug(flow.item);

  // Splitter/merger inputs are untyped until something flows in — then every
  // further input must carry the same item. (Check before the generic -in-
  // match below: "-sm-in-0" would also match that pattern.)
  if (/-sm-in-\d+$/.test(targetHandle)) {
    const tgt = nodes.find(n => n.id === target);
    if (tgt?.type !== 'splitterMergerNode') return true;
    const d = tgt.data as unknown as SplitterMergerNodeData;
    const inCount = d.inputCount ?? 1;
    for (let i = 0; i < inCount; i++) {
      const e = edges.find(e => e.targetHandle === `${target}-sm-in-${i}`);
      if (!e) continue;
      const existing = deriveFlowFromHandle(e.source, e.sourceHandle ?? '', nodes, edges);
      if (existing?.item) return itemSlug(existing.item) === srcSlug;
    }
    return true;
  }

  // Recipe inputs ({id}-in-{slug}) and factory border inputs
  // ({id}-factory-in-{slug}) encode the expected item in the handle ID.
  const m = targetHandle.match(/-in-(.+)$/);
  if (m) return m[1] === srcSlug;

  return true;
}

// ── Conservation sanity check (LHS = RHS) ───────────────────────
// After any autoscale pass we verify that, for every node, what flows IN
// matches what the node expects / sends OUT. Floats are compared with a
// combined absolute + relative tolerance — never strict equality.

export interface ConservationIssue {
  nodeId: string;
  label:  string;
  lhs:    number;   // total incoming /min
  rhs:    number;   // total outgoing (or required) /min
}

export const CONSERVATION_EPS = 0.005;

export function conservationOk(lhs: number, rhs: number): boolean {
  return Math.abs(lhs - rhs) <= CONSERVATION_EPS + 1e-6 * Math.max(Math.abs(lhs), Math.abs(rhs));
}

export function checkConservation(nodes: Node[], edges: Edge[]): ConservationIssue[] {
  const issues: ConservationIssue[] = [];

  for (const node of nodes) {
    if (node.type === 'recipeNode') {
      // LHS = what connected upstream edges actually deliver
      // RHS = what this node consumes at its current machine count
      const d = node.data as unknown as RecipeNodeData;
      const recipe = d.recipe ?? recipeMap.get(d.recipeId);
      if (!recipe) continue;
      const scale = d.machineCount || 1;
      let lhs = 0, rhs = 0, connected = false;

      for (const inp of recipe.inputs) {
        const hid = `${node.id}-in-${inp.item.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
        const incoming = edges.filter(e => e.target === node.id && e.targetHandle === hid);
        if (incoming.length === 0) continue;   // unconnected input — nothing to compare
        let supplied = 0;
        let resolvable = false;
        for (const e of incoming) {
          const flow = deriveFlowFromHandle(e.source, e.sourceHandle ?? '', nodes, edges);
          if (flow) { supplied += flow.rate; resolvable = true; }
        }
        if (!resolvable) continue;             // upstream not resolvable — skip, don't false-flag
        connected = true;
        lhs += supplied;
        rhs += inp.ratePerMin * scale;
      }
      if (connected && !conservationOk(lhs, rhs)) {
        issues.push({ nodeId: node.id, label: recipe.name, lhs, rhs });
      }
    }

    if (node.type === 'splitterMergerNode') {
      // LHS = sum of inflows, RHS = sum of allocated output rates
      const d = node.data as unknown as SplitterMergerNodeData;
      const inCount = d.inputCount ?? 1;
      let lhs = 0, connected = false;
      for (let i = 0; i < inCount; i++) {
        const e = edges.find(e => e.targetHandle === `${node.id}-sm-in-${i}`);
        if (!e) continue;
        const flow = deriveFlowFromHandle(e.source, e.sourceHandle ?? '', nodes, edges);
        if (flow) { lhs += flow.rate; connected = true; }
      }
      if (!connected) continue;
      const rhs = (d.outputRates ?? []).slice(0, d.outputCount ?? 0).reduce((a, b) => a + b, 0);
      if (!conservationOk(lhs, rhs)) {
        issues.push({ nodeId: node.id, label: d.label || 'Router', lhs, rhs });
      }
    }
  }

  return issues;
}

// Run the conservation check and publish results to the store + console.
function runConservationCheck(
  get: () => { nodes: Node[]; edges: Edge[] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: (partial: any) => void
) {
  const { nodes, edges } = get();
  const issues = checkConservation(nodes, edges);
  for (const i of issues) {
    console.warn(
      `[conservation] ${i.label} (${i.nodeId}): inputs ${round4(i.lhs)}/min ≠ outputs ${round4(i.rhs)}/min (Δ ${round4(i.lhs - i.rhs)})`
    );
  }
  set({ conservationIssues: issues });
}

// Propagate a scale ratio to connected nodes.
// bidirectional=false → downstream only (source→target); used on connect.
// bidirectional=true  → both directions; used on manual count change.
// Skips startNodeId itself. Does NOT check autoScale flag.
function propagateScale(
  get: () => { nodes: Node[]; edges: Edge[] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: (fn: (s: any) => any) => void,
  startNodeId: string,
  ratio: number,
  bidirectional: boolean
) {
  if (ratio === 1 || ratio <= 0 || !isFinite(ratio)) return;
  const { edges } = get();
  const visited = new Set<string>();
  visited.add(startNodeId);

  const scaleOne = (nodeId: string) => {
    set((state: { nodes: Node[] }) => {
      const node = state.nodes.find(n => n.id === nodeId);
      if (!node) return state;
      const d = node.data as Record<string, unknown>;
      if (node.type === 'recipeNode') {
        const cur = (d.machineCount as number) ?? 1;
        return {
          nodes: state.nodes.map(n =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, machineCount: round4(cur * ratio) } }
              : n
          ),
        };
      }
      if (node.type === 'sourceNode') {
        const cur = (d.ratePerMin as number) ?? 60;
        return {
          nodes: state.nodes.map(n =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, ratePerMin: round4(cur * ratio) } }
              : n
          ),
        };
      }
      if (node.type === 'splitterMergerNode') {
        const rates = (d.outputRates as number[] | undefined) ?? [];
        return {
          nodes: state.nodes.map(n =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, outputRates: rates.map(r => round4(r * ratio)) } }
              : n
          ),
        };
      }
      return state;
    });
  };

  const walk = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    scaleOne(nodeId);
    // Always follow downstream
    edges.filter(e => e.source === nodeId).forEach(e => walk(e.target));
    // Follow upstream only when bidirectional
    if (bidirectional) {
      edges.filter(e => e.target === nodeId).forEach(e => walk(e.source));
    }
  };

  edges.filter(e => e.source === startNodeId).forEach(e => walk(e.target));
  if (bidirectional) {
    edges.filter(e => e.target === startNodeId).forEach(e => walk(e.source));
  }
}

export const DRAG_HANDLE = '.node-drag-handle';
const PAD = 52;

// React Flow requires parent nodes to come before their children in the array.
// We keep factories at the front so they also render behind recipe nodes.
function sortNodes(nodes: Node[]): Node[] {
  const factories = nodes.filter(n => n.type === 'factoryNode');
  const rest      = nodes.filter(n => n.type !== 'factoryNode');
  return [...factories, ...rest];
}

// Convert relative positions back to absolute when a factory is removed
function toAbsolute(nodes: Node[], factoryId: string, factoryPos: { x: number; y: number }): Node[] {
  return nodes.map(n => {
    if (n.parentId !== factoryId) return n;
    return {
      ...n,
      parentId: undefined,
      extent:   undefined,
      position: {
        x: n.position.x + factoryPos.x,
        y: n.position.y + factoryPos.y,
      },
    };
  });
}

// Compute bounding box of the given nodes (absolute coords)
function boundingBox(nodes: Node[]): { x: number; y: number; w: number; h: number } {
  const minX = Math.min(...nodes.map(n => n.position.x));
  const minY = Math.min(...nodes.map(n => n.position.y));
  const maxX = Math.max(...nodes.map(n => n.position.x + (n.measured?.width  ?? 280)));
  const maxY = Math.max(...nodes.map(n => n.position.y + (n.measured?.height ?? 200)));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const LS_AUTOSAVE = 'planner-autosave';
const LS_SLOTS    = 'planner-slots';

export interface SavedSlot {
  id:      string;
  name:    string;
  savedAt: string;
  nodes:   Node[];
  edges:   Edge[];
}

function hydrateNodes(nodes: Node[]): Node[] {
  seedCounter(nodes);
  return sortNodes(nodes.map(n => {
    const base = { ...n, dragHandle: DRAG_HANDLE };
    if (n.type === 'recipeNode') {
      const data = n.data as unknown as RecipeNodeData;
      return { ...base, data: { ...data, recipe: recipeMap.get(data.recipeId) } };
    }
    return base;
  }));
}

// ── Sheets ────────────────────────────────────────────────────────
// The canvas is split into independent sheets (like spreadsheet tabs).
// The ACTIVE sheet's nodes/edges are canonical in state.nodes/state.edges;
// the `sheets` array holds the data of inactive sheets and is synced from
// the live state on every sheet operation and on autosave.

export interface SheetData {
  id:    string;
  name:  string;
  nodes: Node[];
  edges: Edge[];
}

function newSheetId() {
  return `sheet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// Sheets with the active sheet's data refreshed from live state
function syncedSheets(s: { sheets: SheetData[]; activeSheetId: string; nodes: Node[]; edges: Edge[] }): SheetData[] {
  return s.sheets.map(sh =>
    sh.id === s.activeSheetId ? { ...sh, nodes: s.nodes, edges: s.edges } : sh
  );
}

// Accepts both the current multi-sheet format ({sheets, activeSheetId})
// and the legacy single-canvas format ({nodes, edges}).
function parseWorkspace(raw: string): { sheets: SheetData[]; activeSheetId: string } | null {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed.sheets) && parsed.sheets.length > 0) {
    const sheets: SheetData[] = parsed.sheets.map((s: SheetData) => ({
      id:    s.id || newSheetId(),
      name:  s.name || 'Sheet',
      nodes: hydrateNodes(s.nodes ?? []),
      edges: s.edges ?? [],
    }));
    const activeSheetId = sheets.some(s => s.id === parsed.activeSheetId)
      ? parsed.activeSheetId
      : sheets[0].id;
    return { sheets, activeSheetId };
  }
  if (Array.isArray(parsed.nodes)) {
    const sheet: SheetData = {
      id: newSheetId(), name: 'Sheet 1',
      nodes: hydrateNodes(parsed.nodes), edges: parsed.edges ?? [],
    };
    return { sheets: [sheet], activeSheetId: sheet.id };
  }
  return null;
}

function loadAutosave(): { sheets: SheetData[]; activeSheetId: string } | null {
  try {
    const raw = localStorage.getItem(LS_AUTOSAVE);
    if (!raw) return null;
    return parseWorkspace(raw);
  } catch { return null; }
}

function loadSlots(): SavedSlot[] {
  try { return JSON.parse(localStorage.getItem(LS_SLOTS) ?? '[]'); }
  catch { return []; }
}

interface ClipboardData {
  nodes: Node[];
  edges: Edge[];
}

interface PlannerState {
  nodes: Node[];
  edges: Edge[];
  autoScale: boolean;
  conservationIssues: ConservationIssue[];
  savedSlots: SavedSlot[];
  sheets: SheetData[];
  activeSheetId: string;
  clipboard: ClipboardData | null;
  toggleAutoScale: () => void;
  dismissConservationIssues: () => void;
  addSheet:    () => void;
  renameSheet: (id: string, name: string) => void;
  deleteSheet: (id: string) => void;
  switchSheet: (id: string) => void;
  copySelection:  () => void;
  cutSelection:   () => void;
  pasteClipboard: () => void;
  saveSlot:   (name: string) => void;
  loadSlot:   (id: string)   => void;
  deleteSlot: (id: string)   => void;
  onNodesChange: OnNodesChange;
  onEdgesChange:  OnEdgesChange;
  onConnect:      OnConnect;
  addRecipeNode:          (recipeId?: string, position?: { x: number; y: number }) => void;
  addSourceNode:          (item: string,      position?: { x: number; y: number }) => void;
  addSplitterMergerNode:  (position?: { x: number; y: number }) => void;
  addSinkNode:            (position?: { x: number; y: number }) => void;
  addFactoryNode: (memberIds: string[]) => void;
  addToFactory:   (factoryId: string, newMemberIds: string[]) => void;
  updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void;
  scaleConnectedNodes:    (startNodeId: string, ratio: number) => void;
  deleteEdgesForHandle:   (handleId: string) => void;
  deleteNode:     (nodeId: string) => void;
  clearAll:       () => void;
  exportJSON:     () => string;
  importJSON:     (json: string) => void;
}

const _initial = loadAutosave() ?? (() => {
  const sheet: SheetData = { id: newSheetId(), name: 'Sheet 1', nodes: [], edges: [] };
  return { sheets: [sheet], activeSheetId: sheet.id };
})();
const _initialActive = _initial.sheets.find(s => s.id === _initial.activeSheetId)!;

export const usePlannerStore = create<PlannerState>((set, get) => ({
  nodes: _initialActive.nodes,
  edges: _initialActive.edges,
  autoScale: true,
  conservationIssues: [],
  savedSlots: loadSlots(),
  sheets: _initial.sheets,
  activeSheetId: _initial.activeSheetId,
  clipboard: null,

  toggleAutoScale: () => set(s => ({ autoScale: !s.autoScale })),

  dismissConservationIssues: () => set({ conservationIssues: [] }),

  // ── Sheets ─────────────────────────────────────────────────────

  addSheet: () => {
    const sheet: SheetData = {
      id: newSheetId(), name: `Sheet ${get().sheets.length + 1}`, nodes: [], edges: [],
    };
    set({
      sheets: [...syncedSheets(get()), sheet],
      activeSheetId: sheet.id,
      nodes: [], edges: [],
      conservationIssues: [],
    });
  },

  renameSheet: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set({ sheets: get().sheets.map(s => s.id === id ? { ...s, name: trimmed } : s) });
  },

  deleteSheet: (id) => {
    const { sheets, activeSheetId } = get();
    if (sheets.length <= 1) return;   // always keep at least one sheet
    const remaining = sheets.filter(s => s.id !== id);
    if (id !== activeSheetId) {
      set({ sheets: remaining });
      return;
    }
    const next = remaining[0];
    set({
      sheets: remaining,
      activeSheetId: next.id,
      nodes: next.nodes, edges: next.edges,
      conservationIssues: [],
    });
  },

  switchSheet: (id) => {
    const { activeSheetId, sheets } = get();
    if (id === activeSheetId) return;
    const target = sheets.find(s => s.id === id);
    if (!target) return;
    set({
      sheets: syncedSheets(get()),
      activeSheetId: id,
      nodes: target.nodes, edges: target.edges,
      conservationIssues: [],
    });
  },

  // ── Clipboard (copy / cut / paste) ─────────────────────────────
  // The clipboard lives in the store, so it survives sheet switches —
  // copy on one sheet, paste on another.

  copySelection: () => {
    const { nodes, edges } = get();
    const ids = new Set(nodes.filter(n => n.selected).map(n => n.id));
    // A selected factory implicitly brings all its members
    for (const n of nodes) if (n.parentId && ids.has(n.parentId)) ids.add(n.id);
    if (ids.size === 0) return;

    const copied = nodes.filter(n => ids.has(n.id)).map(n => {
      // A child copied without its factory becomes a free node at its
      // absolute position
      if (n.parentId && !ids.has(n.parentId)) {
        const parent = nodes.find(p => p.id === n.parentId);
        return {
          ...n,
          parentId: undefined,
          extent:   undefined,
          position: {
            x: n.position.x + (parent?.position.x ?? 0),
            y: n.position.y + (parent?.position.y ?? 0),
          },
        };
      }
      return n;
    });
    const copiedEdges = edges.filter(e => ids.has(e.source) && ids.has(e.target));

    // Deep-clone via JSON so later canvas edits can't mutate the clipboard
    set({ clipboard: JSON.parse(JSON.stringify({ nodes: copied, edges: copiedEdges })) });
  },

  cutSelection: () => {
    get().copySelection();
    const { nodes, edges } = get();
    const ids = new Set(nodes.filter(n => n.selected).map(n => n.id));
    for (const n of nodes) if (n.parentId && ids.has(n.parentId)) ids.add(n.id);
    if (ids.size === 0) return;
    set({
      nodes: nodes.filter(n => !ids.has(n.id)),
      edges: edges.filter(e => !ids.has(e.source) && !ids.has(e.target)),
    });
  },

  pasteClipboard: () => {
    const clip = get().clipboard;
    if (!clip || clip.nodes.length === 0) return;

    const OFFSET = 48;
    const idMap = new Map(clip.nodes.map(n => [n.id, nextId()]));
    // Handle IDs embed the node ID ({nodeId}-in-..., {nodeId}-sm-out-0, ...)
    // and must be rewritten alongside it
    const remapHandle = (handle: string | null | undefined, oldId: string) =>
      handle && handle.startsWith(`${oldId}-`)
        ? `${idMap.get(oldId)}${handle.slice(oldId.length)}`
        : handle ?? undefined;

    const pastedNodes: Node[] = clip.nodes.map(n => {
      const clone: Node = JSON.parse(JSON.stringify(n));
      clone.id = idMap.get(n.id)!;
      clone.selected = true;
      clone.dragHandle = DRAG_HANDLE;
      if (clone.parentId) {
        // Parent is always in the clipboard (copySelection guarantees it);
        // children keep their relative position and move with the factory.
        clone.parentId = idMap.get(clone.parentId);
      } else {
        clone.position = { x: clone.position.x + OFFSET, y: clone.position.y + OFFSET };
      }
      if (clone.type === 'recipeNode') {
        const d = clone.data as unknown as RecipeNodeData;
        clone.data = { ...clone.data, recipe: recipeMap.get(d.recipeId) };
      }
      return clone;
    });

    const pastedEdges: Edge[] = clip.edges.map(e => ({
      ...JSON.parse(JSON.stringify(e)),
      id:           nextId(),
      source:       idMap.get(e.source)!,
      target:       idMap.get(e.target)!,
      sourceHandle: remapHandle(e.sourceHandle, e.source),
      targetHandle: remapHandle(e.targetHandle, e.target),
      selected:     false,
    }));

    set({
      // Deselect everything else so the pasted block becomes the selection
      nodes: sortNodes([
        ...get().nodes.map(n => (n.selected ? { ...n, selected: false } : n)),
        ...pastedNodes,
      ]),
      edges: [...get().edges, ...pastedEdges],
      // Shift the stored clipboard so repeated pastes cascade instead of stacking
      clipboard: {
        nodes: clip.nodes.map(n => n.parentId ? n : { ...n, position: { x: n.position.x + OFFSET, y: n.position.y + OFFSET } }),
        edges: clip.edges,
      },
    });
  },

  saveSlot: (name) => {
    const { nodes, edges } = get();
    const trimmed = name.trim() || 'Unnamed';
    const existing = get().savedSlots.find(s => s.name === trimmed);
    const slot: SavedSlot = {
      id:      existing?.id ?? `slot_${Date.now()}`,
      name:    trimmed,
      savedAt: new Date().toISOString(),
      nodes,
      edges,
    };
    const updated = [slot, ...get().savedSlots.filter(s => s.id !== slot.id)];
    localStorage.setItem(LS_SLOTS, JSON.stringify(updated));
    set({ savedSlots: updated });
  },

  loadSlot: (id) => {
    const slot = get().savedSlots.find(s => s.id === id);
    if (!slot) return;
    set({ nodes: hydrateNodes(slot.nodes), edges: slot.edges });
  },

  deleteSlot: (id) => {
    const updated = get().savedSlots.filter(s => s.id !== id);
    localStorage.setItem(LS_SLOTS, JSON.stringify(updated));
    set({ savedSlots: updated });
  },

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: (connection) => {
    // ── Item type check ──────────────────────────────────────────
    // Reject any link whose source item doesn't match the target handle's
    // expected item (recipe inputs, factory inputs, splitter/merger inputs).
    {
      const { nodes, edges } = get();
      if (!connectionItemsMatch(
        connection.source,
        connection.sourceHandle ?? '',
        connection.target,
        connection.targetHandle ?? '',
        nodes,
        edges
      )) {
        return;
      }
    }

    set({ edges: addEdge({ ...connection, animated: false }, get().edges) });

    // Scale target node so its input rate matches the source's output rate
    const { nodes } = get();
    const srcNode = nodes.find(n => n.id === connection.source);
    const tgtNode = nodes.find(n => n.id === connection.target);
    if (!srcNode || !tgtNode || tgtNode.type !== 'recipeNode') return;

    const tgtData  = tgtNode.data as unknown as RecipeNodeData;
    const tgtRecipe = tgtData.recipe ?? recipeMap.get(tgtData.recipeId);
    if (!tgtRecipe) return;

    // Resolve the target input item from handle ID  e.g. "node_2-in-iron-ingot"
    const tgtSlug = (connection.targetHandle ?? '').match(/-in-(.+)$/)?.[1];
    if (!tgtSlug) return;
    const tgtInput = tgtRecipe.inputs.find(
      i => i.item.toLowerCase().replace(/[^a-z0-9]/g, '-') === tgtSlug
    );
    if (!tgtInput || tgtInput.ratePerMin <= 0) return;

    // Resolve the source output rate
    let srcRate: number | null = null;
    if (srcNode.type === 'sourceNode') {
      srcRate = (srcNode.data as unknown as SourceNodeData).ratePerMin ?? 60;
    } else if (srcNode.type === 'recipeNode') {
      const sd = srcNode.data as unknown as RecipeNodeData;
      const srcRecipe = sd.recipe ?? recipeMap.get(sd.recipeId);
      const srcSlug = (connection.sourceHandle ?? '').match(/-out-(.+)$/)?.[1];
      if (srcRecipe && srcSlug) {
        const srcOutput = srcRecipe.outputs.find(
          o => o.item.toLowerCase().replace(/[^a-z0-9]/g, '-') === srcSlug
        );
        if (srcOutput) srcRate = srcOutput.ratePerMin * (sd.machineCount || 1);
      }
    }
    if (srcRate === null || srcRate <= 0) return;

    // newCount satisfies: tgtInput.ratePerMin * newCount === srcRate
    const newCount  = Math.round((srcRate / tgtInput.ratePerMin) * 10000) / 10000;
    const prevCount = tgtData.machineCount || 1;
    if (newCount === prevCount) return;

    set({
      nodes: get().nodes.map(n =>
        n.id === tgtNode.id ? { ...n, data: { ...n.data, machineCount: newCount } } : n
      ),
    });

    // Propagate downstream only from the newly connected target
    propagateScale(get, set, tgtNode.id, newCount / prevCount, false);
    runConservationCheck(get, set);
  },

  addRecipeNode: (recipeId = '', position = { x: 200, y: 200 }) => {
    const recipe = recipeId ? recipeMap.get(recipeId) : undefined;
    const id = nextId();
    const node: Node = {
      id,
      type: 'recipeNode',
      position,
      dragHandle: DRAG_HANDLE,
      data: {
        recipeId:        recipeId ?? '',
        machineCount:    1,
        selectedMachine: recipe?.machines[0] ?? '',
        recipe,
        inputSupply:     {},
      } satisfies RecipeNodeData,
    };
    set({ nodes: sortNodes([...get().nodes, node]) });
  },

  addSourceNode: (item, position = { x: 100, y: 100 }) => {
    const id = nextId();
    const node: Node = {
      id,
      type: 'sourceNode',
      position,
      dragHandle: DRAG_HANDLE,
      data: { item, ratePerMin: 60 } satisfies SourceNodeData,
    };
    set({ nodes: sortNodes([...get().nodes, node]) });
  },

  addSplitterMergerNode: (position = { x: 200, y: 200 }) => {
    const id = nextId();
    const node: Node = {
      id,
      type: 'splitterMergerNode',
      position,
      dragHandle: DRAG_HANDLE,
      data: { label: 'Router', inputCount: 1, outputCount: 2, outputRates: [0, 0] } satisfies SplitterMergerNodeData,
    };
    set({ nodes: sortNodes([...get().nodes, node]) });
  },

  addSinkNode: (position = { x: 400, y: 200 }) => {
    const id = nextId();
    const node: Node = {
      id,
      type: 'sinkNode',
      position,
      dragHandle: DRAG_HANDLE,
      data: {} satisfies SinkNodeData,
    };
    set({ nodes: sortNodes([...get().nodes, node]) });
  },

  addFactoryNode: (memberIds) => {
    const { nodes } = get();
    const members = nodes.filter(n => memberIds.includes(n.id));
    if (members.length === 0) return;

    const bb = boundingBox(members);
    const factoryPos = { x: bb.x - PAD, y: bb.y - PAD - 36 /* header room */ };
    const factoryW   = bb.w + PAD * 2;
    const factoryH   = bb.h + PAD * 2 + 36;

    const usedColors = nodes
      .filter(n => n.type === 'factoryNode')
      .map(n => (n.data as unknown as FactoryNodeData).color);
    const color = FACTORY_PALETTE.find(c => !usedColors.includes(c)) ?? FACTORY_PALETTE[0];

    const factoryId = nextId();
    const factoryNode: Node = {
      id:         factoryId,
      type:       'factoryNode',
      position:   factoryPos,
      dragHandle: DRAG_HANDLE,
      style:      { width: factoryW, height: factoryH, zIndex: -1 },
      data:       { label: 'Factory', color } satisfies FactoryNodeData,
    };

    // Convert member positions to be relative to the factory origin
    const withRelative = nodes.map(n => {
      if (!memberIds.includes(n.id)) return n;
      return {
        ...n,
        parentId: factoryId,
        extent:   'parent' as const,
        position: {
          x: n.position.x - factoryPos.x,
          y: n.position.y - factoryPos.y,
        },
      };
    });

    set({ nodes: sortNodes([factoryNode, ...withRelative]) });
  },

  addToFactory: (factoryId, newMemberIds) => {
    const { nodes } = get();
    const factory = nodes.find(n => n.id === factoryId);
    if (!factory) return;

    const factoryPos = factory.position;
    const factoryW   = (factory.style?.width  as number) ?? 400;
    const factoryH   = (factory.style?.height as number) ?? 300;

    // Assign new members to the factory (convert to relative positions)
    const updated = nodes.map(n => {
      if (!newMemberIds.includes(n.id)) return n;
      return {
        ...n,
        parentId: factoryId,
        extent:   'parent' as const,
        position: {
          x: n.position.x - factoryPos.x,
          y: n.position.y - factoryPos.y,
        },
      };
    });

    // Expand factory box if any new member falls outside current bounds
    const allMembers = updated.filter(n => n.parentId === factoryId);
    let newW = factoryW;
    let newH = factoryH;
    for (const m of allMembers) {
      newW = Math.max(newW, m.position.x + (m.measured?.width  ?? 280) + PAD);
      newH = Math.max(newH, m.position.y + (m.measured?.height ?? 200) + PAD);
    }

    const withExpanded = updated.map(n =>
      n.id === factoryId
        ? { ...n, style: { ...n.style, width: newW, height: newH } }
        : n
    );

    set({ nodes: sortNodes(withExpanded) });
  },

  updateNodeData: (nodeId, patch) => {
    set({
      nodes: get().nodes.map(n =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n
      ),
    });
  },

  // Scale all connected nodes by ratio. No-ops if autoScale is off.
  scaleConnectedNodes: (startNodeId, ratio) => {
    if (!get().autoScale) return;
    // Manual count change: propagate bidirectionally (upstream + downstream)
    propagateScale(get, set, startNodeId, ratio, true);
    // Post-scale sanity check: every node's inputs must still equal its outputs
    runConservationCheck(get, set);
  },

  deleteEdgesForHandle: (handleId) => {
    set({
      edges: get().edges.filter(
        e => e.sourceHandle !== handleId && e.targetHandle !== handleId
      ),
    });
  },

  deleteNode: (nodeId) => {
    const { nodes } = get();
    const target = nodes.find(n => n.id === nodeId);

    let updated = nodes;
    if (target?.type === 'factoryNode') {
      // Free all children back to absolute positions before removing the factory
      updated = toAbsolute(nodes, nodeId, target.position);
    }

    set({
      nodes: sortNodes(updated.filter(n => n.id !== nodeId)),
      edges: get().edges.filter(e => e.source !== nodeId && e.target !== nodeId),
    });
  },

  clearAll: () => set({ nodes: [], edges: [] }),

  exportJSON: () => {
    const { activeSheetId } = get();
    return JSON.stringify({ sheets: syncedSheets(get()), activeSheetId }, null, 2);
  },

  importJSON: (json) => {
    try {
      // Accepts multi-sheet exports and legacy {nodes, edges} files
      const ws = parseWorkspace(json);
      if (!ws) throw new Error('not a planner export');
      const active = ws.sheets.find(s => s.id === ws.activeSheetId)!;
      set({
        sheets: ws.sheets,
        activeSheetId: ws.activeSheetId,
        nodes: active.nodes, edges: active.edges,
        conservationIssues: [],
      });
    } catch (e) {
      console.error('Import failed', e);
    }
  },
}));

// Auto-save to localStorage on every change (all sheets)
usePlannerStore.subscribe((s) => {
  try {
    localStorage.setItem(
      LS_AUTOSAVE,
      JSON.stringify({ sheets: syncedSheets(s), activeSheetId: s.activeSheetId })
    );
  } catch { /* quota exceeded — silently ignore */ }
});
