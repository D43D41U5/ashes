/**
 * DIAGNOSTIC DE LA RÉCOLTE — « pourquoi les villages qui récoltent meurent-ils ? »
 *
 * Le banc, une fois posé sur la carte de production, rend une signature très parlante : le Foyer
 * et le neutre tombent à ZÉRO membre en quatre jours, pendant que la Meute — celle qui PILLE —
 * survit avec des vivres. Cet outil ne cherche pas à expliquer : il RECENSE ce que les PNJ font,
 * tick après tick, pour que la cause se voie au lieu de se deviner.
 *
 * Ce qu'il compte, et pourquoi chacun trancherait quelque chose :
 *   • SANS TÂCHE — l'IA ne trouve rien à faire (pas de nœud éligible, ou plus de place).
 *   • SANS CHEMIN — une tâche est prise mais aucune route ne mène au nœud. C'est la signature
 *     du bug déjà corrigé pour le ciblage : viser à vol d'oiseau, se cogner à une falaise.
 *   • BLOQUÉ (`stuck`) — un chemin existe mais le PNJ n'avance pas.
 *   • DISTANCE au nœud visé, et si ce nœud est dans SA zone.
 *
 *   node --import tsx tools/diag-recolte.mts [joueurs] [jours] [relevés]
 */
import { construireMondeDuBanc } from '../packages/sim/src/scenario'
import { freeRoomFor } from '../packages/sim/src/items'
import { zoneIdAt } from '../packages/sim/src/map'
import { drainEvents } from '../packages/sim/src/events'
import { step } from '../packages/sim/src/sim'
import { TICKS_PER_CYCLE } from '../packages/sim/src/time'

const joueurs = Number(process.argv[2] ?? 6)
const jours = Number(process.argv[3] ?? 2)
const releves = Number(process.argv[4] ?? 16)

const { sim, monde } = construireMondeDuBanc(2026, joueurs)
console.log(`monde ${monde.width}×${monde.height} · ${monde.nodes} nœuds · ${monde.huntingGrounds} coins de chasse`)
console.log(`villages : ${sim.villages.map((v) => `${v.archetype}(${v.memberIds.length})`).join(' ')}\n`)

const total = jours * TICKS_PER_CYCLE
const pas = Math.floor(total / releves)

console.log('  tick   vivants  sansTâche  sansChemin  bloqués  distMoy  horsZone  faimMoy   TABLEAU              tâches prises')
for (let k = 0; k < releves; k++) {
  for (let i = 0; i < pas; i++) {
    step(sim, [])
    drainEvents(sim)
  }
  let vivants = 0
  let sansTache = 0
  let sansChemin = 0
  let bloques = 0
  let horsZone = 0
  let sommeDist = 0
  let nDist = 0
  let sommeFaim = 0
  // CE QUI RETIENT UN PNJ AVANT MÊME QU'IL REGARDE LE TABLEAU : dormir, avoir froid, être parti
  // en expédition. Un tableau plein de tâches libres ne sert à rien si personne n'y arrive.
  let dort = 0
  let auChaud = 0
  let enExpedition = 0
  let defend = 0
  let defendBloque = 0
  const kinds: Record<string, number> = {}

  for (const npc of sim.npcs) {
    const e = sim.entities.find((en) => en.id === npc.entityId)
    if (!e || e.hp <= 0) continue
    vivants += 1
    sommeFaim += e.hunger
    if (npc.sleeping) dort += 1
    if (npc.seekingWarmth) auChaud += 1
    if (npc.errand) enExpedition += 1
    // LA DÉFENSE laisse une trace : `defendBest` vaut -1 hors engagement. Le commentaire du code
    // décrit précisément le piège — « un zombie posté hors d'atteinte affamait tout le village,
    // grenier plein » — et la vraie carte, avec ses falaises, est le terrain rêvé pour ça.
    if (npc.defendBest >= 0) defend += 1
    if (npc.defendStuck > 0) defendBloque += 1
    if (!npc.task) {
      sansTache += 1
      continue
    }
    kinds[npc.task.kind] = (kinds[npc.task.kind] ?? 0) + 1
    if (npc.path.length === 0) sansChemin += 1
    if (npc.stuck > 0) bloques += 1
    const node = npc.task.nodeId === null ? undefined : sim.nodes.find((n) => n.id === npc.task!.nodeId)
    if (node) {
      const dx = node.tx - e.x
      const dy = node.ty - e.y
      sommeDist += Math.sqrt(dx * dx + dy * dy)
      nDist += 1
      if (zoneIdAt(sim.map, node.tx, node.ty) !== zoneIdAt(sim.map, Math.floor(e.x), Math.floor(e.y))) horsZone += 1
    }
  }
  // LE SAC. `claimTask` filtre sur `canTakeInFor` : sans place pour ce que la corvée va y mettre,
  // le PNJ ne réclame RIEN — même avec un tableau plein de tâches libres.
  const sacs: string[] = []
  for (const npc of sim.npcs.slice(0, 3)) {
    const e = sim.entities.find((en) => en.id === npc.entityId)
    if (!e) continue
    const cases = e.inventory.filter((sl) => sl !== null).length
    sacs.push(`${cases}/${e.inventory.length}[b${freeRoomFor(e.inventory, 'berries')} w${freeRoomFor(e.inventory, 'wood')} f${freeRoomFor(e.inventory, 'fiber')}]`)
  }
  if (k === 0) {
    console.log(`  SACS (3 premiers PNJ) : ${sacs.join('  ')}`)
    // AUTOPSIE D'UN SEUL PNJ : son village, et le tableau tel que `claimTask` le voit.
    const npc0 = sim.npcs[0]!
    const e0 = sim.entities.find((en) => en.id === npc0.entityId)!
    const v0 = sim.villages.find((v) => v.id === npc0.villageId)
    console.log(`  PNJ#${npc0.entityId} village=${npc0.villageId} (${v0 ? 'trouvé' : 'INTROUVABLE'}) tâche=${JSON.stringify(npc0.task)}`)
    // CE QUE LA ZONE DU VILLAGE OFFRE VRAIMENT. `nearestAliveNode` filtre les nœuds sur la zone
    // du PNJ : si sa zone ne porte aucun nœud du type demandé, il n'a AUCUN candidat — il relâche
    // la corvée au même tick et recommence, indéfiniment, jusqu'à mourir de faim.
    const maZone = zoneIdAt(sim.map, Math.floor(e0.x), Math.floor(e0.y))
    const parType: Record<string, { zone: number; monde: number }> = {}
    for (const n of sim.nodes) {
      const r = (parType[n.type] ??= { zone: 0, monde: 0 })
      r.monde += 1
      if (zoneIdAt(sim.map, n.tx, n.ty) === maZone) r.zone += 1
    }
    console.log(`  ZONE du village = ${maZone} · nœuds par type (dans la zone / dans le monde) :`)
    for (const [t, r] of Object.entries(parType).sort()) console.log(`    ${t.padEnd(12)} ${String(r.zone).padStart(6)} / ${r.monde}`)
    for (const t of v0?.tasks ?? []) {
      const intake: Record<string, string[]> = {
        gather_berries: ['berries'], gather_wood: ['wood'], gather_fiber: ['fiber'],
        cook_stew: ['berries', 'fiber', 'stew'], repair: ['wood'], feed_fire: ['wood'],
      }
      const place = (intake[t.kind] ?? []).map((it) => `${it}=${freeRoomFor(e0.inventory, it as never)}`).join(' ')
      console.log(`    tâche#${t.id} ${t.kind} prio=${t.priority} prise par=${t.claimedBy} · place: ${place}`)
    }
  }
  // LE TABLEAU DU VILLAGE : `claimTask` ne puise QUE là. Un tableau vide = personne ne travaille,
  // quels que soient les chemins et les nœuds.
  const tableau = sim.villages.map((v) => `${v.archetype[0]}${v.tasks.length}`).join('/')
  const libres = sim.villages.reduce((n, v) => n + v.tasks.filter((t) => t.claimedBy === null).length, 0)
  const f = (v: number, w = 8): string => String(Math.round(v * 10) / 10).padStart(w)
  console.log(
    `${String(sim.tick).padStart(7)}${String(vivants).padStart(10)}${String(sansTache).padStart(11)}` +
      `${String(sansChemin).padStart(12)}${String(bloques).padStart(9)}${f(nDist ? sommeDist / nDist : 0)}` +
      `${String(horsZone).padStart(10)}${f(vivants ? sommeFaim / vivants : 0)}   ` +
      `${(tableau + ` (${libres} libres)`).padEnd(22)}` +
      `dort:${dort} froid:${auChaud} exp:${enExpedition} def:${defend}/${defendBloque}  ` +
      Object.entries(kinds)
        .map(([k, n]) => `${k}:${n}`)
        .join(' '),
  )
}
