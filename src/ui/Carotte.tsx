import { useEffect, useState } from 'react';
import logo from '../assets/logo.png';
import './carotte.css';

/** Logo de l'en-tête (l'icône de l'app) : il sautille à chaque scan réussi. */
export function Carotte({ bounce = 0, size = 40 }: { bounce?: number; size?: number }) {
  const [anim, setAnim] = useState(false);
  useEffect(() => {
    if (!bounce) return;
    setAnim(true);
    const t = setTimeout(() => setAnim(false), 750);
    return () => clearTimeout(t);
  }, [bounce]);
  return <img className={'carotte' + (anim ? ' bounce' : '')} src={logo} width={size} height={size} alt="" aria-hidden="true" />;
}
