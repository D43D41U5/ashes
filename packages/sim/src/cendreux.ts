/**
 * La levée des Cendreux (spec 2026-07-08). Critère de mort, réveil, IA. Pur/déterministe.
 */
import { CENDREUX, COMBAT } from './balance'
import { distSq } from './geometry'
import { emitEvent } from './events'
import { spawnMonster } from './monsters'
import type { Entity, SimState } from './sim'

/** Vrai si cette mort (déjà connue `cold`) donnera un Cendreux : seul ET loin d'un feu. */
export function willRiseAsCendreux(state: SimState, entity: Entity): boolean {
  // Loin d'un feu : aucune structure feu dans HEARTH_WARD_RADIUS.
  const hearthWardR = CENDREUX.HEARTH_WARD_RADIUS
  const nearFire = state.structures.some(
    (s) => s.type === 'fire' && distSq(s.tx + 0.5, s.ty + 0.5, entity.x, entity.y) <= hearthWardR * hearthWardR,
  )
  if (nearFire) return false
  // Seul : aucun allié vivant (même village) dans WITNESS_RADIUS.
  const witnessR = CENDREUX.WITNESS_RADIUS
  const village = state.villages.find((v) => v.memberIds.includes(entity.id))
  if (village) {
    const hasAlly = state.entities.some(
      (e) => e.id !== entity.id && e.hp > 0 && village.memberIds.includes(e.id) &&
        distSq(e.x, e.y, entity.x, entity.y) <= witnessR * witnessR,
    )
    if (hasAlly) return false
  }
  return true
}

/** Réveil : les cadavres marqués se lèvent en Cendreux (ou sont annulés par un feu). */
export function advanceCendreux(state: SimState): void {
  const ward = CENDREUX.HEARTH_WARD_RADIUS
  for (const corpse of [...state.corpses]) {
    if (corpse.risesAt === undefined || state.tick < corpse.risesAt) continue
    // Veillé par un feu à portée → annulation.
    const warded = state.structures.some(
      (s) => s.type === 'fire' && distSq(s.tx + 0.5, s.ty + 0.5, corpse.x, corpse.y) <= ward * ward,
    )
    if (warded) {
      delete corpse.risesAt
      corpse.decayAt = state.tick + COMBAT.CORPSE_TICKS
      continue
    }
    // Levée : le cadavre devient le Cendreux, portant son loot.
    const id = spawnMonster(state, 'cendreux', corpse.x, corpse.y)
    const ent = state.entities.find((e) => e.id === id)!
    ent.inventory = { ...corpse.inventory }
    state.corpses = state.corpses.filter((c) => c.id !== corpse.id)
    emitEvent(state, { type: 'cendreux_risen', tick: state.tick, entityId: id, x: corpse.x, y: corpse.y })
  }
}
