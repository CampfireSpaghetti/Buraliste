import { Panel } from '../../ui/Panel';

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12M8 7l4-4 4 4M5 11v9h14v-9" />
  </svg>
);
const DotsIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
);

export function InstallGuide({ onClose }: { onClose: () => void }) {
  return (
    <Panel title="Installer sur mon téléphone" onClose={onClose}>
      <p style={{ margin: 0 }}>Une fois installée, La Carotte a son icône sur l'écran d'accueil, s'ouvre en plein écran et fonctionne sans connexion. C'est gratuit et sans store.</p>
      <section className="card">
        <h3>iPhone (Safari)</h3>
        <ol className="steps">
          <li>Ouvrez l'adresse de l'app dans <b>Safari</b>.</li>
          <li>Touchez le bouton Partager <ShareIcon />.</li>
          <li>Choisissez <b>« Sur l'écran d'accueil »</b>, puis <b>Ajouter</b>.</li>
        </ol>
        <p className="muted">À la première utilisation du scanner, autorisez l'appareil photo. iOS peut redemander cette autorisation de temps en temps : c'est normal.</p>
      </section>
      <section className="card">
        <h3>Android (Chrome)</h3>
        <ol className="steps">
          <li>Ouvrez l'adresse de l'app dans <b>Chrome</b>.</li>
          <li>Touchez le menu <DotsIcon />.</li>
          <li>Choisissez <b>« Installer l'application »</b> (ou « Ajouter à l'écran d'accueil »).</li>
        </ol>
      </section>
      <p className="muted">Pensez à faire une sauvegarde complète chaque semaine (Réglages) et à l'envoyer sur Drive.</p>
    </Panel>
  );
}
