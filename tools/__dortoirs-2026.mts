import { FAUNA, MONDE_JOUE, terrainAt, WOOD_TERRAINS } from '../packages/sim/src/index'
import { placeHuntingGrounds } from '../packages/sim/src/faune'
import { carteDeTest } from './carte-cache'

// Le dortoir que la PREMIÈRE harde d'un coin élira (la même dérivation que
// `elireDortoir` : meilleure cellule boisée du canton, départages d puis x puis y —
// sans structures ni autres hardes : le monde neuf).
const seed = 2026
const map = carteDeTest(seed, undefined, MONDE_JOUE).map
const grounds = placeHuntingGrounds(map, seed)
const cell = FAUNA.GROUND_WATER_CELL
const gw = Math.ceil(map.width / cell)
const gh = Math.ceil(map.height / cell)
const boise = new Uint16Array(gw * gh)
for (let ty = 0; ty < map.height; ty++) {
  for (let tx = 0; tx < map.width; tx++) {
    if (!WOOD_TERRAINS.includes(terrainAt(map, tx, ty))) continue
    const c = Math.floor(ty / cell) * gw + Math.floor(tx / cell)
    boise[c] = boise[c]! + 1
  }
}
console.log(`seed ${seed} — ${grounds.length} coins ; heures de nuit du cerf : ~19h30 → 6h`)
for (const g of grounds) {
  const r = Math.ceil(FAUNA.GROUND_COVER_NEAR / cell)
  const cgx = Math.floor(g.x / cell)
  const cgy = Math.floor(g.y / cell)
  let bx = -1
  let by = -1
  let bd = Infinity
  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      const nx = cgx + ox
      const ny = cgy + oy
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
      if (boise[ny * gw + nx]! < FAUNA.GROUND_COVER_MIN_TILES) continue
      const px = nx * cell + cell / 2
      const py = ny * cell + cell / 2
      const d = (g.x - px) * (g.x - px) + (g.y - py) * (g.y - py)
      if (d < bd || (d === bd && (px < bx || (px === bx && py < by)))) {
        bd = d
        bx = px
        by = py
      }
    }
  }
  console.log(`  coin (${g.x.toFixed(0)}, ${g.y.toFixed(0)}) → dortoir de la 1re harde : (${bx}, ${by})`)
}
