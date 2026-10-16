import { useEffect, useState } from 'react';
import './carotte.css';

export function Carotte({ bounce = 0, size = 44 }: { bounce?: number; size?: number }) {
  const [anim, setAnim] = useState(false);
  useEffect(() => {
    if (!bounce) return;
    setAnim(true);
    const t = setTimeout(() => setAnim(false), 750);
    return () => clearTimeout(t);
  }, [bounce]);
  return (
    <span
      className={'carotte' + (anim ? ' bounce' : '')}
      style={{ width: size / 2, height: size }}
      aria-hidden="true"
    />
  );
}
