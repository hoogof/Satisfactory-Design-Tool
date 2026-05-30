import { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
  useReactFlow,
} from '@xyflow/react';

export function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  selected,
}: EdgeProps) {
  const { setEdges } = useReactFlow();
  const [hovered, setHovered] = useState(false);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });

  const deleteEdge = () =>
    setEdges(edges => edges.filter(e => e.id !== id));

  const visible = hovered || selected;

  return (
    <>
      {/* Wider invisible hit area — drives hover state */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        className="deletable-edge__hitarea"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />

      <EdgeLabelRenderer>
        <div
          className="deletable-edge__btn-wrap"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            opacity: visible ? 1 : 0,
          }}
        >
          <button
            className="deletable-edge__btn"
            onClick={deleteEdge}
            title="Delete connection"
          >
            ×
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
