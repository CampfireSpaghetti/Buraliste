import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { frDateTime, num, parseAutres, parseCigarettes, parseComposition, parseCsv } from '../../scripts/anses/parseAnses';
import { matchToDouane, type AnsesProduct } from '../../scripts/anses/matchDouane';
import { buildComposition } from '../../scripts/anses/buildComposition';
import { applyAnsesBarcodes } from '../../scripts/anses/applyBarcodes';
import { mergeReferences, type RefItem, type ReferenceFile } from '../../src/domain/catalog';
import type { CompositionFile } from '../../src/domain/composition';
import type { Kind } from '../../src/domain/types';

const fixture = (name: string) => readFileSync(`tests/fixtures/anses/${name}`, 'utf8');
const cigarettes = parseCigarettes(fixture('liste-fr-cigarettes.csv'));
const autres = parseAutres(fixture('liste-fr-autres-produits.csv'));
const composition = parseComposition(fixture('composition-fr-tabac.csv'));
const all: AnsesProduct[] = [...cigarettes, ...autres];

/** Référence Douane comme la produit le script Douane (clé « fabricant|désignation »). */
const ref = (name: string, kind: Kind = 'cigarette', manufacturer = 'FAB'): RefItem => ({
  ref: `${manufacturer.toLowerCase()}|${name.toLowerCase()}`, kind, name, manufacturer, status: 'inchange',
  ...(/, en (.+)$/.exec(name) ? { format: /, en (.+)$/.exec(name)![1] } : {}),
});
const code = (start: string) => {
  const p = all.find((x) => x.code.startsWith(start));
  if (!p) throw new Error('absent des fixtures : ' + start);
  return p.code;
};

describe('lecture des fichiers ANSES', () => {
  it('CSV « ; » : guillemets, guillemets doublés, champs vides, BOM', () => {
    expect(parseCsv('﻿"a";"b";c\n"x ""y""";;3.5\r\n"z;w";"";\n')).toEqual([['a', 'b', 'c'], ['x "y"', '', '3.5'], ['z;w', '', '']]);
  });
  it('dates mixtes (jour/mois non complétés, avec ou sans guillemets) et notation scientifique', () => {
    expect(frDateTime('5/9/2019 08:14:00')).toBe('2019-09-05T08:14:00');
    expect(frDateTime('13/01/2026 13:10:25')).toBe('2026-01-13T13:10:25');
    expect(frDateTime('')).toBe('');
    expect(num('4.61100569259962e-04')).toBeCloseTo(0.000461100569, 9);
    expect(num('8.23')).toBe(8.23);
    expect(num('')).toBeUndefined();
    expect(num('abc')).toBeUndefined();
  });
  it('cigarettes : marque, sous-type, paquet, numéro, émissions, date du dossier', () => {
    expect(cigarettes).toHaveLength(26);
    expect(cigarettes.find((p) => p.code === '1637 ORIGINE [4A27B949A67924C5]')).toEqual({
      code: '1637 ORIGINE [4A27B949A67924C5]', categorie: 'cigarette', marque: '1637', sousType: 'Origine',
      unites: 20, conditionnement: 'Boîte à couvercle supérieur rabattable, bord droit', numero: '3258170830010',
      majLe: '2026-01-13T13:10:25', goudron: 8.23, nicotine: 0.56, co: 9.92,
    });
  });
  it('autres produits : tabac à rouler (poids), cigare, cigarillo', () => {
    expect(autres.find((p) => p.code.startsWith('DRUM BLEU'))).toMatchObject({ categorie: 'tabac-rouler', marque: 'Drum Bleu', poids: 30, conditionnement: 'Pochette à rabat', numero: '058527' });
    expect(autres.find((p) => p.code.startsWith('COHIBA SIGLO I [4DBE'))).toMatchObject({ categorie: 'cigare', unites: 25 });
    expect(autres.filter((p) => p.categorie === 'cigarillo')).toHaveLength(2);
  });
  it('composition : ingrédient, fonction, brûlé / non brûlé', () => {
    const lines = composition.filter((r) => r.code === '1637 ORIGINE [4A27B949A67924C5]');
    expect(lines[0]).toEqual({ code: '1637 ORIGINE [4A27B949A67924C5]', nom: 'TABAC (TYPE: BURLEY, SECHAGE: AIR)', fonction: 'Tabac', brule: true });
    expect(lines.find((r) => r.nom === 'CELLULOSE DIACETATE POLYMER')?.brule).toBe(false);
  });
  it('fichier au format inattendu (colonne manquante) : erreur, pas de liste vide', () => {
    expect(() => parseCigarettes('"Code_Référence";"Nom_Marque_Produit"\n"x";"y"\n')).toThrow(/colonne/i);
  });
});

describe('matchToDouane', () => {
  it('un rapprochement exact réussit (marque, variante, format, paquet ; déclaration la plus récente)', () => {
    const refs = [
      ref('Marlboro Gold (paquet rigide), en 20 unités'),
      ref('Marlboro Red (paquet souple), en 20 unités'),
      ref('Marlboro Red (paquet rigide), en 20 unités'),
      ref('Marlboro Red, en 20 unités'),
      ref('Lucky Strike red XL, en 25 unités'),
      ref("Lucky Strike red longues (100's), en 20 unités"),
      ref('Gauloises Blondes Bleu, en 20 unités'),
      ref('Gauloises Blondes Bleu XXL, en 30 unités'),
      ref('Peter Stuyvesant bleu by Dunhill, en 20 unités'),
      ref('Gitanes Bleu (filtre), en 20 unités'),
      ref('Drum Bleu (blague), en 30 g', 'tabac-rouler'),
      ref('Cohiba Siglo I, en 25 cigares', 'cigare'),
      ref('Davidoff mini cigarillos silver, en 20 cigares', 'cigarillo'),
    ];
    const m = matchToDouane(all, refs);
    expect(m.get(refs[0].ref)).toBe('MARLBORO GOLD HARD PACK - 20 CIGARETTES [0B58B531C99F18D9]');
    expect(m.get(refs[1].ref)).toBe(code('MARLBORO RED SOFT PACK'));
    expect(m.get(refs[2].ref)).toBe('MARLBORO RED HARD PACK - 20 CIGARETTES [2B991D910E44EABC]');
    expect(m.get(refs[3].ref)).toBe('MARLBORO RED HARD PACK - 20 CIGARETTES [2B991D910E44EABC]'); // paquet non précisé : rigide
    expect(m.get(refs[4].ref)).toBe('LUCKY STRIKE RED XL [1D658D735EBDD438]');
    expect(m.get(refs[5].ref)).toBe('LUCKY STRIKE RED LONGUES [68C7BE692B94B13C]'); // « longues » = « 100's »
    expect(m.get(refs[6].ref)).toBe('GAULOISES BLONDES BLEU [0F19461DB556FC48]'); // 2026 plutôt que 2020
    expect(m.get(refs[7].ref)).toBe('GAULOISES BLONDES BLEU [12537B69C330CD7E]');
    expect(m.get(refs[8].ref)).toBe(code('PETER STUYVESANT BLEU BY DUNHILL'));
    expect(m.get(refs[9].ref)).toBe(code('GITANES BLEU (FILTRE) [1E3D'));
    expect(m.get(refs[10].ref)).toBe(code('DRUM BLEU'));
    expect(m.get(refs[11].ref)).toBe(code('COHIBA SIGLO I [4DBE'));
    expect(m.get(refs[12].ref)).toBe('DAVIDOFF MINI CIGARILLOS SILVER [1631AFF8DE0D519F]');
    expect(m.size).toBe(refs.length);
  });

  it('ambigu non rapproché : « Marlboro Gold » et « Marlboro Gold Touch » ne se confondent pas', () => {
    const gold = ref('Marlboro Gold, en 20 unités');
    const touch = ref('Marlboro Gold Touch, en 20 unités');
    const both = matchToDouane(all, [gold, touch]);
    expect(both.get(gold.ref)).toBe('MARLBORO GOLD HARD PACK - 20 CIGARETTES [0B58B531C99F18D9]');
    expect(both.get(touch.ref)).toBe('MARLBORO GOLD TOUCH HARD PACK - 20 CIGARETTES [T0B58B531C99F18D9]');
    // L'une sans l'autre : jamais la variante voisine (ni la version « Duty Free » ou 100s).
    const noTouch = all.filter((p) => !p.code.includes('TOUCH'));
    expect(matchToDouane(noTouch, [touch]).has(touch.ref)).toBe(false);
    const noGold = all.filter((p) => !p.code.startsWith('MARLBORO GOLD HARD PACK'));
    expect(matchToDouane(noGold, [gold]).has(gold.ref)).toBe(false);
  });

  it('ambigu non rapproché : deux produits aussi proches (pochette et boîte, sans précision côté Douane)', () => {
    const pouch = all.find((p) => p.code.startsWith('DRUM BLEU'))!;
    const tin: AnsesProduct = { ...pouch, code: 'DRUM BLEU [BOITE]', conditionnement: 'Boîte cylindrique en métal' };
    const drum = ref('Drum Bleu, en 30 g', 'tabac-rouler');
    expect(matchToDouane([pouch, tin], [drum]).has(drum.ref)).toBe(false);
    // Précisé côté Douane (« blague ») : la pochette.
    const blague = ref('Drum Bleu (blague), en 30 g', 'tabac-rouler');
    expect(matchToDouane([pouch, tin], [blague]).get(blague.ref)).toBe(pouch.code);
  });

  it('format différent, autre catégorie ou « Duty Free » : jamais rapproché', () => {
    const refs = [
      ref('Drum Bleu (blague), en 50 g', 'tabac-rouler'),
      ref('Gauloises Blondes Bleu, en 25 unités'),
      ref('Drum Bleu, en 30 unités'),
    ];
    expect(matchToDouane(all, refs).size).toBe(0);
    const dutyFreeOnly = all.filter((p) => p.code.includes('DUTY FREE'));
    expect(matchToDouane(dutyFreeOnly, [ref('Marlboro Gold, en 20 unités')]).size).toBe(0);
  });
});

describe('buildComposition', () => {
  const refs = [
    ref('Marlboro Gold (paquet rigide), en 20 unités', 'cigarette', 'PMI'),
    ref('1637 Origine, en 20 unités', 'cigarette', 'DIVERS LOGISTA'),
    ref('Drum Bleu (blague), en 30 g', 'tabac-rouler', 'SEITA'),
    ref('Produit inconnu, en 20 unités'),
  ];
  const build = (over: Partial<Parameters<typeof buildComposition>[0]> = {}) =>
    buildComposition({ products: all, composition, refs, date: '2026-07-01', source: 'https://example.test/anses', fetchedAt: '2026-10-22', ...over });

  it('émissions par cigarette, ingrédients sans doublon, EAN valides, seulement les références rapprochées', () => {
    const { file, stats } = build();
    expect(Object.keys(file.produits).sort()).toEqual([refs[1].ref, refs[0].ref, refs[2].ref].sort());
    expect(file).toMatchObject({ date: '2026-07-01', source: 'https://example.test/anses', fetchedAt: '2026-10-22' });
    expect(file.version).toMatch(/^2026-07-01-[0-9a-f]{8}$/);
    const origine = file.produits[refs[1].ref];
    expect(origine).toMatchObject({ goudron: 8.23, nicotine: 0.56, co: 9.92, ean: ['3258170830010'] });
    expect(origine.ingredients[0]).toEqual({ nom: 'Tabac (type: burley, sechage: air)', fonction: 'Tabac', brule: true });
    // Même nom, brûlé et non brûlé : deux lignes.
    expect(origine.ingredients.filter((i) => i.nom === 'Cellulose pulp').map((i) => i.brule)).toEqual([true, false]);
    // Numéro interne (POM.…) : pas d'EAN.
    expect(file.produits[refs[0].ref]).toMatchObject({ nicotine: expect.any(Number), ean: [] });
    // Tabac à rouler : la teneur en nicotine du fichier n'a pas d'unité sûre, elle n'est pas reprise.
    const drum = file.produits[refs[2].ref];
    expect(drum.nicotine).toBeUndefined();
    expect(drum.goudron).toBeUndefined();
    expect(drum.ingredients.length).toBeGreaterThan(0);
    expect(stats.cigarette).toEqual({ total: 3, matched: 2 });
    expect(stats['tabac-rouler']).toEqual({ total: 1, matched: 1 });
  });

  it('un EAN rattaché à deux références Douane est écarté (un code = une référence)', () => {
    const twin = ref('1637 Origine, en 20 unités', 'cigarette', 'AUTRE FOURNISSEUR');
    const { file } = build({ refs: [...refs, twin] });
    expect(file.produits[refs[1].ref].ean).toEqual([]);
    expect(file.produits[twin.ref].ean).toEqual([]);
    expect(file.produits[twin.ref].goudron).toBe(8.23);
  });

  it('même contenu : même version (rien à publier)', () => {
    const a = build().file;
    const b = build({ fetchedAt: '2026-10-29', previous: a });
    expect(b.changed).toBe(false);
    expect(b.file).toBe(a);
  });
});

describe('codes-barres ANSES dans la liste officielle', () => {
  const items = [
    { ref: 'fab|a', kind: 'cigarette', name: 'A, en 20 unités', manufacturer: 'FAB', status: 'inchange', price: 12 },
    { ref: 'fab|b', kind: 'cigarette', name: 'B, en 20 unités', manufacturer: 'FAB', status: 'inchange', price: 12, barcodes: ['0000000000000'] },
  ] as RefItem[];
  const refFile: ReferenceFile = { version: '2026-11-01-00000000', effectiveDate: '2026-11-01', source: 's', items };
  const comp = { version: 'v', fetchedAt: '', date: '2026-07-01', source: '', produits: {
    'fab|a': { ingredients: [], ean: ['3258170830010'] },
  } } as CompositionFile;

  it('ajoute les EAN aux références rapprochées (anciens codes ANSES retirés), nouvelle version seulement si changé', () => {
    const out = applyAnsesBarcodes(refFile, comp);
    expect(out.items[0].barcodes).toEqual(['3258170830010']);
    expect(out.items[1].barcodes).toBeUndefined();
    expect(out.version).not.toBe(refFile.version);
    expect(out.version.startsWith('2026-11-01-')).toBe(true);
    expect(applyAnsesBarcodes(out, comp).version).toBe(out.version);
  });

  it('la fusion Douane les met dans les codes officiels (base), jamais dans user', () => {
    const out = applyAnsesBarcodes(refFile, comp);
    const ops = mergeReferences([], out, [], 1);
    const a = ops.put.find((p) => p.douaneRef === 'fab|a')!;
    expect(a.base.barcodes).toEqual(['3258170830010']);
    expect(a.user).toEqual({});
  });
});
