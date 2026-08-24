/**
 * A20 — LES QUATRE SAISONS SE DISTINGUENT À L'ŒIL (spec `saisons.md` S17).
 *
 * On ne juge pas une DA par un test : la teinte finale se tranchera sur une planche rendue.
 * Ce que ces gardes tiennent, c'est la FORME de la loi — qu'elle sépare vraiment les quatre
 * saisons, qu'elle ne saute jamais d'un jour à l'autre, qu'elle ne touche que le vivant, et
 * qu'elle ne puisse pas inventer une couleur que l'art n'a pas.
 */
import { describe, expect, it } from 'vitest'
import { teinteDuTerrain, teinteSaisonniere, teinter, TERRAINS_VIVANTS } from './teinte-saison'

const HERBE = 0x3e7d3a // TERRAIN_COLORS[1] — le pré, le point de comparaison
const ecart = (a: number, b: number): number =>
  Math.abs(((a >> 16) & 0xff) - ((b >> 16) & 0xff)) +
  Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff)) +
  Math.abs((a & 0xff) - (b & 0xff))

describe('la teinte de la saison', () => {
  it('les quatre saisons rendent quatre couleurs nettement séparées', () => {
    const cardinaux = [15, 45, 75, 105].map((j) => teinter(HERBE, teinteSaisonniere(j)))
    for (let i = 0; i < cardinaux.length; i++) {
      for (let k = i + 1; k < cardinaux.length; k++) {
        expect(ecart(cardinaux[i]!, cardinaux[k]!), `saisons ${i} et ${k}`).toBeGreaterThan(20)
      }
    }
  })

  it('l’automne ROUSSIT pour de vrai — un multiplicateur n’y arrivait pas', () => {
    // Ce que la planche a réfuté : × ne peut pas sortir du vert. Le fondu, si — et la garde le
    // dit en HSV plutôt qu'en canaux : au cœur des Pluies, la teinte de l'herbe doit avoir
    // basculé du vert (~110°) vers l'orangé (< 60°).
    const teinteHue = (c: number): number => {
      const r = ((c >> 16) & 0xff) / 255
      const g = ((c >> 8) & 0xff) / 255
      const b = (c & 0xff) / 255
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      if (max === min) return 0
      const d = max - min
      const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
      return h * 60
    }
    expect(teinteHue(HERBE)).toBeGreaterThan(90) // la prémisse : le pré EST vert
    expect(teinteHue(teinter(HERBE, teinteSaisonniere(75)))).toBeLessThan(60) // …et il roussit
    expect(teinteHue(teinter(HERBE, teinteSaisonniere(15)))).toBeGreaterThan(80) // le printemps reste vert
  })

  it('l’automne roussit, l’hiver DÉSATURE — deux directions différentes', () => {
    const rouge = (c: number): number => (c >> 16) & 0xff
    const vert = (c: number): number => (c >> 8) & 0xff
    const saturation = (c: number): number => {
      const r = (c >> 16) & 0xff
      const g = (c >> 8) & 0xff
      const b = c & 0xff
      const max = Math.max(r, g, b)
      return max === 0 ? 0 : (max - Math.min(r, g, b)) / max
    }
    const printemps = teinter(HERBE, teinteSaisonniere(15))
    const automne = teinter(HERBE, teinteSaisonniere(75))
    const hiver = teinter(HERBE, teinteSaisonniere(105))
    expect(rouge(automne)).toBeGreaterThan(rouge(printemps)) // le roux monte
    expect(vert(automne)).toBeLessThan(vert(printemps)) // le vert s'éteint
    // L'hiver ne va PAS plus loin dans le roux — il va ailleurs : il éteint la couleur.
    // (La première garde demandait « moins de vert qu'à l'automne » ; un gris-bleu a des canaux
    // équilibrés, donc son vert remonte. Ce qui distingue l'hiver, c'est la SATURATION.)
    expect(saturation(hiver)).toBeLessThan(saturation(automne))
    expect(saturation(hiver)).toBeLessThan(saturation(printemps))
  })

  it('elle ne saute jamais d’un jour à l’autre, tour de l’an compris', () => {
    for (let j = 1; j <= 2 * 120; j++) {
      const a = teinter(HERBE, teinteSaisonniere(j))
      const b = teinter(HERBE, teinteSaisonniere(j + 1))
      expect(ecart(a, b), `jour ${j}`).toBeLessThanOrEqual(6)
    }
  })

  it('elle est cyclique : le même jour de l’année rend la même teinte, à vie', () => {
    for (let j = 1; j <= 120; j++) {
      expect(teinteSaisonniere(j + 120)).toEqual(teinteSaisonniere(j))
      expect(teinteSaisonniere(j + 12 * 120)).toEqual(teinteSaisonniere(j))
    }
    // …et un jour aberrant ne la casse pas.
    for (const j of [0, -1, -1000, 1e6, 3.7]) {
      const t = teinteSaisonniere(j)
      expect(Number.isFinite(t.cible) && Number.isFinite(t.force)).toBe(true)
      expect(t.force).toBeGreaterThanOrEqual(0)
    }
  })

  it('seul le VIVANT tourne — la roche, l’eau, la route et le mur ne bougent pas', () => {
    for (const mort of [2, 4, 5, 6, 7, 10, 15]) {
      expect(TERRAINS_VIVANTS.has(mort), `terrain ${mort}`).toBe(false)
      for (const j of [15, 45, 75, 105]) {
        // Force nulle = l'art intact, quelle que soit la cible : un lac ne rousit pas.
        expect(teinteDuTerrain(mort, j).force, `terrain ${mort}, jour ${j}`).toBe(0)
        expect(teinter(HERBE, teinteDuTerrain(mort, j))).toBe(HERBE)
      }
    }
    for (const vif of [1, 3, 13]) {
      expect(teinteDuTerrain(vif, 75).force).toBeGreaterThan(0)
    }
  })

  it('un FONDU, jamais un remplacement : l’art garde ses écarts à toute saison', () => {
    // La forêt (#2c5a2e) est plus sombre que le pré (#3e7d3a) : elle doit le rester TOUTE
    // l'année, sinon la teinte cesse d'être une saison pour devenir un filtre.
    const FORET = 0x2c5a2e
    const luminance = (c: number): number =>
      0.299 * ((c >> 16) & 0xff) + 0.587 * ((c >> 8) & 0xff) + 0.114 * (c & 0xff)
    for (let j = 1; j <= 120; j++) {
      const t = teinteSaisonniere(j)
      expect(luminance(teinter(FORET, t)), `jour ${j}`).toBeLessThan(luminance(teinter(HERBE, t)))
      expect(t.force, `jour ${j}`).toBeLessThan(0.8) // il reste toujours de l'art dessous
      const c = teinter(0xffffff, t)
      for (const canal of [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]) {
        expect(canal).toBeGreaterThanOrEqual(0)
        expect(canal).toBeLessThanOrEqual(255)
      }
    }
  })
})
