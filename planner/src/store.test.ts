import { describe, it, expect, beforeEach } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { usePlannerStore, round4, checkConservation, conservationOk, connectionItemsMatch } from './store';
import type { Recipe, RecipeNodeData, SourceNodeData, SplitterMergerNodeData } from './types';

// ── Test fixtures ────────────────────────────────────────────────

const ingotRecipe: Recipe = {
  id: 'iron-ingot',
  name: 'Iron Ingot',
  isAlternate: false,
  machines: ['Smelter'],
  inputs:  [{ item: 'Iron Ore',   ratePerMin: 30 }],
  outputs: [{ item: 'Iron Ingot', ratePerMin: 30 }],
  unlockMethod: '',
};

const plateRecipe: Recipe = {
  id: 'iron-plate',
  name: 'Iron Plate',
  isAlternate: false,
  machines: ['Constructor'],
  inputs:  [{ item: 'Iron Ingot', ratePerMin: 30 }],
  outputs: [{ item: 'Iron Plate', ratePerMin: 20 }],
  unlockMethod: '',
};

function sourceNode(id: string, item: string, ratePerMin: number): Node {
  return {
    id, type: 'sourceNode', position: { x: 0, y: 0 },
    data: { item, ratePerMin } satisfies SourceNodeData,
  };
}

function recipeNode(id: string, recipe: Recipe, machineCount: number): Node {
  return {
    id, type: 'recipeNode', position: { x: 0, y: 0 },
    data: {
      recipeId: recipe.id, machineCount, selectedMachine: recipe.machines[0], recipe,
    } satisfies RecipeNodeData,
  };
}

function smNode(id: string, inputCount: number, outputRates: number[]): Node {
  return {
    id, type: 'splitterMergerNode', position: { x: 0, y: 0 },
    data: {
      label: 'Router', inputCount, outputCount: outputRates.length, outputRates,
    } satisfies SplitterMergerNodeData,
  };
}

const slug = (item: string) => item.toLowerCase().replace(/[^a-z0-9]/g, '-');

function edge(source: string, sourceHandle: string, target: string, targetHandle: string): Edge {
  return { id: `${sourceHandle}->${targetHandle}`, source, sourceHandle, target, targetHandle };
}

function srcEdge(src: string, tgt: string, item: string): Edge {
  return edge(src, `${src}-out`, tgt, `${tgt}-in-${slug(item)}`);
}

function recipeEdge(src: string, tgt: string, outItem: string, inItem = outItem): Edge {
  return edge(src, `${src}-out-${slug(outItem)}`, tgt, `${tgt}-in-${slug(inItem)}`);
}

function getData<T>(id: string): T {
  const n = usePlannerStore.getState().nodes.find(n => n.id === id);
  if (!n) throw new Error(`node ${id} not found`);
  return n.data as unknown as T;
}

function setGraph(nodes: Node[], edges: Edge[]) {
  usePlannerStore.setState({ nodes, edges, autoScale: true, conservationIssues: [] });
}

beforeEach(() => {
  usePlannerStore.setState({
    nodes: [], edges: [], autoScale: true, conservationIssues: [],
    sheets: [{ id: 's1', name: 'Sheet 1', nodes: [], edges: [] }],
    activeSheetId: 's1',
    clipboard: null,
  });
});

// ── Task 1: autoscale propagation ────────────────────────────────

describe('autoscale propagation from a source node', () => {
  it('scales a multi-level chain source → smelter → constructor', () => {
    setGraph(
      [
        sourceNode('src', 'Iron Ore', 30),
        recipeNode('smelt', ingotRecipe, 1),
        recipeNode('plate', plateRecipe, 1),
      ],
      [
        srcEdge('src', 'smelt', 'Iron Ore'),
        recipeEdge('smelt', 'plate', 'Iron Ingot'),
      ]
    );

    // Simulate the source rate being doubled (what SourceNode.commitRate does)
    usePlannerStore.getState().updateNodeData('src', { ratePerMin: 60 });
    usePlannerStore.getState().scaleConnectedNodes('src', 60 / 30);

    expect(getData<SourceNodeData>('src').ratePerMin).toBe(60);
    expect(getData<RecipeNodeData>('smelt').machineCount).toBe(2);
    expect(getData<RecipeNodeData>('plate').machineCount).toBe(2);
  });

  it('scales all branches when one source feeds multiple consumers', () => {
    setGraph(
      [
        sourceNode('src', 'Iron Ore', 30),
        recipeNode('a', ingotRecipe, 1),
        recipeNode('b', ingotRecipe, 0.5),
      ],
      [
        srcEdge('src', 'a', 'Iron Ore'),
        srcEdge('src', 'b', 'Iron Ore'),
      ]
    );

    usePlannerStore.getState().updateNodeData('src', { ratePerMin: 90 });
    usePlannerStore.getState().scaleConnectedNodes('src', 3);

    expect(getData<RecipeNodeData>('a').machineCount).toBe(3);
    expect(getData<RecipeNodeData>('b').machineCount).toBe(1.5);
  });

  it('scales through a merger/splitter and updates its outputRates', () => {
    // source → smelter → router(30 → 20+10) → two constructors
    setGraph(
      [
        sourceNode('src', 'Iron Ore', 30),
        recipeNode('smelt', ingotRecipe, 1),
        smNode('sm', 1, [20, 10]),
        recipeNode('p1', plateRecipe, 20 / 30),
        recipeNode('p2', plateRecipe, 10 / 30),
      ],
      [
        srcEdge('src', 'smelt', 'Iron Ore'),
        edge('smelt', `smelt-out-${slug('Iron Ingot')}`, 'sm', 'sm-sm-in-0'),
        edge('sm', 'sm-sm-out-0', 'p1', `p1-in-${slug('Iron Ingot')}`),
        edge('sm', 'sm-sm-out-1', 'p2', `p2-in-${slug('Iron Ingot')}`),
      ]
    );

    usePlannerStore.getState().updateNodeData('src', { ratePerMin: 60 });
    usePlannerStore.getState().scaleConnectedNodes('src', 2);

    expect(getData<RecipeNodeData>('smelt').machineCount).toBe(2);
    expect(getData<SplitterMergerNodeData>('sm').outputRates).toEqual([40, 20]);
    expect(getData<RecipeNodeData>('p1').machineCount).toBeCloseTo(40 / 30, 4);
    expect(getData<RecipeNodeData>('p2').machineCount).toBeCloseTo(20 / 30, 4);
  });

  it('does nothing when autoScale is off', () => {
    setGraph(
      [sourceNode('src', 'Iron Ore', 30), recipeNode('smelt', ingotRecipe, 1)],
      [srcEdge('src', 'smelt', 'Iron Ore')]
    );
    usePlannerStore.setState({ autoScale: false });

    usePlannerStore.getState().scaleConnectedNodes('src', 2);
    expect(getData<RecipeNodeData>('smelt').machineCount).toBe(1);
  });

  it('scales upstream sources when a recipe node is changed (bidirectional)', () => {
    setGraph(
      [sourceNode('src', 'Iron Ore', 30), recipeNode('smelt', ingotRecipe, 1)],
      [srcEdge('src', 'smelt', 'Iron Ore')]
    );

    usePlannerStore.getState().updateNodeData('smelt', { machineCount: 4 });
    usePlannerStore.getState().scaleConnectedNodes('smelt', 4);

    expect(getData<SourceNodeData>('src').ratePerMin).toBe(120);
  });
});

// ── Task 2: conservation sanity check (LHS = RHS) ────────────────

describe('post-scale conservation check', () => {
  it('reports no issues for a balanced chain after scaling', () => {
    setGraph(
      [
        sourceNode('src', 'Iron Ore', 30),
        recipeNode('smelt', ingotRecipe, 1),
        smNode('sm', 1, [20, 10]),
        recipeNode('p1', plateRecipe, 20 / 30),
        recipeNode('p2', plateRecipe, 10 / 30),
      ],
      [
        srcEdge('src', 'smelt', 'Iron Ore'),
        edge('smelt', `smelt-out-${slug('Iron Ingot')}`, 'sm', 'sm-sm-in-0'),
        edge('sm', 'sm-sm-out-0', 'p1', `p1-in-${slug('Iron Ingot')}`),
        edge('sm', 'sm-sm-out-1', 'p2', `p2-in-${slug('Iron Ingot')}`),
      ]
    );

    usePlannerStore.getState().updateNodeData('src', { ratePerMin: 90 });
    usePlannerStore.getState().scaleConnectedNodes('src', 3);

    expect(usePlannerStore.getState().conservationIssues).toEqual([]);
  });

  it('flags a splitter whose outputs do not sum to its input', () => {
    setGraph(
      [
        sourceNode('src', 'Iron Ore', 30),
        recipeNode('smelt', ingotRecipe, 1),
        smNode('sm', 1, [20, 5]),   // 30 in, only 25 allocated out
      ],
      [
        srcEdge('src', 'smelt', 'Iron Ore'),
        edge('smelt', `smelt-out-${slug('Iron Ingot')}`, 'sm', 'sm-sm-in-0'),
      ]
    );

    usePlannerStore.getState().updateNodeData('src', { ratePerMin: 60 });
    usePlannerStore.getState().scaleConnectedNodes('src', 2);

    const issues = usePlannerStore.getState().conservationIssues;
    expect(issues).toHaveLength(1);
    expect(issues[0].nodeId).toBe('sm');
    expect(issues[0].lhs).toBeCloseTo(60, 4);   // 30 × 2 in
    expect(issues[0].rhs).toBeCloseTo(50, 4);   // (20+5) × 2 out
  });

  it('flags a recipe node whose supply no longer matches its consumption', () => {
    const nodes = [
      sourceNode('src', 'Iron Ore', 30),
      recipeNode('smelt', ingotRecipe, 2),   // needs 60, supplied 30
    ];
    const edges = [srcEdge('src', 'smelt', 'Iron Ore')];
    const issues = checkConservation(nodes, edges);
    expect(issues).toHaveLength(1);
    expect(issues[0].nodeId).toBe('smelt');
    expect(issues[0].lhs).toBe(30);
    expect(issues[0].rhs).toBe(60);
  });

  it('uses epsilon comparison, not strict float equality', () => {
    expect(conservationOk(0.1 + 0.2, 0.3)).toBe(true);
    expect(conservationOk(59.99999999, 60)).toBe(true);
    expect(conservationOk(59.9, 60)).toBe(false);
  });
});

// ── Connection item-type validation ──────────────────────────────

describe('connection item type check', () => {
  const nodes = [
    sourceNode('src', 'Iron Ore', 30),
    recipeNode('smelt', ingotRecipe, 1),   // in: Iron Ore, out: Iron Ingot
    recipeNode('plate', plateRecipe, 1),   // in: Iron Ingot, out: Iron Plate
    smNode('sm', 2, [0, 0]),
  ];

  it('allows matching items (source → recipe, recipe → recipe)', () => {
    expect(connectionItemsMatch('src', 'src-out', 'smelt', `smelt-in-${slug('Iron Ore')}`, nodes, [])).toBe(true);
    expect(connectionItemsMatch('smelt', `smelt-out-${slug('Iron Ingot')}`, 'plate', `plate-in-${slug('Iron Ingot')}`, nodes, [])).toBe(true);
  });

  it('rejects mismatched items', () => {
    // Iron Ore source into an Iron Ingot input
    expect(connectionItemsMatch('src', 'src-out', 'plate', `plate-in-${slug('Iron Ingot')}`, nodes, [])).toBe(false);
    // Iron Ingot output into an Iron Ore input
    expect(connectionItemsMatch('smelt', `smelt-out-${slug('Iron Ingot')}`, 'smelt', `smelt-in-${slug('Iron Ore')}`, nodes, [])).toBe(false);
  });

  it('locks splitter/merger inputs to the item already flowing in', () => {
    const edges = [edge('smelt', `smelt-out-${slug('Iron Ingot')}`, 'sm', 'sm-sm-in-0')];
    // Iron Ingot already flows in — Iron Plate and Iron Ore are rejected
    expect(connectionItemsMatch('plate', `plate-out-${slug('Iron Plate')}`, 'sm', 'sm-sm-in-1', nodes, edges)).toBe(false);
    expect(connectionItemsMatch('src', 'src-out', 'sm', 'sm-sm-in-1', nodes, edges)).toBe(false);
    // Empty splitter accepts anything
    expect(connectionItemsMatch('src', 'src-out', 'sm', 'sm-sm-in-0', nodes, [])).toBe(true);
  });

  it('allows connections whose source item cannot be resolved', () => {
    const blank: Node = {
      id: 'blank', type: 'recipeNode', position: { x: 0, y: 0 },
      data: { recipeId: '', machineCount: 1, selectedMachine: '' },
    };
    expect(connectionItemsMatch('blank', 'blank-out-anything', 'plate', `plate-in-${slug('Iron Ingot')}`, [...nodes, blank], [])).toBe(true);
  });

  it('onConnect refuses to add a mismatched edge', () => {
    setGraph(nodes, []);
    usePlannerStore.getState().onConnect({
      source: 'src', sourceHandle: 'src-out',
      target: 'plate', targetHandle: `plate-in-${slug('Iron Ingot')}`,
    });
    expect(usePlannerStore.getState().edges).toHaveLength(0);

    usePlannerStore.getState().onConnect({
      source: 'src', sourceHandle: 'src-out',
      target: 'smelt', targetHandle: `smelt-in-${slug('Iron Ore')}`,
    });
    expect(usePlannerStore.getState().edges).toHaveLength(1);
  });
});

// ── Clipboard: copy / cut / paste ─────────────────────────────────

describe('copy / cut / paste', () => {
  function seedChain() {
    setGraph(
      [
        { ...sourceNode('src', 'Iron Ore', 30), selected: true },
        { ...recipeNode('smelt', ingotRecipe, 2), selected: true },
      ],
      [srcEdge('src', 'smelt', 'Iron Ore')]
    );
  }

  it('pastes clones with new ids, remapped edges/handles, and offset positions', () => {
    seedChain();
    const st = usePlannerStore.getState();
    st.copySelection();
    st.pasteClipboard();

    const { nodes, edges } = usePlannerStore.getState();
    expect(nodes).toHaveLength(4);
    expect(edges).toHaveLength(2);

    const pasted = nodes.filter(n => n.selected);
    expect(pasted).toHaveLength(2);
    // originals deselected, clones selected
    expect(nodes.filter(n => !n.selected).map(n => n.id).sort()).toEqual(['smelt', 'src']);

    const newSrc   = pasted.find(n => n.type === 'sourceNode')!;
    const newSmelt = pasted.find(n => n.type === 'recipeNode')!;
    expect(newSrc.id).not.toBe('src');
    expect(newSrc.position).toEqual({ x: 48, y: 48 });
    expect((newSmelt.data as unknown as RecipeNodeData).machineCount).toBe(2);

    // the cloned edge links the clones via remapped handle ids
    const newEdge = edges.find(e => e.source === newSrc.id)!;
    expect(newEdge.target).toBe(newSmelt.id);
    expect(newEdge.sourceHandle).toBe(`${newSrc.id}-out`);
    expect(newEdge.targetHandle).toBe(`${newSmelt.id}-in-${slug('Iron Ore')}`);
  });

  it('repeated pastes cascade instead of stacking', () => {
    seedChain();
    const st = usePlannerStore.getState();
    st.copySelection();
    st.pasteClipboard();
    usePlannerStore.getState().pasteClipboard();
    const sources = usePlannerStore.getState().nodes.filter(n => n.type === 'sourceNode');
    expect(sources.map(n => n.position.x).sort((a, b) => a - b)).toEqual([0, 48, 96]);
  });

  it('cut removes the selection and its edges; paste restores it', () => {
    seedChain();
    usePlannerStore.getState().cutSelection();
    expect(usePlannerStore.getState().nodes).toHaveLength(0);
    expect(usePlannerStore.getState().edges).toHaveLength(0);

    usePlannerStore.getState().pasteClipboard();
    expect(usePlannerStore.getState().nodes).toHaveLength(2);
    expect(usePlannerStore.getState().edges).toHaveLength(1);
  });

  it('copying a factory brings its members and keeps relative positions', () => {
    const factory: Node = {
      id: 'fac', type: 'factoryNode', position: { x: 100, y: 100 },
      style: { width: 400, height: 300 }, selected: true,
      data: { label: 'F', color: '#fff' },
    };
    const child: Node = {
      ...recipeNode('kid', ingotRecipe, 1),
      parentId: 'fac', extent: 'parent' as const, position: { x: 60, y: 60 },
    };
    setGraph([factory, child], []);

    const st = usePlannerStore.getState();
    st.copySelection();           // only the factory is selected
    st.pasteClipboard();

    const { nodes } = usePlannerStore.getState();
    expect(nodes).toHaveLength(4);
    const newFac = nodes.find(n => n.type === 'factoryNode' && n.id !== 'fac')!;
    const newKid = nodes.find(n => n.type === 'recipeNode' && n.id !== 'kid')!;
    expect(newFac.position).toEqual({ x: 148, y: 148 });
    expect(newKid.parentId).toBe(newFac.id);
    expect(newKid.position).toEqual({ x: 60, y: 60 });   // relative — unchanged
    // factories must precede children in the array (React Flow constraint)
    expect(nodes.indexOf(newFac)).toBeLessThan(nodes.indexOf(newKid));
  });

  it('copying a child without its factory pastes it as a free node at absolute position', () => {
    const factory: Node = {
      id: 'fac', type: 'factoryNode', position: { x: 100, y: 100 },
      data: { label: 'F', color: '#fff' },
    };
    const child: Node = {
      ...recipeNode('kid', ingotRecipe, 1),
      parentId: 'fac', extent: 'parent' as const, position: { x: 60, y: 60 }, selected: true,
    };
    setGraph([factory, child], []);

    usePlannerStore.getState().copySelection();
    usePlannerStore.getState().pasteClipboard();

    const pasted = usePlannerStore.getState().nodes.find(n => n.selected)!;
    expect(pasted.parentId).toBeUndefined();
    expect(pasted.position).toEqual({ x: 100 + 60 + 48, y: 100 + 60 + 48 });
  });
});

// ── Sheets ────────────────────────────────────────────────────────

describe('sheets', () => {
  it('switching sheets preserves each canvas', () => {
    setGraph([sourceNode('src', 'Iron Ore', 30)], []);
    const st = usePlannerStore.getState();

    st.addSheet();   // empty new sheet, becomes active
    expect(usePlannerStore.getState().nodes).toHaveLength(0);
    expect(usePlannerStore.getState().sheets).toHaveLength(2);

    usePlannerStore.getState().switchSheet('s1');
    expect(usePlannerStore.getState().nodes.map(n => n.id)).toEqual(['src']);
  });

  it('copy on one sheet, paste on another', () => {
    setGraph(
      [
        { ...sourceNode('src', 'Iron Ore', 30), selected: true },
        { ...recipeNode('smelt', ingotRecipe, 1), selected: true },
      ],
      [srcEdge('src', 'smelt', 'Iron Ore')]
    );
    const st = usePlannerStore.getState();
    st.copySelection();
    st.addSheet();
    usePlannerStore.getState().pasteClipboard();

    const { nodes, edges } = usePlannerStore.getState();
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    // sheet 1 untouched
    usePlannerStore.getState().switchSheet('s1');
    expect(usePlannerStore.getState().nodes).toHaveLength(2);
  });

  it('never deletes the last sheet; deleting the active sheet activates a neighbour', () => {
    const st = usePlannerStore.getState();
    st.deleteSheet('s1');
    expect(usePlannerStore.getState().sheets).toHaveLength(1);

    st.addSheet();
    const newId = usePlannerStore.getState().activeSheetId;
    usePlannerStore.getState().deleteSheet(newId);
    expect(usePlannerStore.getState().sheets).toHaveLength(1);
    expect(usePlannerStore.getState().activeSheetId).toBe('s1');
  });

  it('rename changes the sheet name', () => {
    usePlannerStore.getState().renameSheet('s1', 'Steel Plant');
    expect(usePlannerStore.getState().sheets[0].name).toBe('Steel Plant');
  });
});

// ── Task 5: floating point hygiene ───────────────────────────────

describe('floating point hygiene', () => {
  it('round4 removes float tails', () => {
    expect(round4(0.1 + 0.2)).toBe(0.3);
    expect(round4(59.99999999)).toBe(60);
  });

  it('scaling by a non-terminating ratio leaves no float tails in stored data', () => {
    setGraph(
      [sourceNode('src', 'Iron Ore', 30), recipeNode('smelt', ingotRecipe, 1.1)],
      [srcEdge('src', 'smelt', 'Iron Ore')]
    );

    // ratio 1.1 / 3 style multiplications are classic float-tail producers
    usePlannerStore.getState().scaleConnectedNodes('src', 1.1);
    const count = getData<RecipeNodeData>('smelt').machineCount;
    expect(count).toBe(round4(count));
    expect(String(count).length).toBeLessThanOrEqual(7); // e.g. "1.21"
  });
});
