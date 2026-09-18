import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LUMIERE } from '@ashes/sim'
import { champRef, facesDuChamp, masqueDAstre, ombrePleineDAstre, type Astre } from '../render/gi/champ-ref'
import { grilleDuMonde } from '../render/gi/grille'
import { GI, longueurDOmbre, profilFeu } from '../render/gi/reglages'
import { TILE_PX } from '../render/framing'
import {
  ASTRE_DU_BANC, GATES_MS, MN_DU_BANC, SCENE, cartesDuBanc, classeDuGpu, ecartDe, fenetreDuBanc, gateDe, mediane, mondeDuBanc,
  sourcesDuBanc, tient,
} from './banc-gi-loi'

/**
 * LE BANC GI — SES PRÉMISSES, PROUVÉES PAR L'ORACLE AVANT TOUT GPU (mémoire du projet : « une garde
 * prouve sa prémisse »). Le banc de l'Atelier (`banc-gi.ts`) relit chaque passe contre l'oracle sur la
 * scène fixe de `banc-gi-loi.ts` ; si cette scène n'avait pas de face de bande, pas de rebond ou pas
 * d'ombre d'astre tombant sur de la lumière, une garde verte n'aurait rien éprouvé. On le tient ICI,
 * sans navigateur, sur la même fenêtre que le GPU allouera.
 */
const T = LUMIERE.TEXELS_PAR_TUILE
const PX_PAR_TEXEL = TILE_PX / T

function astreDuBanc(): Astre {
  return {
    derive: ASTRE_DU_BANC.derive,
    longueur: longueurDOmbre(GI.ASTRE.HAUTEUR_MUR_PX, PX_PAR_TEXEL),
    cisaillement: GI.ASTRE.CISAILLEMENT,
    penombre: GI.ASTRE.PENOMBRE,
    longueurParHauteur: GI.ASTRE.LONGUEUR_PAR_HAUTEUR,
  }
}

function champDuBanc() {
  const f = fenetreDuBanc()
  const g = grilleDuMonde(mondeDuBanc(), 0, f)
  const emetteurs = sourcesDuBanc().map((s) => ({
    x: s.worldX / PX_PAR_TEXEL - g.ox,
    y: s.worldY / PX_PAR_TEXEL - g.oy,
    rayon: (s.radiusTiles * TILE_PX) / PX_PAR_TEXEL,
    taille: GI.TAILLE_SOURCE,
    rgb: [GI.TEINTE_FEU[0] * s.force, GI.TEINTE_FEU[1] * s.force, GI.TEINTE_FEU[2] * s.force] as const,
  }))
  const o = champRef(g, emetteurs, { rebond: GI.REBOND, porteeRebond: GI.PORTEE_REBOND, plafondRebond: GI.PLAFOND_REBOND, profil: profilFeu })
  return { f, g, o, emetteurs }
}

describe('la scène fixe du banc GI — ses prémisses (LG-A1)', () => {
  it('la fenêtre du champ tient dans la carte, aux paliers de la chaîne', () => {
    const f = fenetreDuBanc()
    expect(f.x0).toBeGreaterThanOrEqual(0)
    expect(f.y0).toBeGreaterThanOrEqual(0)
    expect(f.x1).toBeLessThan(SCENE.MAP_W)
    expect(f.y1).toBeLessThan(SCENE.MAP_H)
    expect(f.gw % GI.PALIER_TEXELS).toBe(0)
    expect(f.gh % GI.PALIER_TEXELS).toBe(0)
  })

  it('toutes les sortes d’occludeur y sont : bandes, cellules de bâti, terrain plein, nœud plein, fûts', () => {
    const { f, g } = champDuBanc()
    const k = (tx: number, ty: number, sx = 0, sy = 0) => ((ty - f.y0) * T + sy) * g.gw + (tx - f.x0) * T + sx
    // Le coin : six bandes ouest, sept bandes nord (l'angle porte les deux).
    expect(g.murs.length).toBe(SCENE.COIN.ouest + SCENE.COIN.nord)
    expect(g.occ[k(SCENE.COIN.tx, SCENE.COIN.ty + 2, 1, 1)]).toBe(0) // la tuile d'un mur d'arête reste du sol
    expect(g.occ[k(SCENE.PLEIN.tx, SCENE.PLEIN.ty, 3, 3)]).toBe(1)
    expect(g.occ[k(SCENE.ROCHE.tx + 1, SCENE.ROCHE.ty + 1, 0, 0)]).toBe(1)
    expect(g.occ[k(SCENE.PIERRE.tx, SCENE.PIERRE.ty, 2, 2)]).toBe(1)
    for (const a of SCENE.ARBRES) {
      expect(g.occ[k(a.tx, a.ty, 1, 1)]).toBe(1) // le fût
      expect(g.occ[k(a.tx, a.ty, 0, 0)]).toBe(0) // la cime n'occulte pas le sol
    }
  })

  it('les deux feux éclairent, il y a des faces des DEUX sortes, et du rebond', () => {
    const { g, o } = champDuBanc()
    const n = g.gw * g.gh
    let eclaires = 0
    let rebond = 0
    for (let k = 0; k < n; k++) {
      if (g.occ[k] === 1) continue
      if (o.direct[k * 3]! > 0) eclaires++
      if (o.rebond[k * 3]! > 0) rebond++
    }
    expect(eclaires).toBeGreaterThan(1000)
    expect(rebond).toBeGreaterThan(100)
    const faces = facesDuChamp(g, o.direct)
    const cellules = faces.filter((f) => g.occ[Math.floor(f.y) * g.gw + Math.floor(f.x)] === 1).length
    expect(cellules).toBeGreaterThan(0)
    expect(faces.length - cellules).toBeGreaterThan(0)
    // Chaque face regarde un texel VOISIN, libre : c'est ce qui la pose dans une case du raster 2×.
    for (const f of faces) {
      expect(Math.abs(f.vx - f.x) + Math.abs(f.vy - f.y)).toBe(1)
      expect(g.occ[Math.floor(f.vy) * g.gw + Math.floor(f.vx)]).toBe(0)
    }
  })

  it('l’ombre d’astre a de la pénombre, et tombe SUR la lumière (la prémisse de la composition)', () => {
    const { g, o } = champDuBanc()
    const astre = astreDuBanc()
    const cartes = cartesDuBanc().map((c) => ({
      silhouette: { w: SCENE.FUT_W, h: SCENE.FUT_H, opaque: new Uint8Array(SCENE.FUT_W * SCENE.FUT_H).fill(1) },
      x: c.x / PX_PAR_TEXEL - g.ox, y: c.y / PX_PAR_TEXEL - g.oy,
      originX: c.originX, originY: c.originY, rotation: c.rotation, scaleX: c.scaleX, scaleY: c.scaleY, flipX: c.flipX, flipY: c.flipY,
      piedX: c.piedX / PX_PAR_TEXEL - g.ox, piedY: c.piedY / PX_PAR_TEXEL - g.oy,
    }))
    // ⚠ Les cartes se donnent en PX DE GRILLE, l'oracle divise par `pxParTexel` lui-même.
    const enPx = cartes.map((c) => ({ ...c, x: c.x * PX_PAR_TEXEL, y: c.y * PX_PAR_TEXEL, piedX: c.piedX * PX_PAR_TEXEL, piedY: c.piedY * PX_PAR_TEXEL }))
    const pleine = ombrePleineDAstre(g, astre, { cartes: enPx, pxParTexel: PX_PAR_TEXEL })
    const masque = masqueDAstre(g, astre, { cartes: enPx, pxParTexel: PX_PAR_TEXEL })
    let ombres = 0
    let penombre = 0
    let croises = 0
    for (let k = 0; k < g.gw * g.gh; k++) {
      if (g.occ[k] === 1) continue
      if (pleine[k] === 1) ombres++
      if (masque[k]! > 0 && masque[k]! < 1) penombre++
      if (masque[k]! > 0 && o.light[k * 3]! > 0) croises++
    }
    expect(ombres).toBeGreaterThan(50)
    expect(penombre).toBeGreaterThan(20)
    expect(croises).toBeGreaterThan(50)
  })

  it('l’astre du banc porte la force de l’ombre du jeu, et le Mn est un plancher de nuit', () => {
    // `SHADOW_ALPHA` vit dans `contact-shadow.ts`, qui tire Phaser (pas de `window` ici) : on lit la
    // déclaration dans la source, la seule ligne `export const SHADOW_ALPHA = …`.
    const source = readFileSync(new URL('../scenes/world/contact-shadow.ts', import.meta.url), 'utf8')
    const m = /export const SHADOW_ALPHA = ([0-9.]+)/.exec(source)
    expect(m).not.toBeNull()
    expect(ASTRE_DU_BANC.a).toBeCloseTo(Number(m![1]) * 0.8, 6)
    expect(ASTRE_DU_BANC.derive).toBeGreaterThan(0)
    expect(ASTRE_DU_BANC.derive).toBeLessThanOrEqual(1)
    for (const c of MN_DU_BANC) {
      expect(c).toBeGreaterThan(0)
      expect(c).toBeLessThan(1)
    }
  })
})

describe('la comparaison d’une cible relue (LG-A2, les seuils de la spec)', () => {
  it('arrondit l’attendu comme l’octet, et compte la prémisse', () => {
    const ref = [0, 0.5, 1, 0.2]
    const lu = [0, 128, 255, 51]
    const e = ecartDe(4, 1, (k) => lu[k]!, (k) => ref[k]!)
    expect(e).toEqual({ n: 4, moyenne: 0, partSup3: 0, max: 0, nonNuls: 3 })
    expect(tient(e)).toBe(true)
  })
  it('rompt au-delà des seuils, et sur une scène sans rien à comparer', () => {
    expect(tient(ecartDe(10, 1, () => 10, () => 0))).toBe(false) // 10 niveaux partout
    expect(tient(ecartDe(10, 1, () => 0, () => 0))).toBe(false) // rien de non nul : pas de prémisse
    const e = ecartDe(1000, 1, (k) => (k < 5 ? 10 : 100), () => 100 / 255)
    expect(e.partSup3).toBeCloseTo(0.005, 6)
    expect(tient(e)).toBe(true)
    const e2 = ecartDe(1000, 1, (k) => (k < 20 ? 10 : 100), () => 100 / 255)
    expect(tient(e2)).toBe(false)
  })
})

describe('la classe d’un GPU et sa gate (LG-A14)', () => {
  it('lit la classe dans le nom, et ne connaît de gate que pour l’intégré et le dédié', () => {
    expect(classeDuGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe('logiciel')
    expect(classeDuGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('dedie')
    expect(classeDuGpu('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('integre')
    expect(classeDuGpu('ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('integre')
    expect(classeDuGpu('ANGLE (AMD, AMD Radeon RX 6700 XT (0x000073DF) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('dedie')
    expect(classeDuGpu('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)')).toBe('integre')
    expect(classeDuGpu('Mesa Intel(R) UHD Graphics 620 (KBL GT2)')).toBe('integre')
    expect(classeDuGpu('WebKit WebGL')).toBe('inconnue')
    expect(gateDe('integre')).toBe(GATES_MS.integre)
    expect(gateDe('dedie')).toBe(GATES_MS.dedie)
    expect(gateDe('logiciel')).toBeNull()
    expect(gateDe('inconnue')).toBeNull()
    // Les deux seuils d'Alexis (LG-Q7), tels quels.
    expect(GATES_MS).toEqual({ integre: 2, dedie: 4 })
  })
  it('la médiane de trois est le deuxième', () => {
    expect(mediane([3, 1, 2])).toBe(2)
    expect(mediane([5])).toBe(5)
    expect(mediane([])).toBe(0)
  })
})
