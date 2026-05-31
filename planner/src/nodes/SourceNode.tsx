import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { SourceNodeData } from '../types';
import { usePlannerStore, RAW_RESOURCES } from '../store';

// Same math evaluator as in RecipeNode
function evalMath(expr: string): number | null {
  if (!expr.trim()) return null;
  try {
    const sanitized = expr.replace(/\^/g, '**');
    if (/[^0-9+\-*/.() \t]/.test(sanitized.replace(/\*\*/g, ''))) return null;
    // eslint-disable-next-line no-new-func
    const result = new Function(`"use strict"; return (${sanitized})`)() as unknown;
    if (typeof result === 'number' && isFinite(result) && result > 0) {
      return Math.round(result * 10000) / 10000;
    }
    return null;
  } catch {
    return null;
  }
}

export const SourceNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as unknown as SourceNodeData;
  const { updateNodeData, deleteNode, deleteEdgesForHandle } = usePlannerStore();

  const [rateStr, setRateStr] = useState(String(d.ratePerMin ?? 60));
  const rateInputRef = useRef<HTMLInputElement>(null);

  // Sync display when ratePerMin is changed externally (e.g. auto-scale)
  useEffect(() => {
    if (rateInputRef.current !== document.activeElement) {
      setRateStr(String(d.ratePerMin ?? 60));
    }
  }, [d.ratePerMin]);

  const handleResourceChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const res = RAW_RESOURCES.find(r => r.name === e.target.value);
    updateNodeData(id, { item: e.target.value, ratePerMin: res?.defaultRate ?? 60 });
    setRateStr(String(res?.defaultRate ?? 60));
  }, [id, updateNodeData]);

  const commitRate = useCallback(() => {
    const evaluated = evalMath(rateStr);
    const final = evaluated ?? 60;
    setRateStr(String(final));
    updateNodeData(id, { ratePerMin: final });
  }, [rateStr, id, updateNodeData]);

  const handleRateKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitRate();
      (e.target as HTMLInputElement).blur();
    }
  }, [commitRate]);

  return (
    <div className={`source-node${selected ? ' source-node--selected' : ''}`}>
      <Handle
        type="source"
        position={Position.Right}
        id={`${id}-out`}
        className="node-handle node-handle--out"
        style={{ top: '50%' }}
        title="Double-click to disconnect"
        onDoubleClick={() => deleteEdgesForHandle(`${id}-out`)}
      />

      <div className="source-node__header node-drag-handle">
        <span className="source-node__icon">⛏</span>
        <span className="source-node__header-label">Source</span>
        <button className="recipe-node__delete" onClick={() => deleteNode(id)}>✕</button>
      </div>

      <div className="source-node__body">
        {/* Resource selector */}
        <select
          className="source-node__resource-select"
          value={d.item}
          onChange={handleResourceChange}
        >
          {RAW_RESOURCES.map(r => (
            <option key={r.name} value={r.name}>{r.name}</option>
          ))}
        </select>

        {/* Rate input with math expression support */}
        <div className="source-node__rate-row">
          <input
            type="text"
            inputMode="decimal"
            value={rateStr}
            ref={rateInputRef}
            onChange={e => setRateStr(e.target.value)}
            onBlur={commitRate}
            onKeyDown={handleRateKeyDown}
            className="source-node__rate-input"
            placeholder="e.g. 60*2"
            title="Supports math: 60*3, 120/2, etc."
          />
          <span className="source-node__rate-unit">/min</span>
        </div>
      </div>
    </div>
  );
});

SourceNode.displayName = 'SourceNode';
