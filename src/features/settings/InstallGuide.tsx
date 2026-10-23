import { useState } from 'react';
import { Panel } from '../../ui/Panel';
import './settings.css';

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12M8 7l4-4 4 4M5 11v9h14v-9" />
  </svg>
);
const DotsIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
);
/** Bouton « Menu de la page » de Safari (iOS 26 et suivants) : trois points dans un rond, à côté de l'adresse. */
const PageMenuIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor">
    <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="7.5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="16.5" cy="12" r="1.6" />
  </svg>
);

const APP_URL = location.origin + import.meta.env.BASE_URL;
const isIos = () => {
  try {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  } catch {
    return false;
  }
};

function IphoneSteps() {
  return (
    <section className="card install-card">
      <h3>iPhone (Safari)</h3>
      <ol className="steps">
        <li>Ouvrez l'adresse de l'app dans <b>Safari</b>.</li>
        <li>Touchez le bouton <b>Menu de la page</b> <PageMenuIcon /> à côté de l'adresse, puis <b>« Partager »</b> <ShareIcon />.</li>
        <li>Faites défiler la liste et touchez <b>« Sur l'écran d'accueil »</b>.</li>
        <li>Laissez <b>« Ouvrir comme app web »</b> activé, puis touchez <b>Ajouter</b>.</li>
      </ol>
      <details className="install-help">
        <summary>Je ne trouve pas ces boutons</summary>
        <ul>
          <li><b>Le lien s'est ouvert dans WhatsApp, Messages, Gmail…</b> : ce n'est pas Safari. Touchez « Ouvrir dans Safari » (ou la boussole), ou copiez l'adresse ci-dessous et collez-la dans Safari.</li>
          <li><b>Pas de Menu de la page</b> : si les onglets de Safari sont « En bas » ou « En haut », le bouton Partager <ShareIcon /> est directement dans la barre.</li>
          <li><b>« Sur l'écran d'accueil » absent</b> : tout en bas de la liste, touchez « Modifier les actions », puis ajoutez « Sur l'écran d'accueil ».</li>
          <li><b>iOS 18 ou plus ancien</b> : bouton Partager <ShareIcon /> en bas de l'écran, puis « Sur l'écran d'accueil » et Ajouter.</li>
        </ul>
      </details>
      <p className="muted">À la première utilisation du scanner, autorisez l'appareil photo. iOS peut redemander cette autorisation de temps en temps : c'est normal.</p>
    </section>
  );
}

function AndroidSteps() {
  return (
    <section className="card install-card">
      <h3>Android (Chrome)</h3>
      <ol className="steps">
        <li>Ouvrez l'adresse de l'app dans <b>Chrome</b>.</li>
        <li>Touchez le menu <DotsIcon />.</li>
        <li>Choisissez <b>« Installer l'application »</b> (ou « Ajouter à l'écran d'accueil »).</li>
      </ol>
    </section>
  );
}

export function InstallGuide({ onClose }: { onClose: () => void }) {
  const ios = isIos();
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(APP_URL);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Panel title="Installer sur mon téléphone" onClose={onClose}>
      <p style={{ margin: 0 }}>Une fois installée, La Carotte a son icône sur l'écran d'accueil, s'ouvre en plein écran et fonctionne sans connexion. C'est gratuit et sans store.</p>
      {ios ? <><IphoneSteps /><AndroidSteps /></> : <><AndroidSteps /><IphoneSteps /></>}
      <div className="card install-url">
        <span className="muted">Adresse de l'app</span>
        <span className="num install-url-value">{APP_URL}</span>
        <button type="button" className="btn" onClick={() => void copy()}>{copied ? 'Adresse copiée' : "Copier l'adresse"}</button>
        {copied === false && <span className="muted">Copie impossible : sélectionnez l'adresse ci-dessus.</span>}
      </div>
      <p className="muted">Pensez à faire une sauvegarde complète chaque semaine (Réglages) et à l'envoyer sur Drive.</p>
    </Panel>
  );
}
