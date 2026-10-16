import { describe, it, expect } from 'vitest';
import { inviteAction, scannedInvite } from '../../src/tabacs/invite';
import { encodeTabacInvite, type TabacEntry } from '../../src/tabacs/registry';
import { SYNC_LABELS, syncLabel, syncSentence } from '../../src/sync/statusLabels';

const KEY_A = 'A'.repeat(43);
const KEY_B = 'B'.repeat(43);
const entry = (id: string, name: string, key: string): TabacEntry => ({ id, name, key, addedAt: 0 });
const tabacs = [entry('principal', 'Mon tabac', KEY_A), entry('x1', 'Tabac de la Gare', KEY_B)];

describe('inviteAction', () => {
  it('nouvelle clé : on ajoute le tabac', () => {
    expect(inviteAction({ name: 'Tabac du Centre', key: 'C'.repeat(43) }, tabacs, 'principal')).toEqual({ type: 'ajouter' });
  });
  it('clé déjà présente (même renommé) : on passe simplement à ce tabac', () => {
    expect(inviteAction({ name: 'Ancien nom', key: KEY_B }, tabacs, 'principal')).toEqual({ type: 'changer', id: 'x1' });
  });
  it('clé du tabac courant : déjà dedans', () => {
    expect(inviteAction({ name: 'Tabac de la Gare', key: KEY_B }, tabacs, 'x1')).toEqual({ type: 'deja' });
  });
});

describe('scannedInvite', () => {
  it('pas une invitation : undefined', () => {
    expect(scannedInvite('3017620422003')).toBeUndefined();
    expect(scannedInvite('LACAROTTE1:abc')).toBeUndefined();
  });
  it('invitation lisible', () => {
    expect(scannedInvite(encodeTabacInvite({ name: 'Tabac de la Gare', key: KEY_B }))).toEqual({ ok: true, invite: { name: 'Tabac de la Gare', key: KEY_B } });
  });
  it('invitation abîmée : reconnue mais illisible', () => {
    expect(scannedInvite('LACAROTTE2:pas-du-json')).toEqual({ ok: false });
  });
});

describe('libellés de synchronisation', () => {
  it('aria-label du point, pour chaque statut', () => {
    expect(syncLabel('ok')).toBe('Synchronisation : à jour');
    expect(syncLabel('attente')).toBe('Synchronisation : envoi en attente');
    expect(syncLabel('hors-ligne')).toBe('Synchronisation : hors ligne');
    expect(syncLabel('erreur')).toBe('Synchronisation : erreur');
    expect(syncLabel('refuse')).toBe('Synchronisation : accès refusé');
    expect(Object.keys(SYNC_LABELS)).toHaveLength(5);
  });
  it('phrase de Réglages : accès refusé, données gardées', () => {
    expect(syncSentence('refuse')).toBe('Ce téléphone n’a plus accès à ce tabac.');
    expect(syncSentence('erreur')).toMatch(/nouvelle tentative/i);
    expect(syncSentence('hors-ligne')).toMatch(/retour du réseau/);
  });
});
