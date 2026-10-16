import { describe, it, expect } from 'vitest';
import { collectFromIssue } from '../../scripts/codes/collectFromIssue';
import { buildIssue, type SharedCodesFile } from '../../src/domain/sharing';

const refs = { items: [{ ref: 'pmi|marlboro' }] };
const fdj = { items: [{ ref: 'fdj|ITGC9K' }] };
const empty: SharedCodesFile = { version: '0', updatedAt: '', barcodes: {}, fdjPrefixes: {} };
const issue = (items: Parameters<typeof buildIssue>[0], login = 'wongmichel2048') => ({ issue: { number: 7, user: { login }, ...buildIssue(items) }, repository: { owner: { login: 'wongmichel2048' } } });

describe('collectFromIssue (robot)', () => {
  it('ajoute les codes d’un message du propriétaire et résume le résultat', () => {
    const r = collectFromIssue(issue([{ kind: 'barcode', code: '3017620422003', ref: 'pmi|marlboro' }, { kind: 'barcode', code: '12', ref: 'pmi|marlboro' }]), refs, fdj, empty, '2026-10-16');
    expect(r.file?.barcodes).toEqual({ '3017620422003': 'pmi|marlboro' });
    expect(r.summary).toContain('1 code ajouté');
    expect(r.summary).toContain('12 → pmi|marlboro : code invalide');
  });
  it('ignore un message qui ne vient pas du propriétaire du dépôt', () => {
    const r = collectFromIssue(issue([{ kind: 'barcode', code: '3017620422003', ref: 'pmi|marlboro' }], 'inconnu'), refs, fdj, empty, '2026-10-16');
    expect(r.file).toBeUndefined();
    expect(r.summary).toContain('ignoré');
  });
  it('message sans contenu lisible : ignoré', () => {
    const ev = { issue: { number: 8, user: { login: 'wongmichel2048' }, title: '[codes-barres] 0 code', body: 'texte' }, repository: { owner: { login: 'wongmichel2048' } } };
    expect(collectFromIssue(ev, refs, fdj, empty, '2026-10-16').file).toBeUndefined();
  });
});
