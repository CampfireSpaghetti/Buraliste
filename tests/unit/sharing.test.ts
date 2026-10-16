import { describe, it, expect } from 'vitest';
import {
  contributionsFor, buildIssue, parseIssueBody, encodePairing, decodePairing, applySharedCodes, mergeContributions,
  type SharedCodesFile, type Contribution,
} from '../../src/domain/sharing';
import { effectiveFields, resolveScan } from '../../src/domain/matching';
import type { Product } from '../../src/domain/types';

const p = (over: Partial<Product>): Product => ({ id: 'x', source: 'douane', douaneRef: 'pmi|marlboro', base: { kind: 'cigarette', name: 'Marlboro' }, user: {}, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0, ...over });

describe('contributionsFor : ce qui part du téléphone', () => {
  it('un code ajouté à une référence officielle Douane', () => {
    const before = p({});
    const after = p({ user: { barcodes: ['3017620422003'] } });
    expect(contributionsFor(before, after)).toEqual([{ kind: 'barcode', code: '3017620422003', ref: 'pmi|marlboro' }]);
  });
  it('un code de jeu FDJ appris', () => {
    const game = p({ source: 'fdj', douaneRef: undefined, fdjRef: 'fdj|ITGC9K', base: { kind: 'jeu-fdj', name: 'CASH' } });
    expect(contributionsFor(game, { ...game, user: { fdjPrefix: '0417' } })).toEqual([{ kind: 'fdjPrefix', prefix: '0417', ref: 'fdj|ITGC9K' }]);
  });
  it('rien pour une fiche créée à la main ni pour un code déjà connu', () => {
    const mine = p({ source: 'utilisateur', douaneRef: undefined, base: {}, user: { kind: 'cigare', name: 'Maison' } });
    expect(contributionsFor(mine, { ...mine, user: { ...mine.user, barcodes: ['4006381333931'] } })).toEqual([]);
    const shared = p({ sharedBarcodes: ['3017620422003'] });
    expect(contributionsFor(shared, { ...shared, user: { barcodes: ['3017620422003'] } })).toEqual([]);
  });
  it('rien d’autre ne part : ni rupture, ni goût, ni prix', () => {
    const before = p({});
    expect(contributionsFor(before, { ...before, outOfStock: true, user: { tasteTags: ['doux'], price: 14 } })).toEqual([]);
  });
});

describe('message envoyé à GitHub', () => {
  const items: Contribution[] = [{ kind: 'barcode', code: '3017620422003', ref: 'pmi|marlboro' }, { kind: 'fdjPrefix', prefix: '0417', ref: 'fdj|ITGC9K' }];
  it('aller-retour titre + corps', () => {
    const issue = buildIssue(items);
    expect(issue.title).toBe('[codes-barres] 2 codes');
    expect(parseIssueBody(issue.body)).toEqual(items);
  });
  it('corps illisible : liste vide', () => {
    expect(parseIssueBody('bonjour')).toEqual([]);
    expect(parseIssueBody('```json\n{"app":"autre","items":[]}\n```')).toEqual([]);
  });
});

describe('jumelage par QR code', () => {
  it('aller-retour', () => {
    const text = encodePairing({ token: 'github_pat_ABC', repo: 'wongmichel2048/Buraliste', shop: 'Tabac du Centre' });
    expect(text.startsWith('LACAROTTE1:')).toBe(true);
    expect(decodePairing(text)).toEqual({ token: 'github_pat_ABC', repo: 'wongmichel2048/Buraliste', shop: 'Tabac du Centre' });
  });
  it('autre QR code : ignoré', () => {
    expect(decodePairing('https://example.com')).toBeUndefined();
    expect(decodePairing('LACAROTTE1:pas-du-base64!')).toBeUndefined();
  });
});

describe('robot : vérification et fusion', () => {
  const empty: SharedCodesFile = { version: '0', updatedAt: '', barcodes: {}, fdjPrefixes: {} };
  const known = new Set(['pmi|marlboro', 'fdj|ITGC9K', 'seita|gitanes']);
  it('accepte les codes valides vers des références existantes', () => {
    const r = mergeContributions(empty, [{ kind: 'barcode', code: '3017620422003', ref: 'pmi|marlboro' }, { kind: 'fdjPrefix', prefix: '0417', ref: 'fdj|ITGC9K' }], known, '2026-10-16');
    expect(r.file.barcodes).toEqual({ '3017620422003': 'pmi|marlboro' });
    expect(r.file.fdjPrefixes).toEqual({ 'fdj|ITGC9K': '0417' });
    expect(r.accepted).toBe(2);
    expect(r.file.version).toMatch(/^2026-10-16-[0-9a-f]{8}$/);
  });
  it('refuse les références inconnues, les codes invalides et les conflits', () => {
    const start = { ...empty, barcodes: { '3017620422003': 'pmi|marlboro' } };
    const r = mergeContributions(start, [
      { kind: 'barcode', code: '123', ref: 'pmi|marlboro' },
      { kind: 'barcode', code: '4006381333931', ref: 'inconnu|x' },
      { kind: 'barcode', code: '3017620422003', ref: 'seita|gitanes' },
      { kind: 'fdjPrefix', prefix: '04', ref: 'fdj|ITGC9K' },
    ], known, '2026-10-16');
    expect(r.accepted).toBe(0);
    expect(r.rejected.map((x) => x.reason)).toEqual(['code invalide', 'référence inconnue', 'code déjà attribué à un autre produit', 'code de jeu trop court']);
    expect(r.file.barcodes).toEqual({ '3017620422003': 'pmi|marlboro' });
  });
});

describe('réception sur les téléphones', () => {
  const file: SharedCodesFile = { version: 'v1', updatedAt: '2026-10-16', barcodes: { '3017620422003': 'pmi|marlboro' }, fdjPrefixes: { 'fdj|ITGC9K': '0417' } };
  const marlboro = p({});
  const cash = p({ id: 'c', source: 'fdj', douaneRef: undefined, fdjRef: 'fdj|ITGC9K', base: { kind: 'jeu-fdj', name: 'CASH' } });
  it('les codes partagés sont reconnus au scan', () => {
    const changed = applySharedCodes([marlboro, cash], file);
    expect(changed).toHaveLength(2);
    expect(resolveScan('3017620422003', changed)).toMatchObject({ type: 'product', product: { id: 'x' } });
    expect(resolveScan('04170099999999', changed)).toMatchObject({ type: 'product', product: { id: 'c' } });
  });
  it('vos ajouts personnels restent prioritaires', () => {
    const mine = { ...cash, user: { fdjPrefix: '041700' } };
    const [after] = applySharedCodes([mine], file);
    expect(effectiveFields(after).fdjPrefix).toBe('041700');
  });
  it('rien ne change si déjà appliqué', () => {
    const once = applySharedCodes([marlboro, cash], file);
    expect(applySharedCodes(once, file)).toEqual([]);
  });
});
