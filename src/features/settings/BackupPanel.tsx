import { useEffect, useState } from 'react';
import { exportBackupText } from '../../data/backupData';
import { localIsoDate } from '../../domain/catalog';
import { canShareFile, shareFile } from '../../share';
import { actions } from '../../store';
import { Panel } from '../../ui/Panel';

/** Prépare le fichier de sauvegarde complète et propose de l'envoyer (Drive…) ou de le télécharger. */
export function BackupPanel({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string>();
  const [done, setDone] = useState(false);

  useEffect(() => {
    let objectUrl: string | undefined;
    const now = Date.now();
    void exportBackupText(now).then((text) => {
      const f = new File([text], `la-carotte-sauvegarde-${localIsoDate(new Date(now))}.json`, { type: 'application/json' });
      objectUrl = URL.createObjectURL(f);
      setFile(f);
      setUrl(objectUrl);
    });
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, []);

  const markDone = () => { setDone(true); void actions.saveSettings({ lastBackupAt: Date.now() }); };

  return (
    <Panel title="Sauvegarde complète" onClose={onClose}>
      <p style={{ margin: 0 }}>Ce fichier contient tout : catalogue, vos ajouts, comptage et réglages. Envoyez-le sur Drive pour pouvoir tout restaurer sur un autre téléphone.</p>
      {!file && <p className="muted">Préparation du fichier…</p>}
      {file && url && (
        <>
          <p className="muted num" style={{ margin: 0 }}>{file.name} · {(file.size / 1024).toFixed(0)} Ko</p>
          {canShareFile(file) && (
            <button type="button" className="btn accent" onClick={async () => { if ((await shareFile(file)) === 'shared') markDone(); }}>
              Envoyer (Drive, e-mail…)
            </button>
          )}
          <a className="btn" href={url} download={file.name} onClick={markDone}>Télécharger</a>
          {done && <p className="muted" role="status">Sauvegarde faite.</p>}
        </>
      )}
    </Panel>
  );
}
