import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { RecipeNodeData } from '../types';
import { getCategoryColor, usePlannerStore, allRecipes, allMachines } from '../store';

function handleId(nodeId: string, item: string, side: 'in' | 'out') {
  return `${nodeId}-${side}-${item.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
}

// Evaluate a basic math expression: supports +  -  *  /  ^  ( )
// Returns null if the expression is invalid or non-positive.
function evalMath(expr: string): number | null {
  if (!expr.trim()) return null;
  try {
    // Replace ^ with ** for JS exponentiation
    const sanitized = expr.replace(/\^/g, '**');
    // Only allow digits, operators, spaces, dots, and parentheses
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

function handleTops(count: number, headerHeight = 72, footerHeight = 36, rowHeight = 44): number[] {
  if (count === 0) return [];
  const bodyHeight = count * rowHeight;
  const totalHeight = headerHeight + bodyHeight + footerHeight;
  return Array.from({ length: count }, (_, i) => {
    const y = headerHeight + rowHeight * i + rowHeight / 2;
    return (y / totalHeight) * 100;
  });
}

export const RecipeNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as unknown as RecipeNodeData;
  const recipe = d.recipe;
  const { updateNodeData, deleteNode, scaleConnectedNodes, deleteEdgesForHandle } = usePlannerStore();

  const color = getCategoryColor(d.selectedMachine ?? '');

  const [countStr, setCountStr] = useState(String(d.machineCount ?? 1));
  const countInputRef = useRef<HTMLInputElement>(null);

  // Sync display when machineCount is changed externally (e.g. auto-scale)
  useEffect(() => {
    if (countInputRef.current !== document.activeElement) {
      setCountStr(String(d.machineCount ?? 1));
    }
  }, [d.machineCount]);

  const recipeOptions = useMemo(() =>
    [...allRecipes].sort((a, b) => {
      if (a.isAlternate !== b.isAlternate) return a.isAlternate ? 1 : -1;
      return a.name.localeCompare(b.name);
    }), []);

  const handleRecipeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newRecipe = allRecipes.find(r => r.id === e.target.value);
    if (newRecipe) {
      updateNodeData(id, {
        recipeId: newRecipe.id,
        recipe: newRecipe,
        selectedMachine: newRecipe.machines[0] ?? d.selectedMachine,
      });
    }
  }, [id, updateNodeData, d.selectedMachine]);

  const handleMachineChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    updateNodeData(id, { selectedMachine: e.target.value });
  }, [id, updateNodeData]);

  const handleCountInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // Accept any characters while typing — we evaluate on commit
    setCountStr(e.target.value);
  }, []);

  const commitCount = useCallback(() => {
    const evaluated = evalMath(countStr);
    const final = evaluated ?? 1;
    // Read the live store value — avoids stale-closure issues with d.machineCount
    const liveNode = usePlannerStore.getState().nodes.find(n => n.id === id);
    const prev = ((liveNode?.data as unknown as RecipeNodeData)?.machineCount) ?? 1;
    setCountStr(String(final));
    updateNodeData(id, { machineCount: final });
    if (final !== prev && prev > 0) {
      scaleConnectedNodes(id, final / prev);
    }
  }, [countStr, id, updateNodeData, scaleConnectedNodes]);

  const handleCountKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitCount();
      (e.target as HTMLInputElement).blur();
    }
  }, [commitCount]);

  // Sync local string when machineCount changes externally (e.g. import)
  const externalCount = d.machineCount ?? 1;
  const lastExternal = useMemo(() => externalCount, [externalCount]);
  if (parseFloat(countStr) !== lastExternal && document.activeElement?.getAttribute('data-node-count') !== id) {
    // Not focused — sync silently
  }

  const scale = d.machineCount || 1;
  const machineName = d.selectedMachine ?? (recipe?.machines[0] ?? '');
  const machine = allMachines.find(m => m.name === machineName);

  const inputTops = handleTops(recipe?.inputs.length ?? 0);
  const outputTops = handleTops(recipe?.outputs.length ?? 0);

  return (
    <div className={`recipe-node${selected ? ' recipe-node--selected' : ''}`}>
      {/* Left-edge input handles */}
      {recipe?.inputs.map((inp, i) => {
        const supply = d.inputSupply?.[inp.item];
        const needed = inp.ratePerMin * scale;
        const sufficient = supply === undefined || supply >= needed - 0.01;
        return (
          <Handle
            key={i}
            type="target"
            position={Position.Left}
            id={handleId(id, inp.item, 'in')}
            className={`node-handle node-handle--in${!sufficient ? ' node-handle--deficit' : ''}`}
            style={{ top: `${inputTops[i]}%` }}
            title={`${inp.item} · ${(inp.ratePerMin * scale).toFixed(2)}/min — double-click to disconnect`}
            onDoubleClick={() => deleteEdgesForHandle(handleId(id, inp.item, 'in'))}
          />
        );
      })}

      {/* Right-edge output handles */}
      {recipe?.outputs.map((out, i) => (
        <Handle
          key={i}
          type="source"
          position={Position.Right}
          id={handleId(id, out.item, 'out')}
          className="node-handle node-handle--out"
          style={{ top: `${outputTops[i]}%` }}
          title={`${out.item} · ${(out.ratePerMin * scale).toFixed(2)}/min — double-click to disconnect`}
          onDoubleClick={() => deleteEdgesForHandle(handleId(id, out.item, 'out'))}
        />
      ))}

      {/* Header */}
      <div className="recipe-node__header node-drag-handle">
        <div className="recipe-node__top-row">
          <span className="recipe-node__category-dot" style={{ background: color }} title={machine?.category} />
          <span className="recipe-node__machine-label">{machineName || 'New node'}</span>
          <button className="recipe-node__delete" onClick={() => deleteNode(id)} title="Remove">✕</button>
        </div>
        <select
          className="recipe-node__recipe-select"
          value={d.recipeId ?? ''}
          onChange={handleRecipeChange}
        >
          <option value="" disabled>— pick a recipe —</option>
          {recipeOptions.map(r => (
            <option key={r.id} value={r.id}>
              {r.isAlternate ? `↺ ${r.name}` : r.name}
            </option>
          ))}
        </select>
      </div>

      {/* Body: port label rows */}
      {recipe && (
        <div className="recipe-node__body">
          <div className="recipe-node__ports recipe-node__ports--inputs">
            {recipe.inputs.map((inp, i) => {
              const supply = d.inputSupply?.[inp.item];
              const needed = inp.ratePerMin * scale;
              const sufficient = supply === undefined || supply >= needed - 0.01;
              return (
                <div key={i} className="recipe-node__port-row">
                  <span className={`recipe-node__rate${!sufficient ? ' recipe-node__rate--deficit' : ''}`}>
                    <strong>{inp.item}</strong>
                    <small>{(inp.ratePerMin * scale).toFixed(2)}/min</small>
                  </span>
                </div>
              );
            })}
          </div>

          <div className="recipe-node__ports recipe-node__ports--outputs">
            {recipe.outputs.map((out, i) => (
              <div key={i} className="recipe-node__port-row recipe-node__port-row--out">
                <span className="recipe-node__rate recipe-node__rate--output">
                  <strong>{out.item}</strong>
                  <small>{(out.ratePerMin * scale).toFixed(2)}/min</small>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="recipe-node__footer">
        <label className="recipe-node__count-label">
          ×
          <input
            ref={countInputRef}
            type="text"
            inputMode="decimal"
            value={countStr}
            onChange={handleCountInput}
            onBlur={commitCount}
            onKeyDown={handleCountKeyDown}
            className="recipe-node__count-input"
            data-node-count={id}
            title="Number of machines (supports decimals)"
            placeholder="1"
          />
        </label>
        {recipe && recipe.machines.length > 1 && (
          <select value={d.selectedMachine} onChange={handleMachineChange} className="recipe-node__machine-select">
            {recipe.machines.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        {machine && machine.powerConsumptionMW > 0 && (
          <span className="recipe-node__power">⚡ {(machine.powerConsumptionMW * scale).toFixed(1)} MW</span>
        )}
      </div>
    </div>
  );
});

RecipeNode.displayName = 'RecipeNode';
