/**
 * LA DERNIÈRE PARTIE JOUÉE — ce que « REPRENDRE » a besoin de savoir, et rien de plus.
 *
 * L'écran d'accueil doit pouvoir proposer de reprendre SANS ouvrir quoi que ce soit. En solo,
 * il n'a besoin de personne : chaque case porte son `savedAt`, la plus récente gagne (voir
 * `persistence-store.listSlots`). En MULTI, en revanche, **rien du monde n'est sur ce disque** —
 * le serveur le tient. On ne peut donc mémoriser que le lieu et la date : quelle vallée on a
 * rejointe, et quand.
 *
 * D'où une ASYMÉTRIE ASSUMÉE des deux résumés (décision d'Alexis, 2026-07-28) : le solo dit
 * « jour 14 · seed 2026 », le multi dit « rejointe il y a 2 h ». Annoncer l'avancement d'une
 * partie multi exigerait de se connecter au chargement du menu — un aller-retour réseau pour
 * peindre un bouton, et un menu qui reste vide quand le serveur est éteint.
 *
 * `localStorage` et pas IndexedDB : deux champs et une date, lus au montage du menu. Le coffre
 * de la Veillée (asynchrone) est fait pour des mondes, pas pour un signet.
 */

const CLE = 'braises.derniere-multi'

/** Le signet d'une vallée partagée : où l'on est allé, sous quel nom, et quand. */
export interface DerniereMulti {
  url: string
  /** Le nom affiché du serveur au moment où on l'a rejoint (il peut changer côté config). */
  nom: string
  /** Horloge murale de la connexion. */
  at: number
}

/** Retient qu'on vient de rejoindre cette vallée. Silencieux si le stockage refuse. */
export function noteMulti(url: string, nom: string, at: number): void {
  try {
    localStorage.setItem(CLE, JSON.stringify({ url, nom, at } satisfies DerniereMulti))
  } catch {
    /* stockage plein ou refusé : on perd un signet, pas une partie */
  }
}

/**
 * Relit le signet, ou `null`. NE JETTE JAMAIS : un stockage corrompu (édité à la main, écrit
 * par une version antérieure) ne doit pas empêcher l'écran d'accueil de se monter — on préfère
 * un accueil sans « REPRENDRE » à un accueil qui ne s'affiche pas.
 */
export function lireDerniereMulti(): DerniereMulti | null {
  let brut: string | null = null
  try {
    brut = localStorage.getItem(CLE)
  } catch {
    return null
  }
  if (!brut) return null
  try {
    const v = JSON.parse(brut) as Partial<DerniereMulti>
    if (typeof v?.url !== 'string' || !v.url) return null
    return { url: v.url, nom: typeof v.nom === 'string' ? v.nom : v.url, at: typeof v.at === 'number' ? v.at : 0 }
  } catch {
    return null
  }
}

/** Oublie le signet — le serveur a disparu de la config, ou l'on repart de zéro. */
export function oublieMulti(): void {
  try {
    localStorage.removeItem(CLE)
  } catch {
    /* rien à faire */
  }
}
