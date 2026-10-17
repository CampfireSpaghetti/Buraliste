import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { TabacSwitcher } from '../../src/ui/TabacSwitcher';
import { TabacSection } from '../../src/features/settings/TabacSection';
import { announcePairing, PairingPrompt } from '../../src/ui/PairingPrompt';
import { addTabac, currentTabac, decodeTabacInvite, encodeTabacInvite, listTabacs, renameTabac, resetRegistryMemoryForTests } from '../../src/tabacs/registry';
import { parseInviteHash, setPendingLinkInvite } from '../../src/tabacs/inviteLink';
import { tabacDisplayName } from '../../src/tabacs/pageTabac';
import { db, getSettings, openTabacDb, saveSettings } from '../../src/data/db';

beforeEach(async () => {
  localStorage.clear();
  resetRegistryMemoryForTests();
  await db.settings.clear();
  sessionStorage.clear();
  setPendingLinkInvite(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('sans relais (VITE_RELAY_URL vide) : partage « bientôt disponible »', () => {
  beforeEach(() => vi.stubEnv('VITE_RELAY_URL', ''));

  it('en-tête : pas de point de synchronisation ; « Rejoindre » dit bientôt disponible ; créer reste possible', () => {
    render(<TabacSwitcher name="Mon tabac" />);
    expect(screen.queryByRole('button', { name: /Synchronisation/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mes tabacs : Mon tabac' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rejoindre un tabac' }));
    expect(screen.getByText('Rejoindre un tabac : bientôt disponible')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Créer un tabac' }));
    expect(screen.getByLabelText('Nom du nouveau tabac')).toBeTruthy();
  });

  it('Réglages : « Inviter un employé » n’affiche pas de QR code', () => {
    render(<TabacSection shopName="Mon tabac" />);
    expect(screen.getByText('Partage entre téléphones : bientôt disponible')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Inviter un employé' }));
    expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Bientôt disponible');
  });

  it('scan d’une invitation : « Bientôt disponible », aucun tabac ajouté', () => {
    render(<PairingPrompt />);
    act(() => announcePairing({ kind: 'invitation', invite: { name: 'Tabac de la Gare', key: 'B'.repeat(43) } }));
    expect(screen.getByRole('status').textContent).toContain('Bientôt disponible');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(listTabacs()).toHaveLength(1);
  });

  it('lien d’invitation ouvert sans relais : « Bientôt disponible », aucun tabac ajouté', () => {
    setPendingLinkInvite(parseInviteHash('#rejoindre=' + encodeTabacInvite({ name: 'Tabac de la Gare', key: 'B'.repeat(43) }).slice('LACAROTTE2:'.length)));
    render(<PairingPrompt />);
    expect(screen.getByRole('status').textContent).toContain('Bientôt disponible');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(listTabacs()).toHaveLength(1);
  });

  it('retirer un tabac non partagé : ses données n’existent que sur ce téléphone', async () => {
    addTabac('Tabac du Centre');
    render(<TabacSwitcher name="Mon tabac" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mes tabacs : Mon tabac' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retirer Tabac du Centre' }));
    expect(await screen.findByText(/n’existent que sur ce téléphone/)).toBeTruthy();
  });
});

describe('avec relais', () => {
  beforeEach(() => vi.stubEnv('VITE_RELAY_URL', 'http://localhost:8787'));

  it('invitation : « Rejoindre « <nom> » ? » ; Annuler ne change rien', () => {
    render(<PairingPrompt />);
    act(() => announcePairing({ kind: 'invitation', invite: { name: 'Tabac de la Gare', key: 'B'.repeat(43) } }));
    expect(screen.getByRole('dialog', { name: 'Rejoindre « Tabac de la Gare » ?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(listTabacs()).toHaveLength(1);
  });

  it('invitation illisible et ancien QR code : messages clairs', () => {
    render(<PairingPrompt />);
    act(() => announcePairing({ kind: 'invitation' }));
    expect(screen.getByRole('status').textContent).toMatch(/illisible/);
    act(() => announcePairing({ kind: 'ancien' }));
    expect(screen.getByRole('status').textContent).toBe('Ancien QR code : demandez une invitation de tabac');
  });

  it('« Mes tabacs » : coche sur le courant, date d’ajout ; on ne peut retirer que les autres, après confirmation honnête', async () => {
    const other = addTabac('Tabac du Centre');
    render(<TabacSwitcher name="Mon tabac" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mes tabacs : Mon tabac' }));
    expect(screen.getByRole('button', { name: /^Mon tabac/ }).getAttribute('aria-current')).toBe('true');
    expect(screen.getAllByText(/^ajouté le \d{1,2}(er)? \S+ \d{4}$/)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Retirer Mon tabac' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer Tabac du Centre' }));
    expect(screen.getByText('Ses données seront effacées de ce téléphone. Si aucun autre téléphone n’a rejoint ce tabac, elles seront perdues.')).toBeTruthy();
    expect(screen.getByText(/Sauvegarde complète/)).toBeTruthy();
    expect(screen.queryByText(/Les autres téléphones du tabac les gardent/)).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retirer' })); });
    await waitFor(() => expect(listTabacs().map((t) => t.id)).not.toContain(other.id));
    expect(screen.queryByRole('button', { name: 'Retirer Tabac du Centre' })).toBeNull();
  });

  it('retirer un tabac dont des modifications n’ont pas été envoyées : avertissement', async () => {
    const other = addTabac('Tabac du Centre');
    const d = openTabacDb(other.id);
    await d.opsOut.add({ op: { e: 'settings', id: 'main', f: { shopName: 'X' }, t: '1' } });
    d.close();
    render(<TabacSwitcher name="Mon tabac" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mes tabacs : Mon tabac' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retirer Tabac du Centre' }));
    expect(await screen.findByText('Des modifications n’ont pas encore été envoyées.')).toBeTruthy();
  });

  it('retrait bloqué par un autre onglet : message, le tabac reste', async () => {
    const other = addTabac('Tabac du Centre');
    // Connexion ouverte qui ne se ferme pas d'elle-même (comme un autre onglet).
    const raw = await new Promise<IDBDatabase>((resolve) => {
      const o = indexedDB.open(`la-carotte-${other.id}`);
      o.onsuccess = () => resolve(o.result);
    });
    render(<TabacSwitcher name="Mon tabac" removeTimeoutMs={50} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mes tabacs : Mon tabac' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retirer Tabac du Centre' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retirer' })); });
    expect(await screen.findByText('Fermez les autres onglets de La Carotte puis réessayez.')).toBeTruthy();
    expect(listTabacs().map((t) => t.id)).toContain(other.id);
    raw.close();
  });

  it('un seul tabac : jamais de bouton Retirer', () => {
    render(<TabacSwitcher name="Mon tabac" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mes tabacs : Mon tabac' }));
    expect(screen.queryByRole('button', { name: /^Retirer/ })).toBeNull();
  });

  it('point de synchronisation : avant le moteur, « Connexion… » ; le toucher ouvre Réglages', () => {
    location.hash = '';
    render(<TabacSwitcher name="Mon tabac" />);
    const dot = screen.getByRole('button', { name: 'Synchronisation : connexion…' });
    fireEvent.click(dot);
    expect(location.hash).toBe('#reglages');
  });

  it('inviter avec le nom par défaut : QR code tout de suite, et proposition de renommer qui refait le QR code', async () => {
    render(<TabacSection shopName="Mon tabac" />);
    fireEvent.click(screen.getByRole('button', { name: 'Inviter un employé' }));
    const qr = await screen.findByRole('img', { name: /QR code/ });
    expect(decodeTabacInvite(qr.getAttribute('data-invite')!)?.name).toBe('Mon tabac');
    expect(screen.getByText('Ce tabac s’appelle encore « Mon tabac » : vos employés auront du mal à le reconnaître.')).toBeTruthy();
    // Un seul tabac : pas de choix.
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.change(screen.getByLabelText('Nouveau nom du tabac'), { target: { value: '  Tabac du Port ' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Renommer' })); });
    await waitFor(() => expect(decodeTabacInvite(screen.getByRole('img', { name: /QR code/ }).getAttribute('data-invite')!)?.name).toBe('Tabac du Port'));
    expect(screen.queryByText(/s’appelle encore/)).toBeNull();
    expect((await getSettings()).shopName).toBe('Tabac du Port');
    expect(screen.getByText('Toute personne qui scanne ce QR code accède aux données du tabac.')).toBeTruthy();
  });

  it('inviter avec un vrai nom : QR code tout de suite, sans proposition de renommer', async () => {
    await saveSettings({ shopName: 'Tabac de la Gare' });
    render(<TabacSection shopName="Tabac de la Gare" />);
    fireEvent.click(screen.getByRole('button', { name: 'Inviter un employé' }));
    const qr = await screen.findByRole('img', { name: /QR code/ });
    expect(decodeTabacInvite(qr.getAttribute('data-invite')!)).toEqual({ name: 'Tabac de la Gare', key: listTabacs()[0].key });
    expect(screen.queryByText(/s’appelle encore/)).toBeNull();
  });

  it('plusieurs tabacs : on choisit lequel ; le QR code prend le nom et la clé du tabac choisi', async () => {
    await saveSettings({ shopName: 'Tabac de la Gare' });
    const other = addTabac('Tabac du Centre');
    render(<TabacSection shopName="Tabac de la Gare" />);
    fireEvent.click(screen.getByRole('button', { name: 'Inviter un employé' }));
    await screen.findByRole('img', { name: /QR code/ });
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    expect((screen.getByRole('radio', { name: /Tabac de la Gare/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByText(/^ajouté le /)).toHaveLength(2);
    fireEvent.click(screen.getByRole('radio', { name: /Tabac du Centre/ }));
    await waitFor(() => expect(decodeTabacInvite(screen.getByRole('img', { name: /QR code/ }).getAttribute('data-invite')!)).toEqual({ name: 'Tabac du Centre', key: other.key }));
  });

  it('autre tabac encore nommé « Mon tabac » : on dit de l’ouvrir pour le renommer', async () => {
    await saveSettings({ shopName: 'Tabac de la Gare' });
    addTabac('Mon tabac');
    render(<TabacSection shopName="Tabac de la Gare" />);
    fireEvent.click(screen.getByRole('button', { name: 'Inviter un employé' }));
    await screen.findByRole('img', { name: /QR code/ });
    fireEvent.click(screen.getByRole('radio', { name: /Mon tabac/ }));
    expect(await screen.findByText('Ouvrez ce tabac pour le renommer.')).toBeTruthy();
    expect(screen.queryByLabelText('Nouveau nom du tabac')).toBeNull();
  });

  it('envoyer l’invitation : partage du lien (sans le préfixe), sinon copie du lien', async () => {
    await saveSettings({ shopName: 'Tabac de la Gare' });
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    render(<TabacSection shopName="Tabac de la Gare" />);
    fireEvent.click(screen.getByRole('button', { name: 'Inviter un employé' }));
    const qr = await screen.findByRole('img', { name: /QR code/ });
    expect(screen.getByText('Ce lien donne accès au tabac : envoyez-le seulement à vos employés, et supprimez le message ensuite si possible.')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Envoyer l’invitation par message' })); });
    const arg = share.mock.calls[0][0];
    expect(arg.title).toBe('La Carotte');
    expect(arg.text).toBe('Rejoins le tabac « Tabac de la Gare » sur La Carotte : ouvre ce lien sur ton téléphone.');
    expect(arg.url).toBe(location.origin + import.meta.env.BASE_URL + '#rejoindre=' + qr.getAttribute('data-invite')!.slice('LACAROTTE2:'.length));

    // Partage impossible : le lien est copié.
    share.mockRejectedValue(new Error('NotAllowedError'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Envoyer l’invitation par message' })); });
    expect(writeText).toHaveBeenCalledWith(arg.url);
    expect(screen.getByRole('status').textContent).toContain('Lien copié : collez-le dans un message à votre employé.');

    // L'employé a fermé le partage : rien d'autre.
    writeText.mockClear();
    share.mockRejectedValue(new DOMException('annulé', 'AbortError'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Envoyer l’invitation par message' })); });
    expect(writeText).not.toHaveBeenCalled();
    delete (navigator as unknown as Record<string, unknown>).share;
    delete (navigator as unknown as Record<string, unknown>).clipboard;
  });

  it('lien ouvert : « Rejoindre « <nom> » ? » ; lien abîmé : message clair', () => {
    render(<PairingPrompt />);
    act(() => announcePairing({ kind: 'invitation', via: 'lien' }));
    expect(screen.getByRole('status').textContent).toBe('Lien d’invitation invalide ou incomplet.');
    act(() => announcePairing({ kind: 'invitation', via: 'lien', invite: { name: 'Tabac de la Gare', key: 'B'.repeat(43) } }));
    expect(screen.getByRole('dialog', { name: 'Rejoindre « Tabac de la Gare » ?' })).toBeTruthy();
  });

  it('lien vers le tabac déjà ouvert : « déjà dans ce tabac », rien d’ajouté', () => {
    setPendingLinkInvite({ ok: true, invite: { name: 'Mon tabac', key: listTabacs()[0].key } });
    render(<PairingPrompt />);
    expect(screen.getByRole('status').textContent).toBe('Ce téléphone est déjà dans ce tabac');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(listTabacs()).toHaveLength(1);
  });

  it('lien vers un autre tabac déjà sur le téléphone (même renommé) : on y passe, sans doublon', async () => {
    const other = addTabac('Tabac du Centre');
    setPendingLinkInvite({ ok: true, invite: { name: 'Ancien nom', key: other.key } });
    render(<PairingPrompt />);
    await act(async () => { fireEvent.click(screen.getByRole('dialog', { name: 'Rejoindre « Ancien nom » ?' }).querySelector('.btn.accent')!); });
    await waitFor(() => expect(currentTabac().id).toBe(other.id));
    expect(listTabacs()).toHaveLength(2);
  });

  it('rejoindre par lien qui échoue (iPhone, Safari) : pas d’astuce laissée, bouton de nouveau utilisable', async () => {
    const ua = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent')!;
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', configurable: true });
    try {
      render(<PairingPrompt />);
      // Clé invalide : l'ajout du tabac est refusé.
      act(() => announcePairing({ kind: 'invitation', via: 'lien', invite: { name: 'Tabac de la Gare', key: 'pas-une-cle' } }));
      const button = screen.getByRole('button', { name: 'Rejoindre' }) as HTMLButtonElement;
      await act(async () => { fireEvent.click(button); });
      await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Le tabac n’a pas pu être rejoint : réessayez'));
      expect(button.disabled).toBe(false);
      expect(sessionStorage.getItem('carotte:astuce-iphone')).toBeNull();
      expect(listTabacs()).toHaveLength(1);
    } finally {
      delete (navigator as unknown as Record<string, unknown>).userAgent;
      expect(navigator.userAgent).toBe(ua.get!.call(navigator));
    }
  });

  it('tabac de la page retiré du téléphone : on le dit, jamais le QR code d’un autre tabac', () => {
    localStorage.setItem('carotte:tabacs', JSON.stringify({ current: 'x1', tabacs: [{ id: 'x1', name: 'Tabac du Centre', key: 'C'.repeat(43), addedAt: 0 }] }));
    resetRegistryMemoryForTests();
    render(<TabacSection shopName="Mon tabac" />);
    fireEvent.click(screen.getByRole('button', { name: 'Inviter un employé' }));
    expect(screen.getByText('Ce tabac a été retiré de ce téléphone.')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('« Rejoindre un tabac » : coller le lien d’invitation ouvre la même question ; un texte abîmé est refusé', () => {
    const link = 'https://wongmichel2048.github.io/Buraliste/#rejoindre=' + encodeTabacInvite({ name: 'Tabac de la Gare', key: 'B'.repeat(43) }).slice('LACAROTTE2:'.length);
    render(<><TabacSwitcher name="Mon tabac" /><PairingPrompt /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Mes tabacs : Mon tabac' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rejoindre un tabac' }));
    fireEvent.change(screen.getByLabelText('Coller le lien d’invitation'), { target: { value: 'bonjour' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rejoindre avec ce lien' }));
    expect(screen.getByRole('alert').textContent).toBe('Lien d’invitation invalide ou incomplet.');
    fireEvent.change(screen.getByLabelText('Coller le lien d’invitation'), { target: { value: link } });
    fireEvent.click(screen.getByRole('button', { name: 'Rejoindre avec ce lien' }));
    expect(screen.queryByRole('dialog', { name: 'Mes tabacs' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Rejoindre « Tabac de la Gare » ?' })).toBeTruthy();
  });
});

describe('tabacDisplayName', () => {
  it('le nom des réglages ; « Mon tabac » par défaut (base neuve) cède la place au nom du registre', () => {
    expect(tabacDisplayName('Tabac du Centre')).toBe('Tabac du Centre');
    expect(tabacDisplayName('Mon tabac')).toBe('Mon tabac');
    renameTabac('principal', 'Tabac de la Gare');
    expect(tabacDisplayName('Mon tabac')).toBe('Tabac de la Gare');
    expect(tabacDisplayName(undefined)).toBe('Tabac de la Gare');
  });
});
