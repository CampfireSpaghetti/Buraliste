import { useState } from 'react';
import qrcode from 'qrcode-generator';
import { relayUrl } from '../../sync/relayConfig';
import { syncSentence, SYNC_LABELS } from '../../sync/statusLabels';
import { dbTabacId } from '../../data/db';
import { encodeTabacInvite, listTabacs } from '../../tabacs/registry';
import { testModeEnabled } from '../../testHooks';
import { Panel } from '../../ui/Panel';
import { Dot, useSyncStatus } from '../../ui/SyncDot';
import { DEFAULT_TABAC_NAME } from '../../tabacs/registry';
import { actions } from '../../store';
import { Toast } from '../../ui/Toast';

/**
 * Réglages, partage du tabac : inviter un employé (QR code qui contient la clé du tabac) et état de la synchronisation.
 * Le nom du tabac (partagé) se change dans le champ « Nom du tabac » au-dessus.
 */
export function TabacSection({ shopName }: { shopName: string }) {
  const relay = !!relayUrl();
  const [invite, setInvite] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  return (
    <>
      <button type="button" className="btn" onClick={() => (relay ? setInvite(true) : setToast('Bientôt disponible'))}>
        Inviter un employé
      </button>
      {relay ? <SyncState /> : <p className="muted hint">Partage entre téléphones : bientôt disponible</p>}
      {invite && <InvitePanel shopName={shopName} onClose={() => setInvite(false)} />}
      {toast && <Toast message={toast} onDone={() => setToast(null)} ms={3000} />}
    </>
  );
}

function SyncState() {
  const status = useSyncStatus();
  if (status === 'refuse') {
    return (
      <div className="sync-state">
        <p className="error" role="alert">{syncSentence(status)}</p>
        <p className="muted hint">Les données restent sur ce téléphone.</p>
      </div>
    );
  }
  return (
    <p className={'muted hint sync-state sync-' + status}>
      <Dot status={status} /> Synchronisation : {status === 'connexion' ? SYNC_LABELS[status] : `${SYNC_LABELS[status]}. ${syncSentence(status)}`}
    </p>
  );
}

function InvitePanel({ shopName, onClose }: { shopName: string; onClose: () => void }) {
  // Un nom choisi ici remplace tout de suite le nom par défaut (les réglages se rechargent ensuite).
  const [named, setNamed] = useState<string | null>(null);
  const name = named ?? shopName;
  // La clé du tabac ouvert par cette page, jamais celle d'un autre.
  const tabac = listTabacs().find((t) => t.id === dbTabacId);
  if (!tabac) {
    return (
      <Panel title="Inviter un employé" onClose={onClose}>
        <p style={{ margin: 0 }}>Ce tabac a été retiré de ce téléphone.</p>
      </Panel>
    );
  }
  // Tous les tabacs s'appellent « Mon tabac » tant qu'on ne les a pas nommés : l'employé ne pourrait pas les distinguer.
  if (!name.trim() || name === DEFAULT_TABAC_NAME) {
    return (
      <Panel title="Inviter un employé" onClose={onClose}>
        <NameFirst onNamed={setNamed} />
      </Panel>
    );
  }
  const payload = encodeTabacInvite({ name: name.trim().slice(0, 80), key: tabac.key });
  const qr = qrcode(0, 'M');
  qr.addData(payload);
  qr.make();
  return (
    <Panel title="Inviter un employé" onClose={onClose}>
      <p style={{ margin: 0 }}>
        Sur le téléphone de l’employé : ouvrez La Carotte, onglet <b>Scanner</b>, et visez ce QR code. Il rejoint le tabac
        « {name} », sans compte ni mot de passe.
      </p>
      <img
        className="invite-qr"
        src={qr.createDataURL(6, 4)}
        alt="QR code d’invitation au tabac"
        {...(testModeEnabled() ? { 'data-invite': payload } : {})}
      />
      <p className="error">Toute personne qui scanne ce QR code accède aux données du tabac.</p>
      <p className="muted" style={{ margin: 0 }}>Ne le montrez qu’aux personnes qui travaillent dans le tabac.</p>
    </Panel>
  );
}

function NameFirst({ onNamed }: { onNamed: (name: string) => void }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const n = value.trim();
  const ok = n.length > 0 && n !== DEFAULT_TABAC_NAME;
  const submit = async () => {
    if (!ok || saving) return;
    setSaving(true);
    try {
      // Nom partagé : il apparaît aussi sur les téléphones des employés et en tête des exports.
      await actions.saveSettings({ shopName: n.slice(0, 80) });
      onNamed(n.slice(0, 80));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="tabac-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p style={{ margin: 0 }}>D’abord, donnez un nom à votre tabac : vos employés le verront sur leur téléphone.</p>
      <label className="field-label">
        Nom du tabac à afficher sur les téléphones
        <input className="input" autoFocus maxLength={80} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Ex. : Tabac de la Gare" />
      </label>
      <button type="submit" className="btn accent" disabled={!ok || saving}>Afficher le QR code</button>
    </form>
  );
}
