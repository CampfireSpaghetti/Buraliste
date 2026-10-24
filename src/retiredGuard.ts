import { isRetiredHost, retire } from './retired';

// Premier import de main.tsx. Ancienne adresse de l'app : tout est effacé, puis le chargement s'arrête là (l'erreur
// interrompt l'évaluation des modules suivants : ni la base ni l'app ne s'ouvrent).
if (isRetiredHost(location.hostname)) {
  void retire(document.getElementById('root')!);
  throw new Error("Ancienne adresse de l'app : données effacées.");
}
