import { memo, useState, useMemo } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import { usePlannerStore, recipeMap } from '../store';
import type { FactoryNodeData, RecipeNodeData, SourceNodeData } from '../types';

function itemHandleId(nodeId: string, item: string, side: 'in' | 'out') {
  return `${nodeId}-${side}-${item.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
}

function factoryHandleId(factoryId: string, item: string, side: 'in' | 'out') {
  return `${factoryId}-factory-${side}-${item.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
}

export const FactoryNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as unknown as FactoryNodeData;
  const { nodes, edges, updateNodeData, deleteNode } = usePlannerStore();

  const [labelDraft, setLabelDraft] = useState(d.label);

  const commitLabel = () => {
    const v = labelDraft.trim() || 'Factory';
    setLabelDraft(v);
    updateNodeData(id, { label: v });
  };

  const color = d.color ?? '#6366f1';

  // Members = all nodes whose parentId is this factory
  const { extInputs, extOutputs, memberCount } = useMemo(() => {
    const allMembers    = nodes.filter(n => n.parentId === id);
    const memberSet     = new Set(allMembers.map(n => n.id));
    const recipeMembers = allMembers.filter(n => n.type === 'recipeNode');
    const sourceMembers = allMembers.filter(n => n.type === 'sourceNode');

    const inputTotals  = new Map<string, number>();
    const outputTotals = new Map<string, number>();

    // Recipe node inputs/outputs
    for (const node of recipeMembers) {
      const nd     = node.data as unknown as RecipeNodeData;
      const recipe = nd.recipe ?? recipeMap.get(nd.recipeId);
      if (!recipe) continue;
      const scale = nd.machineCount || 1;

      for (const inp of recipe.inputs) {
        const hid = itemHandleId(node.id, inp.item, 'in');
        const internal = edges.some(
          e => e.target === node.id && e.targetHandle === hid && memberSet.has(e.source)
        );
        if (!internal)
          inputTotals.set(inp.item, (inputTotals.get(inp.item) ?? 0) + inp.ratePerMin * scale);
      }

      for (const out of recipe.outputs) {
        const hid = itemHandleId(node.id, out.item, 'out');
        const internal = edges.some(
          e => e.source === node.id && e.sourceHandle === hid && memberSet.has(e.target)
        );
        if (!internal)
          outputTotals.set(out.item, (outputTotals.get(out.item) ?? 0) + out.ratePerMin * scale);
      }
    }

    // Source node outputs
    for (const node of sourceMembers) {
      const nd  = node.data as unknown as SourceNodeData;
      const hid = `${node.id}-out`;
      const internal = edges.some(
        e => e.source === node.id && e.sourceHandle === hid && memberSet.has(e.target)
      );
      if (!internal)
        outputTotals.set(nd.item, (outputTotals.get(nd.item) ?? 0) + (nd.ratePerMin ?? 60));
    }

    return {
      extInputs:   [...inputTotals.entries()].map(([item, rate]) => ({ item, rate })),
      extOutputs:  [...outputTotals.entries()].map(([item, rate]) => ({ item, rate })),
      memberCount: allMembers.length,
    };
  }, [id, nodes, edges]);

  // Spread handles evenly along the node height (percentage-based)
  function handlePositions(count: number): number[] {
    if (count === 0) return [];
    if (count === 1) return [50];
    return Array.from({ length: count }, (_, i) =>
      10 + (80 / (count - 1)) * i
    );
  }

  const inputPositions  = handlePositions(extInputs.length);
  const outputPositions = handlePositions(extOutputs.length);

  return (
    <div
      className={`factory-node${selected ? ' factory-node--selected' : ''}`}
      style={{ '--factory-color': color } as React.CSSProperties}
    >
      <NodeResizer
        minWidth={200}
        minHeight={120}
        isVisible={selected}
        lineStyle={{ borderColor: color, borderWidth: 1.5 }}
        handleStyle={{ width: 10, height: 10, borderColor: color, background: 'var(--bg-panel)' }}
      />

      {/* Input handles on left edge */}
      {extInputs.map((port, i) => (
        <Handle
          key={port.item}
          type="target"
          position={Position.Left}
          id={factoryHandleId(id, port.item, 'in')}
          className="node-handle node-handle--in factory-node__handle"
          style={{ top: `${inputPositions[i]}%` }}
          title={`${port.item} · ${port.rate.toFixed(2)}/min`}
          data-label={`${port.item} ${port.rate.toFixed(1)}/m`}
        />
      ))}

      {/* Output handles on right edge */}
      {extOutputs.map((port, i) => (
        <Handle
          key={port.item}
          type="source"
          position={Position.Right}
          id={factoryHandleId(id, port.item, 'out')}
          className="node-handle node-handle--out factory-node__handle"
          style={{ top: `${outputPositions[i]}%` }}
          title={`${port.item} · ${port.rate.toFixed(2)}/min`}
          data-label={`${port.item} ${port.rate.toFixed(1)}/m`}
        />
      ))}

      {/* Header / drag handle */}
      <div className="factory-node__header node-drag-handle">
        <input
          className="factory-node__label-input"
          value={labelDraft}
          onChange={e => setLabelDraft(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={e => {
            if (e.key === 'Enter') { commitLabel(); (e.target as HTMLInputElement).blur(); }
            if (e.key === 'Escape') { setLabelDraft(d.label); (e.target as HTMLInputElement).blur(); }
          }}
          placeholder="Factory name"
        />
        <span className="factory-node__member-count">
          {memberCount} node{memberCount !== 1 ? 's' : ''}
        </span>
        <button className="factory-node__delete" onClick={() => deleteNode(id)} title="Remove factory (nodes remain)">✕</button>
      </div>

      {/* I/O panel — pinned to bottom */}
      <div className="factory-node__io">
        {memberCount === 0 && (
          <span className="factory-node__empty">Drag nodes inside, or use "Add to Factory"</span>
        )}

        {extInputs.length > 0 && (
          <div className="factory-node__io-col">
            <span className="factory-node__io-heading">Requires</span>
            {extInputs.map(({ item, rate }) => (
              <div key={item} className="factory-node__io-row factory-node__io-row--in">
                <span className="factory-node__io-item">{item}</span>
                <span className="factory-node__io-rate">{rate.toFixed(2)}/min</span>
              </div>
            ))}
          </div>
        )}

        {extOutputs.length > 0 && (
          <div className="factory-node__io-col">
            <span className="factory-node__io-heading">Produces</span>
            {extOutputs.map(({ item, rate }) => (
              <div key={item} className="factory-node__io-row factory-node__io-row--out">
                <span className="factory-node__io-item">{item}</span>
                <span className="factory-node__io-rate">{rate.toFixed(2)}/min</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

FactoryNode.displayName = 'FactoryNode';
