import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { allRecipes, usePlannerStore } from '../store';
import type { Recipe } from '../types';

interface Props {
  onClose: () => void;
}

/** Group recipes by their primary output item */
function groupByOutputItem(recipes: Recipe[]): Map<string, Recipe[]> {
  const map = new Map<string, Recipe[]>();
  for (const r of recipes) {
    const key = r.outputs[0]?.item ?? 'Unknown';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return map;
}

export function QuickSearch({ onClose }: Props) {
  const [query, setQuery]         = useState('');
  const [focusedIdx, setFocused]  = useState(0);
  const inputRef                  = useRef<HTMLInputElement>(null);
  const listRef                   = useRef<HTMLDivElement>(null);
  const { addRecipeNode }         = usePlannerStore();
  const { screenToFlowPosition }  = useReactFlow();

  const spawnPos = useCallback(() => {
    const canvas = document.querySelector('.planner-canvas');
    if (!canvas) return { x: 300, y: 200 };
    const { left, top, width, height } = canvas.getBoundingClientRect();
    const c = screenToFlowPosition({ x: left + width / 2, y: top + height / 2 });
    return { x: c.x + (Math.random() - 0.5) * 80, y: c.y + (Math.random() - 0.5) * 80 };
  }, [screenToFlowPosition]);

  // Focus the search input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Filter recipes
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allRecipes;
    return allRecipes.filter(r =>
      r.outputs.some(o => o.item.toLowerCase().includes(q)) ||
      r.name.toLowerCase().includes(q)
    );
  }, [query]);

  // Group and sort
  const sortedGroups = useMemo(() => {
    const grouped = groupByOutputItem(filtered);
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Flat list of recipes for keyboard navigation
  const flatRecipes = useMemo(
    () => sortedGroups.flatMap(([, recipes]) => recipes),
    [sortedGroups]
  );

  // Reset focus when results change
  useEffect(() => { setFocused(0); }, [flatRecipes]);

  const addAndClose = useCallback((recipeId: string) => {
    addRecipeNode(recipeId, spawnPos());
    onClose();
  }, [addRecipeNode, spawnPos, onClose]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape')    { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocused(i => Math.min(i + 1, flatRecipes.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setFocused(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && flatRecipes[focusedIdx]) {
      addAndClose(flatRecipes[focusedIdx].id);
    }
  }, [flatRecipes, focusedIdx, addAndClose, onClose]);

  // Scroll focused item into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${focusedIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusedIdx]);

  // Running flat index across groups for keyboard focus
  let runningIdx = 0;

  return (
    <div className="qs__overlay" onMouseDown={onClose}>
      <div className="qs__modal" onMouseDown={e => e.stopPropagation()} onKeyDown={onKeyDown}>

        {/* Search bar */}
        <div className="qs__search-row">
          <span className="qs__search-icon">⌕</span>
          <input
            ref={inputRef}
            className="qs__input"
            placeholder="Search items or recipes…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && (
            <button className="qs__clear" onClick={() => { setQuery(''); inputRef.current?.focus(); }}>✕</button>
          )}
        </div>

        <div className="qs__hint">↑↓ navigate · Enter add · Esc close</div>

        {/* Results */}
        <div className="qs__results" ref={listRef}>
          {sortedGroups.length === 0 && (
            <p className="qs__empty">No recipes match "{query}"</p>
          )}

          {sortedGroups.map(([item, recipes]) => (
            <div key={item} className="qs__group">
              <div className="qs__group-header">
                <span className="qs__group-item">{item}</span>
                <span className="qs__group-count">{recipes.length} recipe{recipes.length !== 1 ? 's' : ''}</span>
              </div>

              {recipes.map(r => {
                const idx = runningIdx++;
                const isFocused = idx === focusedIdx;
                return (
                  <button
                    key={r.id}
                    data-idx={idx}
                    className={`qs__recipe${isFocused ? ' qs__recipe--focused' : ''}`}
                    onClick={() => addAndClose(r.id)}
                    onMouseEnter={() => setFocused(idx)}
                    title={`Inputs: ${r.inputs.map(i => `${i.item} (${i.ratePerMin}/min)`).join(', ')}`}
                  >
                    <div className="qs__recipe-top">
                      {r.isAlternate && <span className="qs__alt-badge">ALT</span>}
                      <span className="qs__recipe-name">{r.name}</span>
                      <span className="qs__recipe-machine">{r.machines[0]}</span>
                    </div>
                    <div className="qs__recipe-io">
                      <span className="qs__io-inputs">
                        {r.inputs.map(i => `${i.item} ×${i.ratePerMin}/min`).join('  +  ')}
                      </span>
                      <span className="qs__io-arrow">→</span>
                      <span className="qs__io-outputs">
                        {r.outputs.map(o => `${o.item} ×${o.ratePerMin}/min`).join(',  ')}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="qs__footer">
          {flatRecipes.length} recipe{flatRecipes.length !== 1 ? 's' : ''}
          {query ? ` matching "${query}"` : ' total'}
        </div>
      </div>
    </div>
  );
}
