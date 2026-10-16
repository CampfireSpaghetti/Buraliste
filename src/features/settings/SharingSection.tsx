import { useCallback, useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { checkToken, flushOutbox, pendingCount } from '../../data/sharingData';
import { formatDateLong } from '../../domain/format';
import { encodePairing } from '../../domain/sharing';
import type { Settings } from '../../domain/types';
import { GITHUB_REPO } from '../../data/sharingData';
import { actions, notifyDataChanged } from '../../store';
import { Panel } from '../../ui/Panel';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';
const STATUS_TEXT: Record<NonNullable<Settings['shareStatus']>, string> = {
  ok: '',
  'cle-refusee': 'Clé refusée par GitHub : elle a peut-être expiré. Désactivez puis réactivez le partage avec une nouvelle clé.',
  'hors-ligne': 'Pas de réseau au dernier essai : les codes partiront tout seuls au retour de la connexion.',
  erreur: 'GitHub n’a pas répondu correctement : nouvel essai automatique plus tard.',
};

function usePending(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const refresh = () => void pendingCount().then(setN);
    refresh();
    window.addEventListener('carotte:data', refresh);
    return () => window.removeEventListener('carotte:data', refresh);
  }, []);
  return n;
}

export function SharingSection({ settings }: { settings: Settings }) {
  const pending = usePending();
  const [form, setForm] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState(false);
  const active = !!settings.shareToken;

  const activate = async () => {
    setBusy(true);
    setError(undefined);
    const ok = await checkToken(token.trim());
    setBusy(false);
    if (!ok) {
      setError('Clé refusée par GitHub. Vérifiez qu’elle donne accès au seul dépôt Buraliste avec le droit « Issues : lecture et écriture », puis réessayez.');
      return;
    }
    await actions.saveSettings({ shareToken: token.trim(), shareStatus: 'ok' });
    setForm(false);
    setToken('');
    void flushOutbox().then(notifyDataChanged);
  };

  const sendNow = useCallback(async () => {
    setBusy(true);
    await flushOutbox();
    setBusy(false);
    notifyDataChanged();
  }, []);

  return (
    <section className="sharing" aria-label="Partage des codes-barres">
      <span className="label">Partage des codes-barres</span>
      <p className="share-state">
        <b>Partage des codes : {active ? 'activé' : 'désactivé'}</b>
        <br />
        <span className="muted">
          {pending} code{pending > 1 ? 's' : ''} en attente
          {settings.lastShareAt ? ` · dernier envoi : ${formatDateLong(settings.lastShareAt)}` : ''}
        </span>
      </p>
      {active && settings.shareStatus && STATUS_TEXT[settings.shareStatus] && <p className="error" role="alert">{STATUS_TEXT[settings.shareStatus]}</p>}
      <p className="muted hint">
        Quand le partage est activé, chaque code-barres rattaché à un produit officiel (et chaque code de jeu appris) part
        automatiquement vers la liste publique commune. Rien d’autre ne part : ni comptages, ni stocks, ni prix, ni nom du tabac.
      </p>

      {active ? (
        <div className="row">
          <button type="button" className="btn" disabled={busy || pending === 0} onClick={sendNow}>Envoyer maintenant</button>
          <button type="button" className="btn" onClick={() => setPairing(true)}>Jumeler un autre téléphone</button>
          <button type="button" className="btn ghost" onClick={() => actions.saveSettings({ shareToken: undefined, shareStatus: undefined })}>Désactiver le partage</button>
        </div>
      ) : form ? (
        <form className="share-form" onSubmit={(e) => { e.preventDefault(); if (token.trim()) void activate(); }}>
          <ol className="steps">
            <li>Sur GitHub, ouvrez <a href={TOKEN_URL} target="_blank" rel="noreferrer">Nouvelle clé d’accès (fine-grained)</a>.</li>
            <li>Nom : « La Carotte ». Expiration : 1 an.</li>
            <li><b>Repository access</b> : « Only select repositories » → <b>Buraliste</b>.</li>
            <li><b>Permissions</b> → Repository permissions → <b>Issues : Read and write</b>. Rien d’autre.</li>
            <li>« Generate token », copiez la clé et collez-la ci-dessous.</li>
          </ol>
          <label className="field-label">
            Clé GitHub
            <input className="input" id="share-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row">
            <button type="button" className="btn" onClick={() => setForm(false)}>Annuler</button>
            <button type="submit" className="btn accent" disabled={busy || !token.trim()}>Vérifier et activer</button>
          </div>
          <p className="muted hint">La clé reste dans ce téléphone : elle n’est jamais incluse dans les sauvegardes.</p>
        </form>
      ) : (
        <button type="button" className="btn" onClick={() => setForm(true)}>Activer le partage</button>
      )}

      {pairing && settings.shareToken && <PairingPanel token={settings.shareToken} shop={settings.shopName} onClose={() => setPairing(false)} />}
    </section>
  );
}

function PairingPanel({ token, shop, onClose }: { token: string; shop: string; onClose: () => void }) {
  const qr = qrcode(0, 'M');
  qr.addData(encodePairing({ token, repo: GITHUB_REPO, shop }));
  qr.make();
  return (
    <Panel title="Jumeler un autre téléphone" onClose={onClose}>
      <p style={{ margin: 0 }}>Sur l’autre téléphone, ouvrez La Carotte, onglet <b>Scanner</b>, et visez ce QR code. Le partage s’active tout seul.</p>
      <img className="pairing-qr" src={qr.createDataURL(6, 4)} alt="QR code de jumelage" />
      <p className="error" style={{ fontWeight: 600 }}>Ne montrez ce QR code qu’à vos employés : il permet d’ajouter des codes à votre liste.</p>
    </Panel>
  );
}
