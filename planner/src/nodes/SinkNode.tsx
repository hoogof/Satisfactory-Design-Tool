import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { usePlannerStore, deriveFlowFromHandle } from '../store';
import { ItemIcon } from '../components/ItemIcon';

// Single input handle ID. Deliberately NOT of the form `{id}-in-{slug}` so the
// connection validator treats it as type-agnostic — a sink accepts any item.
export const sinkInHandle = (nodeId: string) => `${nodeId}-sink-in`;

export const SinkNode = memo(({ id, selected }: NodeProps) => {
  const { deleteNode, deleteEdgesForHandle } = usePlannerStore();
  const nodes = usePlannerStore(s => s.nodes);
  const edges = usePlannerStore(s => s.edges);

  // Everything delivered to this sink, aggregated by item
  const consumed = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of edges) {
      if (e.target !== id) continue;
      const flow = deriveFlowFromHandle(e.source, e.sourceHandle ?? '', nodes, edges);
      if (flow?.item) totals.set(flow.item, (totals.get(flow.item) ?? 0) + flow.rate);
    }
    return [...totals.entries()].map(([item, rate]) => ({ item, rate }));
  }, [id, nodes, edges]);

  const total = consumed.reduce((s, c) => s + c.rate, 0);

  return (
    <div className={`sink-node${selected ? ' sink-node--selected' : ''}`}>
      <Handle
        type="target"
        position={Position.Left}
        id={sinkInHandle(id)}
        className="node-handle node-handle--in"
        style={{ top: '50%' }}
        title="Connect any item — the sink consumes everything"
        onDoubleClick={() => deleteEdgesForHandle(sinkInHandle(id))}
      />

      <div className="sink-node__header node-drag-handle">
        <span className="sink-node__icon">▼</span>
        <span className="sink-node__header-label">Sink</span>
        <button className="recipe-node__delete" onClick={() => deleteNode(id)} title="Remove">✕</button>
      </div>

      <div className="sink-node__body">
        {consumed.length === 0 ? (
          <span className="sink-node__empty">Connect inputs to consume</span>
        ) : (
          <>
            {consumed.map(({ item, rate }) => (
              <div key={item} className="sink-node__row">
                <ItemIcon name={item} />
                <span className="sink-node__item">{item}</span>
                <span className="sink-node__rate">{rate.toFixed(1)}/min</span>
              </div>
            ))}
            <div className="sink-node__total">Σ {total.toFixed(1)}/min consumed</div>
          </>
        )}
      </div>
    </div>
  );
});

SinkNode.displayName = 'SinkNode';
