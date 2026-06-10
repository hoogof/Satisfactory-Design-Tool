import { useState, useMemo, useEffect, useCallback } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { usePlannerStore, deriveFlowFromHandle, round4 } from '../store';
import { ItemIcon } from '../components/ItemIcon';
import type { SplitterMergerNodeData } from '../types';

export type { SplitterMergerNodeData };

const HEADER_H  = 36;   // px — must match CSS .sm-node__header height
const SUMMARY_H = 30;   // px — must match CSS .sm-node__summary height
const PORT_H    = 34;   // px — must match CSS .sm-node__port-row height
const CTRL_H    = 28;   // px — must match CSS .sm-node__ctrl height
const MAX_PORTS = 8;
const MIN_PORTS = 1;

export function smHandleId(nodeId: string, side: 'in' | 'out', idx: number) {
  return `${nodeId}-sm-${side}-${idx}`;
}

// Absolute top (from node top) for handle at port-row index i
// Handles sit in the body area, below header + summary
function handleTop(i: number) {
  return HEADER_H + SUMMARY_H + i * PORT_H + PORT_H / 2;
}

function evalMath(expr: string): number | null {
  try {
    const s = expr.replace(/[^0-9+\-*/().^ ]/g, '');
    if (!s) return null;
    // eslint-disable-next-line no-new-func
    const r = new Function(`"use strict"; return (${s})`)();
    if (typeof r === 'number' && isFinite(r) && r >= 0) return r;
    return null;
  } catch { return null; }
}

export function SplitterMergerNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as SplitterMergerNodeData;
  const { updateNodeData, deleteNode, deleteEdgesForHandle } = usePlannerStore();
  const nodes = usePlannerStore(s => s.nodes);
  const edges = usePlannerStore(s => s.edges);
  const conservationError = usePlannerStore(s => s.conservationIssues.some(i => i.nodeId === id));

  const inputCount  = Math.max(MIN_PORTS, d.inputCount  ?? 1);
  const outputCount = Math.max(MIN_PORTS, d.outputCount ?? 2);
  const outputRates: number[] = Array.isArray(d.outputRates)
    ? d.outputRates
    : Array(outputCount).fill(0);

  // ── Derive locked item + per-input rates from live graph ────
  const inputFlows = useMemo(() => {
    return Array.from({ length: inputCount }, (_, i) => {
      const edge = edges.find(e => e.targetHandle === smHandleId(id, 'in', i));
      if (!edge) return null;
      return deriveFlowFromHandle(edge.source, edge.sourceHandle ?? '', nodes, edges);
    });
  }, [id, inputCount, nodes, edges]);

  const lockedItem = useMemo(
    () => inputFlows.find(f => f?.item)?.item ?? null,
    [inputFlows]
  );

  const totalIn = useMemo(
    () => inputFlows.reduce((s, f) => s + (f?.rate ?? 0), 0),
    [inputFlows]
  );

  const totalOut = useMemo(
    () => outputRates.slice(0, outputCount).reduce((a, b) => a + b, 0),
    [outputRates, outputCount]
  );

  const overBy      = Math.max(0, totalOut - totalIn);
  const isOver      = overBy > 0.005;
  const remaining   = Math.max(0, totalIn - totalOut);

  // ── Local string state for output-rate inputs ────────────────
  const [rateStrs, setRateStrs] = useState<string[]>(
    () => Array.from({ length: MAX_PORTS }, (_, i) => String(outputRates[i] ?? 0))
  );
  const [focusedSlot, setFocusedSlot] = useState<number | null>(null);

  // Sync from store when rates change externally (load, undo, etc.)
  useEffect(() => {
    setRateStrs(prev =>
      Array.from({ length: MAX_PORTS }, (_, i) => {
        if (i === focusedSlot) return prev[i]; // don't clobber active edit
        return String(outputRates[i] ?? 0);
      })
    );
  // outputRates identity changes when store updates, which is correct
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputRates, outputCount]);

  const commitRate = useCallback((idx: number, raw: string) => {
    const val = round4(Math.max(0, evalMath(raw) ?? outputRates[idx] ?? 0));
    const newRates = [...outputRates];
    while (newRates.length <= idx) newRates.push(0);
    newRates[idx] = val;
    updateNodeData(id, { outputRates: newRates });
    setRateStrs(prev => { const n = [...prev]; n[idx] = String(val); return n; });
    setFocusedSlot(null);
  }, [outputRates, id, updateNodeData]);

  // ── Port add/remove ──────────────────────────────────────────
  const addInput = () => inputCount < MAX_PORTS &&
    updateNodeData(id, { inputCount: inputCount + 1 });

  const removeInput = () => {
    if (inputCount <= MIN_PORTS) return;
    deleteEdgesForHandle(smHandleId(id, 'in', inputCount - 1));
    updateNodeData(id, { inputCount: inputCount - 1 });
  };

  const addOutput = () => {
    if (outputCount >= MAX_PORTS) return;
    const newRates = [...outputRates, 0];
    updateNodeData(id, { outputCount: outputCount + 1, outputRates: newRates });
  };

  const removeOutput = () => {
    if (outputCount <= MIN_PORTS) return;
    deleteEdgesForHandle(smHandleId(id, 'out', outputCount - 1));
    const newRates = outputRates.slice(0, outputCount - 1);
    updateNodeData(id, { outputCount: outputCount - 1, outputRates: newRates });
  };

  const rowCount = Math.max(inputCount, outputCount);
  const bodyH    = rowCount * PORT_H + CTRL_H;

  return (
    <div className={`sm-node node-drag-handle${selected ? ' sm-node--selected' : ''}${conservationError ? ' node--conservation-error' : ''}`}>

      {/* ── Input handles — left edge ── */}
      {Array.from({ length: inputCount }, (_, i) => (
        <Handle
          key={`in-${i}`}
          type="target"
          position={Position.Left}
          id={smHandleId(id, 'in', i)}
          className="node-handle node-handle--in"
          style={{ top: handleTop(i), transform: 'translateY(-50%)' }}
          onDoubleClick={() => deleteEdgesForHandle(smHandleId(id, 'in', i))}
        />
      ))}

      {/* ── Output handles — right edge ── */}
      {Array.from({ length: outputCount }, (_, i) => (
        <Handle
          key={`out-${i}`}
          type="source"
          position={Position.Right}
          id={smHandleId(id, 'out', i)}
          className="node-handle node-handle--out"
          style={{ top: handleTop(i), transform: 'translateY(-50%)' }}
          onDoubleClick={() => deleteEdgesForHandle(smHandleId(id, 'out', i))}
        />
      ))}

      {/* ── Header ── */}
      <div className="sm-node__header">
        <span className="sm-node__icon">⇌</span>
        <input
          className="sm-node__label-input"
          value={d.label ?? 'Router'}
          onChange={e => updateNodeData(id, { label: e.target.value })}
          onMouseDown={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
        />
        <button className="sm-node__delete" onClick={() => deleteNode(id)} title="Delete node">✕</button>
      </div>

      {/* ── Summary bar ── */}
      <div className={`sm-node__summary${isOver ? ' sm-node__summary--over' : ''}`}>
        <span className="sm-node__locked-item">
          {lockedItem
            ? <><ItemIcon name={lockedItem} size={16} /> {lockedItem}</>
            : <em className="sm-node__no-item">Connect an input</em>
          }
        </span>
        {lockedItem && (
          <span className="sm-node__balance-info">
            <span className="sm-node__total-in">{totalIn.toFixed(1)}/min</span>
            {isOver
              ? <span className="sm-node__over-warn">⚠ +{overBy.toFixed(1)} over</span>
              : remaining > 0.005
                ? <span className="sm-node__remaining">+{remaining.toFixed(1)} free</span>
                : <span className="sm-node__balanced">✓ balanced</span>
            }
          </span>
        )}
      </div>

      {/* ── Body ── */}
      <div className="sm-node__body" style={{ height: bodyH }}>

        {/* Inputs column */}
        <div className="sm-node__col sm-node__col--in">
          {Array.from({ length: rowCount }, (_, i) => (
            <div key={i} className="sm-node__port-row">
              {i < inputCount
                ? <span className="sm-node__port-label sm-node__port-label--in">
                    IN {i + 1}
                    {inputFlows[i] != null && (
                      <span className="sm-node__port-rate">
                        {' '}{inputFlows[i]!.rate.toFixed(1)}
                      </span>
                    )}
                  </span>
                : <span className="sm-node__port-label sm-node__port-label--empty">—</span>
              }
            </div>
          ))}
          <div className="sm-node__ctrl">
            <button className="sm-node__ctrl-btn" onClick={removeInput}
              disabled={inputCount <= MIN_PORTS} title="Remove input port">−</button>
            <span className="sm-node__ctrl-count">{inputCount}</span>
            <button className="sm-node__ctrl-btn" onClick={addInput}
              disabled={inputCount >= MAX_PORTS} title="Add input port">+</button>
          </div>
        </div>

        {/* Centre arrow */}
        <div className="sm-node__arrow">→</div>

        {/* Outputs column */}
        <div className="sm-node__col sm-node__col--out">
          {Array.from({ length: rowCount }, (_, i) => (
            <div key={i} className="sm-node__port-row sm-node__port-row--out">
              {i < outputCount
                ? <>
                    <input
                      className={`sm-node__rate-input${isOver ? ' sm-node__rate-input--over' : ''}`}
                      value={rateStrs[i] ?? '0'}
                      onChange={e => {
                        const v = e.target.value;
                        setRateStrs(prev => { const n = [...prev]; n[i] = v; return n; });
                      }}
                      onFocus={() => setFocusedSlot(i)}
                      onBlur={e => commitRate(i, e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          commitRate(i, (e.target as HTMLInputElement).value);
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      onMouseDown={e => e.stopPropagation()}
                      onPointerDown={e => e.stopPropagation()}
                      title="Rate per minute for this output (supports math expressions)"
                      placeholder="0"
                    />
                    <span className="sm-node__port-label sm-node__port-label--out">OUT {i + 1}</span>
                  </>
                : <span className="sm-node__port-label sm-node__port-label--empty">—</span>
              }
            </div>
          ))}
          <div className="sm-node__ctrl sm-node__ctrl--out">
            <button className="sm-node__ctrl-btn" onClick={removeOutput}
              disabled={outputCount <= MIN_PORTS} title="Remove output port">−</button>
            <span className="sm-node__ctrl-count">{outputCount}</span>
            <button className="sm-node__ctrl-btn" onClick={addOutput}
              disabled={outputCount >= MAX_PORTS} title="Add output port">+</button>
          </div>
        </div>

      </div>
    </div>
  );
}
