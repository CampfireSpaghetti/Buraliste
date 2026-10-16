import { useEffect, useState } from 'react';
import { TabBar, TABS, type Tab } from './ui/TabBar';
import { Carotte } from './ui/Carotte';
import { NavProvider, useNav, type View } from './nav';
import { SCAN_OK_EVENT } from './features/scanner/feedback';
import { ScannerScreen } from './features/scanner/ScannerScreen';
import { ProductSheet } from './features/catalog/ProductSheet';
import { ProductForm } from './features/catalog/ProductForm';
import { AttachToReference } from './features/catalog/AttachToReference';
import { CatalogScreen } from './features/catalog/CatalogScreen';
import { CompareView } from './features/catalog/CompareView';
import { useSettings } from './store';
import './ui/panel.css';

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

function ViewLayer({ view }: { view: View }) {
  switch (view.type) {
    case 'product': return <ProductSheet id={view.id} />;
    case 'create': return <ProductForm initialCode={view.code} initialKind={view.kind} />;
    case 'edit': return <ProductForm id={view.id} />;
    case 'attach': return <AttachToReference code={view.code} />;
    case 'compare': return <CompareView ids={view.ids} />;
  }
}

function Shell() {
  const [tab, setTab] = useState<Tab>(readHash);
  const [bounce, setBounce] = useState(0);
  const nav = useNav();
  const settings = useSettings();
  useEffect(() => {
    const onHash = () => setTab(readHash());
    const onScan = () => setBounce((n) => n + 1);
    window.addEventListener('hashchange', onHash);
    window.addEventListener(SCAN_OK_EVENT, onScan);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener(SCAN_OK_EVENT, onScan);
    };
  }, []);
  const go = (t: Tab) => {
    if (location.hash !== '#' + t) location.hash = t;
    nav.closeAll();
    setTab(t);
  };
  return (
    <div className="app">
      <header className="app-header">
        <Carotte bounce={bounce} />
        <div>
          <h1>LA CAROTTE</h1>
          <small>{settings?.shopName ?? ''} · {TITLES[tab]}</small>
        </div>
      </header>
      <main className={'app-main tab-' + tab}>
        <h2 className="screen-title">{TITLES[tab]}</h2>
        {tab === 'scanner' && <ScannerScreen />}
        {tab === 'catalogue' && <CatalogScreen />}
      </main>
      <TabBar current={tab} onChange={go} />
      {nav.stack.map((v, i) => <ViewLayer key={i} view={v} />)}
    </div>
  );
}

export default function App() {
  return (
    <NavProvider>
      <Shell />
    </NavProvider>
  );
}
