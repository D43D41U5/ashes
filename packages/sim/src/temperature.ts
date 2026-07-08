/**
 * Jauge Température (spec 2026-07-08) — modèle thermostat, pur et déterministe.
 * La cible = BASE − altitude − acte + (nuit+biome amortis par l'abri), plancherée
 * par la bulle d'un feu. Aucune fonction transcendante (seul `sqrt`, autorisé).
 */
import { TEMPERATURE } from './balance'
import { die } from './combat'
import { elevationAt, terrainAt } from './map'
import { getGameTime } from './time'
import type { SimState } from './sim'

const T = TEMPERATURE

function clampTemp(v: number): number {
  return Math.max(0, Math.min(100, v))
}

/** Sur l'empreinte d'une structure à toit (maison) → abrité. */
export function isSheltered(state: SimState, tx: number, ty: number): boolean {
  return state.structures.some((s) => s.tx === tx && s.ty === ty && s.type === 'house')
}

/** Réchauffement du feu le plus proche : FIRE_WARMTH au contact, linéaire → 0 à FIRE_RANGE. */
export function fireBubble(state: SimState, x: number, y: number): number {
  let best = 0
  for (const s of state.structures) {
    if (s.type !== 'fire') continue
    const dx = s.tx - x
    const dy = s.ty - y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist >= T.FIRE_RANGE) continue
    const warmth = T.FIRE_WARMTH * (1 - dist / T.FIRE_RANGE)
    if (warmth > best) best = warmth
  }
  return best
}

/** Température ambiante cible (0-100) au lieu (x,y) et à l'instant courant. */
export function ambientTemperature(state: SimState, x: number, y: number): number {
  const tx = Math.floor(x)
  const ty = Math.floor(y)
  const time = getGameTime(state)
  const elev = elevationAt(state.map, tx, ty)
  const biome = T.BIOME_OFFSET[terrainAt(state.map, tx, ty)] ?? 0

  const base = T.BASE - elev * T.ALT_COLD - T.ACT_COLD[time.act - 1]! // non coupé par un toit
  const exposed = biome - (time.isNight ? T.NIGHT_COLD : 0) // amorti par l'abri
  const shelter = isSheltered(state, tx, ty) ? T.SHELTER_FACTOR : 1
  const ambient = clampTemp(base + shelter * exposed)

  return Math.max(ambient, fireBubble(state, x, y)) // le feu ne peut que réchauffer
}

/** Un pas de dérive vers l'ambiant, freiné par l'isolation. Pur. */
export function driftStep(current: number, ambient: number, insulation: number): number {
  return current + ((ambient - current) * T.K_DRIFT) / insulation
}

/** Dégâts PV/tick dus au froid : 0 au-dessus de HYPOTHERMIA, linéaire jusqu'à 0. */
export function coldDamagePerTick(temp: number): number {
  if (temp >= T.HYPOTHERMIA) return 0
  return ((T.HYPOTHERMIA - temp) / T.HYPOTHERMIA) * T.HYPOTHERMIA_DAMAGE_MAX
}

/** 0 au confort (≥60), 1 à l'hypothermie (≤20), linéaire entre les deux. */
export function coldEffectRamp(temp: number): number {
  if (temp >= T.COMFORT) return 0
  if (temp <= T.HYPOTHERMIA) return 1
  return (T.COMFORT - temp) / (T.COMFORT - T.HYPOTHERMIA)
}

/** Malus de vitesse dû à l'engourdissement : 1 au confort, plancher SPEED_FLOOR à l'hypothermie. */
export function coldSpeedFactor(temp: number): number {
  return 1 - coldEffectRamp(temp) * (1 - T.SPEED_FLOOR)
}

/** Malus de régén d'endurance dû à l'engourdissement : 1 au confort, plancher STAMINA_FLOOR à l'hypothermie. */
export function coldStaminaRegenFactor(temp: number): number {
  return 1 - coldEffectRamp(temp) * (1 - T.STAMINA_FLOOR)
}

/** Fait dériver chaque humain vers son ambiant. Une étape de tick. */
export function advanceTemperature(state: SimState): void {
  const monsterIds = new Set(state.monsters.map((m) => m.entityId))
  // Copie défensive (comme advanceCombat) : die() peut réassigner state.entities.
  for (const entity of [...state.entities]) {
    if (monsterIds.has(entity.id)) continue // pas de température pour les monstres
    const ambient = ambientTemperature(state, entity.x, entity.y)
    entity.temperature = clampTemp(driftStep(entity.temperature, ambient, T.INSULATION_BODY))

    const dmg = coldDamagePerTick(entity.temperature)
    if (dmg > 0) {
      const before = entity.hp
      entity.hp = Math.max(0, entity.hp - dmg)
      if (before > 0 && entity.hp <= 0) die(state, entity, 0, 'cold')
    }
  }
}
