import './tabbar.css';

export type Tab = 'scanner' | 'catalogue' | 'grattage' | 'reglages';

export const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'scanner', label: 'Scanner', icon: 'M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M7 8v8M10 8v8M13 8v8M16 8v8' },
  { id: 'catalogue', label: 'Catalogue', icon: 'M4 5h16M4 12h16M4 19h10' },
  { id: 'grattage', label: 'Grattage', icon: 'M4 4h16v16H4zM4 10h16M10 10v10' },
  { id: 'reglages', label: 'Réglages', icon: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1' },
];

export function TabBar({ current, onChange }: { current: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="tabbar" aria-label="Onglets">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={'tab' + (t.id === current ? ' on' : '')}
          aria-current={t.id === current ? 'page' : undefined}
          onClick={() => onChange(t.id)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={t.icon} /></svg>
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
