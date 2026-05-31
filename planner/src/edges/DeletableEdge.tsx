import { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
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

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const deleteEdge = () =>
    setEdges(edges => edges.filter(e => e.id !== id));

  const visible = hovered || selected;

  return (
    // Wrapping <g> drives hover state for the delete button.
    // BaseEdge renders its own 20px interaction path that handles
    // selection clicks — we no longer need a custom hit area.
    <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={20}
      />

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
    </g>
  );
}
