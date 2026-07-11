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
import type { RecipeId } from '@braises/sim'
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
  block: ['C'],
  // Actions ponctuelles (au down)
  lightFire: ['F'],
  attack: ['SPACE'],
  bandage: ['X'],
  give: ['T'],
  repair: ['G'],
  eatBerries: ['E'],
  eatStew: ['R'],
  toggleJournal: ['J'],
  toggleMap: ['M'],
} as const

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

/** Sélection de construction, dans l'ordre des touches 1-5 (touche → structure). */
export const BUILD_BINDINGS: readonly [string, Buildable][] = [
  ['ONE', 'wall'],
  ['TWO', 'door'],
  ['THREE', 'chest'],
  ['FOUR', 'workshop'],
  ['FIVE', 'furnace'],
]

/** Recettes de craft, dans l'ordre des touches 6-0 (touche → recette). */
export const CRAFT_BINDINGS: readonly [string, RecipeId][] = [
  ['SIX', 'stew'],
  ['SEVEN', 'axe'],
  ['EIGHT', 'pickaxe'],
  ['NINE', 'iron_ingot'],
  ['ZERO', 'iron_axe'],
]
