import { useCallback, useState } from 'react';
import { attachCodePatch, effectiveFields } from '../../domain/matching';
import { useNav } from '../../nav';
import { actions, currentProduct, useProducts } from '../../store';
import { Panel } from '../../ui/Panel';
import { Toast } from '../../ui/Toast';
import { ScannerView, type ScannedResult } from '../scanner/ScannerView';

/**
 * « Ajouter un code » d'une fiche : le prochain code lu (ticket ou EAN) est rattaché à cette fiche. Un code déjà
 * rattaché à une autre fiche n'est pas déplacé ; un code de traçabilité est refusé (ScannerView l'explique).
 */
export function AddCodeScanner({ id }: { id: string }) {
  const nav = useNav();
  const products = useProducts();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closeNotice = useCallback(() => setNotice(null), []);
  const product = products?.find((p) => p.id === id);
  if (!products) return null;
  if (!product) return <Panel title="Fiche introuvable" onClose={nav.close}><p>Cette fiche n'existe plus.</p></Panel>;
  const f = effectiveFields(product);

  const onResult = async (r: ScannedResult, code: string) => {
    if (r.type === 'product') {
      setNotice(r.product.id === id ? 'Ce code est déjà sur cette fiche.' : `Ce code est déjà rattaché à : ${effectiveFields(r.product).name}`);
      return;
    }
    setBusy(true);
    try {
      const current = await currentProduct(product);
      // Ticket : comme au comptage (code complet + préfixe appris) ; le numéro du catalogue de CE jeu est confirmé.
      const patch = attachCodePatch(current, code, products, r.type === 'confirm-game' && r.product.id === id ? { confirmedPrefix: r.prefix } : {});
      await actions.patchUserFields(id, patch);
      nav.close();
    } catch (e) {
      console.error('Ajout du code', e);
      setNotice("Le code n'a pas pu être ajouté. Réessayez.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={`Ajouter un code — ${f.name}`} onClose={nav.close}>
      <p className="muted" style={{ margin: 0 }}>Scannez le code-barres à rattacher à cette fiche.</p>
      <ScannerView mode="add-code" onResult={(r, code) => void onResult(r, code)} paused={busy} />
      {notice && <Toast message={notice} onDone={closeNotice} />}
    </Panel>
  );
}
