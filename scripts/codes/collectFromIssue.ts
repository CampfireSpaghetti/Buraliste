import { mergeContributions, parseIssueBody, type Contribution, type SharedCodesFile } from '../../src/domain/sharing.ts';

type IssueEvent = { issue: { number: number; title: string; body?: string | null; user: { login: string } }; repository: { owner: { login: string } } };

/** Étiquette des messages laissés ouverts pour le propriétaire du dépôt (R28). */
export const REVIEW_LABEL = 'à vérifier';

const label = (item: Contribution) => `${item.kind === 'barcode' ? item.code : item.prefix} → ${item.ref}`;

/**
 * Robot : traite un message « [codes-barres] ». Le relais ouvre ces messages avec le jeton du propriétaire du dépôt :
 * l'auteur ne dit donc rien de l'expéditeur (envoi anonyme), il écarte seulement les messages ouverts à la main par
 * d'autres comptes. Seules les correspondances nouvelles et sans conflit sont appliquées ; si le message en contient
 * d'autres (`review`), il reste ouvert avec l'étiquette « à vérifier ».
 */
export function collectFromIssue(
  event: IssueEvent,
  refs: { items: { ref: string; barcodes?: string[] }[] },
  fdj: { items: { ref: string; codes?: string[] }[] },
  current: SharedCodesFile,
  today: string,
): { file?: SharedCodesFile; summary: string; review: boolean } {
  if (event.issue.user.login !== event.repository.owner.login) {
    return { summary: `Message ignoré : il ne vient pas du compte ${event.repository.owner.login}.`, review: false };
  }
  const items = parseIssueBody(event.issue.body ?? '');
  if (items.length === 0) return { summary: 'Message ignoré : aucun code lisible.', review: false };
  const known = new Set([...refs.items.map((i) => i.ref), ...fdj.items.map((i) => i.ref)]);
  const catalog = Object.fromEntries(fdj.items.filter((i) => Array.isArray(i.codes)).map((i) => [i.ref, i.codes!]));
  const official = Object.fromEntries(refs.items.filter((i) => Array.isArray(i.barcodes) && i.barcodes.length).map((i) => [i.ref, i.barcodes!]));
  const { file, accepted, rejected, held } = mergeContributions(current, items, known, today, catalog, official);
  const lines = [`${accepted} code${accepted > 1 ? 's' : ''} ajouté${accepted > 1 ? 's' : ''} à la liste partagée.`];
  if (rejected.length) {
    lines.push('', 'Refusés :');
    for (const { item, reason } of rejected) lines.push(`- ${label(item)} : ${reason}`);
  }
  if (held.length) {
    lines.push('', 'À vérifier (non appliqués : ils changeraient la liste déjà publiée) :');
    for (const { item, reason } of held) lines.push(`- ${label(item)} : ${reason}`);
    lines.push(
      '',
      `Ce message reste ouvert avec l'étiquette « ${REVIEW_LABEL} ». Si la correction est juste, modifier public/data/codes-barres.json à la main ; puis fermer le message.`,
    );
  }
  return { file: accepted > 0 ? file : undefined, summary: lines.join('\n'), review: held.length > 0 };
}
