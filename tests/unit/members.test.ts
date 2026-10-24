import { describe, it, expect } from 'vitest';
import { generateDeviceKeys, generateTabacKey, unwrapKey, wrapKeyFor } from '../../src/sync/crypto';
import { activeLabel, canDemote, canManage, hasManager, visibleMembers } from '../../src/domain/members';
import type { Member } from '../../src/domain/types';

const m = (id: string, over: Partial<Member> = {}): Member => ({ id, name: id, role: 'employe', pub: '', joinedAt: 0, lastSeen: 0, ...over });

describe('clé du tabac emballée pour chaque téléphone', () => {
  it('chaque membre retrouve la nouvelle clé ; un autre téléphone, ou un autre id, non', async () => {
    const [a, b, x] = await Promise.all([generateDeviceKeys(), generateDeviceKeys(), generateDeviceKeys()]);
    const k2 = generateTabacKey();
    const rot = await wrapKeyFor(k2, [{ id: 'a', pub: a.pub }, { id: 'b', pub: b.pub }]);
    expect(Object.keys(rot.wraps).sort()).toEqual(['a', 'b']);
    expect(await unwrapKey(rot, 'a', a.priv)).toBe(k2);
    expect(await unwrapKey(rot, 'b', b.priv)).toBe(k2);
    expect(await unwrapKey(rot, 'x', x.priv)).toBeUndefined(); // pas dans la liste
    expect(await unwrapKey(rot, 'a', x.priv)).toBeUndefined(); // mauvaise clé privée
    expect(await unwrapKey({ ...rot, wraps: { b: rot.wraps.a } }, 'b', a.priv)).toBeUndefined(); // id échangé
    expect(await unwrapKey({ epub: 'abîmé', wraps: rot.wraps }, 'a', a.priv)).toBeUndefined();
    expect(JSON.stringify(rot)).not.toContain(k2);
  });
  it('un membre sans clé publique valide est sauté', async () => {
    const a = await generateDeviceKeys();
    const rot = await wrapKeyFor(generateTabacKey(), [{ id: 'a', pub: a.pub }, { id: 'vieux', pub: '' }, { id: 'abime', pub: 'zz' }]);
    expect(Object.keys(rot.wraps)).toEqual(['a']);
  });
});

describe('membres et rôles', () => {
  it('liste : gérants d’abord, puis par nom ; retirés absents', () => {
    const list = [m('3', { name: 'zoé' }), m('1', { name: 'Ali', role: 'gerant' }), m('2', { name: 'Éric' }), m('4', { name: 'Bob', removed: true }), m('5', { name: '' })];
    expect(visibleMembers(list).map((x) => x.id)).toEqual(['1', '5', '2', '3']);
  });
  it('sans gérant, tout le monde gère ; avec un gérant, lui seul ; le dernier gérant garde son rôle', () => {
    const none = [m('a'), m('b')];
    expect(hasManager(none)).toBe(false);
    expect(canManage(none, 'b')).toBe(true);
    const one = [m('a', { role: 'gerant' }), m('b')];
    expect(canManage(one, 'a')).toBe(true);
    expect(canManage(one, 'b')).toBe(false);
    expect(canDemote(one, 'a')).toBe(false);
    const two = [m('a', { role: 'gerant' }), m('b', { role: 'gerant' }), m('c', { role: 'gerant', removed: true })];
    expect(canDemote(two, 'a')).toBe(true);
  });
  it('dernière activité en mots', () => {
    const now = 10 * 86_400_000;
    expect(activeLabel(now - 60_000, now)).toBe('actif maintenant');
    expect(activeLabel(now - 25 * 60_000, now)).toBe('actif il y a 25 min');
    expect(activeLabel(now - 2 * 3_600_000, now)).toBe('actif il y a 2 h');
    expect(activeLabel(now - 3 * 86_400_000, now)).toBe('actif il y a 3 jours');
    expect(activeLabel(now - 86_400_000, now)).toBe('actif il y a 1 jour');
    expect(activeLabel(0, now)).toBe('jamais vu');
  });
});
