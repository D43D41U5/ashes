/**
 * PROFILEUR DU BANC D'ÉQUILIBRAGE — « le banc est lent : à partir de QUAND, et de combien ? »
 *
 * `profil-tick.mts` mesure un tick à l'instant zéro. Ça ne suffisait pas : le banc s'est révélé
 * **8,7× plus lent que ce que ce profil prédisait** sur exactement le même monde (15,9 ms/tick
 * mesurés contre 1,8 prédits). Un coût moyen ne dit rien d'un coût qui DÉRIVE.
 *
 * D'où cet outil : il joue le monde du banc — la MÊME recette, importée (`construireMondeDuBanc`),
 * jamais réécrite — et rend le coût par TRANCHE. Si le tick se dégrade, on voit à quel moment,
 * et de combien.
 *
 * Il vit dans `tools/` et non dans `/sim` : le lint y interdit `performance` (invariant de
 * déterminisme), et c'est de chronométrage qu'on a besoin.
 *
 *   node --import tsx tools/profil-banc.mts [joueurs] [jours] [tranches]
 */
import { construireMondeDuBanc } from '../packages/sim/src/scenario'
import { drainEvents } from '../packages/sim/src/events'
import { step } from '../packages/sim/src/sim'
import { jourDeSaison, TICKS_PER_CYCLE } from '../packages/sim/src/time'

const joueurs = Number(process.argv[2] ?? 8)
const jours = Number(process.argv[3] ?? 1)
const tranches = Number(process.argv[4] ?? 12)
/** `--drain` reproduit la boucle EXACTE du banc : `step` PUIS `drainEvents` à chaque tick.
 *  Sans le drapeau, on ne mesure que `step` — l'écart entre les deux est la réponse. */
const drain = process.argv.includes('--drain')

const t0 = performance.now()
const { sim, monde } = construireMondeDuBanc(2026, joueurs)
console.log(`monde ${monde.width}×${monde.height} = ${((monde.width * monde.height) / 1e6).toFixed(2)} M tuiles`)
console.log(`génération : ${((performance.now() - t0) / 1000).toFixed(1)} s`)
console.log(
  `nœuds ${monde.nodes} · coins de chasse ${monde.huntingGrounds} · entités ${sim.entities.length}` +
    ` · PNJ ${sim.npcs.length} · monstres ${sim.monsters.length} · marge de ciblage ${monde.margeDeCible} %`,
)

/** On COMPTE les événements, on ne les GARDE pas. Les garder (`events.push`) ne servait à rien —
 *  personne ne les relisait — mais ⚠ ce n'était PAS la cause de la régression tardive du tick,
 *  et je l'ai cru une heure durant. Mesuré le 2026-09-21 : le banc à 6 joueurs n'émet que ~870
 *  événements sur une journée de 36 000 ticks. Retenir 870 petits objets ne remplit aucun tas,
 *  et la régression (tranches 8 à 10 à 131, 246, 240 ms) se reproduit à l'identique une fois le
 *  hoard retiré. On jette quand même : un instrument qui accumule ce qu'il n'ouvre jamais finit
 *  par mesurer sa propre thésaurisation. La leçon vaut plus que le correctif — vérifier l'ORDRE
 *  DE GRANDEUR d'un mécanisme avant de le déclarer coupable. */
let nEvents = 0
const total = jours * TICKS_PER_CYCLE
const parTranche = Math.floor(total / tranches)
console.log(`\n${jours} jour(s) = ${total} ticks, en ${tranches} tranches de ${parTranche}${drain ? ' — AVEC drainEvents (boucle du banc)' : ' — step() seul'}\n`)
console.log('  tranche   ms/tick   entités  monstres  corps  structures  événements   jour de saison')

for (let k = 0; k < tranches; k++) {
  const t = performance.now()
  for (let i = 0; i < parTranche; i++) {
    step(sim, [])
    if (drain) nEvents += drainEvents(sim).length
  }
  const ms = (performance.now() - t) / parTranche
  const corps = sim.corpses?.length ?? 0
  console.log(
    `  ${String(k + 1).padStart(7)}${ms.toFixed(2).padStart(10)}` +
      `${String(sim.entities.length).padStart(10)}${String(sim.monsters.length).padStart(10)}` +
      `${String(corps).padStart(7)}${String(sim.structures.length).padStart(12)}` +
      `${String(nEvents).padStart(10)}` +
      `${String(jourDeSaison(sim)).padStart(17)}`,
  )
}
