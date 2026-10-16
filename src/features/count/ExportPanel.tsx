import { useEffect, useState } from 'react';
import { layoutExport } from '../../domain/exportLayout';
import { formatStamp } from '../../domain/format';
import type { CountLine, Settings } from '../../domain/types';
import { canShareFile, shareFile } from '../../share';
import { Panel } from '../../ui/Panel';
import { renderExportJpg } from './exportJpg';

export function ExportPanel({ lines, settings, onClose }: { lines: CountLine[]; settings: Settings; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [stamped, setStamped] = useState(false);

  useEffect(() => {
    let objectUrl: string | undefined;
    const now = Date.now();
    renderExportJpg(layoutExport(lines, settings, now))
      .then((blob) => {
        const f = new File([blob], `comptage-grattage-${formatStamp(now)}.jpg`, { type: 'image/jpeg' });
        objectUrl = URL.createObjectURL(f);
        setFile(f);
        setUrl(objectUrl);
      })
      .catch((e) => setError((e as Error).message));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
    // Image figée à l'ouverture du panneau.
  }, []);

  const share = async () => {
    if (!file) return;
    const r = await shareFile(file);
    if (r === 'shared') setStamped(true);
  };

  return (
    <Panel title="Export du comptage" onClose={onClose}>
      {error && <p role="alert">L'image n'a pas pu être créée : {error}</p>}
      {!url && !error && <p className="muted">Préparation de l'image…</p>}
      {url && file && (
        <>
          <img className="export-img" src={url} alt={`Comptage grattage du ${file.name.slice(18, 28)}`} />
          <p className="muted num" style={{ margin: 0 }}>{file.name} · toutes les lignes, codes complets</p>
          {canShareFile(file) && <button type="button" className="btn accent" onClick={share}>Partager (Drive, WhatsApp…)</button>}
          <p className="muted" style={{ margin: 0 }}>Appui long sur l'image pour l'enregistrer</p>
          <a className="btn" href={url} download={file.name}>Télécharger</a>
          {stamped && <div className="stamp" role="status">Comptage exporté ✓</div>}
        </>
      )}
    </Panel>
  );
}
