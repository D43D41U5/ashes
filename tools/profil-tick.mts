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
  MONDE, createSim, step, placeZoneNodes, placeHuntingGrounds, spawnPoiMonsters,
  emplacementsDeVillage, pointsDeSpawn, generateZonedTerrain, foundNpcVillage, FAUNA, nidsAMonstre,
} from '../packages/sim/src/index'

const joueurs = Number(process.argv[2] ?? 8)
const ticks = Number(process.argv[3] ?? 2000)

const t0 = performance.now()
const carte = generateZonedTerrain(2026, joueurs)
const tGen = performance.now() - t0

const nodes = placeZoneNodes(carte)
const emplacements = emplacementsDeVillage(carte, nodes, {
  coinsDeChasse: placeHuntingGrounds(carte.map, 2026),
  nids: nidsAMonstre(carte.map),
})
const spawns = pointsDeSpawn(carte, emplacements, Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE))
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
const d2 = (e: { tx: number; ty: number }) => (e.tx - premier.tx) ** 2 + (e.ty - premier.ty) ** 2
const voisins = emplacements.filter((e) => e.tx !== premier.tx || e.ty !== premier.ty).sort((a, b) => d2(b) - d2(a))
if (voisins[0]) foundNpcVillage(sim, voisins[0].tx, voisins[0].ty, 4, 'foyer')
if (voisins[1]) foundNpcVillage(sim, voisins[1].tx, voisins[1].ty, 3, 'meute')

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

