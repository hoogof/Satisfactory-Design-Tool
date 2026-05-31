import { useCallback, useRef, useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  SelectionMode,
  type NodeTypes,
  type Node,
  type Edge,
  MarkerType,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './App.css';

import { RecipeNode } from './nodes/RecipeNode';
import { SourceNode } from './nodes/SourceNode';
import { FactoryNode } from './nodes/FactoryNode';
import { SplitterMergerNode } from './nodes/SplitterMergerNode';
import { DeletableEdge } from './edges/DeletableEdge';
import { Sidebar } from './components/Sidebar';
import { QuickSearch } from './components/QuickSearch';
import { HelpModal } from './components/HelpModal';
import { usePlannerStore, recipeMap, getCategoryColor } from './store';
import type { RecipeNodeData, SplitterMergerNodeData } from './types';

const nodeTypes: NodeTypes = {
  recipeNode:          RecipeNode          as never,
  sourceNode:          SourceNode          as never,
  factoryNode:         FactoryNode         as never,
  splitterMergerNode:  SplitterMergerNode  as never,
};

const edgeTypes = {
  default: DeletableEdge,
};

function useEdgeStyles(nodes: Node[], edges: Edge[]): Edge[] {
  return edges.map(edge => {
    const sourceNode = nodes.find(n => n.id === edge.source);
    const targetNode = nodes.find(n => n.id === edge.target);
    if (!sourceNode || !targetNode) return edge;

    let color = '#94a3b8';

    if (sourceNode.type === 'sourceNode') {
      color = '#22c55e';
    } else if (sourceNode.type === 'factoryNode') {
      // Use deriveFlowFromHandle to get the rate from the factory border output
      const flow = (window as unknown as Record<string, unknown>)._deriveFlow
        ? null // placeholder
        : null;
      void flow;
      // Inline: factory output handle carries a known rate — always green if connected
      const slug = edge.sourceHandle?.match(/factory-out-(.+)$/)?.[1];
      if (slug) {
        const members   = nodes.filter(n => n.parentId === sourceNode.id);
        const memberSet = new Set(members.map(n => n.id));
        let totalRate = 0;
        for (const m of members) {
          if (m.type === 'recipeNode') {
            const d = m.data as unknown as RecipeNodeData;
            const recipe = d.recipe ?? recipeMap.get(d.recipeId);
            if (!recipe) continue;
            for (const out of recipe.outputs) {
              if (out.item.toLowerCase().replace(/[^a-z0-9]/g, '-') !== slug) continue;
              const hid = `${m.id}-out-${slug}`;
              const internal = edges.some(e => e.source === m.id && e.sourceHandle === hid && memberSet.has(e.target));
              if (!internal) totalRate += out.ratePerMin * (d.machineCount || 1);
            }
          }
        }
        if (targetNode.type === 'recipeNode') {
          const tgtData   = targetNode.data as unknown as RecipeNodeData;
          const tgtRecipe = tgtData.recipe ?? recipeMap.get(tgtData.recipeId);
          const tgtSlug   = edge.targetHandle?.match(/-in-(.+)$/)?.[1];
          if (tgtRecipe && tgtSlug) {
            const inp = tgtRecipe.inputs.find(i => i.item.toLowerCase().replace(/[\s']/g, '-') === tgtSlug);
            if (inp) {
              color = totalRate >= inp.ratePerMin * (tgtData.machineCount || 1) - 0.01 ? '#22c55e' : '#ef4444';
            } else { color = '#22c55e'; }
          } else { color = '#22c55e'; }
        } else {
          color = totalRate > 0 ? '#22c55e' : '#94a3b8';
        }
      }
    } else if (sourceNode.type === 'splitterMergerNode') {
      const srcData = sourceNode.data as unknown as SplitterMergerNodeData;
      const outIdx = parseInt(edge.sourceHandle?.match(/sm-out-(\d+)$/)?.[1] ?? 'NaN');
      if (!isNaN(outIdx)) {
        const allocated = (srcData.outputRates as number[] | undefined)?.[outIdx] ?? 0;
        if (allocated <= 0) {
          color = '#94a3b8'; // grey — nothing allocated
        } else if (targetNode.type === 'recipeNode') {
          const tgtData = targetNode.data as unknown as RecipeNodeData;
          const tgtRecipe = tgtData.recipe ?? recipeMap.get(tgtData.recipeId);
          const tgtSlug = edge.targetHandle?.match(/-in-(.+)$/)?.[1];
          if (tgtRecipe && tgtSlug) {
            const inp = tgtRecipe.inputs.find(
              i => i.item.toLowerCase().replace(/[\s']/g, '-') === tgtSlug
            );
            if (inp) {
              color = allocated >= inp.ratePerMin * (tgtData.machineCount || 1) - 0.01
                ? '#22c55e' : '#ef4444';
            } else { color = '#22c55e'; }
          } else { color = '#22c55e'; }
        } else {
          color = '#22c55e';
        }
      }
    } else if (sourceNode.type === 'recipeNode') {
      const srcData = sourceNode.data as unknown as RecipeNodeData;
      const srcRecipe = srcData.recipe ?? recipeMap.get(srcData.recipeId);
      const handleId = edge.sourceHandle ?? '';
      const itemMatch = handleId.match(/-out-(.+)$/);
      if (itemMatch && srcRecipe) {
        const itemSlug = itemMatch[1];
        const outputItem = srcRecipe.outputs.find(
          o => o.item.toLowerCase().replace(/[\s']/g, '-') === itemSlug
        );
        if (outputItem && targetNode.type === 'recipeNode') {
          const tgtData = targetNode.data as unknown as RecipeNodeData;
          const tgtRecipe = tgtData.recipe ?? recipeMap.get(tgtData.recipeId);
          const tgtHandleId = edge.targetHandle ?? '';
          const tgtItemMatch = tgtHandleId.match(/-in-(.+)$/);
          if (tgtItemMatch && tgtRecipe) {
            const tgtSlug = tgtItemMatch[1];
            const inputItem = tgtRecipe.inputs.find(
              i => i.item.toLowerCase().replace(/[\s']/g, '-') === tgtSlug
            );
            if (inputItem) {
              const produced = outputItem.ratePerMin * (srcData.machineCount || 1);
              const needed = inputItem.ratePerMin * (tgtData.machineCount || 1);
              color = produced >= needed - 0.01 ? '#22c55e' : '#ef4444';
            }
          }
        } else {
          color = '#22c55e';
        }
      }
    }

    return {
      ...edge,
      style: { stroke: color, strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    };
  });
}

function PlannerCanvas({ dark }: { dark: boolean }) {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, addRecipeNode, addSourceNode } =
    usePlannerStore();
  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const styledEdges = useEdgeStyles(nodes, edges);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const recipeId = event.dataTransfer.getData('recipeId');
      const isSource = event.dataTransfer.getData('isSource');
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      if (recipeId) addRecipeNode(recipeId, position);
      else if (isSource) addSourceNode('Resource', position);
    },
    [screenToFlowPosition, addRecipeNode, addSourceNode]
  );

  return (
    <div className="planner-canvas" ref={wrapperRef}>
      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onDragOver={onDragOver}
        onDrop={onDrop}
        fitView
        deleteKeyCode="Delete"
        minZoom={0.1}
        maxZoom={2}
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode="Shift"
        selectionOnDrag
        panOnDrag={[2]}
        onContextMenu={e => e.preventDefault()}
        defaultEdgeOptions={{
          type: 'default',
          style: { strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed },
        }}
      >
        {/* Major grid lines every 80px */}
        <Background
          variant={BackgroundVariant.Lines}
          gap={80}
          size={0.5}
          color={dark ? '#1f1f1f' : '#e2e8f0'}
        />
        {/* Minor subdivision dots every 20px */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={0.8}
          color={dark ? '#2a2a2a' : '#cbd5e1'}
        />
        <Controls />
        <MiniMap
          nodeColor={(n) => {
            if (n.type === 'sourceNode') return '#16a34a';
            const d = n.data as unknown as RecipeNodeData;
            return getCategoryColor(d.selectedMachine ?? '');
          }}
          maskColor="var(--minimap-mask)"
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}
          zoomable
          pannable
        />
      </ReactFlow>
    </div>
  );
}

export default function App() {
  const [dark, setDark]               = useState(true);
  const [quickSearch, setQuickSearch] = useState(false);
  const [showHelp, setShowHelp]       = useState(false);
  const { autoScale, toggleAutoScale } = usePlannerStore();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') document.body.classList.add('shift-held');

      // Press N to open quick-search (skip when typing in an input / textarea)
      if (e.key === 'n' || e.key === 'N') {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
        e.preventDefault();
        setQuickSearch(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') document.body.classList.remove('shift-held');
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup',   onKeyUp);
    };
  }, []);

  return (
    <ReactFlowProvider>
      <div className="app">
        <div className="toolbar">
          <button
            className={`toolbar__btn toolbar__btn--autoscale${autoScale ? ' toolbar__btn--active' : ''}`}
            onClick={toggleAutoScale}
            title="When on, changing a node's machine count scales all downstream nodes by the same ratio"
          >
            {autoScale ? '⛓ Auto-Scale ON' : '⛓ Auto-Scale OFF'}
          </button>
          <button
            className="toolbar__btn"
            onClick={() => setDark(d => !d)}
            title="Toggle dark mode"
          >
            {dark ? '☀ Light' : '◑ Dark'}
          </button>
          <button
            className="toolbar__btn"
            onClick={() => setQuickSearch(true)}
            title="Quick-search recipes (N)"
          >
            ⌕ Search recipes <kbd>N</kbd>
          </button>
          <button
            className="toolbar__btn"
            onClick={() => setShowHelp(true)}
            title="Help"
          >
            ? Help
          </button>
        </div>
        <Sidebar />
        <PlannerCanvas dark={dark} />
        {quickSearch && <QuickSearch onClose={() => setQuickSearch(false)} />}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      </div>
    </ReactFlowProvider>
  );
}
