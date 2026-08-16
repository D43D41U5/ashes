/**
 * ═══ LE BANC DE SAISON — la calibration longue que le banc CI ne joue plus ═══
 *
 * Le banc `pnpm scenario` garde la non-régression de famine à 1 jour ; les longues saisons
 * sont « l'affaire du calibrage manuel » (scenario.test.ts). Voici l'instrument de ce
 * calibrage : le MÊME monde (`construireMondeDuBanc`, parité d'amorce comprise), joué une
 * saison entière, avec un RELEVÉ PAR CYCLE écrit au fil de l'eau — un crash à l'heure trois
 * ne perd rien, et la courbe dit ce qu'un agrégat final efface (un village mort au jour 12
 * et un village mort au jour 58 rendent le même « 0 membre »).
 *
 * Usage : node --import tsx tools/banc-saison.mts <seed> [jours=60]
 * Sortie : scratchpad/banc-saison/seed-<seed>.jsonl — une ligne par cycle, puis un résumé.
 *
 * LES DEUX LIMITES DE L'INSTRUMENT, à lire avant les nombres :
 *   ① le banc n'a PAS de joueur — toute règle qui vise l'avatar mesure zéro ici ;
 *   ② deux horloges — `calendarScale` fait d'un cycle un jour de saison : ce qui compte en
 *     CYCLES réels (péremption, cadences) tourne ~30× plus vite qu'en vrai jeu.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { construireMondeDuBanc } from '../packages/sim/src/scenario'
import { drainEvents } from '../packages/sim/src/events'
import { step, type SimState } from '../packages/sim/src/sim'
import { TICKS_PER_CYCLE } from '../packages/sim/src/time'
import { BALANCE } from '../packages/sim/src/balance'
import { countOf } from '../packages/sim/src/items'

const SEED = Number(process.argv[2])
const JOURS = Number(process.argv[3] ?? 60)
if (!Number.isFinite(SEED)) {
  console.error('usage : node --import tsx tools/banc-saison.mts <seed> [jours=60]')
  process.exit(1)
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = resolve(ROOT, 'scratchpad/banc-saison')
mkdirSync(OUT_DIR, { recursive: true })
const OUT = resolve(OUT_DIR, `seed-${SEED}.jsonl`)
writeFileSync(OUT, '')

/** Les faits qu'on garde NOMMÉS avec leur jour — la chronique de l'instrument. Tout le
 *  reste n'est que compté (un tally par cycle) : accumuler 60 jours d'événements bruts
 *  coûterait des centaines de Mo pour rien. */
const MOMENTS = new Set([
  'act_started', 'season_ended', 'evacuation_opened', 'ark_departed',
  'village_fell', 'village_archetype_changed', 'village_stage_up',
  'fire_starved', 'fire_extinguished', 'fire_relit', 'fire_upgraded',
  'horde_spawned', 'horde_dispersed', 'member_banished',
])

const t0 = performance.now()
const { sim, monde } = construireMondeDuBanc(SEED)
appendFileSync(OUT, JSON.stringify({ type: 'monde', seed: SEED, jours: JOURS, ...monde }) + '\n')
console.log(`seed ${SEED} : monde ${monde.width}×${monde.height}, ${monde.nodes} nœuds, ` +
  `${monde.huntingGrounds} coins de chasse, ${monde.structuresBaties} structures, ` +
  `marge de ciblage ${monde.margeDeCible} % (bâti en ${Math.round(performance.now() - t0) / 1000} s)`)

function releveVillages(s: SimState): object[] {
  return s.villages.map((v) => {
    const granary = s.structures.find(
      (st) => st.type === 'chest' && st.villageId === v.id && st.access === 'village',
    )
    const inv = granary?.inventory ?? []
    return {
      nom: v.name,
      arch: v.archetype,
      membres: s.entities.filter((e) => v.memberIds.includes(e.id) && e.hp > 0).length,
      nourriture: countOf(inv, 'berries') + 3 * countOf(inv, 'stew'),
      bois: countOf(inv, 'wood'),
      fuel: Math.round(v.fuel),
      palier: v.tier,
      warmth: Math.round(v.warmth),
      engagement: Math.round(v.engagement),
    }
  })
}

// La cadence d'échantillonnage de la faim du banc CI, à l'identique — le seuil historique
// (≤ 10 à 1 jour, 177 à l'effondrement) n'est comparable qu'à cadence égale.
const sampleEveryTicks = Math.round(500 * (BALANCE.TICK_RATE_HZ / 12))

let morts = 0
let hordes = 0
let faim = 0
const moments: { jour: number; evt: string; detail?: string }[] = []
let tickGlobal = 0

for (let cycle = 1; cycle <= JOURS; cycle++) {
  const c0 = performance.now()
  const tally: Record<string, number> = {}
  for (let t = 0; t < TICKS_PER_CYCLE; t++) {
    step(sim, [])
    for (const e of drainEvents(sim)) {
      tally[e.type] = (tally[e.type] ?? 0) + 1
      if (e.type === 'entity_died' && !(e as { wasMonster?: boolean }).wasMonster) morts += 1
      if (e.type === 'horde_spawned') hordes += 1
      if (MOMENTS.has(e.type)) {
        const d = e as unknown as Record<string, unknown>
        moments.push({
          jour: cycle,
          evt: e.type,
          detail: [d.act, d.villageId, d.name, d.archetype].filter((x) => x !== undefined).join(' '),
        })
      }
    }
    tickGlobal += 1
    if (tickGlobal % sampleEveryTicks === 0) {
      for (const npc of sim.npcs) {
        const entity = sim.entities.find((en) => en.id === npc.entityId)
        if (entity && entity.hunger <= 0) faim += 1
      }
    }
  }
  const ligne = {
    type: 'cycle',
    jour: cycle,
    tick: sim.tick,
    villages: releveVillages(sim),
    monstres: sim.monsters.length,
    mortsCumul: morts,
    hordesCumul: hordes,
    faimCumul: faim,
    evts: tally,
    msCycle: Math.round(performance.now() - c0),
  }
  appendFileSync(OUT, JSON.stringify(ligne) + '\n')
  const v = releveVillages(sim) as { nom: string; membres: number }[]
  console.log(`seed ${SEED} · jour ${cycle}/${JOURS} : ` +
    v.map((x) => `${x.nom} ${x.membres}`).join(' · ') +
    ` · monstres ${sim.monsters.length} · faim ${faim} · ${Math.round((performance.now() - c0) / 100) / 10} s`)
}

appendFileSync(OUT, JSON.stringify({
  type: 'resume',
  seed: SEED,
  jours: JOURS,
  villages: releveVillages(sim),
  morts,
  hordes,
  faim,
  moments,
  minutesReelles: Math.round((performance.now() - t0) / 60000),
}) + '\n')
console.log(`seed ${SEED} : TERMINÉ en ${Math.round((performance.now() - t0) / 60000)} min — ${OUT}`)
