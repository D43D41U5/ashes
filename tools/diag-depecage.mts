/**
 * SONDE DU DÉPEÇAGE (spec `depecage.md`) — ce que vaut une carcasse, en temps et en parts.
 *
 * Pour chaque espèce et quelques niveaux de `hunting`, on tue une vraie bête (`die()`, coup
 * propre), on tient le couteau dessus jusqu'à ce que la découpe s'arrête d'elle-même, et on
 * relève : les parts sorties et leur ORDRE (tiré, D3), les ticks passés sur la bête, ce qui y
 * reste (l'os du novice), l'XP gagnée. Puis le troisième acte : un loup affamé à 12 tuiles d'un
 * cerf ENTAMÉ — en combien de ticks il arrive, et ce qu'il mange (le quartier, depuis R4).
 * C'est l'instrument qui calibre `BUTCHER` et la table d'os — en jouant la scène, pas en la
 * lisant.
 *
 *   node --import tsx tools/diag-depecage.mts [seeds...]
 */
import { BALANCE, BUTCHER, FAUNA, MONSTER_DEFS, TERRAIN_GRASS, type MonsterType } from '../packages/sim/src/balance'
import { die } from '../packages/sim/src/combat'
import { drainEvents } from '../packages/sim/src/events'
import { countOf, type ItemId } from '../packages/sim/src/items'
import { createEmptyMap } from '../packages/sim/src/map'
import { spawnMonster } from '../packages/sim/src/monsters'
import { createSim, spawnEntity, step, type SimState } from '../packages/sim/src/sim'
import { cycleOffsetForStartHour } from '../packages/sim/src/time'
import { grantItems } from '../packages/sim/src/village'

const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n))
if (seeds.length === 0) seeds.push(2026)

const ESPECES: MonsterType[] = ['rabbit', 'boar', 'deer', 'wolf']
const NIVEAUX = [0, 2, 5]

function banc(seed: number, heure = 12): { sim: SimState; id: number } {
  const sim = createSim(seed, {
    map: createEmptyMap(60, 60, TERRAIN_GRASS),
    faunaCap: 0,
    worldEvents: false,
    meteoActive: false,
    cycleOffset: cycleOffsetForStartHour(heure),
  })
  sim.wind = { x: 0, y: 0 }
  const id = spawnEntity(sim, 20.5, 20.5)
  grantItems(sim, id, { crude_knife: 1 })
  const e = sim.entities.find((x) => x.id === id)!
  e.activeSlot = e.inventory.findIndex((s) => s?.item === 'crude_knife')
  drainEvents(sim)
  return { sim, id }
}

function tuer(sim: SimState, byId: number, species: MonsterType, x: number, y: number): number {
  const mid = spawnMonster(sim, species, x, y)
  const m = sim.monsters.find((k) => k.entityId === mid)!
  m.slainClean = true
  die(sim, sim.entities.find((e) => e.id === mid)!, byId)
  drainEvents(sim)
  return sim.corpses[sim.corpses.length - 1]!.id
}

for (const seed of seeds) {
  console.log(`\n═══ seed ${seed} — CUT_TICKS ${BUTCHER.CUT_TICKS} (−${BUTCHER.SPEED_PER_LEVEL}/niveau, plancher ${BUTCHER.CUT_TICKS_MIN}) · BONE_LEVEL ${BUTCHER.BONE_LEVEL} ═══`)
  for (const species of ESPECES) {
    for (const niveau of NIVEAUX) {
      const { sim, id } = banc(seed)
      const e = sim.entities.find((x) => x.id === id)!
      e.skills.hunting = 100 * niveau * niveau
      const corpseId = tuer(sim, id, species, 21.5, 20.5)
      const ordre: ItemId[] = []
      let ticks = 0
      let hold = false
      for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) {
        step(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'butcher_start', corpseId, hold } }])
        hold = true
        ticks += 1
        for (const ev of drainEvents(sim)) if (ev.type === 'carcass_cut') ordre.push(ev.item)
        if (e.butchering === undefined) break
      }
      const reste = sim.corpses.find((c) => c.id === corpseId)
      const resteTxt = reste ? (Object.keys(MONSTER_DEFS[species].loot) as ItemId[]).concat(['raw_hide']).map((it) => `${countOf(reste.inventory, it)} ${it}`).filter((s) => !s.startsWith('0 ')).join(', ') : 'rien (disparue)'
      console.log(
        `${species.padEnd(6)} niv ${niveau} — ${ordre.length} parts en ${ticks} ticks (${(ticks / BALANCE.TICK_RATE_HZ).toFixed(1)} s) : ${ordre.join(' → ')} · reste : ${resteTxt} · XP ${e.skills.hunting! - 100 * niveau * niveau}`,
      )
    }
  }

  // LE TROISIÈME ACTE : le loup et le cerf entamé.
  const { sim, id } = banc(seed, 2)
  const corpseId = tuer(sim, id, 'deer', 21.5, 20.5)
  let hold = false
  for (let t = 0; t < BUTCHER.CUT_TICKS + 1; t++) {
    step(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'butcher_start', corpseId, hold } }])
    hold = true
  }
  step(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'butcher_stop' } }])
  const e = sim.entities.find((x) => x.id === id)!
  e.x = 5.5
  e.y = 5.5
  drainEvents(sim)
  const loupId = spawnMonster(sim, 'wolf', 33.5, 20.5)
  const loup = sim.monsters.find((m) => m.entityId === loupId)!
  loup.alpha = true
  loup.alphaId = loupId
  loup.herdId = sim.nextHerdId++
  let arrive = -1
  for (let t = 0; t < 40 * BALANCE.TICK_RATE_HZ; t++) {
    step(sim, [{ entityId: id, dx: 0, dy: 0 }])
    if (loup.eatingUntil !== undefined) {
      arrive = t
      break
    }
  }
  if (arrive < 0) console.log(`loup — n'est PAS venu au cerf entamé en 40 s`)
  else {
    for (let t = 0; t < FAUNA.EAT_TICKS + 2; t++) step(sim, [{ entityId: id, dx: 0, dy: 0 }])
    const c = sim.corpses.find((k) => k.id === corpseId)
    console.log(
      `loup — sur le cerf entamé en ${arrive} ticks (${(arrive / BALANCE.TICK_RATE_HZ).toFixed(1)} s, depuis 12 t) ; après son repas : ${c ? `${countOf(c.inventory, 'quartier')} quartier, ${countOf(c.inventory, 'raw_hide')} peau, ${countOf(c.inventory, 'bone')} os` : 'carcasse disparue'} ; repu ${loup.satedUntil !== undefined}`,
    )
  }
}
