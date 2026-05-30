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
import type { RecipeNodeData, SourceNodeData, FactoryNodeData } from './types';
import recipesRaw from './data/recipes.json';
import machinesRaw from './data/machines.json';
import type { Recipe, Machine } from './types';

export const allRecipes: Recipe[] = recipesRaw as Recipe[];
export const allMachines: Machine[] = machinesRaw as Machine[];

export const recipeMap = new Map<string, Recipe>(allRecipes.map(r => [r.id, r]));
export const machineMap = new Map<string, Machine>(allMachines.map(m => [m.id, m]));

export const CATEGORY_COLORS: Record<string, string> = {
  Smelting:   '#b45309',
  Production: '#1d4ed8',
  Refining:   '#7e22ce',
  Packaging:  '#0f766e',
  Advanced:   '#be185d',
  Power:      '#15803d',
  Extraction: '#4d7c0f',
  Other:      '#475569',
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

export const FACTORY_PALETTE = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b',
  '#ef4444', '#a855f7', '#ec4899', '#14b8a6',
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

interface PlannerState {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange:  OnEdgesChange;
  onConnect:      OnConnect;
  addRecipeNode:  (recipeId?: string, position?: { x: number; y: number }) => void;
  addSourceNode:  (item: string,      position?: { x: number; y: number }) => void;
  addFactoryNode: (memberIds: string[]) => void;
  addToFactory:   (factoryId: string, newMemberIds: string[]) => void;
  updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void;
  deleteNode:     (nodeId: string) => void;
  clearAll:       () => void;
  exportJSON:     () => string;
  importJSON:     (json: string) => void;
}

export const usePlannerStore = create<PlannerState>((set, get) => ({
  nodes: [],
  edges: [],

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: (connection) => {
    set({ edges: addEdge({ ...connection, animated: false }, get().edges) });
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
      const hydrated = nodes.map((n: Node) => {
        const base = { ...n, dragHandle: DRAG_HANDLE };
        if (n.type === 'recipeNode') {
          const data = n.data as unknown as RecipeNodeData;
          return { ...base, data: { ...data, recipe: recipeMap.get(data.recipeId) } };
        }
        return base;
      });
      set({ nodes: sortNodes(hydrated), edges });
    } catch (e) {
      console.error('Import failed', e);
    }
  },
}));
