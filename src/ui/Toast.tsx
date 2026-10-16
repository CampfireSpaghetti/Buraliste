import { useEffect } from 'react';

/** Message temporaire en bas d'écran, avec une action facultative (ex. Annuler). */
export function Toast({ message, action, onAction, onDone, ms = 5000 }: { message: string; action?: string; onAction?: () => void; onDone: () => void; ms?: number }) {
  useEffect(() => {
    const t = setTimeout(onDone, ms);
    return () => clearTimeout(t);
  }, [onDone, ms]);
  return (
    <div className="toast" role="status">
      <span>{message}</span>
      {action && <button type="button" onClick={onAction}>{action}</button>}
    </div>
  );
}
