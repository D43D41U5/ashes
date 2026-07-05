/**
 * L'alignement émergent (GDD §3, spec alignement) — le cœur philosophique.
 *
 * Aucun choix déclaratif : des actes discrets envers l'EXTÉRIEUR, pondérés
 * par le coût réel, agrégés au Feu avec un plafond par tête et l'inertie
 * d'un paquebot. Rien d'interne ne compte (règle d'or du GDD).
 */
import { ALIGNMENT } from './balance'
import { emitEvent } from './events'
import type { Entity, SimState } from './sim'
import { actForDay, seasonDayAtTick, TICKS_PER_SEASON_DAY } from './time'
import { getVillageOf, type Village } from './village'

export type Archetype = 'foyer' | 'meute' | 'neutre'

export interface Aggression {
  fromVillageId: number
  toVillageId: number
  tick: number
}

function clampWarmth(v: number): number {
  return Math.max(-100, Math.min(100, v))
}

/** La cible est-elle « l'extérieur » pour l'acteur ? (avatar d'un autre bord) */
export function isOutsider(state: SimState, actorId: number, targetId: number): boolean {
  if (state.monsters.some((m) => m.entityId === actorId || m.entityId === targetId)) return false
  const va = getVillageOf(state, actorId)
  const vb = getVillageOf(state, targetId)
  if (!va) return false // un sans-village n'a pas de Feu à teinter
  return va.id !== vb?.id
}

/** Applique un acte d'alignement à un avatar (jamais à un monstre). */
export function recordAct(state: SimState, entityId: number, warmthDelta: number): void {
  if (state.monsters.some((m) => m.entityId === entityId)) return
  const entity = state.entities.find((e) => e.id === entityId)
  if (!entity) return
  entity.warmth = clampWarmth(entity.warmth + warmthDelta)
  entity.engagement = Math.min(100, entity.engagement + ALIGNMENT.ENGAGEMENT_PER_ACT)
}

/** Facteur saisonnier : nourrir pendant le Grand Froid vaut cher. */
export function seasonActFactor(state: SimState): number {
  const act = actForDay(seasonDayAtTick(state.tick, state.calendarScale))
  return ALIGNMENT.ACT_FACTOR[act - 1]!
}

// ─── Le premier sang (spec R4) ────────────────────────────────────────────

function findAggression(state: SimState, fromV: number, toV: number): Aggression | undefined {
  return state.aggressions.find(
    (a) =>
      a.fromVillageId === fromV &&
      a.toVillageId === toV &&
      state.tick - a.tick <= ALIGNMENT.AGGRESSION_MEMORY_TICKS,
  )
}

/**
 * Enregistre une hostilité de village à village et retourne son coût moral :
 * premier sang plein tarif, riposte presque gratuite, mêlée en cours réduite.
 */
export function recordHostility(state: SimState, attackerId: number, victimVillageId: number | null): number {
  const attackerVillage = getVillageOf(state, attackerId)
  if (!attackerVillage) return 0
  if (victimVillageId === null) return ALIGNMENT.FIRST_BLOOD_WARMTH // frapper un errant reste froid
  if (victimVillageId === attackerVillage.id) return 0 // interne : gouvernance, pas alignement

  const riposte = findAggression(state, victimVillageId, attackerVillage.id)
  if (riposte) return ALIGNMENT.RIPOSTE_WARMTH

  const ongoing = findAggression(state, attackerVillage.id, victimVillageId)
  if (ongoing) {
    ongoing.tick = state.tick // l'engagement se prolonge
    return ALIGNMENT.ONGOING_HIT_WARMTH
  }
  state.aggressions.push({ fromVillageId: attackerVillage.id, toVillageId: victimVillageId, tick: state.tick })
  return ALIGNMENT.FIRST_BLOOD_WARMTH
}

/** Y a-t-il une agression active de `fromVillageId` vers `toVillageId` ? */
export function hasAggressionBetween(state: SimState, fromVillageId: number, toVillageId: number): boolean {
  return findAggression(state, fromVillageId, toVillageId) !== undefined
}

/** Les menaces d'un village : monstres ET avatars des villages agresseurs. */
export function isThreatTo(state: SimState, entityId: number, village: Village): boolean {
  if (state.monsters.some((m) => m.entityId === entityId)) return true
  if (village.memberIds.includes(entityId)) return false
  const theirVillage = getVillageOf(state, entityId)
  return theirVillage !== undefined && hasAggressionBetween(state, theirVillage.id, village.id)
}

// ─── Les effets (spec R7-R8) ──────────────────────────────────────────────

export function archetypeOf(village: Village): Archetype {
  if (village.engagement >= ALIGNMENT.ARCHETYPE_ENGAGEMENT) {
    if (village.warmth >= ALIGNMENT.ARCHETYPE_WARMTH) return 'foyer'
    if (village.warmth <= -ALIGNMENT.ARCHETYPE_WARMTH) return 'meute'
  }
  return 'neutre'
}

/** Régén PV continue : de ×0.75 (Feu glacial) à ×2 (Feu chaleureux). */
export function regenFactor(state: SimState, entity: Entity): number {
  const village = getVillageOf(state, entity.id)
  if (!village) return 1
  return ALIGNMENT.REGEN_MIN + ((village.warmth + 100) / 200) * (ALIGNMENT.REGEN_MAX - ALIGNMENT.REGEN_MIN)
}

/** Modulateur de dégâts par palier (Foyer retenu, Meute mordante). */
export function damageModifier(state: SimState, attackerId: number, targetId: number): number {
  const attackerVillage = getVillageOf(state, attackerId)
  if (!attackerVillage || !isOutsider(state, attackerId, targetId)) return 1
  const archetype = archetypeOf(attackerVillage)
  if (archetype === 'meute') return ALIGNMENT.MEUTE_DAMAGE_BONUS
  if (archetype === 'foyer') {
    const targetVillage = getVillageOf(state, targetId)
    const provoked = targetVillage && findAggression(state, targetVillage.id, attackerVillage.id)
    return provoked ? 1 : ALIGNMENT.FOYER_OFFENSE_MALUS
  }
  return 1
}

/** La Meute a une économie anémique (spec R8). */
export function harvestFactor(state: SimState, entityId: number): number {
  const village = getVillageOf(state, entityId)
  return village && archetypeOf(village) === 'meute' ? ALIGNMENT.MEUTE_HARVEST_MALUS : 1
}

// ─── La passe du tick (spec R3, R5) ───────────────────────────────────────

export function advanceAlignment(state: SimState): void {
  // L'inertie : décroissance linéaire vers 0, liée au calendrier.
  const decayPerTick = (ALIGNMENT.DECAY_PER_DAY * state.calendarScale) / TICKS_PER_SEASON_DAY
  const monsterIds = new Set(state.monsters.map((m) => m.entityId))
  for (const entity of state.entities) {
    if (monsterIds.has(entity.id)) continue
    if (entity.warmth > 0) entity.warmth = Math.max(0, entity.warmth - decayPerTick)
    else if (entity.warmth < 0) entity.warmth = Math.min(0, entity.warmth + decayPerTick)
    if (entity.engagement > 0) entity.engagement = Math.max(0, entity.engagement - decayPerTick)
  }

  // L'agrégation au Feu : moyenne plafonnée par tête (spec R5).
  if (state.tick % ALIGNMENT.REFRESH_TICKS === 0) {
    for (const village of state.villages) {
      const members = state.entities.filter((e) => village.memberIds.includes(e.id))
      if (members.length === 0) continue
      const cap = ALIGNMENT.WARMTH_CAP_PER_HEAD
      let warmthSum = 0
      let engagementSum = 0
      for (const m of members) {
        warmthSum += Math.max(-cap, Math.min(cap, m.warmth))
        engagementSum += Math.min(cap, m.engagement)
      }
      village.warmth = warmthSum / members.length
      village.engagement = engagementSum / members.length
      const archetype = archetypeOf(village)
      if (archetype !== village.archetype) {
        village.archetype = archetype
        emitEvent(state, { type: 'village_archetype_changed', tick: state.tick, villageId: village.id, archetype })
      }
    }
    // La mémoire d'agression expire.
    state.aggressions = state.aggressions.filter(
      (a) => state.tick - a.tick <= ALIGNMENT.AGGRESSION_MEMORY_TICKS,
    )
  }
}
