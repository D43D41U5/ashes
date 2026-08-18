/**
 * Jauge Température (spec 2026-07-08) — modèle thermostat, pur et déterministe.
 * La cible = BASE − altitude − acte + (nuit+biome amortis par l'abri), plancherée
 * par la bulle d'un feu. Aucune fonction transcendante (seul `sqrt`, autorisé).
 */
import { POI, TEMPERATURE } from './balance'
import { brumeCold } from './brume'
import { fireWarmthFactor } from './fire'
import { die } from './combat'
import { countOf } from './items'
import { terrainAt } from './map'
import { isOnPoiKind } from './poi-discovery'
import { getGameTime } from './time'
import type { SimState } from './sim'

const T = TEMPERATURE

function clampTemp(v: number): number {
  return Math.max(0, Math.min(100, v))
}

/** Sur l'empreinte d'une structure à toit (maison) — ou d'une Grotte → abrité. */
export function isSheltered(state: SimState, tx: number, ty: number): boolean {
  if (state.structures.some((s) => s.tx === tx && s.ty === ty && s.type === 'house')) return true
  return isOnPoiKind(state, tx, ty, 'grotte')
}

/** Réchauffement du feu le plus proche : FIRE_WARMTH au contact, linéaire → 0 à FIRE_RANGE. */
export function fireBubble(state: SimState, x: number, y: number): number {
  let best = 0
  for (const s of state.structures) {
    if (s.type !== 'fire') continue
    // Un feu éteint ne chauffe plus ; les braises chauffent atténué (spec feu-station S3).
    const factor = fireWarmthFactor(state, s)
    if (factor <= 0) continue
    const dx = s.tx - x
    const dy = s.ty - y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist >= T.FIRE_RANGE) continue
    const warmth = T.FIRE_WARMTH * factor * (1 - dist / T.FIRE_RANGE)
    if (warmth > best) best = warmth
  }
  return best
}

/**
 * Réchauffement des sources chaudes — MÊME LOI que `fireBubble` (linéaire,
 * max au contact → 0 au bord du rayon). C'est un feu qu'on n'a pas allumé :
 * sur une carte où le Grand Froid mord, il réécrit les itinéraires.
 */
export function naturalWarmth(state: SimState, x: number, y: number): number {
  let best = 0
  for (const z of state.map.zones) {
    if (z.kind !== 'source_chaude') continue
    const dx = z.x + z.w / 2 - x
    const dy = z.y + z.h / 2 - y
    const dist = Math.sqrt(dx * dx + dy * dy) // sqrt est autorisé (invariant #2)
    if (dist >= POI.HOTSPRING_RANGE_TILES) continue
    const warmth = POI.HOTSPRING_WARMTH * (1 - dist / POI.HOTSPRING_RANGE_TILES)
    if (warmth > best) best = warmth
  }
  return best
}

/**
 * Température de BASE d'un lieu — biome + heure + acte + abri, SANS aucune source de chaleur
 * (ni feu ni source chaude). C'est le froid « du monde ». Sert au gate d'attraction des
 * Cendreux (spec feu-station S5) : surtout PAS l'ambiant fini (qui inclut le feu), sinon un
 * Cendreux qui s'approche se réchaufferait, franchirait le seuil et oscillerait à la lisière.
 */
export function baselineTemperature(state: SimState, x: number, y: number): number {
  const tx = Math.floor(x)
  const ty = Math.floor(y)
  const time = getGameTime(state)
  const biome = T.BIOME_OFFSET[terrainAt(state.map, tx, ty)] ?? 0

  // La carte est plate : le froid ne vient plus de l'altitude, seulement du BIOME (la neige, le
  // glacier) et de l'heure. Le froid des zones hautes est porté par leur terrain, pas par une hauteur.
  const base = T.BASE - T.ACT_COLD[time.act - 1]! // non coupé par un toit
  // LA BRUME (spec brume.md R4) est une EXPOSITION de plus : l'abri l'amortit, et le feu
  // comme la tenue la PLANCHENT (l'ambiant est un max) — le déni de zone tombe de ces lois,
  // pas d'une mécanique neuve.
  const exposed = biome - (time.isNight ? T.NIGHT_COLD : 0) - brumeCold(state, x, y) // amorti par l'abri
  const shelter = isSheltered(state, tx, ty) ? T.SHELTER_FACTOR : 1
  return clampTemp(base + shelter * exposed)
}

/** Température ambiante cible (0-100) au lieu (x,y) : le froid de base, PLANCHERÉ par un feu / une source chaude. */
export function ambientTemperature(state: SimState, x: number, y: number): number {
  // Ni le feu ni la source chaude ne peuvent refroidir : ils ne font que plancher.
  return Math.max(baselineTemperature(state, x, y), fireBubble(state, x, y), naturalWarmth(state, x, y))
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
    let ambient = ambientTemperature(state, entity.x, entity.y)
    // LA TENUE D'HIVER PLAFONNE LE FROID (spec cuir/température) : la porter plancher
    // l'ambiant ressenti — au-dessus de l'hypothermie, donc survivable. C'est ce qui
    // donne une raison à toute la chaîne chasse→cuir→couture, et rend la plaine
    // franchissable en acte III. Vraie protection, pas un simple ralentissement de dérive.
    if (countOf(entity.inventory, 'tenue_hiver') > 0) ambient = Math.max(ambient, T.TENUE_FLOOR)
    entity.temperature = clampTemp(driftStep(entity.temperature, ambient, T.INSULATION_BODY))

    const dmg = coldDamagePerTick(entity.temperature)
    if (dmg > 0) {
      const before = entity.hp
      entity.hp = Math.max(0, entity.hp - dmg)
      if (before > 0 && entity.hp <= 0) die(state, entity, 0, 'cold')
    }
  }
}
