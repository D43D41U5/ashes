import { describe, expect, it } from 'vitest'
import {
  ECART_PX,
  PAS_CV,
  JITTER_ANGLE,
  JITTER_PX,
  ORIENTATIONS,
  OUVERTURE,
  angleDOrientation,
  ecartLateral,
  posePas,
  poseTrainee,
  rasterEmpreinte,
} from './empreintes'

/** L'écart d'angle le plus court entre deux caps (rad, dans [-π, π]). */
function ecartAngle(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  return d
}

/** Le balayage EXHAUSTIF des caps — une propriété de géométrie se prouve sur tout le domaine,
 *  jamais sur quatre directions choisies (c'est le nord et l'est qui avaient l'air corrects). */
const CAPS = Array.from({ length: 360 }, (_, d) => (d * Math.PI) / 180)

describe('la traînée d’un corps qui rampe', () => {
  it('reste SUR la ligne de marche — pas d’alternance, pas d’écart de pied', () => {
    // La propriété qui la distingue d'un pas : `posePas` enjambe la ligne (±ECART_PX/2), la
    // traînée non. Balayage exhaustif des caps, et sur DEUX poses consécutives : c'est
    // l'alternance gauche/droite qu'on affirme absente, pas seulement un petit écart.
    for (const cap of CAPS) {
      const dx = Math.cos(cap) * 4
      const dy = Math.sin(cap) * 4
      for (const [px, py] of [[100, 100], [103, 107]] as const) {
        const e = Math.abs(ecartLateral(poseTrainee(px, py, dx, dy), px, py, dx, dy))
        expect(e, `cap ${((cap * 180) / Math.PI).toFixed(0)}° en (${px},${py})`).toBeLessThan(ECART_PX / 2)
      }
    }
  })

  it('pointe dans le sens de la marche, sur TOUT le tour d’horizon', () => {
    const marge = Math.PI / ORIENTATIONS + JITTER_ANGLE + 1e-9
    for (const cap of CAPS) {
      const pose = poseTrainee(200, 150, Math.cos(cap) * 5, Math.sin(cap) * 5)
      expect(Math.abs(ecartAngle(angleDOrientation(pose.orient), cap)), `cap ${cap}`).toBeLessThan(marge)
    }
  })

  it('rend la même marque pour la même position (haché, jamais tiré au sort)', () => {
    const a = poseTrainee(64, 32, 3, -1)
    const b = poseTrainee(64, 32, 3, -1)
    expect(a).toEqual(b)
  })

  it('ne rend jamais un NaN, même sur une foulée dégénérée', () => {
    const pose = poseTrainee(10, 10, 0, 0)
    expect(Number.isFinite(pose.px) && Number.isFinite(pose.py)).toBe(true)
    expect(pose.orient).toBeGreaterThanOrEqual(0)
    expect(pose.orient).toBeLessThan(ORIENTATIONS)
  })
})

describe('la pose d’un pas', () => {
  it('pointe dans le sens de la marche, sur TOUT le tour d’horizon', () => {
    const marge = Math.PI / ORIENTATIONS + OUVERTURE + JITTER_ANGLE + 1e-9
    for (const cap of CAPS) {
      for (const pied of [0, 1] as const) {
        const pose = posePas(100, 200, Math.cos(cap), Math.sin(cap), pied)
        const d = Math.abs(ecartAngle(angleDOrientation(pose.orient), cap))
        expect(d, `cap ${((cap * 180) / Math.PI).toFixed(0)}° pied ${pied}`).toBeLessThanOrEqual(marge)
      }
    }
  })

  it('emprunte bien les seize variantes bakées (la piste tourne, elle ne se répète pas)', () => {
    const vus = new Set<number>()
    for (const cap of CAPS) vus.add(posePas(100, 200, Math.cos(cap), Math.sin(cap), 0).orient)
    expect(vus.size).toBe(ORIENTATIONS)
    for (const o of vus) expect(o).toBeGreaterThanOrEqual(0)
    expect(Math.max(...vus)).toBeLessThan(ORIENTATIONS)
  })

  it('écarte les deux pieds PERPENDICULAIREMENT à la marche, de part et d’autre', () => {
    // C'EST LA GARDE DU DÉFAUT : l'ancien code décalait de ±2 px EN X. Vers le sud ça straddlait
    // par chance ; vers l'est les deux pieds tombaient sur la MÊME ligne, l'un derrière l'autre.
    const mini = ECART_PX / 2 - JITTER_PX / 2 - 1e-9
    for (const cap of CAPS) {
      const dx = Math.cos(cap)
      const dy = Math.sin(cap)
      const g = ecartLateral(posePas(100, 200, dx, dy, 0), 100, 200, dx, dy)
      const d = ecartLateral(posePas(100, 200, dx, dy, 1), 100, 200, dx, dy)
      expect(g, `gauche au cap ${((cap * 180) / Math.PI).toFixed(0)}°`).toBeLessThanOrEqual(-mini)
      expect(d, `droite au cap ${((cap * 180) / Math.PI).toFixed(0)}°`).toBeGreaterThanOrEqual(mini)
    }
  })

  it('ouvre chaque pied vers l’extérieur — le droit à droite du cap, le gauche à gauche', () => {
    // À position ÉGALE, le hachage est le même pour les deux pieds : l'écart d'angle qui reste
    // est EXACTEMENT l'ouverture, deux fois. Rien d'aléatoire ne se glisse dans cette mesure.
    for (const cap of CAPS) {
      const dx = Math.cos(cap)
      const dy = Math.sin(cap)
      const g = posePas(100, 200, dx, dy, 0)
      const d = posePas(100, 200, dx, dy, 1)
      // Sur le cap CONTINU, pas sur le cran : 16 variantes valent 22,5°, l'ouverture 18,3° —
      // quantifiée, elle disparaîtrait la moitié du temps et la garde ne garderait rien.
      expect(ecartAngle(d.angle, g.angle)).toBeCloseTo(2 * OUVERTURE, 9)
      expect(ecartAngle(g.angle, cap)).toBeLessThan(0)
      expect(ecartAngle(d.angle, cap)).toBeGreaterThan(0)
    }
  })

  it('rend le même pas pour la même foulée (haché, jamais tiré au sort)', () => {
    const a = posePas(137, 249, 0.6, -0.8, 1)
    const b = posePas(137, 249, 0.6, -0.8, 1)
    expect(b).toEqual(a)
  })

  it('ne rend jamais un NaN, même sur une foulée dégénérée', () => {
    for (const [dx, dy] of [[0, 0], [1e-12, 0], [0, -1e-12]] as const) {
      const p = posePas(10, 10, dx, dy, 0)
      expect(Number.isFinite(p.px) && Number.isFinite(p.py) && Number.isInteger(p.orient)).toBe(true)
    }
  })
})

describe('la semelle rastérisée', () => {
  const dedans = (o: number, creux = 1.35) => rasterEmpreinte(o, creux).map((p) => p.dedans)
  const boite = (o: number) => {
    const p = dedans(o)
    let x0 = PAS_CV, x1 = -1, y0 = PAS_CV, y1 = -1
    for (let y = 0; y < PAS_CV; y++) for (let x = 0; x < PAS_CV; x++) if (p[y * PAS_CV + x]) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
    }
    return { w: x1 - x0 + 1, h: y1 - y0 + 1 }
  }

  it('tourne vraiment : à plat elle est haute, au quart de tour elle est large', () => {
    // Cap 0 = plein EST : la semelle (4 large × 6 long) se couche → large et basse.
    // Cap 4 = plein SUD : elle se dresse → étroite et haute. C'est la garde de l'image UNIQUE.
    const est = boite(0)
    const sud = boite(4)
    expect(est.w).toBeGreaterThan(est.h)
    expect(sud.h).toBeGreaterThan(sud.w)
    expect(est.w).toBe(sud.h)
    expect(est.h).toBe(sud.w)
  })

  it('couvre une aire comparable dans les seize caps (rien ne se perd hors du carré)', () => {
    const aires = Array.from({ length: ORIENTATIONS }, (_, o) => dedans(o).filter(Boolean).length)
    expect(Math.min(...aires)).toBeGreaterThanOrEqual(14) // 4×6 = 24 px, à la diagonale on en garde le gros
    expect(Math.max(...aires) - Math.min(...aires)).toBeLessThanOrEqual(10)
  })

  it('creuse une CUVETTE : la normale rentre vers le cœur, des deux côtés', () => {
    // Cap 0 (vers l'est) : sur le bord AVANT (x grand) la paroi regarde vers l'arrière (nx < 0),
    // sur le bord ARRIÈRE elle regarde vers l'avant (nx > 0). Une BUTTE ferait exactement l'inverse.
    const p = rasterEmpreinte(0, 1.35)
    const y = PAS_CV / 2 // la ligne médiane
    const avant = p[y * PAS_CV + (PAS_CV - 2)]!
    const arriere = p[y * PAS_CV + 1]!
    expect(avant.dedans && arriere.dedans).toBe(true)
    expect(avant.nx).toBeLessThan(-0.1)
    expect(arriere.nx).toBeGreaterThan(0.1)
  })

  it('tourne SA normale avec elle (une rotation d’image ne l’aurait pas fait)', () => {
    // Le même point du bord avant, au cap sud : c'est maintenant en Y que la paroi rentre.
    const p = rasterEmpreinte(4, 1.35)
    const x = PAS_CV / 2
    const avant = p[(PAS_CV - 2) * PAS_CV + x]!
    const arriere = p[1 * PAS_CV + x]!
    expect(avant.dedans && arriere.dedans).toBe(true)
    expect(avant.ny).toBeLessThan(-0.1)
    expect(arriere.ny).toBeGreaterThan(0.1)
    expect(Math.abs(avant.nx)).toBeLessThan(0.1) // rien ne penche en X : le pas est plein sud
  })

  it('rend une normale unitaire partout, et PLATE quand rien ne creuse', () => {
    for (let o = 0; o < ORIENTATIONS; o++) {
      for (const px of rasterEmpreinte(o, 1.35)) {
        expect(Math.hypot(px.nx, px.ny, px.nz)).toBeCloseTo(1, 9)
        expect(px.nz).toBeGreaterThan(0)
      }
      // `creux = 0` — la semelle humide : une tache, pas un trou. Aucun relief à trouver.
      // `Math.abs` : `-0` est un zéro, et `toEqual` le distingue de `+0` (mémoire maison).
      for (const px of rasterEmpreinte(o, 0)) expect([Math.abs(px.nx), Math.abs(px.ny), px.nz]).toEqual([0, 0, 1])
    }
  })

  it('assombrit le FOND, jamais un côté (l’occlusion n’est pas un ombrage peint)', () => {
    const p = rasterEmpreinte(0, 1.35)
    const y = PAS_CV / 2
    const coeur = p[y * PAS_CV + PAS_CV / 2]!
    expect(coeur.cuve).toBeGreaterThan(p[y * PAS_CV + 1]!.cuve)
    expect(coeur.cuve).toBeGreaterThan(p[y * PAS_CV + (PAS_CV - 2)]!.cuve)
    // Symétrie : deux points opposés du bord sont ÉGALEMENT occlus — aucun côté n'est privilégié.
    expect(p[y * PAS_CV + 1]!.cuve).toBeCloseTo(p[y * PAS_CV + (PAS_CV - 2)]!.cuve, 6)
  })
})
