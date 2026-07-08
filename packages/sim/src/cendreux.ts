/**
 * La levée des Cendreux (spec 2026-07-08). Critère de mort, réveil, IA. Pur/déterministe.
 */
import { CENDREUX } from './balance'
import { distSq } from './geometry'
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
