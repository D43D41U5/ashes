/** SONDE JETABLE — champDuCadre mange-t-il un bandeau de roche de 60 tuiles ? */
import { peindreCarteArt } from '../packages/client/src/render/carte-art'
import type { WorldMap } from '@ashes/sim'

const W = 300
const H = 200
const terrain = new Array<number>(W * H)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const d = Math.min(x, y, W - 1 - x, H - 1 - y)
    terrain[y * W + x] = d < 60 ? 5 : 1 // bandeau de roche 60, herbe dedans
  }
}
const map = { width: W, height: H, terrain, zones: [] } as unknown as WorldMap
const sol = new Uint32Array(W * H).fill(0x3e7d3a)
const art = peindreCarteArt(map, sol)
const px = (x: number, y: number): number[] => {
  const k = (y * W + x) * 4
  return [art.vive[k]!, art.vive[k + 1]!, art.vive[k + 2]!]
}
console.log('coin (5,5) — roche du cadre, attendu ~encre :', px(5, 5))
console.log('bande (30,100) — roche du cadre :', px(30, 100))
console.log('bord intérieur (65,100) — herbe à 5 t du cadre :', px(65, 100))
console.log('cœur (150,100) — herbe pleine :', px(150, 100))
