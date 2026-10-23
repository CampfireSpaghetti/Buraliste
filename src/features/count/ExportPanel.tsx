import { layoutExport } from '../../domain/exportLayout';
import { formatDateLong } from '../../domain/format';
import type { CountLine, Settings } from '../../domain/types';
import { ImageExportPanel } from '../../ui/ImageExportPanel';
import { renderExportJpg } from './exportJpg';

export function ExportPanel({ lines, settings, onClose }: { lines: CountLine[]; settings: Settings; onClose: () => void }) {
  return (
    <ImageExportPanel
      title="Export du comptage"
      fileBase="comptage-grattage"
      alt={`Comptage grattage du ${formatDateLong(Date.now()).slice(0, 10)}`}
      note="toutes les lignes, codes complets"
      doneLabel="Comptage exporté ✓"
      render={(now) => renderExportJpg(layoutExport(lines, settings, now))}
      onClose={onClose}
    />
  );
}
