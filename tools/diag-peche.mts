/**
 * SONDE DU SEMIS DES COINS DE PÊCHE (spec `peche.md` P2-P5).
 *
 * Génère le monde joué sur quelques graines et compte les coins : combien sur la rivière,
 * combien au lac, et vérifie la règle P2 (haut-fond touchant le profond) sur chacun. C'est
 * l'instrument qui calibre `CONTENU.PECHE_*` — en regardant une carte, pas en jouant.
 *
 *   node --import tsx tools/diag-peche.mts [seeds...]
 */
import { TERRAIN_DEEP_WATER, TERRAIN_SHALLOW_WATER } from '../packages/sim/src/balance'
import { placeZoneNodes } from '../packages/sim/src/zone-content'
import { generateZonedTerrain } from '../packages/sim/src/zonegen'
import { MONDE_JOUE } from '../packages/sim/src/zonegraph'

const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n))
if (seeds.length === 0) seeds.push(1, 7, 42, 1234, 2026)

for (const seed of seeds) {
  const t0 = performance.now()
  const carte = generateZonedTerrain(seed, undefined, MONDE_JOUE)
  const nodes = placeZoneNodes(carte)
  const { width, height, terrain } = carte.map
  const coins = nodes.filter((n) => n.type === 'fishing_spot_river' || n.type === 'fishing_spot_lake')
  let mauvais = 0
  for (const k of coins) {
    const i = k.ty * width + k.tx
    const shallow = terrain[i] === TERRAIN_SHALLOW_WATER
    const touche = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dy]) => {
      const x = k.tx + dx!
      const y = k.ty + dy!
      return x >= 0 && y >= 0 && x < width && y < height && terrain[y * width + x] === TERRAIN_DEEP_WATER
    })
    if (!shallow || !touche) mauvais += 1
  }
  const riv = coins.filter((n) => n.type === 'fishing_spot_river').length
  const lac = coins.filter((n) => n.type === 'fishing_spot_lake').length
  const ms = (performance.now() - t0).toFixed(0)
  console.log(`seed ${seed} — fil ${carte.map.fil?.length ?? 0} pas · coins rivière ${riv} · coins lac ${lac} · hors P2 ${mauvais} · ${ms} ms`)
  for (const k of coins) console.log(`   ${k.type === 'fishing_spot_river' ? 'R' : 'L'} (${k.tx}, ${k.ty})`)
}
