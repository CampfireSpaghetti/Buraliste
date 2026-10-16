import { mergeContributions, parseIssueBody, type SharedCodesFile } from '../../src/domain/sharing.ts';

type IssueEvent = { issue: { number: number; title: string; body?: string | null; user: { login: string } }; repository: { owner: { login: string } } };

/** Robot : traite un message « [codes-barres] ». Seuls les messages du propriétaire du dépôt (téléphones jumelés) sont pris en compte. */
export function collectFromIssue(
  event: IssueEvent,
  refs: { items: { ref: string }[] },
  fdj: { items: { ref: string }[] },
  current: SharedCodesFile,
  today: string,
): { file?: SharedCodesFile; summary: string } {
  if (event.issue.user.login !== event.repository.owner.login) {
    return { summary: `Message ignoré : il ne vient pas du compte ${event.repository.owner.login}.` };
  }
  const items = parseIssueBody(event.issue.body ?? '');
  if (items.length === 0) return { summary: 'Message ignoré : aucun code lisible.' };
  const known = new Set([...refs.items.map((i) => i.ref), ...fdj.items.map((i) => i.ref)]);
  const { file, accepted, rejected } = mergeContributions(current, items, known, today);
  const lines = [`${accepted} code${accepted > 1 ? 's' : ''} ajouté${accepted > 1 ? 's' : ''} à la liste partagée.`];
  if (rejected.length) {
    lines.push('', 'Refusés :');
    for (const { item, reason } of rejected) lines.push(`- ${item.kind === 'barcode' ? item.code : item.prefix} → ${item.ref} : ${reason}`);
  }
  return { file: accepted > 0 ? file : undefined, summary: lines.join('\n') };
}
