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
  toggleInventory: ['TAB'],
  /** Fait défiler la structure à bâtir (mur → porte → coffre → atelier → four).
   *  Béquille : les touches 1-6 tiennent désormais la ceinture (spec inventaire R17). */
  cycleBuildable: ['B'],
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

/** La CEINTURE : touches 1-6 → case active 0-5 (spec inventaire R17). */
export const BELT_BINDINGS: readonly [string, number][] = [
  ['ONE', 0],
  ['TWO', 1],
  ['THREE', 2],
  ['FOUR', 3],
  ['FIVE', 4],
  ['SIX', 5],
]

/** L'ordre dans lequel `B` fait défiler les structures à bâtir (spec inventaire R17). */
export const BUILDABLE_CYCLE: readonly Buildable[] = ['wall', 'door', 'chest', 'workshop', 'furnace']

/**
 * Recettes de craft — BÉQUILLE jusqu'au chantier 2 (le panneau de craft). Les
 * touches 1-6 tenant la ceinture, le craft se replie sur SHIFT+1…5 (même ordre
 * qu'avant) : sans lui, le craft serait inaccessible et le jeu injouable entre
 * deux chantiers. Le handler lit `event.shiftKey` pour trancher. À supprimer au
 * chantier 2.
 */
export const CRAFT_BINDINGS: readonly [string, RecipeId][] = [
  ['ONE', 'stew'],
  ['TWO', 'axe'],
  ['THREE', 'pickaxe'],
  ['FOUR', 'iron_ingot'],
  ['FIVE', 'iron_axe'],
]
