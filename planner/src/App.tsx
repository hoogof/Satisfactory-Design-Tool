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
  type Connection,
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
import { SinkNode } from './nodes/SinkNode';
import { DeletableEdge } from './edges/DeletableEdge';
import { Sidebar } from './components/Sidebar';
import { QuickSearch } from './components/QuickSearch';
import { HelpModal } from './components/HelpModal';
import { usePlannerStore, recipeMap, getCategoryColor, connectionItemsMatch } from './store';
import type { RecipeNodeData, SplitterMergerNodeData } from './types';

const nodeTypes: NodeTypes = {
  recipeNode:          RecipeNode          as never,
  sourceNode:          SourceNode          as never,
  factoryNode:         FactoryNode         as never,
  splitterMergerNode:  SplitterMergerNode  as never,
  sinkNode:            SinkNode            as never,
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

// Spreadsheet-style tabs for switching between independent factory sheets.
// Double-click a tab to rename it; × deletes (with confirm when non-empty).
function SheetTabs() {
  const sheets        = usePlannerStore(s => s.sheets);
  const activeSheetId = usePlannerStore(s => s.activeSheetId);
  const { switchSheet, addSheet, renameSheet, deleteSheet } = usePlannerStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft]         = useState('');

  const commitRename = () => {
    if (editingId) renameSheet(editingId, draft);
    setEditingId(null);
  };

  const handleDelete = (id: string, name: string) => {
    // The active sheet's live nodes are in state.nodes, not sheets[]
    const st = usePlannerStore.getState();
    const nodeCount = id === st.activeSheetId
      ? st.nodes.length
      : st.sheets.find(s => s.id === id)?.nodes.length ?? 0;
    if (nodeCount > 0 && !window.confirm(`Delete sheet "${name}" and its ${nodeCount} node${nodeCount !== 1 ? 's' : ''}?`)) {
      return;
    }
    deleteSheet(id);
  };

  return (
    <div className="sheet-tabs">
      {sheets.map(sheet => (
        <div
          key={sheet.id}
          className={`sheet-tab${sheet.id === activeSheetId ? ' sheet-tab--active' : ''}`}
          onClick={() => switchSheet(sheet.id)}
          onDoubleClick={() => { setEditingId(sheet.id); setDraft(sheet.name); }}
          title="Double-click to rename"
        >
          {editingId === sheet.id ? (
            <input
              className="sheet-tab__rename"
              value={draft}
              autoFocus
              onChange={e => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setEditingId(null);
              }}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span className="sheet-tab__name">{sheet.name}</span>
          )}
          {sheets.length > 1 && (
            <button
              className="sheet-tab__close"
              onClick={e => { e.stopPropagation(); handleDelete(sheet.id, sheet.name); }}
              title="Delete sheet"
            >✕</button>
          )}
        </div>
      ))}
      <button className="sheet-tabs__add" onClick={addSheet} title="New sheet">+</button>
    </div>
  );
}

// Warning toast shown when the post-autoscale conservation check fails.
// Lists every node whose total inputs (LHS) ≠ total outputs (RHS).
function ConservationWarning() {
  const issues  = usePlannerStore(s => s.conservationIssues);
  const dismiss = usePlannerStore(s => s.dismissConservationIssues);
  if (issues.length === 0) return null;
  return (
    <div className="conservation-toast" role="alert">
      <div className="conservation-toast__title">
        ⚠ Flow imbalance after auto-scale
        <button className="conservation-toast__close" onClick={dismiss} title="Dismiss">✕</button>
      </div>
      <ul className="conservation-toast__list">
        {issues.map(i => (
          <li key={i.nodeId}>
            <strong>{i.label}</strong> — in {i.lhs.toFixed(2)}/min, out {i.rhs.toFixed(2)}/min
            {' '}(Δ {(i.lhs - i.rhs).toFixed(2)})
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlannerCanvas({ dark }: { dark: boolean }) {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, addRecipeNode, addSourceNode } =
    usePlannerStore();
  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const styledEdges = useEdgeStyles(nodes, edges);

  // Live validation while dragging a connection: handles whose item type
  // doesn't match the source are rejected (React Flow greys them out and
  // refuses the drop).
  const isValidConnection = useCallback((conn: Edge | Connection) => {
    const { nodes, edges } = usePlannerStore.getState();
    return connectionItemsMatch(
      conn.source,
      conn.sourceHandle ?? '',
      conn.target,
      conn.targetHandle ?? '',
      nodes,
      edges
    );
  }, []);

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
        isValidConnection={isValidConnection}
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
            if (n.type === 'sinkNode')   return '#c84030';
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

      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Copy / cut / paste the canvas selection (leave native clipboard
      // behaviour alone while typing in a text field)
      if ((e.ctrlKey || e.metaKey) && !typing) {
        const k = e.key.toLowerCase();
        if (k === 'c' || k === 'x' || k === 'v') {
          const store = usePlannerStore.getState();
          if (k === 'c') store.copySelection();
          if (k === 'x') store.cutSelection();
          if (k === 'v') store.pasteClipboard();
          e.preventDefault();
          return;
        }
      }

      if (typing) return;

      // Press N to open quick-search
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setQuickSearch(true);
      }
      // Press M to toggle auto-scale
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        usePlannerStore.getState().toggleAutoScale();
      }
      // Press L to toggle light/dark
      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        setDark(d => !d);
      }

      // Press H to toggle help
      if (e.key == "h" || e.key == "H") {
        e.preventDefault();
        setShowHelp(true);
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
            {autoScale ? '⛓ Auto-Scale ON' : '⛓ Auto-Scale OFF'} <kbd>M</kbd>
          </button>
          <button
            className="toolbar__btn"
            onClick={() => setDark(d => !d)}
            title="Toggle dark mode"
          >
            {dark ? '☀ Light' : '◑ Dark'} <kbd>L</kbd>
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
            ? Help <kbd>H</kbd>
          </button>
        </div>
        <Sidebar />
        <PlannerCanvas dark={dark} />
        <SheetTabs />
        <ConservationWarning />
        {quickSearch && <QuickSearch onClose={() => setQuickSearch(false)} />}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      </div>
    </ReactFlowProvider>
  );
}
