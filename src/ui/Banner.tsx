import type { ReactNode } from 'react';

export function Banner({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="banner" role="status">
      <span>{children}</span>
      {actions && <span className="banner-actions">{actions}</span>}
    </div>
  );
}
