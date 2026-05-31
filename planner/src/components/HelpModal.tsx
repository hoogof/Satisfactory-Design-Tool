import { useEffect } from 'react';

interface Props {
  onClose: () => void;
}

interface Section {
  icon: string;
  title: string;
  body: string;
  kbd?: string;
}

const SECTIONS: Section[] = [
  {
    icon: '⚙',
    title: 'Nodes — Machines',
    body: 'Each node represents a production machine (Smelter, Constructor, Assembler, etc.). Pick a recipe from the dropdown, set how many machines are running, and connect inputs/outputs to other nodes. Edge colour shows whether supply meets demand — green means satisfied, red means a deficit.',
  },
  {
    icon: '🪨',
    title: 'Sources — Raw Resources',
    body: 'Source nodes represent raw resource extractors (miners, pumps). Set the resource type and extraction rate. Every chain should start from a source. Drag one from the sidebar or click the "+ Source" button.',
  },
  {
    icon: '⇌',
    title: 'Router — Splitter / Merger',
    body: 'The Router node lets you split one stream into many, or merge multiple streams into one. Once an input is connected the item type is locked — all inputs must carry the same resource. Set the output rate for each port; the summary bar warns you if total out exceeds total in.',
  },
  {
    icon: '🏭',
    title: 'Factories — Compartmentalise',
    body: 'Select multiple nodes (click + drag or Shift-click), then press "New Factory" in the sidebar. The selected nodes are wrapped in a labelled factory block. Factory border handles let you connect the encapsulated outputs directly to external nodes or routers.',
    kbd: 'Shift + drag to select',
  },
  {
    icon: '🔍',
    title: 'Recipe Search',
    body: 'Quickly find any recipe by name or output item. The search is grouped by produced item for easy browsing. Click a result to instantly add that machine node to the canvas.',
    kbd: 'N',
  },
  {
    icon: '⛓',
    title: 'Auto-Scale',
    body: 'When enabled, changing a node\'s machine count automatically scales all connected downstream (and upstream) nodes by the same ratio, keeping your production chain balanced. Toggle it off if you want to adjust counts manually without cascading changes.',
  },
  {
    icon: '🗺',
    title: 'MiniMap Navigation',
    body: 'Click anywhere on the minimap (bottom-right) to jump the viewport to that area. You can also scroll on the minimap to zoom. Use the Controls panel to fit the whole canvas in view.',
  },
  {
    icon: '💾',
    title: 'Saves',
    body: 'Your canvas is auto-saved in the browser every time you make a change. Use the Saves panel in the sidebar to name and keep multiple save slots, load a previous session, or export/import JSON to share a design.',
  },
];

export function HelpModal({ onClose }: Props) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="help__overlay" onClick={onClose}>
      <div className="help__modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="help__header">
          <div className="help__title-row">
            <span className="help__title">
              <span className="help__title-op">Op</span><span className="help__title-tim">tim</span>
              {' '}— How it works
            </span>
            <button className="help__close" onClick={onClose} title="Close (Esc)">✕</button>
          </div>
          <p className="help__subtitle">Satisfactory Factory Planner — quick reference</p>
        </div>

        {/* Sections */}
        <div className="help__body">
          <div className="help__grid">
            {SECTIONS.map(s => (
              <div key={s.title} className="help__card">
                <div className="help__card-header">
                  <span className="help__card-icon">{s.icon}</span>
                  <span className="help__card-title">{s.title}</span>
                  {s.kbd && <kbd className="help__kbd">{s.kbd}</kbd>}
                </div>
                <p className="help__card-body">{s.body}</p>
              </div>
            ))}
          </div>

          {/* Feedback banner */}
          <div className="help__feedback">
            <span className="help__feedback-icon">🚧</span>
            <span className="help__feedback-text">
              Optim is actively in development. If you run into any issues or have suggestions,
              we'd love to hear from you!
            </span>
            <a
              href="https://forms.gle/j8RU9Yzc2E9ixHsa7"
              target="_blank"
              rel="noopener noreferrer"
              className="help__feedback-link"
              onClick={e => e.stopPropagation()}
            >
              Leave feedback ↗
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="help__footer">
          Press <kbd className="help__kbd">Esc</kbd> or click outside to close
        </div>
      </div>
    </div>
  );
}
