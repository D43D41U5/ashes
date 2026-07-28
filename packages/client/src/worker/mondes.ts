/**
 * LES MONDES DE LA VEILLÉE — l'identité d'une partie solo, et rien d'autre.
 *
 * Module FEUILLE, sans aucun import, et c'est sa raison d'être : l'écran des mondes
 * (`ui/menu-dom.ts`) a besoin de la seed par défaut et du nombre de cases, mais importer
 * `veillee.ts` pour ça tirerait TOUTE la worldgen de /sim dans le bundle du menu — pour
 * deux nombres. Le scénario (`veillee.ts`) et le coffre (`persistence-store.ts`) lisent
 * d'ici ; personne ne redéclare.
 */

/**
 * COMBIEN DE VALLÉES un joueur peut tenir de front (demande d'Alexis, 2026-07-28).
 *
 * ⚠ Ce n'est pas gratuit : chaque monde garde SA carte au disque (~60 Mo — 86,9 % du poids
 * d'une sauvegarde, cf. `persistence-store.ts`), donc cinq mondes pleins pèsent ~300 Mo
 * d'IndexedDB. C'est le prix de la reprise instantanée : la carte se déduirait de la seed,
 * mais un simple ajustement de worldgen la rendrait alors différente de celle qu'on a
 * jouée — sans que `SAVE_FORMAT_VERSION` ne bouge, donc en silence. On préfère payer le
 * disque. Le bouton EFFACER de l'écran des mondes est la soupape.
 */
export const SLOT_COUNT = 5

/**
 * LA SEED PAR DÉFAUT — la vallée « canonique », celle de tous les scénarios de smoke et du
 * deep-link `?solo`. Proposée à la fondation d'un monde ; le joueur en met ce qu'il veut.
 */
export const VEILLEE_SEED = 2026

/** Une seed reste un entier positif : c'est ce que `generateZonedTerrain` sait semer. */
export const SEED_MAX = 999_999_999

/** `n` désigne-t-il une case existante ? Une case hors bornes écrirait une clé fantôme. */
export function slotValide(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < SLOT_COUNT
}

/** Une seed utilisable : entier, dans les bornes. */
export function seedValide(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= SEED_MAX
}

/**
 * COMBIEN DE SIGNES pour nommer une vallée. 24 : c'est ce qui tient dans la colonne de gauche
 * de l'écran des vallées sans la faire déborder sur l'état du monde (mesuré en mono, à 19 px).
 * Au-delà, on ne coupe pas à l'affichage — on refuse à la saisie, pour que ce qu'on tape soit
 * exactement ce qu'on lira.
 */
export const NOM_MAX = 24

/**
 * NETTOIE un nom de vallée — c'est le SEUL texte libre du jeu, et il finit dans un `innerHTML`.
 *
 * L'échappement HTML se fait au rendu (`esc`, dans `menu-dom`), mais on ne laisse pas entrer
 * n'importe quoi pour autant : les caractères de contrôle (dont les sauts de ligne, qu'un
 * collage apporte) casseraient la ligne, et les espaces de bordure font des noms qui se
 * ressemblent sans être égaux. Rend `''` pour un nom vide — l'écran retombe alors sur
 * « VALLÉE N », et nommer reste facultatif.
 */
export function nettoieNom(brut: string): string {
  return brut.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, NOM_MAX).trim()
}

/**
 * LA CONFIGURATION D'HÔTE du Worker — QUEL monde il ouvre.
 *
 * Ce message n'est **pas** du protocole de jeu (`ClientToHost`, dans /sim) et n'a rien à y
 * faire : « seul le transport change » veut dire que le protocole solo et le protocole LAN
 * sont le MÊME. Quelle case et quelle seed, c'est une donnée d'hôte — l'exact équivalent de
 * l'URL qu'on passe à `createColyseusHost`, ou des arguments de lancement d'un serveur.
 * Il part par `postMessage` AVANT le `join`, et l'ordre des messages vers un même Worker
 * est garanti : le boot le trouve toujours posé.
 */
export interface VeilleeInit {
  type: 'veillee_init'
  slot: number
  seed: number
  /** Le nom donné à la vallée à sa fondation. `''` = pas de nom (l'écran dira « VALLÉE N »).
   *  Ignoré à la REPRISE : une vallée sauvée porte déjà le sien, au disque. */
  nom: string
}
