/**
 * ═══ LA TRACTION (spec `traction.md`) — tirer une charge derrière soi ═══
 *
 * Née du Bûcher rituel (`cendre.md` R31) et conçue d'emblée comme un SYSTÈME (directive
 * d'Alexis : les chariots viendront — bûches en masse, cadavres). Le cadavre est la première
 * charge du registre ; le chariot y entrera par une ligne.
 *
 * L'état vit sur le TIREUR seul (`entity.attelage`, un champ JSON) ; la charge ne sait rien.
 * La longe est une CORDE, pas un lien magique : la charge suit au pas quand la longe se tend
 * (T2), et casse au-delà de la rupture (T2bis) — jamais une téléportation.
 */
import { BALANCE } from './balance'
import { emitEvent } from './events'
import type { Entity, SimState } from './sim'

export const TRACTION = {
  /** À combien de tuiles on peut NOUER l'attelage. */
  PORTEE: 2,
  /** La longueur de la longe : en deçà, la charge ne bouge pas — on tourne autour. */
  LONGE: 1.2,
  /** Au-delà, la corde CASSE (charge coincée, téléport) : `attelage_rompu`, la charge reste. */
  RUPTURE: 3,
} as const

/**
 * LE REGISTRE DES TRACTABLES (T4) — ce qui se tire se déclare : le facteur de vitesse du
 * tireur, et le mode de collision de la charge. Le cadavre GLISSE (fantôme — il n'a jamais
 * bloqué personne mort, il ne va pas commencer traîné) ; le chariot, quand il viendra, sera
 * `solide` : manœuvrer dans une porte sera une affaire de géométrie.
 */
export const TRACTABLES = {
  corpse: { facteur: 0.6, fantome: true },
} as const

export type TractableKind = keyof typeof TRACTABLES

export type TractionAction =
  | { type: 'atteler'; kind: TractableKind; id: number }
  | { type: 'detacher' }

export function isTractionAction(a: { type: string }): a is TractionAction {
  return a.type === 'atteler' || a.type === 'detacher'
}

/** La position d'une charge — le cadavre aujourd'hui ; le chariot ajoutera sa branche. */
function chargeDe(state: SimState, attelage: { kind: TractableKind; id: number }): { x: number; y: number } | null {
  const c = state.corpses.find((q) => q.id === attelage.id)
  return c ? c : null
}

export function applyTractionAction(state: SimState, actorId: number, action: TractionAction): void {
  const actor = state.entities.find((e) => e.id === actorId)
  if (!actor) return
  const reject = (reason: string): void => {
    emitEvent(state, { type: 'action_rejected', tick: state.tick, entityId: actorId, reason })
  }
  if (action.type === 'detacher') {
    delete actor.attelage // le geste volontaire est silencieux (T5)
    return
  }
  // `hasOwn`, pas un accès nu (revue ⑥) : une clé héritée (`'toString'`) passerait l'accès et
  // rendrait un facteur `undefined` → NaN dans la vitesse. Le multi est déjà gardé par la
  // validation serveur ; ceci protège le solo et les replays forgés.
  if (!Object.hasOwn(TRACTABLES, action.kind)) return reject('rien à atteler là')
  const charge = chargeDe(state, action)
  if (!charge) return reject('rien à atteler là')
  const d2 = (actor.x - charge.x) * (actor.x - charge.x) + (actor.y - charge.y) * (actor.y - charge.y)
  if (d2 > TRACTION.PORTEE * TRACTION.PORTEE) return reject('trop loin')
  // UNE charge, UN tireur (T1) : le second arrivé est refusé, jamais un vol silencieux.
  const autre = state.entities.some(
    (e) => e.id !== actorId && e.attelage !== undefined && e.attelage.kind === action.kind && e.attelage.id === action.id,
  )
  if (autre) return reject('déjà attelée')
  actor.attelage = { kind: action.kind, id: action.id }
}

/** LES MAINS NE FONT QU'UNE CHOSE (T1/T5) : tout geste de combat ou de récolte détache. */
export function detacherPourLeGeste(actor: Entity): void {
  if (actor.attelage !== undefined) delete actor.attelage
}

/**
 * LA PASSE DU TICK (T2/T2bis) — après le mouvement : la longe tendue tire la charge VERS le
 * tireur, au pas (jamais plus vite que la marche — c'est ce qui borne aussi le tireur, T3) ;
 * au-delà de la rupture, la corde casse et le DIT. Une charge disparue (consumée, décomposée)
 * détache en silence.
 */
export function advanceTraction(state: SimState): void {
  for (const e of state.entities) {
    if (e.attelage === undefined) continue
    const charge = chargeDe(state, e.attelage)
    if (!charge) {
      delete e.attelage
      continue
    }
    const dx = e.x - charge.x
    const dy = e.y - charge.y
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d > TRACTION.RUPTURE) {
      delete e.attelage
      emitEvent(state, { type: 'attelage_rompu', tick: state.tick, entityId: e.id, x: charge.x, y: charge.y })
      continue
    }
    if (d <= TRACTION.LONGE) continue
    // Le pas de la charge : vers le tireur, borné à la marche — et jamais plus que ce qui
    // détend la longe (elle s'arrête À la longe, pas dessus le tireur).
    const pas = Math.min(BALANCE.WALK_SPEED_TILES_PER_S * (1 / BALANCE.TICK_RATE_HZ), d - TRACTION.LONGE)
    // (La charge `fantome` glisse — le chariot solide passera par la collision, à son chantier.)
    charge.x += (dx / d) * pas
    charge.y += (dy / d) * pas
  }
}

/** LE PRIX DU TIREUR (T3) — lu par `speedScaleFor` : marche × facteur, sprint interdit.
 *  Structurel et minimal : le `Pick` de `speedScaleFor` le satisfait. */
export function facteurDAttelage(e: { attelage?: { kind: TractableKind; id: number } }): number {
  if (e.attelage === undefined) return 1
  return TRACTABLES[e.attelage.kind].facteur
}
