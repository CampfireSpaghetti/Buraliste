// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMemoryStore } from '../../relay/src/memoryStore.ts';
import { createD1Store } from '../../relay/src/d1Store.ts';
import { storeContract } from './storeContract.ts';
import { createFakeD1 } from './fakeD1.ts';

storeContract('mémoire', () => createMemoryStore());
storeContract('D1 (sql.js)', () => createD1Store(createFakeD1().d1));

describe('Store D1', () => {
  it('le schéma peut être rejoué sans erreur (déploiements successifs)', () => {
    const { db } = createFakeD1();
    const schema = readFileSync(new URL('../../relay/schema.sql', import.meta.url), 'utf8');
    expect(() => db.exec(schema)).not.toThrow();
  });

  it('200 messages en un envoi, en une seule requête SQL', async () => {
    const { d1 } = createFakeD1();
    let queries = 0;
    const counting = {
      prepare: (q: string) => {
        queries++;
        return d1.prepare(q);
      },
      batch: d1.batch.bind(d1),
    };
    const s = createD1Store(counting);
    await s.createChannel('c1', 'h', 1);
    queries = 0;
    const msgs = Array.from({ length: 200 }, (_, k) => ({ iv: 'i' + k, data: 'd' + k }));
    const last = await s.appendMessages('c1', msgs, 100);
    expect(queries).toBeLessThanOrEqual(2);
    const list = await s.listMessages('c1', 0, 500);
    expect(list).toHaveLength(200);
    expect(list[199]).toEqual({ n: last, iv: 'i199', data: 'd199' });
  });

  it('appendMessages sur un canal inconnu échoue sans rien écrire', async () => {
    const s = createD1Store(createFakeD1().d1);
    await expect(s.appendMessages('inconnu', [{ iv: 'a', data: 'b' }], 1)).rejects.toThrow();
    expect(await s.listMessages('inconnu', 0, 10)).toEqual([]);
  });
});
