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
import type { RecipeNodeData, SourceNodeData, FactoryNodeData, SplitterMergerNodeData } from './types';
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
              ? { ...n, data: { ...n.data, machineCount: Math.round(cur * ratio * 10000) / 10000 } }
              : n
          ),
        };
      }
      if (node.type === 'sourceNode') {
        const cur = (d.ratePerMin as number) ?? 60;
        return {
          nodes: state.nodes.map(n =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, ratePerMin: Math.round(cur * ratio * 10000) / 10000 } }
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
  return sortNodes(nodes.map(n => {
    const base = { ...n, dragHandle: DRAG_HANDLE };
    if (n.type === 'recipeNode') {
      const data = n.data as unknown as RecipeNodeData;
      return { ...base, data: { ...data, recipe: recipeMap.get(data.recipeId) } };
    }
    return base;
  }));
}

function loadAutosave(): { nodes: Node[]; edges: Edge[] } | null {
  try {
    const raw = localStorage.getItem(LS_AUTOSAVE);
    if (!raw) return null;
    const { nodes, edges } = JSON.parse(raw);
    return { nodes: hydrateNodes(nodes), edges };
  } catch { return null; }
}

function loadSlots(): SavedSlot[] {
  try { return JSON.parse(localStorage.getItem(LS_SLOTS) ?? '[]'); }
  catch { return []; }
}

interface PlannerState {
  nodes: Node[];
  edges: Edge[];
  autoScale: boolean;
  savedSlots: SavedSlot[];
  toggleAutoScale: () => void;
  saveSlot:   (name: string) => void;
  loadSlot:   (id: string)   => void;
  deleteSlot: (id: string)   => void;
  onNodesChange: OnNodesChange;
  onEdgesChange:  OnEdgesChange;
  onConnect:      OnConnect;
  addRecipeNode:          (recipeId?: string, position?: { x: number; y: number }) => void;
  addSourceNode:          (item: string,      position?: { x: number; y: number }) => void;
  addSplitterMergerNode:  (position?: { x: number; y: number }) => void;
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

const _initial = loadAutosave();

export const usePlannerStore = create<PlannerState>((set, get) => ({
  nodes: _initial?.nodes ?? [],
  edges: _initial?.edges ?? [],
  autoScale: true,
  savedSlots: loadSlots(),

  toggleAutoScale: () => set(s => ({ autoScale: !s.autoScale })),

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
    // ── Validate splitter-merger input connections ──────────────
    // Only allow connections where the item type matches what's already flowing in
    if (connection.targetHandle?.includes('-sm-in-')) {
      const { nodes, edges } = get();
      const tgtNode = nodes.find(n => n.id === connection.target);
      if (tgtNode?.type === 'splitterMergerNode') {
        const smData = tgtNode.data as unknown as SplitterMergerNodeData;
        const newFlow = deriveFlowFromHandle(connection.source, connection.sourceHandle ?? '', nodes, edges);
        if (newFlow?.item) {
          const inCount = smData.inputCount ?? 1;
          for (let i = 0; i < inCount; i++) {
            const existing = edges.find(e => e.targetHandle === `${connection.target}-sm-in-${i}`);
            if (!existing) continue;
            const existingFlow = deriveFlowFromHandle(existing.source, existing.sourceHandle ?? '', nodes, edges);
            if (existingFlow?.item && existingFlow.item !== newFlow.item) {
              // Item mismatch — silently reject the connection
              return;
            }
            break; // only need to check once
          }
        }
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
    const { nodes, edges } = get();
    return JSON.stringify({ nodes, edges }, null, 2);
  },

  importJSON: (json) => {
    try {
      const { nodes, edges } = JSON.parse(json);
      set({ nodes: hydrateNodes(nodes), edges });
    } catch (e) {
      console.error('Import failed', e);
    }
  },
}));

// Auto-save to localStorage on every nodes/edges change
usePlannerStore.subscribe(({ nodes, edges }) => {
  try {
    localStorage.setItem(LS_AUTOSAVE, JSON.stringify({ nodes, edges }));
  } catch { /* quota exceeded — silently ignore */ }
});
