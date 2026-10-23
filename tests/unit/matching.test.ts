import { describe, it, expect } from 'vitest';
import { resolveScan, learnFdjCode, attachCodePatch, createScanDebouncer, effectiveFields, gameCandidates, withUserBarcode, withoutUserCode, codeRows, TRACEABILITY_MESSAGE } from '../../src/domain/matching';
import type { Product, ProductFields } from '../../src/domain/types';

function p(id: string, base: Partial<ProductFields>, user: Partial<ProductFields> = {}): Product {
  return { id, source: 'utilisateur', base, user, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0 };
}
const game = (id: string, f: Partial<ProductFields>) => p(id, { kind: 'jeu-fdj', name: id, ...f });

describe('effectiveFields', () => {
  it('user l’emporte sur base et les codes sont unis sans doublon', () => {
    const f = effectiveFields(p('a', { kind: 'cigarette', name: 'Base', barcodes: ['1', '2'] }, { name: 'Perso', barcodes: ['2', '3'] }));
    expect(f.name).toBe('Perso');
    expect(f.barcodes).toEqual(['1', '2', '3']);
  });
});

describe('resolveScan', () => {
  const cig = p('cig', { kind: 'cigarette', name: 'Cig', barcodes: ['3017620422003'] });
  const cigUser = p('cig2', { kind: 'cigarette', name: 'Cig2' }, { barcodes: ['96385074'] });
  it('correspondance exacte en couche base', () => {
    expect(resolveScan('3017620422003', [cig])).toEqual({ type: 'product', product: cig });
  });
  it('correspondance exacte en couche user', () => {
    expect(resolveScan('9638 5074', [cig, cigUser])).toMatchObject({ type: 'product', product: { id: 'cig2' } });
  });
  it('UPC-A : 12 chiffres (upc_a) et EAN-13 « 0… » désignent le même paquet', () => {
    const cigar = p('cigar', { kind: 'cigare', name: 'Cigare', barcodes: ['0012345678905'] });
    expect(resolveScan('012345678905', [cigar], { format: 'upc_a' })).toEqual({ type: 'product', product: cigar });
    const old = p('old', { kind: 'cigare', name: 'Ancien' }, { barcodes: ['012345678905'] });
    expect(resolveScan('0012345678905', [old], { format: 'ean_13' })).toEqual({ type: 'product', product: old });
    // Inconnu : proposé comme un EAN, sous sa forme EAN-13.
    expect(resolveScan('012345678905', [cig], { format: 'upc_a' })).toEqual({ type: 'unknown-ean', code: '0012345678905' });
    // Lu en ITF (ticket) : jamais pris pour un UPC.
    expect(resolveScan('012345678905', [cigar], { format: 'itf' }).type).not.toBe('product');
  });
  it('R7 : même code sur deux fiches : couche user > officiel (base) > liste partagée, quel que soit l\'ordre', () => {
    const code = '3017620422003';
    const official = p('b-official', { kind: 'cigarette', name: 'Officiel', barcodes: [code] });
    const shared: Product = { ...p('a-shared', { kind: 'cigarette', name: 'Partagé' }), sharedBarcodes: [code] };
    const mine = p('c-mine', { kind: 'cigarette', name: 'Ici' }, { barcodes: [code] });
    for (const list of [[official, shared, mine], [mine, shared, official], [shared, mine, official]]) {
      expect(resolveScan(code, list)).toMatchObject({ type: 'product', product: { id: 'c-mine' } });
    }
    for (const list of [[official, shared], [shared, official]]) {
      expect(resolveScan(code, list)).toMatchObject({ type: 'product', product: { id: 'b-official' } });
    }
    // Même couche : résultat stable (identifiant le plus petit), pas l'ordre de la base.
    const twin = p('a-official', { kind: 'cigarette', name: 'Officiel 2', barcodes: [code] });
    expect(resolveScan(code, [official, twin])).toMatchObject({ product: { id: 'a-official' } });
    expect(resolveScan(code, [twin, official])).toMatchObject({ product: { id: 'a-official' } });
  });
  it('EAN-8 lu par la caméra = GTIN-13/14 « 00000… » enregistré (et l\'inverse)', () => {
    const padded = p('padded', { kind: 'cigare', name: 'Cigare', barcodes: ['0000096385074'] });
    expect(resolveScan('96385074', [padded], { format: 'ean_8' })).toMatchObject({ type: 'product', product: { id: 'padded' } });
    const short = p('short', { kind: 'cigare', name: 'Cigare' }, { barcodes: ['96385074'] });
    expect(resolveScan('00000096385074', [short])).toMatchObject({ type: 'product', product: { id: 'short' } });
    expect(resolveScan('0000096385074', [short], { format: 'ean_13' })).toMatchObject({ type: 'product', product: { id: 'short' } });
  });
  it('EAN valide inconnu', () => {
    expect(resolveScan('4006381333931', [cig])).toEqual({ type: 'unknown-ean', code: '4006381333931' });
  });
  it('code ITF reconnu par préfixe FDJ (ancien champ fdjPrefix)', () => {
    const cash = game('Cash', { fdjPrefix: '0417' });
    expect(resolveScan('04170012345678', [cash])).toMatchObject({ type: 'product', product: { id: 'Cash' } });
  });
  it('retient le préfixe le plus long', () => {
    const a = game('A', { fdjPrefix: '0417' });
    const b = game('B', { fdjPrefix: '041700' });
    expect(resolveScan('04170012345678', [a, b])).toMatchObject({ product: { id: 'B' } });
  });
  it('demande le jeu, candidats triés par préfixe commun', () => {
    const a = game('A', { barcodes: ['05000000000000'] });
    const b = game('B', { barcodes: ['04179900000000'] });
    const r = resolveScan('04170012345678', [a, b, cig]);
    expect(r.type).toBe('ask-game');
    if (r.type === 'ask-game') expect(r.candidates.map((c) => c.id)).toEqual(['B', 'A']);
  });
  it('aucun jeu connu : nouveau jeu', () => {
    expect(resolveScan('04170012345678', [cig])).toEqual({ type: 'new-game', code: '04170012345678' });
  });
});

describe('learnFdjCode', () => {
  it('apprend le préfixe commun et garde le code complet', () => {
    const g = game('Cash', { barcodes: ['04170012345678'] });
    expect(learnFdjCode(g, '04170099999999', [g])).toEqual({ barcodes: ['04170099999999'], fdjPrefixes: ['041700'] });
  });
  it('raccourcit un préfixe appris (carnet suivant)', () => {
    const g = p('Cash', { kind: 'jeu-fdj', name: 'Cash' }, { barcodes: ['04170012345678'], fdjPrefixes: ['041700'] });
    expect(learnFdjCode(g, '04171111111111', [g])).toEqual({ barcodes: ['04170012345678', '04171111111111'], fdjPrefixes: ['0417'] });
  });
  it('garde plusieurs préfixes (une émission par préfixe)', () => {
    const g = p('Cash', { kind: 'jeu-fdj', name: 'Cash' }, { barcodes: ['05200012345678'], fdjPrefixes: ['0417'] });
    expect(learnFdjCode(g, '05200099999999', [g])).toEqual({ barcodes: ['05200012345678', '05200099999999'], fdjPrefixes: ['0417', '052000'] });
  });
  it('préfixe trop court : seulement le code complet', () => {
    const g = game('Cash', { barcodes: ['04170012345678'] });
    expect(learnFdjCode(g, '05170012345678', [g])).toEqual({ barcodes: ['05170012345678'] });
  });
  it('préfixe qui engloberait un autre jeu : seulement le code complet', () => {
    const g = game('Cash', { barcodes: ['04170012345678'] });
    const other = game('Astro', { barcodes: ['04175555555555'] });
    expect(learnFdjCode(g, '04179999999999', [g, other])).toEqual({ barcodes: ['04179999999999'] });
  });
  it('préfixe confirmé (« Oui » à « Ce ticket est-il un … ? ») : ajouté avec le code complet', () => {
    const g = game('Cash', { fdjCodes: ['87105'] });
    expect(learnFdjCode(g, '8710500100012', [g], { confirmedPrefix: '87105' })).toEqual({ barcodes: ['8710500100012'], fdjPrefixes: ['87105'] });
  });
  it('lit l’ancien préfixe unique (user.fdjPrefix) et le reprend dans fdjPrefixes', () => {
    const g = p('Cash', { kind: 'jeu-fdj', name: 'Cash' }, { fdjPrefix: '041700' });
    expect(learnFdjCode(g, '04171111111111', [g])).toEqual({ barcodes: ['04171111111111'], fdjPrefixes: ['0417'] });
  });
});

describe('codes de jeu : plusieurs préfixes, catalogue FDJ, traçabilité', () => {
  const cash = game('Cash', { fdjCodes: ['87103', '87104', '87105'] });
  const astro = game('Astro', { fdjCodes: ['84701'] });
  const ticket = '871050010001'; // 12 chiffres : jamais un EAN
  it('effectiveFields réunit les préfixes user, base, partagés et l’ancien fdjPrefix', () => {
    const g: Product = { ...p('G', { kind: 'jeu-fdj', name: 'G', fdjPrefix: '1111' }, { fdjPrefixes: ['2222'], fdjPrefix: '3333' }), sharedFdjPrefixes: ['4444'], sharedFdjPrefix: '5555' };
    expect(effectiveFields(g).fdjPrefixes?.sort()).toEqual(['1111', '2222', '3333', '4444', '5555']);
  });
  it('code de traçabilité refusé (KPL2F ou DataMatrix) : ni produit, ni jeu demandé', () => {
    expect(resolveScan('KPL2F0123456789ABCDEFGHIJ', [cash, astro])).toEqual({ type: 'traceability', code: 'KPL2F0123456789ABCDEFGHIJ' });
    expect(resolveScan('kpl2f-0123', [cash])).toMatchObject({ type: 'traceability' });
    expect(resolveScan('01234567AB89', [cash], { format: 'data_matrix' })).toMatchObject({ type: 'traceability' });
    // R4 : un DataMatrix fait seulement de chiffres n'est pas un code de traçabilité.
    expect(resolveScan('0123456789', [cash], { format: 'data_matrix' }).type).not.toBe('traceability');
    expect(resolveScan('KPL2F0123', [])).toMatchObject({ type: 'traceability' });
    expect(TRACEABILITY_MESSAGE).toBe('Ce code change à chaque paquet : scannez le code-barres classique (EAN) du paquet.');
  });
  it('format lu par la caméra : un code ITF ou Code 128 n’est jamais pris pour un EAN', () => {
    expect(resolveScan('96385074', [cash], { format: 'itf' })).toMatchObject({ type: 'ask-game' });
    expect(resolveScan('96385074', [cash], { format: 'ean_8' })).toMatchObject({ type: 'unknown-ean' });
    expect(resolveScan('96385074', [cash])).toMatchObject({ type: 'unknown-ean' });
  });
  it('préfixe du catalogue jamais confirmé : demande « Ce ticket est-il un … ? »', () => {
    expect(resolveScan(ticket, [cash, astro])).toEqual({ type: 'confirm-game', code: ticket, product: cash, prefix: '87105' });
  });
  it('préfixe confirmé : reconnu directement', () => {
    const confirmed = { ...cash, user: learnFdjCode(cash, ticket, [cash, astro], { confirmedPrefix: '87105' }) };
    expect(resolveScan('871050020005', [confirmed, astro])).toMatchObject({ type: 'product', product: { id: 'Cash' } });
  });
  it('préfixe partagé par un autre téléphone du tabac (user.fdjPrefixes) ou la liste commune : reconnu directement', () => {
    expect(resolveScan(ticket, [{ ...cash, sharedFdjPrefixes: ['87105'] }])).toMatchObject({ type: 'product' });
  });
  it('« Autre jeu » ne confirme pas le préfixe du catalogue', () => {
    const patch = learnFdjCode(astro, ticket, [cash, astro]);
    expect(patch.fdjPrefixes ?? []).not.toContain('87105');
    const after = [cash, { ...astro, user: patch }];
    expect(resolveScan(ticket, after)).toMatchObject({ type: 'product', product: { id: 'Astro' } }); // le code exact
    expect(resolveScan('871050099999', after)).toMatchObject({ type: 'confirm-game', product: { id: 'Cash' } });
  });
  it('plusieurs préfixes : le plus long gagne, le préfixe confirmé passe avant le catalogue', () => {
    const a = p('A', { kind: 'jeu-fdj', name: 'A' }, { fdjPrefixes: ['9999', '0417'] });
    const b = p('B', { kind: 'jeu-fdj', name: 'B' }, { fdjPrefixes: ['041700'] });
    expect(resolveScan('04170012345678', [a, b])).toMatchObject({ product: { id: 'B' } });
    expect(resolveScan('04179912345678', [a, b])).toMatchObject({ product: { id: 'A' } });
    expect(resolveScan('99990000', [a, b])).toMatchObject({ product: { id: 'A' } });
    const other = p('X', { kind: 'jeu-fdj', name: 'X' }, { fdjPrefixes: ['99887'] });
    expect(resolveScan('998870000001', [cash, other])).toMatchObject({ type: 'product', product: { id: 'X' } });
  });
  it('un préfixe d’un autre jeu qui empiète sur un numéro du catalogue ne l’emporte pas : on demande pour le jeu du catalogue', () => {
    const learned: Product = { ...p('X', { kind: 'jeu-fdj', name: 'X' }, { fdjPrefixes: ['8710500'] }), sharedFdjPrefixes: ['87104000'] };
    expect(resolveScan(ticket, [cash, learned])).toEqual({ type: 'confirm-game', code: ticket, product: cash, prefix: '87105' });
    expect(resolveScan('871040000123', [cash, learned])).toMatchObject({ type: 'confirm-game', product: { id: 'Cash' }, prefix: '87104' });
    // Le jeu du catalogue a son numéro confirmé dans ce tabac : reconnu directement.
    const confirmedCash = { ...cash, user: { fdjPrefixes: ['87105'] } };
    expect(resolveScan(ticket, [confirmedCash, learned])).toMatchObject({ type: 'product', product: { id: 'Cash' } });
    // Un code exact rattaché à X reste à X.
    const exact = { ...learned, user: { ...learned.user, barcodes: [ticket] } };
    expect(resolveScan(ticket, [cash, exact])).toMatchObject({ type: 'product', product: { id: 'X' } });
  });
  it('learnFdjCode n’apprend pas un préfixe qui empiète sur un numéro du catalogue d’un autre jeu', () => {
    const x = p('X', { kind: 'jeu-fdj', name: 'X' }, { barcodes: ['871040000001'] });
    expect(learnFdjCode(x, '871040000099', [cash, x])).toEqual({ barcodes: ['871040000001', '871040000099'] });
  });
  it('« C’est quel jeu ? » → choix du jeu → préfixe appris : le ticket suivant du carnet est reconnu directement', () => {
    const astroKnown = game('Astro2', { barcodes: ['05201234000001'] });
    const first = resolveScan('05201234000077', [cash, astroKnown]);
    expect(first).toMatchObject({ type: 'ask-game' });
    if (first.type !== 'ask-game') return;
    expect(first.candidates[0].id).toBe('Astro2');
    const learned = { ...astroKnown, user: learnFdjCode(astroKnown, first.code, [cash, astroKnown]) };
    expect(learned.user.fdjPrefixes).toEqual(['052012340000']);
    expect(resolveScan('05201234000045', [cash, learned])).toMatchObject({ type: 'product', product: { id: 'Astro2' } });
  });
  it('candidats de « C’est quel jeu ? » : le jeu du catalogue en tête', () => {
    expect(gameCandidates('871040000001', [astro, cash]).map((g) => g.id)).toEqual(['Cash', 'Astro']);
  });
  it('retirer un code : la référence ne le reconnaît plus', () => {
    const user = learnFdjCode(cash, ticket, [cash], { confirmedPrefix: '87105' });
    const withCode = { ...cash, user };
    expect(resolveScan(ticket, [withCode])).toMatchObject({ type: 'product' });
    const noPrefix = { ...cash, user: withoutUserCode(user, '87105') };
    expect(noPrefix.user).toEqual({ barcodes: [ticket] });
    expect(resolveScan('871050020005', [noPrefix])).toMatchObject({ type: 'confirm-game' });
    const none = { ...cash, user: withoutUserCode(noPrefix.user, ticket) };
    expect(none.user).toEqual({});
    expect(resolveScan(ticket, [none])).toMatchObject({ type: 'confirm-game' });
    // ancien préfixe unique
    expect(withoutUserCode({ fdjPrefix: '0417', fdjPrefixes: ['0417', '0520'] }, '0417')).toEqual({ fdjPrefixes: ['0520'] });
  });
  it('un même code ajouté comme code-barres et comme préfixe : une seule ligne, un seul « Retirer »', () => {
    const g = p('G', { kind: 'jeu-fdj', name: 'G' }, { barcodes: ['87105', '871050010001'], fdjPrefixes: ['87105'] });
    expect(codeRows(g)).toEqual([
      { code: '87105', type: 'prefix', origin: 'ajouté ici', removable: true },
      { code: '871050010001', type: 'code', origin: 'ajouté ici', removable: true },
    ]);
  });
  it('ajouter un code-barres à une référence : plusieurs codes, sans doublon', () => {
    expect(withUserBarcode({}, '3017620422003')).toEqual({ barcodes: ['3017620422003'] });
    expect(withUserBarcode({ barcodes: ['3017620422003'] }, '3017620422010')).toEqual({ barcodes: ['3017620422003', '3017620422010'] });
    expect(withUserBarcode({ barcodes: ['3017620422003'] }, '3017620422003')).toEqual({ barcodes: ['3017620422003'] });
  });
  it('liste des codes de la fiche : officiels et partagés sans « Retirer », ajoutés ici avec (un code aussi dans la liste commune reste reconnu : pas de « Retirer »)', () => {
    const g: Product = { ...p('G', { kind: 'cigarette', name: 'G', barcodes: ['111111'] }, { barcodes: ['222222', '333333'], fdjPrefixes: ['4444'] }), sharedBarcodes: ['333333', '555555'] };
    expect(codeRows(g)).toEqual([
      { code: '111111', type: 'code', origin: 'officiel', removable: false },
      { code: '333333', type: 'code', origin: 'partagé', removable: false },
      { code: '555555', type: 'code', origin: 'partagé', removable: false },
      { code: '222222', type: 'code', origin: 'ajouté ici', removable: true },
      { code: '4444', type: 'prefix', origin: 'ajouté ici', removable: true },
    ]);
  });
});

describe('createScanDebouncer', () => {
  it('ignore le même code dans la fenêtre de 1,5 s', () => {
    const accept = createScanDebouncer();
    expect(accept('A', 0)).toBe(true);
    expect(accept('A', 1000)).toBe(false);
    expect(accept('B', 1100)).toBe(true);
    expect(accept('A', 2600)).toBe(true);
  });
});

describe('attachCodePatch (rattacher un code à une fiche existante)', () => {
  const cig = p('cig', { kind: 'cigarette', name: 'Cig' });
  const cash = game('cash', { barcodes: ['04170012345678'] });
  it('tabac : le code-barres rejoint la couche user', () => {
    expect(attachCodePatch(cig, '3017620422003', [cig, cash])).toEqual({ barcodes: ['3017620422003'] });
  });
  it('jeu existant + EAN : code ajouté tel quel, aucun préfixe appris (un EAN ne désigne pas une série de tickets)', () => {
    const g = game('g', {}, );
    const known = { ...g, user: { barcodes: ['3760000000017'] } };
    expect(attachCodePatch(known, '3760000000024', [known, cig])).toEqual({ barcodes: ['3760000000017', '3760000000024'] });
  });
  it('jeu existant + ticket : comme au comptage (code complet et préfixe appris)', () => {
    expect(attachCodePatch(cash, '04170099999999', [cash])).toEqual(learnFdjCode(cash, '04170099999999', [cash]));
  });
  it('jeu existant + ticket confirmé : le numéro du catalogue est retenu', () => {
    expect(attachCodePatch(cash, '8710500100012', [cash], { confirmedPrefix: '87105' })).toEqual({ barcodes: ['8710500100012'], fdjPrefixes: ['87105'] });
  });
  it('après rattachement, le scan de l’EAN ouvre le jeu', () => {
    const after = { ...cash, user: attachCodePatch(cash, '3760000000024', [cash]) };
    expect(resolveScan('3760000000024', [cig, after])).toEqual({ type: 'product', product: after });
  });
});
