// Codes-barres ANSES dans la liste officielle (public/data/references.json) : les EAN de composition.json sont ajoutés
// aux références rapprochées (`items[].barcodes`). L'app les reçoit par la fusion de la liste Douane, dans la couche `base`
// (codes « officiels »), jamais dans `user`. Appelé par les deux robots (Douane puis ANSES) : la liste Douane réécrite
// garde ainsi ses codes même si l'étape ANSES échoue ensuite.
import type { RefItem, ReferenceFile } from '../../src/domain/catalog.ts';
import type { CompositionFile } from '../../src/domain/composition.ts';
import { referenceVersion } from '../douane/parseNomenclature.ts';

export function applyAnsesBarcodes(file: ReferenceFile, composition: CompositionFile | undefined): ReferenceFile {
  const produits = composition?.produits ?? {};
  const items = file.items.map((item): RefItem => {
    const { barcodes: _old, ...rest } = item;
    const ean = produits[item.ref]?.ean;
    return Array.isArray(ean) && ean.length ? { ...rest, barcodes: [...ean] } : rest;
  });
  const version = referenceVersion(file.effectiveDate, items);
  return version === file.version ? file : { ...file, version, items };
}
