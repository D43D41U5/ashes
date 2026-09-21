/**
 * PROFILEUR DU COÛT PAR TICK — l'outil qui répond par la mesure, pas par l'intuition.
 *
 * Il vit dans `tools/` et NON dans `/sim` : le lint y interdit `Date`/`performance` (invariant
 * de déterminisme), et c'est justement de chronométrage qu'on a besoin. On importe la sim
 * comme un consommateur ordinaire — exactement ce que fait le serveur.
 *
 *   node --import tsx tools/profil-tick.mts [joueurs] [ticks]
 */
import {
  BALANCE, MONDE, MONDE_JOUE, createSim, step, placeZoneNodes, placeHuntingGrounds, spawnPoiMonsters,
  creuserLePlancher, emplacementsDeVillage, pointsDeSpawn, generateZonedTerrain, foundNpcVillage, FAUNA, nidsAMonstre,
} from '../packages/sim/src/index'

const joueurs = Number(process.argv[2] ?? 8)
const ticks = Number(process.argv[3] ?? 2000)
/**
 * Combien de villages PNJ fonder — défaut : la règle de l'hôte (`ascension.md` V-R4).
 *
 * Le passer en ARGUMENT est ce qui rend l'A/B honnête : même graine, même carte, même semis,
 * seul le peuplement change — et sans toucher `/sim`, donc sans périmer le cache de cartes.
 *   node --import tsx tools/profil-tick.mts 50 500 2
 *   node --import tsx tools/profil-tick.mts 50 500 5
 */
const villages = Number(process.argv[4] ?? BALANCE.VILLAGES_VEILLEE)

const t0 = performance.now()
const carte = generateZonedTerrain(2026, joueurs, MONDE_JOUE)
const tGen = performance.now() - t0

const nodes = placeZoneNodes(carte)
const emplacements = emplacementsDeVillage(carte, nodes, {
  coinsDeChasse: placeHuntingGrounds(carte.map, 2026),
  nids: nidsAMonstre(carte.map),
})
const spawns = pointsDeSpawn(carte, emplacements, Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE))
creuserLePlancher(carte, nodes, [...spawns, ...emplacements]) // le plancher des grottes (G-R8a), comme les hôtes
const premier = spawns[0] ?? emplacements[0]
if (!premier) throw new Error('carte dégénérée')

const sim = createSim(2026, {
  map: carte.map,
  nodes,
  faunaCap: FAUNA.CAP,
  grounds: placeHuntingGrounds(carte.map, 2026),
  home: { x: premier.tx + 0.5, y: premier.ty + 0.5 },
})
spawnPoiMonsters(sim, 2026)
// LE PEUPLEMENT DE L'HÔTE, comme la Veillée le fait (spec `ascension.md` V-R4, 2026-09-21).
// ⚠ Ce profileur portait sa PROPRE copie de la règle — l'ancienne : les deux emplacements les
// plus ÉLOIGNÉS, tailles 4 et 3 en dur. Il aurait mesuré le peuplement d'hier. Il y avait trois
// copies de cette règle dans le dépôt (ici, `veillee.ts`, `scenario.ts`) : une seule a changé
// le jour où elle s'est corrigée, et c'est exactement ainsi qu'un profileur se met à mentir.
const d2 = (e: { tx: number; ty: number }) => (e.tx - premier.tx) ** 2 + (e.ty - premier.ty) ** 2
const voisins = emplacements
  .filter((e) => e.tx !== premier.tx || e.ty !== premier.ty)
  .sort((a, b) => d2(a) - d2(b))
  .slice(0, villages)
const dispositions = ['foyer', 'meute'] as const
for (const [i, v] of voisins.entries()) {
  foundNpcVillage(sim, v.tx, v.ty, BALANCE.NPC_PER_VILLAGE, dispositions[i] ?? 'neutre')
}

console.log(`carte ${carte.map.width}×${carte.map.height} = ${(carte.map.width * carte.map.height / 1e6).toFixed(2)} M tuiles`)
console.log(`génération : ${(tGen / 1000).toFixed(1)} s`)
console.log(`nœuds : ${nodes.length} · entités : ${sim.entities.length} · PNJ : ${sim.npcs.length} · monstres : ${sim.monsters.length}`)

const t1 = performance.now()
for (let i = 0; i < ticks; i++) step(sim, [])
const dt = performance.now() - t1

const parTick = dt / ticks
console.log(`\n${ticks} ticks en ${(dt / 1000).toFixed(2)} s → ${parTick.toFixed(3)} ms/tick · ${Math.round(1000 / parTick)} ticks/s`)
// Le jeu tourne à 20 Hz : un tick doit coûter bien moins de 50 ms, sinon le serveur décroche.
console.log(`budget 20 Hz (50 ms/tick) : ${(parTick / 50 * 100).toFixed(1)} % consommé`)

