import { describe, expect, it } from 'vitest'
import {
  EDGE_O,
  LUMIERE,
  MOTIF_SOURCE,
  TERRAIN_GRASS,
  TERRAIN_ROCK,
  createEmptyMap,
  partVisible,
  type MondeEclaire,
  type ResourceNode,
  type Structure,
} from '@ashes/sim'
import { MUR_HT } from '../bati-art'
import { TILE_PX } from '../framing'
import { champRef, composerM, masqueDAstre, partVisibleGrille, type Astre, type BandeGrille, type Emetteur, type GrilleGi } from './champ-ref'
import { grilleDuMonde } from './grille'
import { ALBEDO, GI, longueurDOmbre } from './reglages'

/**
 * L'ORACLE DU CHAMP (spec `lumiere-globale.md` LG-R4, critères LG-A4 ; LG-R5, critère LG-A5 ; LG-R11/R12 :
 * l'oracle et la sim sont UNE loi).
 *
 * Le montage : un feu en (50, 48), un mur d'arête OUEST sur sa tuile (la bande x = 50, de y = 47,875 à
 * 49,125), un fût en (46, 50), une roche (nœud plein) en (53, 45), un carré de terrain plein en (44, 44),
 * une maison (bâti plein) en (55, 50). La fenêtre : (40, 40) → (63, 55), 24 × 16 tuiles = 96 × 64 texels.
 */
const T = LUMIERE.TEXELS_PAR_TUILE
const F = { x0: 40, y0: 40, x1: 63, y1: 55 }
const FEU = { tx: 50, ty: 48 }
const N = 0

function monde(avec: { mur?: boolean; corps?: boolean } = { mur: true, corps: true }): MondeEclaire {
  const map = createEmptyMap(96, 96, TERRAIN_GRASS)
  const structures: Structure[] = []
  const nodes: ResourceNode[] = []
  const structure = (type: Structure['type'], tx: number, ty: number, edges?: number): void => {
    structures.push({ id: structures.length + 1, type, tx, ty, villageId: 0, ownerId: 0, access: 'public', hp: 100, edges } as unknown as Structure)
  }
  if (avec.mur) structure('wall', FEU.tx, FEU.ty, EDGE_O)
  if (avec.corps) {
    map.terrain[44 * map.width + 44] = TERRAIN_ROCK
    nodes.push({ id: 1, type: 'tree', tx: 46, ty: 50, stock: 5, regrowAt: 0 } as unknown as ResourceNode)
    nodes.push({ id: 2, type: 'rock', tx: 53, ty: 45, stock: 5, regrowAt: 0 } as unknown as ResourceNode)
    structure('house', 55, 50)
  }
  return { map, structures, nodes }
}

/** Le feu de la sim (centre de tuile, LG-R17) en texels de grille. */
function emetteur(g: { ox: number; oy: number }, rayonTuiles = 6): Emetteur {
  return { x: (FEU.tx + 0.5) * T - g.ox, y: (FEU.ty + 0.5) * T - g.oy, rayon: rayonTuiles * T, taille: GI.TAILLE_SOURCE, rgb: GI.TEINTE_FEU }
}
const G2 = { rebond: GI.REBOND, porteeRebond: GI.PORTEE_REBOND, plafondRebond: GI.PLAFOND_REBOND }

describe('la grille lue dans la sim (LG-R11)', () => {
  it('G1 — opaque là où la sim dit plein, avec l’albédo de sa sorte ; les bandes en texels de grille', () => {
    const m = monde()
    const g = grilleDuMonde(m, N, F)
    expect([g.gw, g.gh, g.ox, g.oy]).toEqual([24 * T, 16 * T, 40 * T, 40 * T])
    const k = (tx: number, ty: number, sx = 0, sy = 0) => ((ty - F.y0) * T + sy) * g.gw + (tx - F.x0) * T + sx
    const f32 = (a: readonly number[]) => Array.from(Float32Array.from(a))
    expect(g.occ[k(44, 44, 3, 3)]).toBe(1)
    expect(Array.from(g.albedo.subarray(k(44, 44) * 3, k(44, 44) * 3 + 3))).toEqual(f32(ALBEDO.TERRAIN[TERRAIN_ROCK]!))
    expect(g.occ[k(46, 50, 1, 1)]).toBe(1) // le fût
    expect(g.occ[k(46, 50, 0, 0)]).toBe(0) // la cime n'occulte pas le sol
    expect(Array.from(g.albedo.subarray(k(46, 50, 1, 1) * 3, k(46, 50, 1, 1) * 3 + 3))).toEqual(f32(ALBEDO.TRONC))
    expect(g.occ[k(53, 45, 2, 0)]).toBe(1)
    expect(g.occ[k(55, 50, 0, 3)]).toBe(1)
    expect(g.occ[k(FEU.tx, FEU.ty, 0, 0)]).toBe(0) // la tuile d'un mur d'arête reste du sol
    expect(g.murs).toEqual([{ x0: 10 * T - 0.5, x1: 10 * T + 0.5, y0: 8 * T - 0.5, y1: 8 * T + T + 0.5 }])
    expect(g.albedoMurs).toEqual([ALBEDO.BATI.wall])
  })
})

describe('l’oracle et la sim sont UNE loi (LG-R12)', () => {
  it('A0 — la part visible de l’oracle vaut `partVisible` de la sim sur TOUS les texels libres à portée, au bit près', () => {
    const m = monde()
    const g = grilleDuMonde(m, N, F)
    const e = emetteur(g)
    let n = 0
    let ombre = 0
    let penombre = 0
    for (let j = 0; j < g.gh; j++)
      for (let i = 0; i < g.gw; i++) {
        if (g.occ[j * g.gw + i] === 1) continue
        const px = i + 0.5
        const py = j + 0.5
        if ((px - e.x) ** 2 + (py - e.y) ** 2 >= e.rayon * e.rayon) continue
        n++
        const oracle = partVisibleGrille(g, px, py, e.x, e.y, e.taille)
        const sim = partVisible(m, N, (g.ox + px) / T, (g.oy + py) / T, FEU.tx + 0.5, FEU.ty + 0.5)
        expect(oracle, `texel (${i}, ${j})`).toBe(sim)
        if (oracle === 0) ombre++
        else if (oracle < 1) penombre++
      }
    // La prémisse : la scène occulte pour de bon — de l'ombre, de la pénombre, et du plein.
    expect(n).toBeGreaterThan(1000)
    expect(ombre).toBeGreaterThan(50)
    expect(penombre).toBeGreaterThan(20)
    expect(n - ombre - penombre).toBeGreaterThan(200)
  })
})

describe('les propriétés de l’oracle (LG-A4)', () => {
  it('A4·1 — derrière une bande qui masque tout le disque, le texel qui la borde reçoit 0 de lumière directe', () => {
    const g = grilleDuMonde(monde({ mur: true }), N, F)
    const c = champRef(g, [emetteur(g)], { ...G2, rebond: 0 })
    // Le texel juste à l'ouest de la ligne x = 50, à la hauteur du feu : son centre est SUR la face.
    const i = (FEU.tx - F.x0) * T - 1
    const j = (FEU.ty - F.y0) * T + 2
    const k = j * g.gw + i
    expect(c.direct[k * 3]).toBe(0)
    // Et son jumeau de l'autre côté de la bande prend le plein : le feu est à un texel et demi.
    expect(c.direct[(j * g.gw + i + 1) * 3]).toBeGreaterThan(0.9)
  })

  it('A4·2 — la pénombre décroît du plein au noir sans jamais remonter', () => {
    const g = grilleDuMonde(monde({ mur: true }), N, F)
    const e = emetteur(g)
    // Du sud vers le nord, le long de x = 48,5 tuiles, on entre dans l'ombre du bout sud de la bande.
    const i = (48 - F.x0) * T + 2
    let precedente = 1
    let vu = 0
    for (let ty = 54; ty >= 49; ty -= 1 / T) {
      const py = (ty - F.y0) * T
      const part = partVisibleGrille(g, i + 0.5, py, e.x, e.y, e.taille)
      expect(part, `y = ${ty}`).toBeLessThanOrEqual(precedente)
      if (part > 0 && part < 1) vu++
      precedente = part
    }
    expect(precedente).toBe(0)
    expect(vu).toBeGreaterThan(3)
  })

  it('A4·3 — un texel dans l’ombre d’un mur ne reçoit AUCUN rebond de la face éclairée de ce mur', () => {
    const g = grilleDuMonde(monde({ mur: true, corps: false }), N, F)
    const c = champRef(g, [emetteur(g)], G2)
    let rebondi = 0
    let ombres = 0
    for (let j = 0; j < g.gh; j++)
      for (let i = 0; i < g.gw; i++) {
        const k = j * g.gw + i
        if (c.direct[k * 3] !== 0 || i >= (FEU.tx - F.x0) * T) continue // dans l'ombre, à l'ouest de la bande
        ombres++
        if (c.rebond[k * 3]! > 0) rebondi++
      }
    expect(ombres).toBeGreaterThan(50)
    expect(rebondi).toBe(0)
    // Et la face ÉCLAIRÉE renvoie bien de son côté : du rebond existe à l'est de la bande.
    let est = 0
    for (let j = 0; j < g.gh; j++) for (let i = (FEU.tx - F.x0) * T; i < g.gw; i++) if (c.rebond[(j * g.gw + i) * 3]! > 0) est++
    expect(est).toBeGreaterThan(20)
  })

  it('A4·4 — le rebond ne dépasse 0,2 sur aucun canal, et sa teinte ne change pas sous le genou', () => {
    const g = grilleDuMonde(monde(), N, F)
    const c = champRef(g, [emetteur(g)], G2)
    let touches = 0
    for (let k = 0; k < g.gw * g.gh; k++) {
      if (g.occ[k] === 1) continue
      const brut = [c.rebond[k * 3]!, c.rebond[k * 3 + 1]!, c.rebond[k * 3 + 2]!]
      const sous = [c.light[k * 3]! - c.direct[k * 3]!, c.light[k * 3 + 1]! - c.direct[k * 3 + 1]!, c.light[k * 3 + 2]! - c.direct[k * 3 + 2]!]
      for (const v of sous) expect(v).toBeLessThanOrEqual(GI.PLAFOND_REBOND + 1e-6)
      const m = Math.max(...brut)
      if (m <= 0) continue
      touches++
      const s = 1 / (1 + m / GI.PLAFOND_REBOND)
      for (let ch = 0; ch < 3; ch++) expect(sous[ch]).toBeCloseTo(brut[ch]! * s, 5)
    }
    expect(touches).toBeGreaterThan(100)
  })

  it('A4·5 — deux calculs rendent le même champ, octet pour octet ; les texels opaques lisent leur face', () => {
    const g = grilleDuMonde(monde(), N, F)
    const a = champRef(g, [emetteur(g)], G2)
    const b = champRef(g, [emetteur(g)], G2)
    expect(Array.from(a.light)).toEqual(Array.from(b.light))
    expect(Array.from(a.direct)).toEqual(Array.from(b.direct))
    // La roche au nord-est du feu, en pleine vue, lit la lumière de sa face : plus que zéro, jamais plus
    // que sa voisine la plus claire. (Le fût, lui, est dans l'ombre du mur : sa face reste noire.)
    const k = ((45 - F.y0) * T + 3) * g.gw + (53 - F.x0) * T
    expect(g.occ[k]).toBe(1)
    expect(a.light[k * 3]).toBeGreaterThan(0)
    expect(a.directFace[k * 3]).toBeGreaterThan(0)
    expect(a.directFace[k * 3]).toBeLessThanOrEqual(a.light[k * 3]! + 1e-6)
    const fut = ((50 - F.y0) * T + 1) * g.gw + (46 - F.x0) * T + 2
    expect(g.occ[fut]).toBe(1)
    expect(a.light[fut * 3]).toBe(0)
  })

  it('A4·6 — le motif est celui de la sim : seize points, exportés, jamais recopiés', () => {
    expect(MOTIF_SOURCE).toHaveLength(16)
  })
})

describe('la composition (LG-R5, LG-A5)', () => {
  it('A5 — rien ne bouge où rien ne tombe ; M ≤ 1 ; de jour sans ombre, M = 1 quelle que soit la lumière', () => {
    for (const mn of [0.05, 0.33, 0.8, 1]) {
      expect(composerM(mn, 0, 0.42, 0)).toBe(mn)
      expect(composerM(mn, 1, 0.42, 0)).toBeCloseTo(mn * (1 - 0.42), 12)
      for (const l of [0, 0.3, 1, 1.4]) expect(composerM(mn, 0, 0.42, l)).toBeLessThanOrEqual(1)
    }
    expect(composerM(1, 0, 0.42, 0.7)).toBe(1)
    // La lumière ne fait que remonter M vers 1, et l'ombre le descend : monotone dans les deux sens.
    expect(composerM(0.33, 0, 0.42, 0.5)).toBeGreaterThan(composerM(0.33, 0, 0.42, 0.2))
    expect(composerM(0.33, 1, 0.42, 0.2)).toBeLessThan(composerM(0.33, 0, 0.42, 0.2))
  })
})

/**
 * LE MASQUE D'ASTRE (LG-R8, LG-R9, LG-R10 « depuis la face »).
 *
 * Le montage se pose au TEXEL plutôt qu'à travers le monde : l'ombre d'astre est une géométrie, et
 * une grille nue d'une seule bande la rend lisible au rang près. Un dernier cas la reprend sur un
 * vrai mur de la sim, pour prouver que la plomberie y arrive.
 *
 * ⚠ LES PRÉDICTIONS SONT ÉCRITES AVANT LA MESURE (sinon la garde ne peut pas échouer) : mur
 * est-ouest à cheval sur y = 8, ℓ = 32 px × 0,4 ÷ 4 = 3,2 texels, donc QUATRE rangs pleins (8 à 11),
 * puis ⅔ au rang 12 et ⅓ au 13 ; à dérive ±1 la pointe part de (8/7) × 3,2 = 3,657 texels de côté.
 */
const ASTRE_NU = { cisaillement: GI.ASTRE.CISAILLEMENT, penombre: GI.ASTRE.PENOMBRE }
const L_MUR = longueurDOmbre(GI.ASTRE.HAUTEUR_MUR_PX, TILE_PX / T)
const astre = (derive: number, longueur = L_MUR): Astre => ({ derive, longueur, ...ASTRE_NU })

/** Une grille nue de gw × gh texels, avec une seule bande — bords demi-entiers, comme la sim les donne. */
function grilleNue(gw: number, gh: number, bande: BandeGrille): GrilleGi & { occ: Uint8Array } {
  return { gw, gh, occ: new Uint8Array(gw * gh), murs: [bande], albedo: new Float32Array(gw * gh * 3), albedoMurs: [[0.5, 0.5, 0.5]] }
}
const MUR_EO: BandeGrille = { x0: 6.5, x1: 13.5, y0: 7.5, y1: 8.5 }
const MUR_NS: BandeGrille = { x0: 9.5, x1: 10.5, y0: 5.5, y1: 10.5 }
/** Les colonnes d'un rang qui sont dans l'ombre PLEINE. */
const pleines = (s: Float32Array, gw: number, y: number): number[] => {
  const c: number[] = []
  for (let x = 0; x < gw; x++) if (s[y * gw + x] === 1) c.push(x)
  return c
}

describe('le masque d’astre (LG-R8, LG-R9)', () => {
  it('R9 — la longueur suit la hauteur : quatre rangs pleins sous un mur, puis ⅔ et ⅓ dehors', () => {
    expect(L_MUR).toBeCloseTo(3.2, 12)
    const g = grilleNue(24, 20, MUR_EO)
    const s = masqueDAstre(g, astre(0))
    const col = (y: number) => s[y * g.gw + 10]
    expect([col(8), col(9), col(10), col(11)]).toEqual([1, 1, 1, 1])
    // Le masque est un Float32Array : la valeur attendue est le float32 de ⅔, pas ⅔ à l'arrondi près.
    expect(col(12)).toBe(Math.fround(2 / 3))
    expect(col(13)).toBe(Math.fround(1 / 3))
    expect(col(14)).toBe(0)
    // L'emprise en largeur s'arrête aux bords OUVERTS de la bande : 6,5 et 13,5 ne sont pas dedans.
    expect(pleines(s, g.gw, 11)).toEqual([7, 8, 9, 10, 11, 12])
  })

  it('R8 — la pénombre ne va jamais vers le nord : le haut d’une ombre est son contact', () => {
    const g = grilleNue(24, 20, MUR_EO)
    for (const d of [0, 1, -1, 0.4]) {
      const s = masqueDAstre(g, astre(d))
      for (let y = 0; y <= 7; y++) for (let x = 0; x < g.gw; x++) expect(s[y * g.gw + x], `d=${d} (${x}, ${y})`).toBe(0)
    }
  })

  it('R8 — la pointe se cisaille, et son SENS est celui du jeu : le soir à l’est, le matin à l’ouest', () => {
    const g = grilleNue(24, 20, MUR_EO)
    const est = pleines(masqueDAstre(g, astre(1)), g.gw, 11)
    const ouest = pleines(masqueDAstre(g, astre(-1)), g.gw, 11)
    expect(est).toEqual([10, 11, 12, 13, 14, 15, 16])
    expect(ouest).toEqual([3, 4, 5, 6, 7, 8, 9])
    // Le miroir se lit en centres de texels (+0,5), pas en indices : c ↔ 19 − c autour de l'axe x = 10.
    expect(est.map((c) => 19 - c).reverse()).toEqual(ouest)
  })

  it('R8 — un texel d’occludeur ne prend pas l’ombre d’astre, et il n’en transmet pas', () => {
    const g = grilleNue(24, 20, MUR_EO)
    g.occ[10 * g.gw + 10] = 1
    const s = masqueDAstre(g, astre(0))
    expect(s[10 * g.gw + 10]).toBe(0)
    expect(s[9 * g.gw + 10]).toBe(1)
    expect(s[11 * g.gw + 10]).toBe(1)
  })

  it('R10 — un mur nord-sud ne jette rien à dérive nulle : son ombre tombe sous lui', () => {
    const g = grilleNue(24, 20, MUR_NS)
    // La bande est à cheval sur x = 10 : l'ombre plein sud tient dans sa propre ligne, et aucun
    // centre de texel n'est dans son intérieur ouvert. Rien à voir — ce qui est le vrai rendu.
    expect(masqueDAstre(g, astre(0)).some((v) => v > 0)).toBe(false)
    // Dès que l'astre dérive, elle traîne en diagonale, au sud et à l'est.
    const s = masqueDAstre(g, astre(1))
    expect(s.some((v) => v === 1)).toBe(true)
    for (let y = 0; y < 5; y++) for (let x = 0; x < g.gw; x++) expect(s[y * g.gw + x], `(${x}, ${y})`).toBe(0)
  })

  it('R8 — sans astre, pas de masque : à longueur nulle le champ est intact au bit', () => {
    const g = grilleNue(24, 20, MUR_EO)
    expect(masqueDAstre(g, astre(0.7, 0)).some((v) => v !== 0)).toBe(false)
  })

  it('R9 — la hauteur d’un mur est celle du jeu, pas un second nombre', () => {
    expect(GI.ASTRE.HAUTEUR_MUR_PX).toBe(MUR_HT)
  })

  it('R8 — la plomberie y arrive : un vrai mur de la sim porte le masque', () => {
    const g = grilleDuMonde(monde(), N, F)
    // Le mur du montage est une arête OUEST, donc nord-sud : rien à dérive nulle, une traîne sinon.
    expect(masqueDAstre(g, astre(0)).some((v) => v > 0)).toBe(false)
    const s = masqueDAstre(g, astre(-1))
    expect(s.some((v) => v === 1)).toBe(true)
    const nord = Math.floor(g.murs[0]!.y0)
    for (let y = 0; y < nord; y++) for (let x = 0; x < g.gw; x++) expect(s[y * g.gw + x], `(${x}, ${y})`).toBe(0)
  })
})
