import { useState } from 'react';
import qrcode from 'qrcode-generator';
import { relayUrl } from '../../sync/relayConfig';
import { syncSentence, SYNC_LABELS } from '../../sync/statusLabels';
import { dbTabacId } from '../../data/db';
import { encodeTabacInvite, listTabacs } from '../../tabacs/registry';
import { testModeEnabled } from '../../testHooks';
import { Panel } from '../../ui/Panel';
import { useSyncStatus } from '../../ui/SyncDot';
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
      <span className={'sync-dot sync-' + status} aria-hidden="true" /> Synchronisation : {SYNC_LABELS[status]}. {syncSentence(status)}
    </p>
  );
}

function InvitePanel({ shopName, onClose }: { shopName: string; onClose: () => void }) {
  // La clé du tabac ouvert par cette page, jamais celle d'un autre.
  const tabac = listTabacs().find((t) => t.id === dbTabacId);
  if (!tabac) {
    return (
      <Panel title="Inviter un employé" onClose={onClose}>
        <p style={{ margin: 0 }}>Ce tabac a été retiré de ce téléphone.</p>
      </Panel>
    );
  }
  // Le nom partagé (réglages) plutôt que celui du registre, au cas où il n'aurait pas encore été recopié.
  const payload = encodeTabacInvite({ name: (shopName.trim() || tabac.name).slice(0, 80), key: tabac.key });
  const qr = qrcode(0, 'M');
  qr.addData(payload);
  qr.make();
  return (
    <Panel title="Inviter un employé" onClose={onClose}>
      <p style={{ margin: 0 }}>
        Sur le téléphone de l’employé : ouvrez La Carotte, onglet <b>Scanner</b>, et visez ce QR code. Il rejoint le tabac
        « {shopName || tabac.name} », sans compte ni mot de passe.
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
