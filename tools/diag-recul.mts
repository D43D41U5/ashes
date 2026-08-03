/**
 * QUEL RECUL LA MEUTE SUPPORTE-T-ELLE ? — la courbe, sur plusieurs graines.
 *
 *   node --import tsx tools/diag-recul.mts
 *
 * POURQUOI CET INSTRUMENT EXISTE. Le recul de combat (spec `combat.md` R4sexies) fait
 * rougir trois gardes de faune (A12 l'encerclement, A12bis la traque, A14 la mort
 * probable). Tentant de calibrer dessus — et c'est le piège : **A12bis rougit déjà pour
 * un recul de 0,02 tuile**, soit trois dixièmes de pixel. Une meute est CHAOTIQUE ; ces
 * gardes se jouent sur UNE graine ; leur verdict à cette échelle mesure le hasard, pas
 * la règle (leçon consignée : « une harde est chaotique — moyenner sur ≥ 4 graines »).
 *
 * On mesure donc les deux PROPRIÉTÉS que ces gardes défendent, sur plusieurs graines :
 *
 *   · L'ENCERCLEMENT — combien de côtés distincts la meute tient-elle autour d'un homme
 *     figé ? (A12/A12bis affirment ≥ 2.) C'est le moment de jeu construit le 2026-08-01.
 *   · LA LÉTALITÉ — un homme désarmé meurt-il face à quatre loups ? (A14, et R13 :
 *     « la mort doit être l'issue probable ».)
 *
 * Le recul se lit dans `balance.ts` : relancer l'instrument après avoir changé la valeur,
 * ou passer `DIAG_RECUL=0.1,0.2` pour balayer (l'override n'existe QUE dans cet outil —
 * `/sim` ne lit jamais d'environnement).
 */
import {
  BALANCE,
  COMBAT,
  FAUNA,
  MONSTER_DEFS,
  TERRAIN_GRASS,
  createEmptyMap,
  createSim,
  cycleOffsetForStartHour,
  spawnEntity,
  spawnMonster,
  step,
  type Monster,
  type SimState,
} from '../packages/sim/src/index'

const RECULS = (process.env.DIAG_RECUL ?? String(COMBAT.KNOCKBACK_TILES)).split(',').map(Number)
const GRAINES = [0, 1, 2, 3, 4, 5]

/**
 * Un monde nu, à 2 h du matin — LE MÊME BANC QUE `faune.test.ts`, et c'est capital :
 * mon premier jet mesurait « 0 côté tenu » sur toutes les graines, y compris à recul
 * NUL, là où la garde A12bis en trouve deux. Il ne mesurait pas la meute : il mesurait
 * mon banc, qui avait gardé la faune ambiante ET la nuit qui chasse — laquelle sème ses
 * propres loups autour du joueur et noie tout comptage de meute. Un instrument qui ne
 * reproduit pas le zéro connu ne mesure rien (leçon consignée : « la capture peut mentir »).
 */
function banc(graine: number): SimState {
  return createSim(graine, {
    map: createEmptyMap(160, 160, TERRAIN_GRASS),
    faunaCap: 0,
    worldEvents: false,
    cycleOffset: cycleOffsetForStartHour(2),
  })
}

function meute(sim: SimState, n: number, x: number, y: number): Monster[] {
  const herdId = sim.nextHerdId++
  const pack: Monster[] = []
  for (let i = 0; i < n; i++) {
    const id = spawnMonster(sim, 'wolf', x + i * 1.2, y)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    m.herdId = herdId
    pack.push(m)
  }
  return pack
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y))

/** COMBIEN DE CÔTÉS la meute tient-elle autour d'un homme qui s'est figé ? */
function cotesTenus(graine: number): number {
  const sim = banc(graine)
  const pack = meute(sim, 4, 80.5, 80.5)
  const a = spawnEntity(sim, 80.5, 92.5)
  const moi = sim.entities.find((e) => e.id === a)!
  moi.hp = 100
  // Trois secondes de marche : elle le repère. Puis il ne bouge plus.
  for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) step(sim, [{ entityId: a, dx: 0, dy: 1 }])
  for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) step(sim, [{ entityId: a, dx: 0, dy: 0 }])
  const proie = sim.entities.find((e) => e.id === a)
  if (!proie) return -1 // mort : l'encerclement ne se juge plus
  const cotes = new Set<string>()
  for (const w of pack) {
    const e = sim.entities.find((x) => x.id === w.entityId)
    if (!e) continue
    if (dist(e, proie) <= FAUNA.ENCIRCLE_RADIUS + FAUNA.POST_TOLERANCE + 1) {
      cotes.add(`${e.x < proie.x ? 'O' : 'E'}${e.y < proie.y ? 'N' : 'S'}`)
    }
  }
  return cotes.size
}

/** L'HOMME DÉSARMÉ MEURT-IL ? (et en combien de secondes) */
function mortEnSecondes(graine: number): number {
  const sim = banc(graine)
  const herdId = sim.nextHerdId++
  const alphaId = spawnMonster(sim, 'wolf', 80.5, 80.5)
  const alpha = sim.monsters.find((z) => z.entityId === alphaId)!
  alpha.herdId = herdId
  alpha.alpha = true
  const e = sim.entities.find((x) => x.id === alphaId)!
  e.hp = MONSTER_DEFS.wolf.hp * FAUNA.ALPHA_HP
  for (let i = 1; i <= 3; i++) {
    const id = spawnMonster(sim, 'wolf', 80.5 + i * 1.2, 80.5)
    const m = sim.monsters.find((z) => z.entityId === id)!
    m.herdId = herdId
    m.alphaId = alphaId
  }
  const a = spawnEntity(sim, 84.5, 80.5)
  for (let t = 0; t < 30 * BALANCE.TICK_RATE_HZ; t++) {
    step(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: -1, dy: 0 } }])
    const moi = sim.entities.find((x) => x.id === a)
    if (!moi || moi.hp <= 0 || moi.hp === COMBAT.RESPAWN_HP) return t / BALANCE.TICK_RATE_HZ
  }
  return -1 // il a survécu 30 s
}

console.log('LE RECUL CONTRE LA MEUTE — deux propriétés, plusieurs graines\n')
console.log(`  recul lu dans balance.ts : ${COMBAT.KNOCKBACK_TILES} tuile · graines ${GRAINES.join(',')}`)
console.log('  (pour balayer : DIAG_RECUL=0,0.1,0.25 node --import tsx tools/diag-recul.mts)\n')

if (RECULS.length > 1 || RECULS[0] !== COMBAT.KNOCKBACK_TILES) {
  console.log('  ⚠ DIAG_RECUL ne peut pas réécrire une constante de /sim : relancer l’outil')
  console.log('    après avoir posé la valeur dans balance.ts. Les colonnes ci-dessous valent')
  console.log(`    pour ${COMBAT.KNOCKBACK_TILES}, et pour elle seule.\n`)
}

const cotes = GRAINES.map(cotesTenus)
const morts = GRAINES.map(mortEnSecondes)
const moy = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length

console.log(`  ENCERCLEMENT (côtés tenus, ≥ 2 = le cercle se ferme)`)
console.log(`     par graine : ${cotes.join(' · ')}`)
console.log(`     moyenne ${moy(cotes).toFixed(2)} · graines à ≥ 2 : ${cotes.filter((c) => c >= 2).length}/${GRAINES.length}`)
console.log(`\n  LÉTALITÉ (secondes jusqu’à la mort ; −1 = il a survécu 30 s)`)
console.log(`     par graine : ${morts.map((m) => (m < 0 ? 'survit' : m.toFixed(1))).join(' · ')}`)
console.log(`     graines où il MEURT : ${morts.filter((m) => m >= 0).length}/${GRAINES.length}`)
