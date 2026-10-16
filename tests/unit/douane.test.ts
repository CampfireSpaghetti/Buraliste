import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { parseNomenclature, normalizeRef } from '../../scripts/douane/parseNomenclature';
import { findLatestOdsUrl } from '../../scripts/douane/findLatest';
import { readOdsRows } from '../../scripts/douane/readOds';

const rows: string[][] = JSON.parse(readFileSync('tests/fixtures/douane-rows.json', 'utf8'));
const listing = readFileSync('tests/fixtures/douane-listing.html', 'utf8');
const file = parseNomenclature(rows, 'https://example.test/n.ods');
const byName = (name: string) => file.items.find((i) => i.name === name)!;

describe('parseNomenclature', () => {
  it('lit la date d’effet', () => {
    expect(file.effectiveDate).toBe('2026-11-01');
  });
  it('produit inchangé', () => {
    expect(byName('Lucky Strike Bleu, en 20 unités')).toMatchObject({
      kind: 'cigarette', price: 13, status: 'inchange', format: '20 unités', brand: 'Lucky', manufacturer: 'BRITISH AMERICAN TOBACCO',
    });
  });
  it('cigarillo détecté dans la famille cigares', () => {
    expect(byName('Lucky Strike Cigarillos, en 10 cigares').kind).toBe('cigarillo');
    expect(byName('Montecristo Herederos (LCDH+HS), en 20 cigares').kind).toBe('cigare');
  });
  it('retrait', () => {
    expect(byName('Montecristo Fragata (T.R.), en 20 cigares')).toMatchObject({ status: 'retrait', price: 310 });
  });
  it('nouveau produit', () => {
    expect(byName('Pall Mall Red, en 20 unités')).toMatchObject({ status: 'nouveau', price: 11.2 });
  });
  it('produit renommé avec changement de prix', () => {
    const it = byName('Royale Fresh Ssl, en 20 unités');
    expect(it).toMatchObject({ price: 11.2, previousPrice: 11.5 });
    expect(it.previousRef).toBe(normalizeRef('SEITA', 'Royale Evolved Fusion Ssl, en 20 unités'));
  });
  it('prix modifié', () => {
    expect(byName('Elixyr Ice (pot), en 50 g')).toMatchObject({ kind: 'autre-tabac', price: 14.8, previousPrice: 14.2, status: 'inchange' });
  });
  it('tabac à rouler', () => {
    expect(byName('Ajja blond (blague), en 30 g')).toMatchObject({ kind: 'tabac-rouler', format: '30 g' });
  });
  it('ignore les lignes d’en-tête du tableau', () => {
    expect(file.items.some((i) => i.name.startsWith('RÉFÉRENCE') || i.name.startsWith('DÉSIGNATION'))).toBe(false);
  });
  it('doublons : même libellé chez deux fabricants donne deux ref, doublon exact gardé une fois', () => {
    const communs = file.items.filter((i) => i.name === 'Marque Commune, en 20 unités');
    expect(communs.map((c) => c.manufacturer)).toEqual(['TEST UN', 'TEST DEUX']);
    expect(new Set(file.items.map((i) => i.ref)).size).toBe(file.items.length);
  });
  it('produit listé chez deux fournisseurs : la version encore en vente l’emporte sur le retrait', () => {
    const c = file.items.filter((i) => i.name === 'Corleone Cupola (coffret bois), en 15 cigares');
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ status: 'inchange', price: 240 });
  });
  it('version = date + empreinte', () => {
    expect(file.version).toMatch(/^2026-11-01-[0-9a-f]{8}$/);
  });
});

describe('normalizeRef', () => {
  it('normalise espaces insécables, doubles espaces et casse', () => {
    expect(normalizeRef('PHILIP MORRIS', 'Philip Morris S À  tuber (pot), en 30 g')).toBe('philip morris|philip morris s à tuber (pot), en 30 g');
  });
});

describe('findLatestOdsUrl', () => {
  it('choisit la date d’effet la plus récente, pas le premier lien', () => {
    expect(findLatestOdsUrl(listing)).toBe('https://www.douane.gouv.fr/sites/default/files/2026-10/06/Maquette%20JORF%201er%20novembre%202026.ods');
  });
});

describe('readOdsRows', () => {
  it('lit une grille avec cellules répétées et espaces', () => {
    const xml = `<?xml version="1.0"?><office:document-content xmlns:office="o" xmlns:table="t" xmlns:text="x"><office:body><office:spreadsheet>
<table:table table:name="Feuille1">
<table:table-row><table:table-cell><text:p>A<text:s/>B</text:p></table:table-cell><table:table-cell table:number-columns-repeated="3"><text:p>x</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell/><table:table-cell><text:p>13,50</text:p></table:table-cell><table:table-cell table:number-columns-repeated="1000"/></table:table-row>
</table:table><table:table table:name="Feuille2"><table:table-row><table:table-cell><text:p>autre</text:p></table:table-cell></table:table-row></table:table>
</office:spreadsheet></office:body></office:document-content>`;
    const ods = zipSync({ 'content.xml': strToU8(xml), mimetype: strToU8('application/vnd.oasis.opendocument.spreadsheet') });
    expect(readOdsRows(ods)).toEqual([
      ['A B', 'x', 'x', 'x', '', ''],
      ['', '13,50', '', '', '', ''],
    ]);
  });
});
