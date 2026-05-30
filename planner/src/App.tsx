import { useCallback, useRef, useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
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
import { DeletableEdge } from './edges/DeletableEdge';
import { Sidebar } from './components/Sidebar';
import { usePlannerStore, recipeMap, getCategoryColor } from './store';
import type { RecipeNodeData } from './types';

const nodeTypes: NodeTypes = {
  recipeNode: RecipeNode as never,
  sourceNode: SourceNode as never,
  factoryNode: FactoryNode as never,
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
        />
      </ReactFlow>
    </div>
  );
}

export default function App() {
  // Default to dark (black grid canvas)
  const [dark, setDark] = useState(true);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <ReactFlowProvider>
      <div className="app">
        <button
          className="theme-toggle"
          onClick={() => setDark(d => !d)}
          title="Toggle dark mode"
        >
          {dark ? '☀ Light' : '◑ Dark'}
        </button>
        <Sidebar />
        <PlannerCanvas dark={dark} />
      </div>
    </ReactFlowProvider>
  );
}
