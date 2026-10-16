const p = (id: string, base: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id, source: 'douane', douaneRef: 'x|' + id, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0,
  base: { kind: 'cigarette', effectiveDate: '2026-11-01', status: 'inchange', ...base }, user: {}, ...extra,
});

export const catalogSeed = {
  products: [
    p('camel', { name: 'Camel Filters (paquet rigide), en 20 unités', brand: 'Camel', format: '20 unités', price: 13, strength: 4, tasteTags: ['corsé', 'torréfié'], origin: 'États-Unis' }),
    p('winston', { name: 'Winston Classic (paquet rigide), en 20 unités', brand: 'Winston', format: '20 unités', price: 13, strength: 4, tasteTags: ['corsé'], origin: 'États-Unis' }),
    p('lucky', { name: 'Lucky Strike Red, en 20 unités', brand: 'Lucky', format: '20 unités', price: 13, strength: 4, tasteTags: ['corsé', 'torréfié'], origin: 'États-Unis' }),
    p('marlboro', { name: 'Marlboro Red (paquet rigide), en 20 unités', brand: 'Marlboro', format: '20 unités', price: 13, strength: 4, tasteTags: ['corsé'], origin: 'États-Unis' }, { outOfStock: true }),
    p('dunhill-r', { name: 'Dunhill rouge, en 20 unités', brand: 'Dunhill', format: '20 unités', price: 14, strength: 4, tasteTags: ['corsé', 'boisé'], origin: 'Royaume-Uni' }),
    p('dunhill-b', { name: 'Dunhill bleu, en 20 unités', brand: 'Dunhill', format: '20 unités', price: 14, strength: 3, tasteTags: ['équilibré', 'boisé'], origin: 'Royaume-Uni' }),
    p('cohiba', { kind: 'cigare', name: 'Cohiba Club, en 20 cigares', brand: 'Cohiba', format: '20 cigares', price: 36.4, strength: 3, origin: 'Cuba' }),
    p('pallmall', { name: 'Pall Mall Red, en 20 unités', brand: 'Pall', format: '20 unités', price: 11.2, status: 'nouveau' }),
  ],
};
