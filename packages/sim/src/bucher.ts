/**
 * ═══ LE BÛCHER RITUEL (spec `cendre.md` R31, chantier ⑥ des dix — 2026-08-30) ═══
 *
 * La seule INVERSION du monde : rendre les morts à la fosse, puis la brûler — et l'avancée
 * RECULE. Locale, bornée, hors de prix : on tient une ligne, on n'éradique pas.
 *
 * Le compte des cadavres rendus est de l'ÉTAT (`state.buchers`, le patron de `lieuxBrules`) —
 * le premier que la cendre possède, et il est minuscule : une entrée par fosse NOURRIE.
 * Le rituel n'a PAS de geste neuf : c'est le brûlage R16 (le feu, le jour, la fosse) qui le
 * déclenche quand la fosse a ses morts — `tenterLeRituel` est appelé de là.
 */
import { MORTS } from './balance'
import { LUNAISON_JOURS } from './nuit'
import { distSq } from './geometry'
import { emitEvent } from './events'
import { jourDeSaison } from './time'
import type { SimState } from './sim'

export const BUCHER = {
  /** Combien de morts la fosse exige avant que le brûlage devienne RITUEL. */
  CADAVRES: 10,
  /** Combien de jours d'âge le rituel efface — ~3 jours d'avancée au plafond (R7). */
  JOURS_RENDUS: 3,
} as const

export interface Bucher {
  zone: number
  rendus: number
  /** Le jour de saison du dernier rituel — la cadence est UNE LUNE par fosse (R31b). */
  dernierRituelJour: number
}

function bucherDe(state: SimState, zone: number): Bucher {
  let b = state.buchers.find((q) => q.zone === zone)
  if (!b) {
    b = { zone, rendus: 0, dernierRituelJour: -LUNAISON_JOURS }
    state.buchers.push(b)
  }
  return b
}

/**
 * LA FOSSE COMPTE SES MORTS (R31a) — un cadavre de CENDREUX à ≤ `MORTS.BRULE_RAYON` du centre
 * d'un charnier est CONSUMÉ et compté. Le rayon est CELUI DU BRÛLAGE R16 : une seule
 * géométrie pour tout ce qui se fait « à la fosse ». Cadencé comme `advanceLieuxBrules`
 * (un tick sur 20) : un cadavre n'est pas pressé.
 */
export function advanceBuchers(state: SimState): void {
  if (state.tick % 20 !== 0) return
  if (state.corpses.length === 0) return
  const zones = state.map.zones
  if (zones.length === 0) return
  const r2 = MORTS.BRULE_RAYON * MORTS.BRULE_RAYON
  let consumes: number[] | null = null
  for (const corpse of state.corpses) {
    if (corpse.cendreux !== true) continue
    for (let zi = 0; zi < zones.length; zi++) {
      const z = zones[zi]!
      if (z.kind !== 'charnier') continue
      const cx = z.x + z.w / 2
      const cy = z.y + z.h / 2
      if (distSq(cx, cy, corpse.x, corpse.y) > r2) continue
      bucherDe(state, zi).rendus += 1
      ;(consumes ??= []).push(corpse.id)
      emitEvent(state, { type: 'cadavre_rendu', tick: state.tick, zone: zi, x: corpse.x, y: corpse.y })
      break
    }
  }
  if (consumes) state.corpses = state.corpses.filter((c) => !consumes.includes(c.id))
}

/**
 * LE RITUEL (R31b) — appelé PAR le brûlage R16, à l'instant où la fosse est marquée. Fosse
 * nourrie (≥ CADAVRES) et lune écoulée : l'âge du foyer recule de `JOURS_RENDUS` (plancher 0 —
 * la tache R0 est éternelle), les rendus se consument, le monde le sait. Sinon : rien — le
 * brûlage garde son effet normal, sans un mot de plus.
 */
export function tenterLeRituel(state: SimState, zone: number, foyer: number, x: number, y: number): void {
  const b = state.buchers.find((q) => q.zone === zone)
  if (!b || b.rendus < BUCHER.CADAVRES) return
  const jour = jourDeSaison(state)
  if (jour - b.dernierRituelJour < LUNAISON_JOURS) return
  if (foyer < 0 || state.cendreAge[foyer] === undefined) return
  state.cendreAge[foyer] = Math.max(0, state.cendreAge[foyer]! - BUCHER.JOURS_RENDUS)
  b.rendus = 0
  b.dernierRituelJour = jour
  emitEvent(state, { type: 'bucher_rituel', tick: state.tick, zone, jours: BUCHER.JOURS_RENDUS, x, y })
}
