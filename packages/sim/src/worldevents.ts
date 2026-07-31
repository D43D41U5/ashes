/**
 * Les événements du monde — hordes, carcasses, alarmes (spec événements).
 *
 * Le robinet à sessions (GDD §6) : la nuit apporte la menace, la route
 * apporte l'opportunité. Tout est tiré au PRNG de la sim et cadencé par le
 * calendrier — la pression monte avec les actes (GDD §2).
 */
import { isThreatTo } from './alignment'
import { BALANCE, COMBAT, CONVOY_LOOT, FAUNA, LOOT_VALUES, MONSTER_DEFS, SEASON, SLOTS, TERRAIN_ROAD, WORLD_EVENTS } from './balance'
import { distSq } from './geometry'
import { computeFlowField } from './pathfinding'
import { inventoryOf, toBag } from './items'
import { rngRoll } from './rng'
import { spawnMonster } from './monsters'
import type { SimState } from './sim'
import { actForDay, DAY_TICKS_PER_CYCLE, seasonDayAtTick, TICKS_PER_CYCLE } from './time'
import { emitEvent } from './events'

export interface Horde {
  id: number
  targetVillageId: number
  memberEntityIds: number[]
}

function roll(state: SimState): number {
  const { value, next } = rngRoll(state.rngState)
  state.rngState = next
  return value
}


/**
 * Fait apparaître une horde en marche vers un village — hors de vue, mais SUR UN SOL QUI Y MÈNE.
 *
 * ═══ ELLE NAISSAIT DANS LA FALAISE ═══
 *
 * Le point d'entrée se cherchait sur un BORD DE CARTE, en 40 essais, **sans garde en cas
 * d'échec** : `ex, ey` gardaient le dernier essai, bloqué ou non. Or la vallée est ceinte de
 * roche — MESURÉ sur la carte du banc : **zéro tuile de bord marchable**, sur les quatre
 * bords et pour les trois villages. Chaque horde naissait donc DANS le mur, hors du champ de
 * flux (`field = -1`), et `hordeStep` concluait « au but ou coincé hors champ ».
 *
 * Le résultat, mesuré sur une saison entière : **0 horde sur 3 n'a atteint son village**, et
 * elles n'ont pas parcouru 1 à 3 tuiles — la méga-horde du Grand Froid, le climax de la
 * saison, a bougé de **3 tuiles** en une nuit, quand un Cendreux en couvre 1 400.
 *
 * On tire donc le point d'entrée du CHAMP DE FLUX lui-même, qui sait exactement quelles
 * tuiles mènent au Feu visé : parmi celles à bonne distance de marche, on en prend une. La
 * cible se choisit d'abord (le village, au hasard), le lieu ensuite — l'ordre inverse de
 * l'ancien, qui devait deviner un village depuis un bord qu'il n'atteignait jamais.
 */
export function spawnHorde(state: SimState, size: number): Horde | null {
  if (state.villages.length === 0) return null

  const target = state.villages[Math.floor(roll(state) * state.villages.length)] ?? state.villages[0]!
  const { width } = state.map
  const champ = computeFlowField(state.map, state.nodes, target.fireTx, target.fireTy)

  // ELLE DOIT POUVOIR ARRIVER. Le champ donne la distance de MARCHE au Feu : on ne retient
  // que la couronne qu'une bête à `speed` tuiles/s franchit dans une nuit, avec de la marge
  // pour le combat. Assez loin pour qu'on la voie venir, assez près pour qu'elle vienne.
  const nuit = Math.round(
    MONSTER_DEFS.cendreux.speed * 60 * BALANCE.CYCLE_REAL_MINUTES * (1 - BALANCE.CYCLE_DAY_FRACTION) * WORLD_EVENTS.HORDE_APPROACH_FRACTION,
  )
  // LA COURONNE SE MESURE CONTRE LA CARTE, pas en tuiles absolues. Écrit en dur, `HORDE_MIN_DIST`
  // vidait la couronne de toute carte plus petite que lui — et le repli sur « la tuile la plus
  // lointaine » posait la horde dans un COIN, où son bloc de naissance déborde sur des tuiles
  // hors champ. On borne donc les deux bouts par ce que la carte offre réellement.
  let dMax = 0
  for (let i = 0; i < champ.length; i++) if (champ[i]! > dMax) dMax = champ[i]!
  if (dMax === 0) return null // le Feu ne mène nulle part : rien à faire marcher
  const portee = Math.min(nuit, dMax)
  const mini = Math.min(WORLD_EVENTS.HORDE_MIN_DIST, Math.floor(portee / 2))
  const candidates: number[] = []
  for (let i = 0; i < champ.length; i++) {
    const d = champ[i]!
    if (d >= mini && d <= portee) candidates.push(i)
  }
  if (candidates.length === 0) return null
  const key = candidates[Math.floor(roll(state) * candidates.length)]!
  const ex = key % width
  const ey = Math.floor(key / width)

  const horde: Horde = { id: state.nextHordeId, targetVillageId: target.id, memberEntityIds: [] }
  state.nextHordeId += 1
  for (let i = 0; i < size; i++) {
    const ox = ex + (i % 3) - 1
    const oy = ey + Math.floor(i / 3) - 1
    let sx = Math.max(1, Math.min(state.map.width - 2, ox))
    let sy = Math.max(1, Math.min(state.map.height - 2, oy))
    // CHAQUE MEMBRE SUR UN SOL QUI MÈNE AU FEU. Le bloc de naissance est un carré aveugle :
    // au bord d'une paroi, une partie de ses cases tombe hors du champ (`-1`) et ces
    // membres-là resteraient plantés toute la nuit — le bug d'origine, en plus petit.
    if (champ[sy * width + sx]! === -1) {
      sx = ex
      sy = ey
    }
    // R1/R2 : la horde est faite de CENDREUX. Le Grand Froid devient littéralement
    // « les morts qui reviennent au feu » — un seul mort-vivant, un seul lore.
    horde.memberEntityIds.push(spawnMonster(state, 'cendreux', sx + 0.5, sy + 0.5))
  }
  state.hordes.push(horde)
  emitEvent(state, {
    type: 'horde_spawned',
    tick: state.tick,
    hordeId: horde.id,
    size,
    targetVillageId: target.id,
  })
  return horde
}

/** Fait apparaître une carcasse de convoi sur la route, gardée (spec R6). */
export function spawnConvoy(state: SimState): void {
  const roadTiles: number[] = []
  for (let i = 0; i < state.map.terrain.length; i++) {
    if (state.map.terrain[i] === TERRAIN_ROAD) roadTiles.push(i)
  }
  if (roadTiles.length === 0) return
  const key = roadTiles[Math.floor(roll(state) * roadTiles.length)]!
  const tx = key % state.map.width
  const ty = Math.floor(key / state.map.width)
  state.corpses.push({
    id: state.nextCorpseId,
    x: tx + 0.5,
    y: ty + 0.5,
    inventory: inventoryOf(SLOTS.CHEST, CONVOY_LOOT),
    decayAt: state.tick + WORLD_EVENTS.CONVOY_DECAY_TICKS,
    diedAt: state.tick,
  })
  state.nextCorpseId += 1
  // LES GARDES PARTENT AVEC LEUR CARCASSE. Ils appartiennent à l'événement, pas au monde :
  // même horloge que la décantation du butin qu'ils veillent (voir `Monster.expiresAt`).
  const expiresAt = state.tick + WORLD_EVENTS.CONVOY_DECAY_TICKS
  for (let i = 0; i < WORLD_EVENTS.CONVOY_GUARDS; i++) {
    const id = spawnMonster(state, 'cendreux', tx + 0.5 + (i === 0 ? 1 : -1), ty + 1.5)
    const garde = state.monsters.find((m) => m.entityId === id)
    if (garde) garde.expiresAt = expiresAt
  }
  emitEvent(state, { type: 'convoy_spawned', tick: state.tick, tx, ty })
}

/** L'ordonnanceur du monde (spec R8) : appelé chaque tick par step(). */
export function advanceWorldEvents(state: SimState): void {
  const cycleTick = state.tick % TICKS_PER_CYCLE
  const act = actForDay(seasonDayAtTick(state.tick, state.calendarScale))

  // La nuit tombe : peut-être une horde (spec R5) — et la Cendre déferle
  // au premier crépuscule de l'acte III (spec saison R2).
  if (cycleTick === DAY_TICKS_PER_CYCLE && state.villages.length > 0) {
    if (act === 3 && !state.megaHordeSpawned) {
      state.megaHordeSpawned = true
      spawnHorde(state, SEASON.MEGA_HORDE_SIZE)
    } else if (roll(state) < WORLD_EVENTS.HORDE_CHANCE_PER_NIGHT[act - 1]!) {
      spawnHorde(state, WORLD_EVENTS.HORDE_SIZE[act - 1]!)
    }
  }

  // L'aube : les hordes survivantes se dissipent (le tick 0 n'est pas une aube).
  if (cycleTick === 0 && state.tick > 0 && state.hordes.length > 0) {
    for (const horde of state.hordes) {
      for (const id of horde.memberEntityIds) {
        state.entities = state.entities.filter((e) => e.id !== id)
        state.monsters = state.monsters.filter((m) => m.entityId !== id)
      }
      emitEvent(state, { type: 'horde_dispersed', tick: state.tick, hordeId: horde.id })
    }
    state.hordes = []
  }

  // CE QUE LE MONDE REPREND. Une bête d'événement dont l'heure est passée s'en va — mais
  // jamais sous les yeux de quelqu'un : on attend qu'on ne la regarde plus, exactement comme
  // `advanceDens` attend pour en faire NAÎTRE une. Sans ce balayage, les gardes de convoi
  // s'empilaient sans fin (mesuré : 5 → 75 Cendreux sur une saison, par ce seul canal).
  if (state.monsters.some((m) => m.expiresAt !== undefined && state.tick >= m.expiresAt)) {
    const monsterIds = new Set(state.monsters.map((m) => m.entityId))
    const avatars = state.entities.filter((e) => !monsterIds.has(e.id) && e.hp > 0)
    const clearance = FAUNA.DEN_SPAWN_CLEARANCE * FAUNA.DEN_SPAWN_CLEARANCE
    const partis = new Set<number>()
    for (const m of state.monsters) {
      if (m.expiresAt === undefined || state.tick < m.expiresAt) continue
      const e = state.entities.find((en) => en.id === m.entityId)
      if (!e) continue
      if (avatars.some((a) => distSq(a.x, a.y, e.x, e.y) <= clearance)) continue // on la regarde
      partis.add(m.entityId)
    }
    if (partis.size > 0) {
      state.monsters = state.monsters.filter((m) => !partis.has(m.entityId))
      state.entities = state.entities.filter((e) => !partis.has(e.id))
    }
  }

  // La carcasse de convoi, tous les N jours de saison (spec R6).
  const day = seasonDayAtTick(state.tick, state.calendarScale)
  if (
    day !== state.lastConvoyDay &&
    day % WORLD_EVENTS.CONVOY_PERIOD_DAYS === 0 &&
    state.map.terrain.includes(TERRAIN_ROAD)
  ) {
    state.lastConvoyDay = day
    spawnConvoy(state)
  }

  // L'alarme (spec R4) : une par vague et par village — monstres ET raiders.
  for (const village of state.villages) {
    if (state.tick < village.lastAlarmAt + WORLD_EVENTS.ALARM_COOLDOWN_TICKS) continue
    const radius = COMBAT.DEFEND_RADIUS
    const threatened = state.entities.some((e) => {
      if (!isThreatTo(state, e.id, village)) return false
      const dx = e.x - (village.fireTx + 0.5)
      const dy = e.y - (village.fireTy + 0.5)
      return dx * dx + dy * dy <= radius * radius
    })
    if (threatened) {
      village.lastAlarmAt = state.tick
      emitEvent(state, { type: 'alarm_raised', tick: state.tick, villageId: village.id })
    }
  }

  // Nettoyage des hordes vidées par la milice.
  state.hordes = state.hordes.filter((h) =>
    h.memberEntityIds.some((id) => state.entities.some((e) => e.id === id)),
  )

  // L'évacuation s'ouvre (spec saison R3).
  if (state.evacuation === null && day >= SEASON.EVAC_DAY) {
    const roadTiles: number[] = []
    for (let i = 0; i < state.map.terrain.length; i++) {
      if (state.map.terrain[i] === TERRAIN_ROAD) roadTiles.push(i)
    }
    const key = roadTiles.length > 0 ? roadTiles[Math.floor(roll(state) * roadTiles.length)]! : 0
    const tx = roadTiles.length > 0 ? key % state.map.width : Math.floor(state.map.width / 2)
    const ty = roadTiles.length > 0 ? Math.floor(key / state.map.width) : Math.floor(state.map.height / 2)
    state.evacuation = { tx, ty }
    emitEvent(state, { type: 'evacuation_opened', tick: state.tick, tx, ty })
  }

  // L'ARCHE LÈVE L'ANCRE (V2-24) : l'évacuation n'est plus un marqueur passif — elle a une
  // HEURE. Au jour EVAC_DAY + EVAC_DEPART_DAYS, qui est À BORD (dans le rayon) part sauvé ;
  // le reste est laissé. C'est le « tenir jusqu'au départ » que le GDD promet, et le verdict
  // Foyer ne compte plus que les EMBARQUÉS, pas ceux qui traînent à proximité à la fin.
  if (state.evacuation !== null && day >= SEASON.EVAC_DAY + SEASON.EVAC_DEPART_DAYS) {
    const evac = state.evacuation
    for (const e of state.entities) {
      if (e.hp <= 0) continue
      const dx = e.x - (evac.tx + 0.5)
      const dy = e.y - (evac.ty + 0.5)
      if (dx * dx + dy * dy <= SEASON.EVAC_RADIUS * SEASON.EVAC_RADIUS) state.evacuatedIds.push(e.id)
    }
    emitEvent(state, { type: 'ark_departed', tick: state.tick, tx: evac.tx, ty: evac.ty, saved: state.evacuatedIds.length })
    state.evacuation = null // partie : le marqueur disparaît
  }

  // La fin de saison : les verdicts (spec saison R4).
  if (!state.seasonEnded && day > BALANCE.SEASON_DAYS) {
    state.seasonEnded = true
    emitEvent(state, { type: 'season_ended', tick: state.tick, verdicts: computeVerdicts(state) })
  }
}

/** Le verdict de chaque village selon son archétype (GDD §2). */
function computeVerdicts(state: SimState): {
  villageId: number
  name: string
  archetype: 'foyer' | 'meute' | 'neutre'
  score: number
  outcome: string
}[] {
  return state.villages.map((village) => {
    const members = state.entities.filter((e) => village.memberIds.includes(e.id) && e.hp > 0)
    // L'ARCHE (V2-24) : seuls les EMBARQUÉS comptent (recensés au départ), pas la proximité
    // passive à la fin — « sauver des vies » exige de les avoir mises à bord à temps.
    const evacuated = members.filter((m) => state.evacuatedIds.includes(m.id)).length
    const lootValue = (inv: Record<string, number | undefined>): number => {
      let total = 0
      for (const item of Object.keys(inv)) {
        total += (inv[item] ?? 0) * ((LOOT_VALUES as Record<string, number>)[item] ?? 1)
      }
      return total
    }
    let granaryValue = 0
    for (const s of state.structures) {
      if (s.villageId === village.id && s.inventory) granaryValue += lootValue(toBag(s.inventory))
    }
    for (const m of members) granaryValue += lootValue(toBag(m.inventory))

    if (village.archetype === 'foyer') {
      const score = members.length + evacuated
      return {
        villageId: village.id,
        name: village.name,
        archetype: village.archetype,
        score,
        outcome: `a sauvé ${members.length} vie${members.length > 1 ? 's' : ''}${evacuated > 0 ? ` dont ${evacuated} évacuée${evacuated > 1 ? 's' : ''}` : ''}`,
      }
    }
    if (village.archetype === 'meute') {
      return {
        villageId: village.id,
        name: village.name,
        archetype: village.archetype,
        score: granaryValue,
        outcome: `est partie les bras pleins (valeur ${granaryValue})`,
      }
    }
    return {
      villageId: village.id,
      name: village.name,
      archetype: village.archetype,
      score: members.length,
      outcome: members.length > 0 ? `a tenu jusqu'à la Cendre (${members.length} debout)` : 's’est éteint',
    }
  })
}
