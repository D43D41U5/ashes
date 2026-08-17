/**
 * ═══ D'OÙ VIENT LA MORT ? — l'autopsie des PNJ de village sur une saison ═══
 *
 * Le banc de saison (docs/calibration-saison.md) a mesuré ~0,4 mort/jour et l'effondrement
 * de tout village PNJ vers j26-30 — mais un agrégat ne dit pas QUI tue, ni OÙ. Cette sonde
 * rejoue le même monde (`construireMondeDuBanc`) et, à chaque mort de PNJ, relève depuis
 * l'ombre du tick précédent : la CAUSE (faim/froid/horde/rôdeur ambiant/raid), le TUEUR
 * (type de monstre), le LIEU (dans le carré du village — Chebyshev ≤ FIRE_RADIUS_BY_TIER —
 * ou dehors, et à quelle distance), le MOMENT (nuit/jour, jour de saison) et la TÂCHE
 * (corvée en cours, sommeil, oisif). C'est la donnée qui manque à la question ② du rapport
 * (le taux d'échange milice/horde) : le remède n'est pas le même si l'on meurt sous ses
 * murs pendant l'assaut ou dehors, cueilli en corvée.
 *
 * Usage : node --import tsx tools/diag-mort-pnj.mts <seed> [jours=32]
 */
import { construireMondeDuBanc } from '../packages/sim/src/scenario'
import { drainEvents } from '../packages/sim/src/events'
import { step } from '../packages/sim/src/sim'
import { DAY_TICKS_PER_CYCLE, TICKS_PER_CYCLE } from '../packages/sim/src/time'
import { BALANCE } from '../packages/sim/src/balance'

const SEED = Number(process.argv[2])
const JOURS = Number(process.argv[3] ?? 32)
if (!Number.isFinite(SEED)) {
  console.error('usage : node --import tsx tools/diag-mort-pnj.mts <seed> [jours=32]')
  process.exit(1)
}

const { sim, monde } = construireMondeDuBanc(SEED)
console.log(`seed ${SEED} : ${monde.huntingGrounds} coins de chasse, marge ${monde.margeDeCible} % — autopsie sur ${JOURS} jours`)

/** L'ombre du tick précédent — la victime et son tueur sont souvent déjà retirés de l'état
 *  au moment où l'événement se lit. */
interface OmbrePnj { x: number; y: number; villageId: number; tache: string }
let pnjs = new Map<number, OmbrePnj>()
let monstres = new Map<number, string>()
let horde = new Set<number>()
let membreDe = new Map<number, number>()
/** Les villages, en DERNIER état connu — un village tombé garde son feu et son palier. */
const villages = new Map<number, { nom: string; fireTx: number; fireTy: number; tier: number }>()

function releverOmbres(): void {
  pnjs = new Map()
  for (const n of sim.npcs) {
    const e = sim.entities.find((x) => x.id === n.entityId)
    if (!e || e.hp <= 0) continue
    pnjs.set(n.entityId, {
      x: e.x,
      y: e.y,
      villageId: n.villageId,
      tache: n.task ? n.task.kind : n.sleeping ? 'sommeil' : 'oisif',
    })
  }
  monstres = new Map(sim.monsters.map((m) => [m.entityId, m.type]))
  horde = new Set(sim.hordes.flatMap((h) => h.memberEntityIds))
  membreDe = new Map()
  for (const v of sim.villages) {
    villages.set(v.id, { nom: v.name, fireTx: v.fireTx, fireTy: v.fireTy, tier: v.tier })
    for (const id of v.memberIds) membreDe.set(id, v.id)
  }
}
releverOmbres()

interface Mort {
  jour: number
  nuit: boolean
  village: string
  tache: string
  dedans: boolean
  dist: number
  cause: string
}
const morts: Mort[] = []

const total = JOURS * TICKS_PER_CYCLE
for (let t = 0; t < total; t++) {
  step(sim, [])
  const jour = Math.floor(t / TICKS_PER_CYCLE) + 1
  const cycleTick = (sim.tick + sim.cycleOffset) % TICKS_PER_CYCLE
  for (const e of drainEvents(sim)) {
    if (e.type !== 'entity_died' || e.wasMonster) continue
    const ombre = pnjs.get(e.entityId)
    const v = ombre ? villages.get(ombre.villageId) : undefined
    let cause: string
    if (e.cause === 'hunger') cause = 'faim'
    else if (e.cause === 'cold') cause = 'froid'
    else if (monstres.has(e.byEntityId)) {
      const type = monstres.get(e.byEntityId)!
      cause = horde.has(e.byEntityId) ? `horde (${type})` : `ambiant (${type})`
    } else if (membreDe.has(e.byEntityId)) {
      cause = `raid (${villages.get(membreDe.get(e.byEntityId)!)?.nom ?? '?'})`
    } else cause = `inconnu (byEntityId ${e.byEntityId})`
    const dist = ombre && v ? Math.max(Math.abs(ombre.x - (v.fireTx + 0.5)), Math.abs(ombre.y - (v.fireTy + 0.5))) : NaN
    const rayon = v ? BALANCE.FIRE_RADIUS_BY_TIER[Math.min(v.tier, 3) - 1]! : 0
    const m: Mort = {
      jour,
      nuit: cycleTick >= DAY_TICKS_PER_CYCLE,
      village: v?.nom ?? '?',
      tache: ombre?.tache ?? '?',
      dedans: Number.isFinite(dist) && dist <= rayon,
      dist: Math.round(dist * 10) / 10,
      cause,
    }
    morts.push(m)
    console.log(
      `  j${m.jour}${m.nuit ? ' NUIT' : ' jour'} · ${m.village} · ${m.cause} · ` +
        `${m.dedans ? 'DANS le carré' : 'DEHORS'} (${m.dist} t du Feu) · tâche: ${m.tache}`,
    )
  }
  releverOmbres()
  if (pnjs.size === 0 && sim.villages.length === 0) {
    console.log(`  (monde PNJ éteint au jour ${jour} — la sonde s'arrête)`)
    break
  }
}

const compte = (f: (m: Mort) => string): Record<string, number> => {
  const c: Record<string, number> = {}
  for (const m of morts) c[f(m)] = (c[f(m)] ?? 0) + 1
  return c
}
console.log(`\n═══ ${morts.length} morts de PNJ — seed ${SEED} ═══`)
console.log('par cause   :', JSON.stringify(compte((m) => m.cause)))
console.log('par lieu    :', JSON.stringify(compte((m) => (m.dedans ? 'dans le carré' : 'dehors'))))
console.log('par moment  :', JSON.stringify(compte((m) => (m.nuit ? 'nuit' : 'jour'))))
console.log('par tâche   :', JSON.stringify(compte((m) => m.tache)))
console.log('par village :', JSON.stringify(compte((m) => m.village)))
