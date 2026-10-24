import { describe, it, expect } from 'vitest';
import {
  contributionsFor, buildIssue, parseIssueBody, isLegacyPairingCode, applySharedCodes, mergeContributions,
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
  it('plusieurs préfixes de jeu (user.fdjPrefixes) : seuls les nouveaux partent', () => {
    const game = p({ source: 'fdj', douaneRef: undefined, fdjRef: 'fdj|ITGC9K', base: { kind: 'jeu-fdj', name: 'CASH' }, user: { fdjPrefixes: ['87104'] }, sharedFdjPrefixes: ['87103'] });
    expect(contributionsFor(game, { ...game, user: { fdjPrefixes: ['87104', '87105', '87103'] } })).toEqual([
      { kind: 'fdjPrefix', prefix: '87105', ref: 'fdj|ITGC9K' },
    ]);
  });
  it('R6 : le code complet d\'un ticket de jeu ne part jamais (seulement le code de jeu) ; le tabac, si', () => {
    const game = p({ source: 'fdj', douaneRef: undefined, fdjRef: 'fdj|ITGC9K', base: { kind: 'jeu-fdj', name: 'CASH' } });
    expect(contributionsFor(game, { ...game, user: { barcodes: ['871050010001'], fdjPrefixes: ['87105'] } })).toEqual([
      { kind: 'fdjPrefix', prefix: '87105', ref: 'fdj|ITGC9K' },
    ]);
    expect(contributionsFor(game, { ...game, user: { barcodes: ['871050010001'] } })).toEqual([]);
    const cig = p({});
    expect(contributionsFor(cig, { ...cig, user: { barcodes: ['3017620422003'] } })).toEqual([{ kind: 'barcode', code: '3017620422003', ref: 'pmi|marlboro' }]);
  });
  it('rien pour une fiche créée à la main ni pour un code déjà connu', () => {
    const mine = p({ source: 'utilisateur', douaneRef: undefined, base: {}, user: { kind: 'cigare', name: 'Maison' } });
    expect(contributionsFor(mine, { ...mine, user: { ...mine.user, barcodes: ['4006381333931'] } })).toEqual([]);
    const shared = p({ sharedBarcodes: ['3017620422003'] });
    expect(contributionsFor(shared, { ...shared, user: { barcodes: ['3017620422003'] } })).toEqual([]);
  });
  it('un code à clé de contrôle fausse (faute de frappe) ne part pas ; un code sans clé connue, si', () => {
    expect(contributionsFor(p({}), p({ user: { barcodes: ['3017620422004'] } }))).toEqual([]);
    expect(contributionsFor(p({}), p({ user: { barcodes: ['ABC123456'] } }))).toEqual([{ kind: 'barcode', code: 'ABC123456', ref: 'pmi|marlboro' }]);
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

describe('ancien QR code de jumelage', () => {
  it('reconnu (sans en lire le contenu), pour répondre « demandez une invitation »', () => {
    expect(isLegacyPairingCode('LACAROTTE1:eyJ0b2tlbiI6IngifQ')).toBe(true);
    expect(isLegacyPairingCode('  LACAROTTE1:abc\n')).toBe(true);
  });
  it('autre texte : ignoré', () => {
    expect(isLegacyPairingCode('https://example.com')).toBe(false);
    expect(isLegacyPairingCode('3017620422003')).toBe(false);
    expect(isLegacyPairingCode('LACAROTTE2:abc')).toBe(false);
  });
});

describe('robot : vérification et fusion', () => {
  const empty: SharedCodesFile = { version: '0', updatedAt: '', barcodes: {}, fdjPrefixes: {} };
  const known = new Set(['pmi|marlboro', 'fdj|ITGC9K', 'seita|gitanes']);
  it('R7 : un code-barres déjà officiel sur une autre référence (references.json) est mis de côté', () => {
    const official = { 'seita|gitanes': ['3017620422003'], 'pmi|marlboro': ['0012345678905'] };
    const r = mergeContributions(empty, [
      { kind: 'barcode', code: '3017620422003', ref: 'pmi|marlboro' },
      { kind: 'barcode', code: '012345678905', ref: 'seita|gitanes' }, // UPC-A du code officiel de Marlboro
      { kind: 'barcode', code: '0012345678905', ref: 'pmi|marlboro' }, // déjà officiel pour cette référence : sans effet
      { kind: 'barcode', code: '4006381333931', ref: 'pmi|marlboro' },
    ], known, '2026-10-22', {}, official);
    expect(r.file.barcodes).toEqual({ '4006381333931': 'pmi|marlboro' });
    expect(r.accepted).toBe(1);
    expect(r.held.map((h) => h.reason)).toEqual(['code-barres officiel de seita|gitanes', 'code-barres officiel de pmi|marlboro']);
  });
  it('accepte les codes valides vers des références existantes', () => {
    const r = mergeContributions(empty, [{ kind: 'barcode', code: '3017620422003', ref: 'pmi|marlboro' }, { kind: 'fdjPrefix', prefix: '0417', ref: 'fdj|ITGC9K' }], known, '2026-10-16');
    expect(r.file.barcodes).toEqual({ '3017620422003': 'pmi|marlboro' });
    expect(r.file.fdjPrefixes).toEqual({ 'fdj|ITGC9K': '0417' });
    expect(r.accepted).toBe(2);
    expect(r.file.version).toMatch(/^2026-10-16-[0-9a-f]{8}$/);
  });
  it('refuse les références inconnues et les codes invalides', () => {
    const r = mergeContributions(empty, [
      { kind: 'barcode', code: '123', ref: 'pmi|marlboro' },
      { kind: 'barcode', code: '4006381333931', ref: 'inconnu|x' },
      { kind: 'fdjPrefix', prefix: '04', ref: 'fdj|ITGC9K' },
    ], known, '2026-10-16');
    expect(r.accepted).toBe(0);
    expect(r.rejected.map((x) => x.reason)).toEqual(['code invalide', 'référence inconnue', 'code de jeu trop court']);
    expect(r.held).toEqual([]);
  });
  it('refuse un code-barres à clé de contrôle fausse (code inventé ou mal tapé)', () => {
    const r = mergeContributions(empty, [
      { kind: 'barcode', code: '3017620422004', ref: 'pmi|marlboro' },
      { kind: 'barcode', code: '036000291453', ref: 'pmi|marlboro' },
      { kind: 'barcode', code: '036000291452', ref: 'pmi|marlboro' },
    ], known, '2026-10-16');
    expect(r.rejected.map((x) => [x.item.kind === 'barcode' && x.item.code, x.reason])).toEqual([
      ['3017620422004', 'clé de contrôle fausse'], ['036000291453', 'clé de contrôle fausse'],
    ]);
    expect(r.accepted).toBe(1);
  });

  it('R28 : n’applique jamais un changement de ce qui est déjà publié (code réattribué, code de jeu pris par un autre jeu) : à vérifier', () => {
    const start = { ...empty, barcodes: { '3017620422003': 'pmi|marlboro' }, fdjPrefixes: { 'fdj|ITGC9K': '0417' } };
    const r = mergeContributions(start, [
      { kind: 'barcode', code: '3017620422003', ref: 'seita|gitanes' }, // réattribution
      { kind: 'fdjPrefix', prefix: '0417', ref: 'fdj|AUTRE' }, // code de jeu déjà pris par un autre jeu
      { kind: 'fdjPrefix', prefix: '041799', ref: 'fdj|AUTRE' }, // contredit le code de jeu d'un autre jeu
      { kind: 'fdjPrefix', prefix: '04', ref: 'fdj|AUTRE' }, // trop court
      { kind: 'barcode', code: '3017620422003', ref: 'pmi|marlboro' }, // déjà connu : sans effet
      { kind: 'fdjPrefix', prefix: '0417', ref: 'fdj|ITGC9K' }, // déjà connu : sans effet
      { kind: 'fdjPrefix', prefix: '041700', ref: 'fdj|ITGC9K' }, // déjà couvert par 0417 : sans effet
      { kind: 'barcode', code: '4006381333931', ref: 'seita|gitanes' }, // nouveau : appliqué
    ], new Set([...known, 'fdj|AUTRE']), '2026-10-16');
    expect(r.accepted).toBe(1);
    expect(r.rejected.map((x) => x.reason)).toEqual(['code de jeu trop court']);
    expect(r.held.map((h) => h.reason)).toEqual([
      'code déjà attribué à pmi|marlboro',
      'code de jeu déjà attribué à fdj|ITGC9K',
      'code de jeu en conflit avec 0417 (fdj|ITGC9K)',
    ]);
    expect(r.file.barcodes).toEqual({ '3017620422003': 'pmi|marlboro', '4006381333931': 'seita|gitanes' });
    expect(r.file.fdjPrefixes).toEqual({ 'fdj|ITGC9K': '0417' });
  });
  it('plusieurs codes de jeu par jeu (une émission chacun) : ajoutés ; un seul reste écrit comme avant (texte)', () => {
    const start = { ...empty, fdjPrefixes: { 'fdj|ITGC9K': '87103' } };
    const r = mergeContributions(start, [
      { kind: 'fdjPrefix', prefix: '87104', ref: 'fdj|ITGC9K' },
      { kind: 'fdjPrefix', prefix: '87105', ref: 'fdj|ITGC9K' },
      { kind: 'fdjPrefix', prefix: '84701', ref: 'fdj|AUTRE' },
    ], new Set([...known, 'fdj|AUTRE']), '2026-10-22');
    expect(r.accepted).toBe(3);
    expect(r.held).toEqual([]);
    expect(r.file.fdjPrefixes).toEqual({ 'fdj|ITGC9K': ['87103', '87104', '87105'], 'fdj|AUTRE': '84701' });
    const again = mergeContributions(r.file, [{ kind: 'fdjPrefix', prefix: '8710', ref: 'fdj|AUTRE' }], new Set([...known, 'fdj|AUTRE']), '2026-10-22');
    expect(again.held.map((h) => h.reason)).toEqual(['code de jeu en conflit avec 87103 (fdj|ITGC9K)']);
  });
  it('un code de jeu qui empiète sur un numéro du catalogue FDJ d’un autre jeu : à vérifier (dans les deux sens)', () => {
    const catalog = { 'fdj|ITGC9K': ['87104', '87105'], 'fdj|AUTRE': ['84701'] };
    const r = mergeContributions(empty, [
      { kind: 'fdjPrefix', prefix: '8710', ref: 'fdj|AUTRE' },
      { kind: 'fdjPrefix', prefix: '87104000000', ref: 'fdj|AUTRE' },
      { kind: 'fdjPrefix', prefix: '87105', ref: 'fdj|ITGC9K' },
      { kind: 'fdjPrefix', prefix: '847012', ref: 'fdj|AUTRE' },
    ], new Set([...known, 'fdj|AUTRE']), '2026-10-22', catalog);
    expect(r.held.map((h) => h.reason)).toEqual([
      'code de jeu en conflit avec le numéro FDJ 87104 (fdj|ITGC9K)',
      'code de jeu en conflit avec le numéro FDJ 87104 (fdj|ITGC9K)',
    ]);
    expect(r.file.fdjPrefixes).toEqual({ 'fdj|ITGC9K': '87105', 'fdj|AUTRE': '847012' });
  });
  it('un code de jeu qui engloberait un code-barres publié d’un autre produit : à vérifier', () => {
    const start = { ...empty, barcodes: { '87105001000123': 'fdj|AUTRE' } };
    const r = mergeContributions(start, [{ kind: 'fdjPrefix', prefix: '87105', ref: 'fdj|ITGC9K' }], new Set([...known, 'fdj|AUTRE']), '2026-10-22');
    expect(r.held.map((h) => h.reason)).toEqual(['code de jeu en conflit avec 87105001000123 (fdj|AUTRE)']);
  });
  it('deux contributions contradictoires dans le même envoi : la première (nouvelle) passe, la seconde est à vérifier', () => {
    const r = mergeContributions(empty, [
      { kind: 'barcode', code: '3017620422003', ref: 'pmi|marlboro' },
      { kind: 'barcode', code: '3017620422003', ref: 'seita|gitanes' },
    ], known, '2026-10-16');
    expect(r.accepted).toBe(1);
    expect(r.held).toHaveLength(1);
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
  it('vos ajouts personnels s’ajoutent aux codes partagés', () => {
    const mine = { ...cash, user: { fdjPrefix: '041700' } };
    const [after] = applySharedCodes([mine], file);
    expect(effectiveFields(after).fdjPrefixes).toEqual(['041700', '0417']);
  });
  it('liste commune avec plusieurs codes de jeu par jeu (et anciens fichiers à un seul code)', () => {
    const multi: SharedCodesFile = { ...file, fdjPrefixes: { 'fdj|ITGC9K': ['87104', '87105'] } };
    const [after] = applySharedCodes([{ ...cash, sharedFdjPrefix: '0417' }], multi);
    expect(after.sharedFdjPrefixes).toEqual(['87104', '87105']);
    expect(after).not.toHaveProperty('sharedFdjPrefix');
    expect(resolveScan('871050010001', [after])).toMatchObject({ type: 'product', product: { id: 'c' } });
    expect(applySharedCodes([cash], file)[0].sharedFdjPrefixes).toEqual(['0417']);
  });
  it('rien ne change si déjà appliqué', () => {
    const once = applySharedCodes([marlboro, cash], file);
    expect(applySharedCodes(once, file)).toEqual([]);
  });
});
