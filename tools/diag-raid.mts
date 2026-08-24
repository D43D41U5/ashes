/**
 * LE RAID ABOUTIT-IL ENCORE ? — le raid d'alignement A7(b), joué sur PLUSIEURS GRAINES.
 *
 *   node --import tsx tools/diag-raid.mts
 *
 * `alignment.test.ts` A7(b) est un test NARRATIF sur une seule graine : une Meute PNJ sort
 * la nuit, casse le grenier du voisin, rentre avec le butin. Il a DÉJÀ changé de graine une
 * fois (23 → 24, portage doublé le 2026-07-19) pour la même raison — « fragilité au seed,
 * pas une régression ».
 *
 * Une graine ne dit donc rien. Ce qu'il faut comparer, c'est le TAUX de réussite avant et
 * après : si le raid aboutit aussi souvent, le rouge est un décalage du flux RNG ; s'il
 * s'effondre, la nuit est devenue trop dure et c'est une vraie régression de jeu.
 *
 * 24 GRAINES depuis le 2026-08-23 (c'était 12). Le passage du cycle à 45 min a donné
 * 6/12 contre 8/12 — un écart qu'on ne peut ni croire ni écarter à douze tirages (σ ≈ 1,4
 * sur un taux de ~50 %). À 24, le même relevé a rendu 7/24 contre 11/24 : toujours pas
 * significatif (z ≈ 1,2), mais on le sait maintenant, au lieu de le supposer.
 */
import {
  ALIGNMENT,
  BALANCE,
  TERRAIN_GRASS,
  TICKS_PER_CYCLE,
  dayTicksPourJour,
  countOf,
  createEmptyMap,
  createSim,
  drainEvents,
  foundNpcVillage,
  step,
} from '../packages/sim/src/index'

interface Issue {
  graine: number
  alarme: boolean
  grenierCassé: boolean
  butin: boolean
  raidersVivants: number
}

function jouerLeRaid(graine: number): Issue {
  const sim = createSim(graine, { map: createEmptyMap(60, 60, TERRAIN_GRASS) })
  foundNpcVillage(sim, 15, 15, 3, 'neutre')
  const victim = sim.villages[0]!
  foundNpcVillage(sim, 40, 40, 4, 'meute')
  const meute = sim.villages[1]!
  for (let t = 0; t < ALIGNMENT.REFRESH_TICKS + 1; t++) step(sim, [])

  const victimChest = sim.structures.find((s) => s.type === 'chest' && s.villageId === victim.id)!
  const meuteChest = sim.structures.find((s) => s.type === 'chest' && s.villageId === meute.id)!
  const boisAvant = countOf(meuteChest.inventory ?? [], 'wood')

  sim.tick = dayTicksPourJour(BALANCE.JOUR_DE_DEPART) - 10
  drainEvents(sim)
  let alarme = false
  let grenierCassé = false
  for (let t = 0; t < 10 * TICKS_PER_CYCLE; t++) {
    step(sim, [])
    for (const e of drainEvents(sim)) {
      if (e.type === 'alarm_raised' && e.villageId === victim.id) alarme = true
      if (e.type === 'structure_destroyed' && e.structureId === victimChest.id) grenierCassé = true
    }
    if (grenierCassé && sim.npcs.filter((n) => n.villageId === meute.id).every((n) => !n.errand)) break
  }
  const raiders = sim.npcs.filter((n) => n.villageId === meute.id)
  const porté = raiders.reduce(
    (s, n) => s + countOf(sim.entities.find((e) => e.id === n.entityId)?.inventory ?? [], 'wood'),
    0,
  )
  const après = countOf(sim.structures.find((s) => s.id === meuteChest.id)?.inventory ?? [], 'wood')
  return { graine, alarme, grenierCassé, butin: après + porté > boisAvant - 1, raidersVivants: raiders.length }
}

const graines = Array.from({ length: 24 }, (_, i) => 20 + i)
let alarmes = 0
let cassés = 0
let butins = 0
const bonnes: number[] = []
for (const g of graines) {
  const r = jouerLeRaid(g)
  if (r.alarme) alarmes += 1
  if (r.grenierCassé) cassés += 1
  if (r.butin) butins += 1
  if (r.alarme && r.grenierCassé && r.butin) bonnes.push(g)
  console.log(
    `  graine ${String(g).padStart(2)} · alarme ${r.alarme ? '✓' : '·'} · grenier cassé ${r.grenierCassé ? '✓' : '·'} · butin rentré ${r.butin ? '✓' : '·'} · raiders vivants ${r.raidersVivants}/4`,
  )
}
console.log(`\n  sur ${graines.length} graines : alarme ${alarmes} · grenier cassé ${cassés} · butin rentré ${butins}`)
console.log(`  graines où LE TEST ENTIER passe : ${bonnes.length ? bonnes.join(', ') : 'aucune'}`)
