import { useEffect, useState } from 'react';
import { formatStamp } from '../domain/format';
import { canShareFile, shareFile } from '../share';
import { Panel } from './Panel';

type Props = {
  title: string;
  /** Début du nom du fichier, complété par la date (« comptage-grattage » → « comptage-grattage-2026-10-23-1530.jpg »). */
  fileBase: string;
  alt: string;
  note: string;
  /** Tampon affiché après un partage réussi (« Comptage exporté ✓ »). */
  doneLabel: string;
  render: (now: number) => Promise<Blob>;
  onClose: () => void;
};

/** Image .jpg figée à l'ouverture, puis Partager (Drive, WhatsApp…) ou Télécharger. */
export function ImageExportPanel({ title, fileBase, alt, note, doneLabel, render, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [stamped, setStamped] = useState(false);

  useEffect(() => {
    let objectUrl: string | undefined;
    const now = Date.now();
    render(now)
      .then((blob) => {
        const f = new File([blob], `${fileBase}-${formatStamp(now)}.jpg`, { type: 'image/jpeg' });
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
    <Panel title={title} onClose={onClose}>
      {error && <p role="alert">L'image n'a pas pu être créée : {error}</p>}
      {!url && !error && <p className="muted">Préparation de l'image…</p>}
      {url && file && (
        <>
          <img className="export-img" src={url} alt={alt} />
          <p className="muted num" style={{ margin: 0 }}>{file.name} · {note}</p>
          {canShareFile(file) && <button type="button" className="btn accent" onClick={share}>Partager (Drive, WhatsApp…)</button>}
          <p className="muted" style={{ margin: 0 }}>Appui long sur l'image pour l'enregistrer</p>
          <a className="btn" href={url} download={file.name}>Télécharger</a>
          {stamped && <div className="stamp" role="status">{doneLabel}</div>}
        </>
      )}
    </Panel>
  );
}
