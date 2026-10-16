import { useState } from 'react';
import { needsBackupReminder } from '../../domain/backup';
import type { Settings } from '../../domain/types';
import { Banner } from '../../ui/Banner';
import { BackupPanel } from '../settings/BackupPanel';

const SNOOZE_KEY = 'carotte:backup-snooze';
const DAY = 86_400_000;

function snoozedUntil(): number {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
  } catch {
    return 0;
  }
}

export function BackupReminder({ settings, hasData }: { settings: Settings; hasData: boolean }) {
  const [hidden, setHidden] = useState(() => snoozedUntil() > Date.now());
  const [open, setOpen] = useState(false);
  const now = Date.now();
  if (hidden || !needsBackupReminder(settings, now, hasData)) return open ? <BackupPanel onClose={() => setOpen(false)} /> : null;
  const days = settings.lastBackupAt ? Math.floor((now - settings.lastBackupAt) / DAY) : undefined;
  const later = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(now + DAY));
    } catch {
      /* rappel ré-affiché à la prochaine ouverture */
    }
    setHidden(true);
  };
  return (
    <>
      <Banner
        actions={
          <>
            <button type="button" className="btn" onClick={() => setOpen(true)}>Sauvegarder</button>
            <button type="button" className="btn ghost" onClick={later}>Plus tard</button>
          </>
        }
      >
        {days !== undefined ? `Dernière sauvegarde il y a ${days} jours` : 'Aucune sauvegarde : pensez à en faire une'}
      </Banner>
      {open && <BackupPanel onClose={() => setOpen(false)} />}
    </>
  );
}
