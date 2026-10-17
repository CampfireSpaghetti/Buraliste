import { useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { relayUrl } from '../../sync/relayConfig';
import { syncSentence, SYNC_LABELS } from '../../sync/statusLabels';
import { dbTabacId } from '../../data/db';
import { inviteFor } from '../../tabacs/inviteFor';
import { inviteLink } from '../../tabacs/inviteLink';
import { DEFAULT_TABAC_NAME, listTabacs } from '../../tabacs/registry';
import { testModeEnabled } from '../../testHooks';
import { Panel } from '../../ui/Panel';
import { Dot, useSyncStatus } from '../../ui/SyncDot';
import { addedOn } from '../../ui/TabacSwitcher';
import { actions } from '../../store';
import { Toast } from '../../ui/Toast';

/**
 * Réglages, partage du tabac : inviter un employé (QR code ou lien par message, qui contiennent la clé du tabac) et état
 * de la synchronisation. Le nom du tabac (partagé) se change dans le champ « Nom du tabac » au-dessus.
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

type Invite = { tabacId: string; name: string; payload: string };

/**
 * QR code d'invitation affiché tout de suite, pour le tabac de la page ; avec plusieurs tabacs sur le téléphone, on
 * choisit lequel (chacun a sa propre clé). `shopName` : nom du tabac de la page (réglages), pour suivre un renommage.
 */
function InvitePanel({ shopName, onClose }: { shopName: string; onClose: () => void }) {
  const tabacs = listTabacs();
  const [selected, setSelected] = useState(() => (tabacs.some((t) => t.id === dbTabacId) ? dbTabacId : tabacs[0].id));
  const [invite, setInvite] = useState<Invite | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [manual, setManual] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    setManual(null);
    inviteFor(selected).then(
      (r) => alive && setInvite({ tabacId: selected, ...r }),
      () => alive && setFailed(true),
    );
    return () => { alive = false; };
  }, [selected, shopName, version]);

  // Le QR code d'un autre tabac n'est jamais montré sous le nom de celui qu'on vient de choisir.
  const shown = invite?.tabacId === selected ? invite : null;
  const isPage = selected === dbTabacId;

  const share = async () => {
    if (!shown) return;
    const url = inviteLink(shown.payload, location.origin + import.meta.env.BASE_URL);
    const text = `Rejoins le tabac « ${shown.name} » sur La Carotte : ouvre ce lien sur ton téléphone.`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'La Carotte', text, url });
        return;
      } catch (e) {
        if ((e as { name?: string } | null)?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setToast('Lien copié : collez-le dans un message à votre employé.');
    } catch {
      // Ni partage ni copie automatique : le lien est affiché pour être copié à la main.
      setManual(url);
    }
  };

  let qrSrc = '';
  if (shown) {
    const qr = qrcode(0, 'M');
    qr.addData(shown.payload);
    qr.make();
    qrSrc = qr.createDataURL(6, 4);
  }

  return (
    <Panel title="Inviter un employé" onClose={onClose}>
      {tabacs.length > 1 && (
        <fieldset className="invite-choice">
          <legend>Inviter dans quel tabac ?</legend>
          {tabacs.map((t) => (
            <label key={t.id} className={'tabac-item' + (t.id === selected ? ' on' : '')}>
              <input type="radio" name="invite-tabac" value={t.id} checked={t.id === selected} onChange={() => setSelected(t.id)} />
              <span className="tabac-text">
                <span className="tabac-name">{t.id === dbTabacId ? shopName || t.name : t.name}</span>
                <span className="tabac-added">{addedOn(t.addedAt)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {failed ? (
        <p className="error" role="alert">Le QR code n’a pas pu être préparé. Fermez puis réessayez.</p>
      ) : !shown ? (
        <p className="muted" role="status" style={{ margin: 0 }}>Préparation du QR code…</p>
      ) : (
        <>
          {shown.name === DEFAULT_TABAC_NAME && (
            <RenameNote isPage={isPage} onRenamed={() => setVersion((v) => v + 1)} />
          )}
          <p style={{ margin: 0 }}>
            Sur le téléphone de l’employé : ouvrez La Carotte, onglet <b>Scanner</b>, et visez ce QR code. Il rejoint le tabac
            « {shown.name} », sans compte ni mot de passe.
          </p>
          <img
            className="invite-qr"
            src={qrSrc}
            alt="QR code d’invitation au tabac"
            {...(testModeEnabled() ? { 'data-invite': shown.payload } : {})}
          />
          <p className="error">Toute personne qui scanne ce QR code accède aux données du tabac.</p>
          <p className="muted" style={{ margin: 0 }}>Ne le montrez qu’aux personnes qui travaillent dans le tabac.</p>
          <button type="button" className="btn accent" onClick={() => void share()}>Envoyer l’invitation par message</button>
          <p className="muted" style={{ margin: 0 }}>
            Ce lien donne accès au tabac : envoyez-le seulement à vos employés, et supprimez le message ensuite si possible.
          </p>
          {manual && (
            <label className="field-label">
              Lien à copier dans un message
              <input className="input" readOnly value={manual} onFocus={(e) => e.currentTarget.select()} />
            </label>
          )}
        </>
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} ms={4000} />}
    </Panel>
  );
}

/** Tabac encore nommé « Mon tabac » : l'employé ne pourrait pas le reconnaître. Renommer ici seulement le tabac ouvert. */
function RenameNote({ isPage, onRenamed }: { isPage: boolean; onRenamed: () => void }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const n = value.trim().slice(0, 80).trim();
  const ok = n.length > 0 && n !== DEFAULT_TABAC_NAME;
  const submit = async () => {
    if (!ok || saving) return;
    setSaving(true);
    try {
      // Nom partagé : il apparaît aussi sur les téléphones des employés et en tête des exports.
      await actions.saveSettings({ shopName: n });
      onRenamed();
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="banner invite-rename">
      <span>Ce tabac s’appelle encore « {DEFAULT_TABAC_NAME} » : vos employés auront du mal à le reconnaître.</span>
      {isPage ? (
        <form className="tabac-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <label className="field-label">
            Nouveau nom du tabac
            <input className="input" maxLength={80} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Ex. : Tabac de la Gare" />
          </label>
          <button type="submit" className="btn" disabled={!ok || saving}>Renommer</button>
        </form>
      ) : (
        <span>Ouvrez ce tabac pour le renommer.</span>
      )}
    </div>
  );
}
