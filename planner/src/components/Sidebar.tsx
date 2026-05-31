import { useState, useMemo } from 'react';
import { useReactFlow } from '@xyflow/react';
import { allRecipes, allMachines, CATEGORY_COLORS, usePlannerStore } from '../store';
import type { SavedSlot } from '../store';
import type { Recipe, RecipeNodeData } from '../types';

// Group recipes by their primary machine
function groupByMachine(recipes: Recipe[]): Map<string, Recipe[]> {
  const map = new Map<string, Recipe[]>();
  for (const r of recipes) {
    const key = r.machines[0] ?? 'Unknown';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return map;
}

export function Sidebar() {
  const [query, setQuery] = useState('');
  const [showAlternates, setShowAlternates] = useState(false);
  const [saveName, setSaveName] = useState('');
  const { addRecipeNode, addSourceNode, addFactoryNode, addToFactory,
          addSplitterMergerNode, nodes, edges,
          savedSlots, saveSlot, loadSlot, deleteSlot } = usePlannerStore();
  const { screenToFlowPosition } = useReactFlow();

  // Convert the canvas centre (screen coords) to flow coords
  const viewportCenter = () => {
    const canvas = document.querySelector('.planner-canvas');
    if (!canvas) return { x: 300, y: 200 };
    const { left, top, width, height } = canvas.getBoundingClientRect();
    return screenToFlowPosition({
      x: left + width  / 2,
      y: top  + height / 2,
    });
  };

  // Small random spread so successive nodes don't perfectly stack
  const spawnPos = () => {
    const c = viewportCenter();
    return { x: c.x + (Math.random() - 0.5) * 80, y: c.y + (Math.random() - 0.5) * 80 };
  };

  // Split selection into factory nodes and regular nodes
  const selectedAll      = useMemo(() => nodes.filter(n => n.selected), [nodes]);
  const selectedFactory  = useMemo(() => selectedAll.find(n => n.type === 'factoryNode'), [selectedAll]);
  const selectedNonFactory = useMemo(
    () => selectedAll.filter(n => n.type !== 'factoryNode' && !n.parentId),
    [selectedAll]
  );
  // For "create factory" — only free (unparented) nodes
  const freeSelectedIds = selectedNonFactory.map(n => n.id);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return allRecipes.filter(r => {
      if (!showAlternates && r.isAlternate) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.outputs.some(o => o.item.toLowerCase().includes(q)) ||
        r.inputs.some(i => i.item.toLowerCase().includes(q))
      );
    });
  }, [query, showAlternates]);

  const grouped = useMemo(() => groupByMachine(filtered), [filtered]);
  const machineOrder = allMachines.map(m => m.name);

  // Total power across all recipe nodes
  const totalPowerMW = useMemo(() => {
    let sum = 0;
    for (const node of nodes) {
      if (node.type !== 'recipeNode') continue;
      const d = node.data as unknown as RecipeNodeData;
      const machineName = d.selectedMachine ?? '';
      const machine = allMachines.find(m => m.name === machineName);
      if (machine && machine.powerConsumptionMW > 0) {
        sum += machine.powerConsumptionMW * (d.machineCount || 1);
      }
    }
    return sum;
  }, [nodes]);

  const sortedGroups = [...grouped.entries()].sort(([a], [b]) => {
    const ia = machineOrder.indexOf(a);
    const ib = machineOrder.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  // Bill of materials: aggregate raw resource requirements
  const bom = useMemo(() => {
    const totals = new Map<string, number>();
    for (const node of nodes) {
      if (node.type === 'sourceNode') {
        const d = node.data as { item: string; ratePerMin: number };
        totals.set(d.item, (totals.get(d.item) ?? 0) + d.ratePerMin);
      }
    }
    return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [nodes]);

  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <div className="sidebar__brand">
          {/* Orange circle checkmark icon */}
          <svg className="sidebar__brand-icon" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="18" cy="18" r="15.5" stroke="#fa9549" strokeWidth="3.5"/>
            <polyline points="10,18 15.5,24 26,12" stroke="#fa9549" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <h2 className="sidebar__title">
            <span className="sidebar__title-op">Op</span><span className="sidebar__title-tim">tim</span>
          </h2>
        </div>
        <p className="sidebar__subtitle">Satisfactory Factory Planner</p>
      </div>

      {/* Quick-add buttons */}
      <div className="sidebar__section sidebar__add-row">
        <button
          className="sidebar__btn sidebar__btn--add-node"
          onClick={() => addRecipeNode('', spawnPos())}
        >
          + Node
        </button>
        <button
          className="sidebar__btn sidebar__btn--add-source"
          onClick={() => addSourceNode('Iron Ore', spawnPos())}
        >
          + Source
        </button>
        <button
          className="sidebar__btn sidebar__btn--add-router"
          onClick={() => addSplitterMergerNode(spawnPos())}
          title="Add a splitter/merger router node"
        >
          ⇌ Router
        </button>
      </div>

      {/* Factory actions — context-sensitive */}
      <div className="sidebar__section sidebar__factory-row">
        {/* Create new factory from free selection */}
        <button
          className={`sidebar__btn sidebar__btn--add-factory${freeSelectedIds.length === 0 ? ' sidebar__btn--disabled' : ''}`}
          onClick={() => freeSelectedIds.length > 0 && addFactoryNode(freeSelectedIds)}
          title={freeSelectedIds.length === 0
            ? 'Select nodes on the canvas first'
            : `Wrap ${freeSelectedIds.length} node${freeSelectedIds.length !== 1 ? 's' : ''} in a new factory`}
        >
          ▣ New Factory{freeSelectedIds.length > 0 ? ` (${freeSelectedIds.length})` : ''}
        </button>

        {/* Add to existing factory — only shown when a factory + other nodes are selected */}
        {selectedFactory && selectedNonFactory.length > 0 && (
          <button
            className="sidebar__btn sidebar__btn--add-to-factory"
            onClick={() => addToFactory(selectedFactory.id, selectedNonFactory.map(n => n.id))}
            title={`Add ${selectedNonFactory.length} node${selectedNonFactory.length !== 1 ? 's' : ''} to "${(selectedFactory.data as { label?: string }).label ?? 'Factory'}"`}
          >
            + Add to Factory
          </button>
        )}
      </div>

      {/* Saves */}
      <div className="sidebar__section sidebar__saves">
        <div className="sidebar__save-row">
          <input
            className="sidebar__save-input"
            placeholder="Save name…"
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && saveName.trim()) {
                saveSlot(saveName);
                setSaveName('');
              }
            }}
          />
          <button
            className="sidebar__btn sidebar__btn--save"
            disabled={!saveName.trim()}
            onClick={() => { saveSlot(saveName); setSaveName(''); }}
          >
            Save
          </button>
        </div>

        {savedSlots.length > 0 && (
          <ul className="sidebar__slot-list">
            {savedSlots.map((slot: SavedSlot) => (
              <li key={slot.id} className="sidebar__slot">
                <div className="sidebar__slot-info">
                  <span className="sidebar__slot-name">{slot.name}</span>
                  <span className="sidebar__slot-date">
                    {new Date(slot.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="sidebar__slot-actions">
                  <button className="sidebar__slot-btn" onClick={() => loadSlot(slot.id)} title="Load">↩</button>
                  <button className="sidebar__slot-btn sidebar__slot-btn--del" onClick={() => { if (confirm(`Delete "${slot.name}"?`)) deleteSlot(slot.id); }} title="Delete">✕</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="sidebar__io-row">
          <button
            className="sidebar__btn sidebar__btn--sm"
            onClick={() => {
              const json = usePlannerStore.getState().exportJSON();
              const blob = new Blob([json], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'satisfactory-plan.json';
              a.click();
            }}
          >
            ↓ Export
          </button>
          <label className="sidebar__btn sidebar__btn--sm">
            ↑ Import
            <input
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                file.text().then(text => usePlannerStore.getState().importJSON(text));
                e.target.value = '';
              }}
            />
          </label>
          <button
            className="sidebar__btn sidebar__btn--sm sidebar__btn--danger"
            onClick={() => { if (confirm('Clear all nodes and edges?')) usePlannerStore.getState().clearAll(); }}
          >
            🗑 Clear
          </button>
        </div>
      </div>

      {/* Recipe search */}
      <div className="sidebar__search">
        <input
          className="sidebar__search-input"
          type="search"
          placeholder="Search recipes or items…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <label className="sidebar__toggle">
          <input
            type="checkbox"
            checked={showAlternates}
            onChange={e => setShowAlternates(e.target.checked)}
          />
          Show alternates
        </label>
      </div>

      {/* Recipe list */}
      <div className="sidebar__recipe-list">
        {sortedGroups.map(([machine, recipes]) => {
          const m = allMachines.find(m => m.name === machine);
          const cat = m?.category ?? 'Other';
          const color = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.Other;
          return (
            <details key={machine} className="sidebar__group" open={!!query}>
              <summary
                className="sidebar__group-header"
                style={{ borderLeftColor: color }}
              >
                <span>{machine}</span>
                <span className="sidebar__group-count">{recipes.length}</span>
              </summary>
              <ul className="sidebar__group-list">
                {recipes.map(r => (
                  <li key={r.id} className="sidebar__recipe-item">
                    <button
                      className="sidebar__recipe-btn"
                      onClick={() => addRecipeNode(r.id, spawnPos())}
                      title={`Inputs: ${r.inputs.map(i => `${i.item} (${i.ratePerMin}/min)`).join(', ')}`}
                    >
                      {r.isAlternate && <span className="sidebar__alt-badge">ALT</span>}
                      {r.name}
                      <span className="sidebar__recipe-outputs">
                        → {r.outputs.map(o => o.item).join(', ')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
        {sortedGroups.length === 0 && (
          <p className="sidebar__empty">No recipes match "{query}"</p>
        )}
      </div>

      {/* Bill of materials */}
      {bom.length > 0 && (
        <div className="sidebar__bom">
          <h3 className="sidebar__bom-title">Raw Resources</h3>
          <ul className="sidebar__bom-list">
            {bom.map(([item, rate]) => (
              <li key={item} className="sidebar__bom-item">
                <span>{item}</span>
                <span className="sidebar__bom-rate">{rate.toFixed(1)}/min</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Total power tracker */}
      <div className="sidebar__power">
        <span className="sidebar__power-label">⚡ Total power</span>
        <span className="sidebar__power-value">
          {totalPowerMW >= 1000
            ? `${(totalPowerMW / 1000).toFixed(2)} GW`
            : `${totalPowerMW.toFixed(1)} MW`}
        </span>
      </div>

      <div className="sidebar__stats">
        {nodes.length} nodes · {edges.length} edges
      </div>
    </aside>
  );
}
