/**
 * TRACE TICK PAR TICK d'un seul PNJ, juste après un rafraîchissement du tableau.
 *
 * Les relevés espacés ne voient rien : une corvée est postée, réclamée et effacée en quelques
 * ticks. Il faut regarder à 20 Hz pour savoir CE QUI la fait tomber.
 *
 *   node --import tsx tools/trace-corvee.mts [joueurs] [ticksAvant] [ticksTracés]
 */
import { construireMondeDuBanc } from '../packages/sim/src/scenario'
import { drainEvents } from '../packages/sim/src/events'
import { step } from '../packages/sim/src/sim'
import { zoneIdAt } from '../packages/sim/src/map'
import { countOf } from '../packages/sim/src/items'

const joueurs = Number(process.argv[2] ?? 6)
const avant = Number(process.argv[3] ?? 6000)
const traces = Number(process.argv[4] ?? 40)

const { sim } = construireMondeDuBanc(2026, joueurs)
for (let i = 0; i < avant; i++) {
  step(sim, [])
  drainEvents(sim)
}

const npc = sim.npcs[0]!
const v = sim.villages.find((x) => x.id === npc.villageId)!
console.log(`PNJ#${npc.entityId} village#${v.id} — trace de ${traces} ticks à partir du tick ${sim.tick}\n`)
console.log('  tick  tâche              étape  nœud     chemin  pos            distNœud  zonePNJ/zoneNœud  tableau')
for (let i = 0; i < traces; i++) {
  step(sim, [])
  drainEvents(sim)
  const e = sim.entities.find((en) => en.id === npc.entityId)!
  const n = npc.task?.nodeId == null ? undefined : sim.nodes.find((x) => x.id === npc.task!.nodeId)
  const d = n ? Math.sqrt((n.tx - e.x) ** 2 + (n.ty - e.y) ** 2) : -1
  // LE GRENIER : c'est LUI que `refreshBoard` interroge pour décider s'il poste une corvée.
  // Un tableau vide en permanence veut dire « le village n'a besoin de rien » — à vérifier.
  const gr = sim.structures.find((st) => st.type === 'chest' && st.villageId === v.id && st.access === 'village')
  const stock = gr ? `b${countOf(gr.inventory ?? [], 'berries')} w${countOf(gr.inventory ?? [], 'wood')} f${countOf(gr.inventory ?? [], 'fiber')} s${countOf(gr.inventory ?? [], 'stew')}` : 'PAS DE GRENIER'
  console.log(
    `${stock.padEnd(18)}${String(sim.tick).padStart(6)}  ${(npc.task?.kind ?? '—').padEnd(18)} ${(npc.task?.stage ?? '—').padEnd(6)} ` +
      `${String(npc.task?.nodeId ?? '—').padEnd(8)} ${String(npc.path.length).padStart(6)}  ` +
      `${`${e.x.toFixed(0)},${e.y.toFixed(0)}`.padEnd(14)} ${(d < 0 ? '—' : d.toFixed(1)).padStart(8)}  ` +
      `${String(zoneIdAt(sim.map, Math.floor(e.x), Math.floor(e.y))).padStart(7)}/${String(n ? zoneIdAt(sim.map, n.tx, n.ty) : '—').padEnd(8)} ` +
      `${v.tasks.map((t) => `${t.kind.replace('gather_', '')}${t.claimedBy ? '*' : ''}`).join(',')}`,
  )
}
