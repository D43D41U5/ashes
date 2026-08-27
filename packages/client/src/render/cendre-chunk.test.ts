/**
 * LA GARDE DE L'INVALIDATION DES CHUNKS DE SOL (spec `cendre.md` R11bis).
 *
 * Elle énonce le défaut d'abord : un chunk cuit AVANT que le front l'atteigne ne porte aucune
 * cendre, donc l'ancienne règle (« retenir les chunks qui en portent ») ne le jetait jamais — donc
 * il n'était jamais recuit et le front s'arrêtait sur son arête. On construit ici exactement cette
 * situation et on vérifie que la règle du seuil la voit.
 */
import { describe, expect, it } from 'vitest'
import {
  CENDRE, avanceesDepuisAges, calculeChampDeCendre, coutDe, estCendre, grainDeCendre,
  TERRAIN_GRASS, type WorldMap,
} from '@ashes/sim'
import { PAVE } from './paves'
import { cendreARemue, signatureCendre } from './cendre-chunk'

const N = PAVE.CHUNK
const W = 96
const H = 64
const SEED = 2026

/** Une carte de pré, une seule fosse au coin nord-ouest : le front traverse d'ouest en est. */
function carte(): WorldMap {
  const terrain = new Array<number>(W * H).fill(TERRAIN_GRASS)
  const cendreCout = calculeChampDeCendre(W, H, terrain, [{ tx: 2, ty: 2 }])
  return { width: W, height: H, terrain, cendreCout, zones: [] } as unknown as WorldMap
}

const avancees = (age: number): number[] => avanceesDepuisAges([age], 1)

/** Combien de tuiles de ce chunk sont cendrées à cet âge. */
function cendrees(map: WorldMap, cx: number, cy: number, age: number): number {
  const av = avancees(age)
  let n = 0
  for (let ty = cy * N; ty < cy * N + N; ty++) {
    for (let tx = cx * N; tx < cx * N + N; tx++) if (estCendre(map, tx, ty, av, SEED)) n++
  }
  return n
}

/** L'ANCIENNE RÈGLE, telle qu'elle était écrite : « ce chunk porte-t-il de la cendre ? », relevée
 *  à la cuisson au pas de 4 tuiles. Reproduite ici pour que la garde montre ce qu'elle corrige. */
function ancienneRegle(map: WorldMap, cx: number, cy: number, age: number): boolean {
  const av = avancees(age)
  for (let dy = 0; dy < N; dy += 4) {
    for (let dx = 0; dx < N; dx += 4) if (estCendre(map, cx * N + dx, cy * N + dy, av, SEED)) return true
  }
  return false
}

describe('invalidation des chunks de sol par la cendre', () => {
  const map = carte()

  it('trouve un chunk que le front entame — la situation du défaut', () => {
    // On cherche un couple (chunk, âge) tel que le chunk soit VIERGE à l'âge N et cendré à N+1.
    const trouve = trouveLeFrontQuiEntre(map)
    expect(trouve, 'aucun chunk entamé sur cette carte : la garde ne prouverait rien').not.toBeNull()
  })

  it("l'ancienne règle ne jetait PAS le chunk que le front entame", () => {
    const { cx, cy, age } = trouveLeFrontQuiEntre(map)!
    expect(cendrees(map, cx, cy, age)).toBe(0)
    expect(cendrees(map, cx, cy, age + 1)).toBeGreaterThan(0)
    // Le chunk cuit à `age` n'entrait dans aucun ensemble : la cendre du lendemain restait invisible.
    expect(ancienneRegle(map, cx, cy, age)).toBe(false)
  })

  it('la règle du seuil le jette', () => {
    const { cx, cy, age } = trouveLeFrontQuiEntre(map)!
    const sig = signatureCendre(map, SEED, cx, cy, [age])
    expect(cendreARemue(sig, [age + 1])).toBe(true)
  })

  it('elle ne jette pas un chunk que le front n\'a pas atteint', () => {
    // Le coin sud-est, le plus loin de la fosse : rien n'y brûle encore au premier jour.
    const cx = Math.floor((W - 1) / N)
    const cy = Math.floor((H - 1) / N)
    expect(cendrees(map, cx, cy, 1)).toBe(0)
    const sig = signatureCendre(map, SEED, cx, cy, [0])
    expect(cendreARemue(sig, [1])).toBe(false)
  })

  it('un foyer qui ne bouge pas (gelé) ne fait rien recuire', () => {
    const { cx, cy, age } = trouveLeFrontQuiEntre(map)!
    const sig = signatureCendre(map, SEED, cx, cy, [age])
    expect(cendreARemue(sig, [age])).toBe(false)
  })

  it('un vieillissement d\'un dixième de jour recuit la cendre déjà posée (elle refroidit)', () => {
    // Le chunk de la fosse : cendré dès le premier jour, sa couleur suit son ancienneté.
    const sig = signatureCendre(map, SEED, 0, 0, [10])
    expect(cendrees(map, 0, 0, 10)).toBeGreaterThan(0)
    expect(cendreARemue(sig, [10.4])).toBe(true)
  })

  it('le premier snapshot (les âges arrivent) recuit tout', () => {
    const sig = signatureCendre(map, SEED, 0, 0, [])
    expect(cendreARemue(sig, [0])).toBe(true)
  })

  it('balaie la marge de cuisson : une tuile hors du chunk mais LUE par lui compte', () => {
    // `cuireChunk` lit une tuile tout autour. La signature du chunk (1, 0) doit donc connaître un
    // seuil au moins aussi bas que celui de sa colonne de marge à l'OUEST — laquelle est plus
    // proche de la fosse, donc prend feu AVANT le chunk lui-même. Sans elle, le défaut se
    // rouvrirait sur une tuile de large à chaque couture.
    const sig = signatureCendre(map, SEED, 1, 0, [0])
    const seuilMin = Math.min(...sig.seuils.map((s) => s.avancee))
    const seuil = (tx: number, ty: number): number =>
      coutDe(map.cendreCout, ty * W + tx) / CENDRE.ORTHO / (1 + grainDeCendre(SEED, tx, ty))
    let seuilMarge = Infinity
    let seuilDedans = Infinity
    for (let ty = 0; ty < N; ty++) {
      seuilMarge = Math.min(seuilMarge, seuil(N - 1, ty))
      seuilDedans = Math.min(seuilDedans, seuil(N, ty))
    }
    // La marge est bien EN AVANCE sur le chunk (sinon le test ne prouverait rien)…
    expect(seuilMarge).toBeLessThan(seuilDedans)
    // …et la signature la connaît.
    expect(seuilMin).toBeLessThanOrEqual(seuilMarge)
  })
})

/** Le premier (chunk, âge) où le front ENTRE : vierge à `age`, entamé à `age + 1`. */
function trouveLeFrontQuiEntre(map: WorldMap): { cx: number; cy: number; age: number } | null {
  for (let cy = 0; cy * N < H; cy++) {
    for (let cx = 0; cx * N < W; cx++) {
      for (let age = 0; age < 400; age++) {
        if (cendrees(map, cx, cy, age) !== 0) break
        if (cendrees(map, cx, cy, age + 1) > 0) return { cx, cy, age }
      }
    }
  }
  return null
}
