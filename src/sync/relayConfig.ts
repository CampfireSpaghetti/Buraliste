/**
 * Adresse du relais (VITE_RELAY_URL, fixée à la construction). Vide ou absente : relais non configuré,
 * l'app se comporte comme avant (aucune opération mise en file). Lue à chaque appel pour que les tests
 * puissent la changer avec `vi.stubEnv`.
 */
export function relayUrl(): string | undefined {
  const v: unknown = import.meta.env.VITE_RELAY_URL;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}
