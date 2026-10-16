import { useEffect, useState } from 'react';
import { TabBar, TABS, type Tab } from './ui/TabBar';
import { Carotte } from './ui/Carotte';

const TITLES: Record<Tab, string> = {
  scanner: 'Scanner',
  catalogue: 'Catalogue',
  grattage: 'Comptage grattage',
  reglages: 'Réglages',
};

function readHash(): Tab {
  const h = location.hash.replace('#', '');
  return (TABS.find((t) => t.id === h)?.id ?? 'grattage') as Tab;
}

export default function App() {
  const [tab, setTab] = useState<Tab>(readHash);
  useEffect(() => {
    const onHash = () => setTab(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (t: Tab) => {
    if (location.hash !== '#' + t) location.hash = t;
    setTab(t);
  };
  return (
    <div className="app">
      <header className="app-header">
        <Carotte />
        <div>
          <h1>LA CAROTTE</h1>
          <small>{TITLES[tab]}</small>
        </div>
      </header>
      <main className="app-main">
        <h2 className="screen-title">{TITLES[tab]}</h2>
      </main>
      <TabBar current={tab} onChange={go} />
    </div>
  );
}
