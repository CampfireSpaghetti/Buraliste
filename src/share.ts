/** Ouvre le menu Partager du téléphone avec un fichier. L'app n'a aucun accès aux applications choisies (Drive…). */
export function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

export async function shareFile(file: File): Promise<'shared' | 'cancelled' | 'fallback'> {
  if (!canShareFile(file)) return 'fallback';
  try {
    await navigator.share({ files: [file], title: file.name });
    return 'shared';
  } catch (e) {
    return (e as DOMException).name === 'AbortError' ? 'cancelled' : 'fallback';
  }
}
