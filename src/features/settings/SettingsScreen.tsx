import { useEffect, useRef, useState } from 'react';
import { restoreFromText } from '../../data/backupData';
import { parseBackup } from '../../domain/backup';
import { formatDateLong, formatIsoDateFr } from '../../domain/format';
import { actions, notifyDataChanged, useProducts, useSettings } from '../../store';
import { relayUrl } from '../../sync/relayConfig';
import { Sheet } from '../../ui/Panel';
import { Toast } from '../../ui/Toast';
import { BackupPanel } from './BackupPanel';
import { InstallGuide } from './InstallGuide';
import './settings.css';

export function SettingsScreen() {
  const settings = useSettings();
  const products = useProducts();
  const [name, setName] = useState<string | null>(null);
  const [backup, setBackup] = useState(false);
  const [install, setInstall] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (settings && name === null) setName(settings.shopName); }, [settings, name]);
  if (!settings) return null;
  const official = (products ?? []).filter((p) => p.source === 'douane').length;
  const fdjGames = (products ?? []).filter((p) => p.source === 'fdj' && p.base.status !== 'retrait').length;

  const saveName = () => { if (name !== null && name.trim() && name.trim() !== settings.shopName) void actions.saveSettings({ shopName: name.trim() }); };

  const onFile = async (f: File | undefined) => {
    setError(undefined);
    if (!f) return;
    const text = await f.text();
    // Vérification avant de demander confirmation : un fichier refusé ne propose même pas de remplacer.
    const r = parseBackup(text);
    if (!r.ok) setError(r.error);
    else setPending(text);
    if (fileRef.current) fileRef.current.value = '';
  };

  const confirmRestore = async () => {
    const text = pending!;
    setPending(null);
    const r = await restoreFromText(text);
    if (!r.ok) { setError(r.error); return; }
    notifyDataChanged();
    setName(null);
    setToast('Données restaurées');
  };

  return (
    <div className="settings">
      <label className="field-label">
        Nom du tabac
        <input className="input" id="shop-name" value={name ?? ''} onChange={(e) => setName(e.target.value)} onBlur={saveName}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </label>
      <p className="muted hint">Affiché en tête des exports du comptage.</p>

      <span className="label">Sauvegarde</span>
      <div className="row">
        <button type="button" className="btn accent" onClick={() => setBackup(true)}>Sauvegarde complète</button>
        <label className="btn file-btn">
          Restaurer…
          <input ref={fileRef} type="file" accept="application/json,.json" aria-label="Choisir une sauvegarde" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
      </div>
      <p className="muted hint">{settings.lastBackupAt ? `Dernière sauvegarde : ${formatDateLong(settings.lastBackupAt)}` : 'Aucune sauvegarde pour l’instant.'}</p>
      {error && <p className="error" role="alert">{error}</p>}

      <span className="label">Liste officielle des tabacs</span>
      <p className="muted hint">
        Douane{settings.referencesEffectiveDate ? ` · En vigueur au ${formatIsoDateFr(settings.referencesEffectiveDate)}` : ''} · {official.toLocaleString('fr-FR')} références · mise à jour automatique chaque semaine
      </p>

      <span className="label">Jeux de grattage FDJ</span>
      <p className="muted hint">
        Gamme en point de vente (fdj.fr){settings.fdjFetchedAt ? ` · liste du ${formatIsoDateFr(settings.fdjFetchedAt)}` : ''} · {fdjGames} jeux · mise à jour automatique chaque semaine
      </p>

      <span className="label">Partage</span>
      {relayUrl() ? (
        <p className="muted hint">
          Les codes-barres scannés enrichissent automatiquement la liste commune.
          {settings.lastShareAt ? ` Dernier envoi : ${formatDateLong(settings.lastShareAt)}.` : ''}
        </p>
      ) : (
        <p className="muted hint">Partage entre téléphones : bientôt disponible</p>
      )}

      <button type="button" className="btn" onClick={() => setInstall(true)}>Installer sur mon téléphone</button>
      <p className="muted hint">
        Vos données restent sur ce téléphone. Seuls partent : les fichiers que vous partagez vous-même et, si le partage
        est disponible, les codes-barres rattachés aux produits officiels (aucun compte, aucune clé sur le téléphone).
      </p>

      {backup && <BackupPanel onClose={() => setBackup(false)} />}
      {install && <InstallGuide onClose={() => setInstall(false)} />}
      {pending && (
        <Sheet label="Restaurer" onClose={() => setPending(null)}>
          <h3>Remplacer toutes les données ?</h3>
          <p className="muted" style={{ margin: 0 }}>Le catalogue, le comptage et les réglages actuels seront remplacés par ceux de la sauvegarde.</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => setPending(null)}>Annuler</button>
            <button type="button" className="btn danger" onClick={confirmRestore}>Remplacer</button>
          </div>
        </Sheet>
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} ms={3000} />}
    </div>
  );
}
