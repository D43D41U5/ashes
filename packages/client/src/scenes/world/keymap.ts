/**
 * LA source unique des raccourcis clavier de la scène monde. Que des NOMS de
 * touches Phaser (chaînes, résolus en KeyCodes par `input-bindings.ts`) — donc
 * aucun import Phaser, aucune logique : une table qu'on lit et qu'on rebinde
 * en une ligne. Les handlers (viser, cibler le plus proche…) restent dans
 * `input-bindings.ts` ; seule la TOUCHE qui les déclenche vient d'ici.
 *
 * Un test (`keymap.test.ts`) garde l'invariant utile au rebinding : deux
 * actions ne partagent jamais une même touche.
 */
import type { Buildable } from '../../hud-state'

/**
 * Action sémantique → une ou plusieurs touches (alias). Les listes de
 * déplacement sont lues chaque frame (maintien) ; les autres déclenchent une
 * action au `down`.
 */
export const KEYMAP = {
  // Déplacement (maintenu, lu chaque frame)
  moveUp: ['Z', 'W', 'UP'],
  moveDown: ['S', 'DOWN'],
  moveLeft: ['Q', 'A', 'LEFT'],
  moveRight: ['D', 'RIGHT'],
  sprint: ['SHIFT'],
  /** LE PAS LENT (spec chasse C2) : discret pour la faune, moitié de la vitesse. */
  sneak: ['C'],
  /**
   * JETER CE QU'ON TIENT (spec chasse C18). Zéro UI : la case active tombe au
   * sol, une unité à la fois. C'est le geste de l'APPÂT (poser des baies et
   * attendre), du JET DE VIANDE à une meute qui vous serre (faune R15, promis par
   * le GDD §9bis et jamais tenu), et de l'allègement d'un porteur en fuite.
   */
  dropHeld: ['G'],
  // Les ÉCRANS, et eux seuls (décision utilisateur, 2026-07-12).
  toggleJournal: ['J'],
  toggleMap: ['M'],
  toggleInventory: ['TAB'],
} as const

/*
 * CE QUI A ÉTÉ DÉBRANCHÉ, ET POURQUOI (2026-07-12, décision utilisateur).
 *
 * Le clavier ne porte plus AUCUN verbe de jeu : ni attaquer (ESPACE), ni parer
 * (C), ni bander (X), ni allumer le Feu (F), ni bâtir (B), ni réparer (G), ni
 * donner (T), ni manger (E/R) — et plus une seule recette (SHIFT+chiffre). Le
 * clic droit (démolir / désarmer) et le SHIFT+clic (partager) tombent avec eux.
 *
 * Ce n'est pas un élagage cosmétique : c'est le préalable à une interaction qui
 * passera par CE QU'ON TIENT (la ceinture) et le clic — le bandage se sélectionne
 * puis s'emploie au clic maintenu, et le craft ne vivra plus sur un raccourci.
 * Une touche par verbe ne tient pas l'échelle du jeu, et SHIFT était déjà chargé
 * trois fois (sprinter, crafter, partager) : sprinter en changeant de case de
 * ceinture LANÇAIT un craft.
 *
 * RIEN N'EST PERDU DANS /sim : `attack`, `bandage`, `build`, `craft`, `eat`,
 * `give`, `repair`, `demolish`, `set_access` existent toujours et sont testées.
 * Seul le câblage clavier a disparu — il se rebranche en une ligne, ici.
 */

/**
 * Les touches du mode DEBUG — câblées uniquement en développement
 * (`debug-bindings.ts`, gardé par `import.meta.env.DEV`). Séparées de KEYMAP
 * pour qu'un rebinding de jeu ne les voie même pas ; le test d'unicité, lui,
 * les inclut (une touche de debug qui volerait une touche de jeu serait un
 * bug silencieux en playtest).
 */
export const DEBUG_KEYMAP = {
  /** Arme/désarme le mode (tout le reste est inerte tant qu'il est éteint). */
  toggle: ['F1'],
  /** Invulnérabilité + jauges gelées. */
  god: ['F2'],
  /** Bascule jour ↔ nuit (force l'heure à midi ou minuit). */
  cycleDayNight: ['F3'],
  /** Cadence de l'hôte : ×1 → ×2 → ×4 → ×8 → ×1. */
  cycleSpeed: ['F4'],
} as const

/** La CEINTURE : touches 1-6 → case active 0-5 (spec inventaire R17). */
export const BELT_BINDINGS: readonly [string, number][] = [
  ['ONE', 0],
  ['TWO', 1],
  ['THREE', 2],
  ['FOUR', 3],
  ['FIVE', 4],
  ['SIX', 5],
]

/**
 * Les structures bâtissables, dans leur ordre d'origine. La table SURVIT au
 * débranchement de `B` : le mode construction (`selected`, le fantôme, le
 * résolveur de clic) est intact dans le code — simplement plus ARMABLE tant que
 * la nouvelle interaction n'est pas posée. Le jour où bâtir passera par le
 * marteau en main, c'est cette table qu'on rebranchera.
 */
export const BUILDABLE_CYCLE: readonly (Buildable | null)[] = [null, 'wall', 'door', 'chest', 'workshop', 'furnace']
