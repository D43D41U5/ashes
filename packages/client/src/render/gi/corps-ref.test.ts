/**
 * ═══ LA GARDE DES CORPS (LG-R7, LG-R16, LG-A8, LG-A17) ═══
 *
 * Écrite AVANT le shader, et c'est délibéré : un oracle rédigé après la passe qu'il doit juger finit
 * rétro-conçu pour lui donner raison. Ici la loi est posée d'abord, la passe la rejoindra ensuite.
 *
 * Ce fichier ne juge QUE la répartition. Les gardes de pixels (LG-A1, LG-A2) se jouent sous SwiftShader
 * dans le smoke, pas ici.
 */
import { describe, expect, it } from 'vitest'
import { composerM } from './champ-ref'
import {
  AMBIANTE,
  ambianteDeLHeure,
  composerLeCorps,
  fractionDuFeu,
  luminanceDuVoile,
  partsDuCorps,
  rgbDeCouleur,
  sansFeuDirect,
  type Rgb,
} from './corps-ref'

/** Une ambiante si haute qu'elle ne rabat jamais : on isole la loi de la somme du rabat de J. */
const SANS_RABAT = 1e9

/** Un balayage grossier mais EXHAUSTIF du domaine — pas trois cas choisis (`garde-exhaustive-plutot-que-cas`). */
const MN: Rgb[] = [
  [0, 0, 0],
  [0.12, 0.14, 0.2],
  [0.35, 0.36, 0.42],
  [0.8, 0.79, 0.74],
  [1, 1, 1],
]
const S = [0, 1 / 3, 2 / 3, 1]
const A = [0, 0.21, 0.42]
const L: Rgb[] = [
  [0, 0, 0],
  [0.05, 0.04, 0.03],
  [0.4, 0.32, 0.22],
  [1, 0.92, 0.62],
]

describe('les parts d’un corps (LG-R7)', () => {
  it('LES TROIS PARTS SOMMENT À M, PAR CANAL — c’est la définition de σ, pas une approximation', () => {
    let cas = 0
    for (const mn of MN)
      for (const s of S)
        for (const a of A)
          for (const light of L)
            for (const part of [0, 0.5, 1]) {
              const df: Rgb = [light[0] * part, light[1] * part, light[2] * part]
              const p = partsDuCorps(mn, s, a, light, df, SANS_RABAT)
              for (let c = 0; c < 3; c++) {
                const attendu = composerM(mn[c]!, s, a, light[c]!)
                expect(p.astre[c]! + p.feu[c]! + p.plat[c]!).toBeCloseTo(attendu, 12)
              }
              cas++
            }
    // La garde prouve sa prémisse : un balayage vide passerait au vert sans rien éprouver.
    expect(cas).toBe(MN.length * S.length * A.length * L.length * 3)
  })

  it('AUCUNE PART N’EST NÉGATIVE, ET AUCUNE NE DÉPASSE M', () => {
    for (const mn of MN)
      for (const s of S)
        for (const a of A)
          for (const light of L) {
            const p = partsDuCorps(mn, s, a, light, light, SANS_RABAT)
            for (let c = 0; c < 3; c++) {
              const m = composerM(mn[c]!, s, a, light[c]!)
              for (const v of [p.astre[c]!, p.feu[c]!, p.plat[c]!]) {
                expect(v).toBeGreaterThanOrEqual(0)
                expect(v).toBeLessThanOrEqual(m + 1e-12)
              }
            }
          }
  })

  it('SANS FEU, LE FEU NE PREND RIEN ET LE CIEL PREND TOUT', () => {
    const mn: Rgb = [0.35, 0.36, 0.42]
    const p = partsDuCorps(mn, 0.5, 0.42, [0, 0, 0], [0, 0, 0], SANS_RABAT)
    expect(p.feu).toEqual([0, 0, 0])
    for (let c = 0; c < 3; c++) expect(p.astre[c]! + p.plat[c]!).toBeCloseTo(composerM(mn[c]!, 0.5, 0.42, 0), 12)
  })

  it('À LA NOUVELLE LUNE (a = 0) UN CORPS N’A PLUS DE DIRECTION DU CIEL — tout son ciel est plat', () => {
    const mn: Rgb = [0.12, 0.14, 0.2]
    for (const s of S) {
      const p = partsDuCorps(mn, s, 0, [0.4, 0.32, 0.22], [0.3, 0.24, 0.16], SANS_RABAT)
      expect(p.astre).toEqual([0, 0, 0])
    }
  })

  it('DANS L’OMBRE PLEINE (S = 1) LA PART D’ASTRE EST NULLE, ET ELLE EST MAXIMALE AU SOLEIL (S = 0)', () => {
    const mn: Rgb = [0.8, 0.79, 0.74]
    const pleine = partsDuCorps(mn, 1, 0.42, [0, 0, 0], [0, 0, 0], SANS_RABAT)
    const soleil = partsDuCorps(mn, 0, 0.42, [0, 0, 0], [0, 0, 0], SANS_RABAT)
    expect(pleine.astre).toEqual([0, 0, 0])
    for (let c = 0; c < 3; c++) expect(soleil.astre[c]!).toBeGreaterThan(0)
  })

  it('LA PART DIRECTE DU FEU NE MANGE JAMAIS LE REBOND — directFace est bornée par light', () => {
    const mn: Rgb = [0.12, 0.14, 0.2]
    // Une source qui prétendrait un direct SUPÉRIEUR à la lumière totale (arrondi GPU) est refermée.
    const p = partsDuCorps(mn, 0, 0.42, [0.4, 0.32, 0.22], [0.9, 0.9, 0.9], SANS_RABAT)
    const q = partsDuCorps(mn, 0, 0.42, [0.4, 0.32, 0.22], [0.4, 0.32, 0.22], SANS_RABAT)
    expect(p.feu).toEqual(q.feu)
    for (let c = 0; c < 3; c++) expect(p.plat[c]!).toBeGreaterThanOrEqual(0)
  })
})

describe('le plancher d’un corps (LG-R7, J)', () => {
  it('L’AMBIANTE RABAT, ELLE NE LÈVE JAMAIS', () => {
    const mn: Rgb = [0.8, 0.79, 0.74]
    const haut = partsDuCorps(mn, 0, 0.42, [0, 0, 0], [0, 0, 0], SANS_RABAT)
    const bas = partsDuCorps(mn, 0, 0.42, [0, 0, 0], [0, 0, 0], 0.05)
    for (let c = 0; c < 3; c++) {
      expect(bas.plat[c]!).toBeLessThan(haut.plat[c]!)
      // Et SOUS le rabat, la somme tombe sous M : c'est la règle de J, pas un défaut.
      expect(bas.astre[c]! + bas.plat[c]!).toBeLessThan(composerM(mn[c]!, 0, 0.42, 0))
    }
  })

  it('LE RABAT GARDE LA TEINTE DU VOILE — il assombrit, il ne décolore pas', () => {
    const mn: Rgb = [0.8, 0.6, 0.4]
    const p = partsDuCorps(mn, 0, 0.42, [0, 0, 0], [0, 0, 0], 0.05)
    // Les rapports entre canaux du plat sont ceux de Mn, au flottant près.
    expect(p.plat[0]! / p.plat[1]!).toBeCloseTo(mn[0] / mn[1], 12)
    expect(p.plat[1]! / p.plat[2]!).toBeCloseTo(mn[1] / mn[2], 12)
  })

  it('UNE AMBIANTE AU-DESSUS DU PLANCHER NE CHANGE RIEN DU TOUT, AU BIT PRÈS', () => {
    const mn: Rgb = [0.12, 0.14, 0.2]
    const a = partsDuCorps(mn, 0.5, 0.42, [0.4, 0.32, 0.22], [0.3, 0.24, 0.16], SANS_RABAT)
    const b = partsDuCorps(mn, 0.5, 0.42, [0.4, 0.32, 0.22], [0.3, 0.24, 0.16], 0.9)
    expect(b).toEqual(a)
  })
})

describe('le `f` de jour (LG-R5, « la fraction suit le voile »)', () => {
  const NUIT: Rgb = [0.35, 0.35, 0.35]

  it('VAUT 1 LA NUIT, AU BIT PRÈS — le raccord ne claque pas', () => {
    expect(fractionDuFeu(NUIT, NUIT)).toBe(1)
  })

  it('VAUT ½ EN PLEIN JOUR — le voile est l’identité', () => {
    expect(fractionDuFeu([1, 1, 1], NUIT)).toBe(0.5)
  })

  it('CROÎT AVEC LA PÉNOMBRE, SANS JAMAIS SORTIR DE [½, 1]', () => {
    let precedent = -1
    for (const v of [1, 0.95, 0.9, 0.8, 0.7, 0.6, 0.5, 0.45, 0.4, 0.35]) {
      const f = fractionDuFeu([v, v, v], NUIT)
      expect(f).toBeGreaterThanOrEqual(0.5)
      expect(f).toBeLessThanOrEqual(1)
      expect(f).toBeGreaterThan(precedent)
      precedent = f
    }
  })

  it('ÉPINGLE LE CRÉPUSCULE DE LA SPEC — ½ + ½ × 0,20/0,65 = 0,6538, que LG-R5 appelle « environ ⅔ »', () => {
    // ⚠ Ce test épingle LA FORMULE, pas l'adverbe. Écrit d'abord en `toBeCloseTo(2/3, 2)`, il rougissait
    // à 0,6538 : il n'éprouvait que ma lecture du mot « environ » de la spec, jamais le code.
    expect(fractionDuFeu([0.8, 0.8, 0.8], [0.35, 0.35, 0.35])).toBeCloseTo(0.5 + 0.5 * (0.2 / 0.65), 12)
  })
})

describe('le dessus (LG-R16)', () => {
  it('N’A PLUS DE PART DIRECTE DU FEU, ET GARDE SES DEUX AUTRES PARTS INTACTES', () => {
    const p = partsDuCorps([0.35, 0.36, 0.42], 0, 0.42, [0.4, 0.32, 0.22], [0.3, 0.24, 0.16], SANS_RABAT)
    const d = sansFeuDirect(p)
    expect(d.feu).toEqual([0, 0, 0])
    expect(d.astre).toBe(p.astre)
    expect(d.plat).toBe(p.plat)
  })

  it('EST PLUS SOMBRE QU’UNE FACE PRÈS D’UN FEU — sinon la règle ne se verrait pas (planche 22)', () => {
    const p = partsDuCorps([0.35, 0.36, 0.42], 0, 0.42, [0.4, 0.32, 0.22], [0.3, 0.24, 0.16], SANS_RABAT)
    const d = sansFeuDirect(p)
    const total = (q: typeof p): number =>
      luminanceDuVoile([q.astre[0] + q.feu[0] + q.plat[0], q.astre[1] + q.feu[1] + q.plat[1], q.astre[2] + q.feu[2] + q.plat[2]])
    expect(total(d)).toBeLessThan(total(p))
  })

  it('⚠ LE REBOND DU FEU SURVIT SUR UN DESSUS — l’écart que LG-A17 devra trancher, MESURÉ ici', () => {
    // LG-R16 retire la part DIRECTE ; LG-A17 veut « feu allumé / feu éteint, la même image à 1 niveau
    // près ». Ce test ne juge pas : il RELÈVE l'écart, pour qu'il soit un chiffre et non une surprise.
    const mn: Rgb = [0.35, 0.36, 0.42]
    const allume = sansFeuDirect(partsDuCorps(mn, 0, 0.42, [0.4, 0.32, 0.22], [0.3, 0.24, 0.16], SANS_RABAT))
    const eteint = sansFeuDirect(partsDuCorps(mn, 0, 0.42, [0, 0, 0], [0, 0, 0], SANS_RABAT))
    const lum = (q: typeof allume): number =>
      luminanceDuVoile([q.astre[0] + q.plat[0], q.astre[1] + q.plat[1], q.astre[2] + q.plat[2]])
    const ecart = Math.abs(lum(allume) - lum(eteint)) * 255
    // La borne est LARGE à dessein : elle n'arbitre pas, elle empêche seulement l'écart de dériver en
    // silence. S'il franchit 1 niveau, c'est LG-A17 qui parle, et la question remonte à Alexis.
    expect(ecart).toBeLessThan(40)
  })
})

/**
 * ═══ LA COMPOSITION D'UN PIXEL (LG-R7, « La normale ») ═══
 *
 * C'est la forme que le shader devra rendre, et elle est écrite AVANT lui pour la raison de l'en-tête.
 * Les facteurs `fA`/`fF` viennent de `facteurDeNormale` (`sol-du-corps.ts`), éprouvé chez lui : ici on
 * ne juge que la COMPOSITION — ce que le texel, les parts et deux facteurs donnent ensemble.
 */
describe('la composition d’un pixel de corps (LG-R7)', () => {
  const BLANC: Rgb = [1, 1, 1]
  const parts = (mn: Rgb, s: number, a: number, l: Rgb, df: Rgb) => partsDuCorps(mn, s, a, l, df, SANS_RABAT)

  it('UN DESSUS PLAT SOUS DEUX FACTEURS 1 REND EXACTEMENT M — texel blanc, rien d’écrêté, la somme des parts', () => {
    let cas = 0
    for (const mn of MN)
      for (const s of S)
        for (const a of A)
          for (const light of L) {
            const df: Rgb = [light[0] * 0.5, light[1] * 0.5, light[2] * 0.5]
            const p = parts(mn, s, a, light, df)
            const out = composerLeCorps(BLANC, p, 1, 1)
            for (let c = 0; c < 3; c++)
              expect(out[c]!).toBeCloseTo(Math.min(1, composerM(mn[c]!, s, a, light[c]!)), 12)
            cas++
          }
    expect(cas).toBe(MN.length * S.length * A.length * L.length)
  })

  it('LE TEXEL MULTIPLIE TOUT — un texel noir rend noir, un texel à moitié rend la moitié', () => {
    const p = parts([0.35, 0.36, 0.42], 0, 0.42, [0.4, 0.32, 0.22], [0.3, 0.24, 0.16])
    expect(composerLeCorps([0, 0, 0], p, 1, 1)).toEqual([0, 0, 0])
    const plein = composerLeCorps(BLANC, p, 1, 1)
    const demi = composerLeCorps([0.5, 0.5, 0.5], p, 1, 1)
    for (let c = 0; c < 3; c++) expect(demi[c]!).toBeCloseTo(plein[c]! / 2, 12)
  })

  it('UNE FACE QUI TOURNE LE DOS NE PERD QUE SES PARTS DIRECTIONNELLES — le plat, lui, reste', () => {
    const p = parts([0.35, 0.36, 0.42], 0, 0.42, [0.4, 0.32, 0.22], [0.3, 0.24, 0.16])
    const dos = composerLeCorps(BLANC, p, 0, 0)
    for (let c = 0; c < 3; c++) {
      expect(dos[c]!).toBeCloseTo(p.plat[c]!, 12)
      expect(dos[c]!).toBeGreaterThan(0) // sinon le test ne dirait rien du plat
    }
  })

  /**
   * L'ÉCRÊTAGE EST AUX DEUX NIVEAUX, et c'est celui de `planche9.mjs` relevé à la ligne : `clip` sur
   * CHAQUE terme directionnel (`:183-184`), puis sur le total (`:186`). Un feu bas donne des `g` de 6
   * ou 7 (`sol-du-corps.test.ts`) : le cas n'est pas théorique, il arrive à quatre tuiles du foyer.
   */
  it('CHAQUE TERME DIRECTIONNEL EST ÉCRÊTÉ À 1 AVANT LA SOMME — pas seulement le total', () => {
    const p = parts([0.35, 0.36, 0.42], 0, 0.42, [0.4, 0.32, 0.22], [0.3, 0.24, 0.16])
    // Un `g` énorme sur le FEU seul : son terme sature à 1, celui de l'astre reste à sa valeur.
    const sature = composerLeCorps(BLANC, p, 0, 1000)
    for (let c = 0; c < 3; c++) expect(sature[c]!).toBe(Math.min(1, p.plat[c]! + 1))
    // Si l'écrêtage n'était QUE sur le total, un feu à 1000 aurait aussi tout blanchi — c'est le cas,
    // ici. Le cas qui DISTINGUE les deux : un feu qui sature seul, avec un plat nul.
    const platNul = { astre: [0, 0, 0] as Rgb, feu: [0.5, 0.5, 0.5] as Rgb, plat: [0, 0, 0] as Rgb }
    expect(composerLeCorps(BLANC, platNul, 0, 1.5)).toEqual([0.75, 0.75, 0.75])
    expect(composerLeCorps(BLANC, platNul, 0, 4)).toEqual([1, 1, 1]) // 0,5 × 4 = 2, écrêté à 1
  })

  it('LE TOTAL EST ÉCRÊTÉ À 1 AUSSI — deux termes à 1 chacun ne font pas 2', () => {
    const p = { astre: [1, 1, 1] as Rgb, feu: [1, 1, 1] as Rgb, plat: [0, 0, 0] as Rgb }
    expect(composerLeCorps(BLANC, p, 1, 1)).toEqual([1, 1, 1])
  })

  /**
   * RIEN NE PEUT DEVENIR NÉGATIF, ET C'EST UNE PROPRIÉTÉ. Le harnais des planches, lui, comptait des
   * `negatifs` (run 42 : 7 371 pixels au noir sur le mur sud) — ils venaient tous de sa soustraction
   * `base − corpsD`. La passe vraie rebâtit le pixel depuis ses parts et n'a pas cette branche.
   */
  it('AUCUN CANAL NE SORT DE [0, 1], SUR TOUT LE DOMAINE', () => {
    let cas = 0
    for (const mn of MN)
      for (const s of S)
        for (const a of A)
          for (const light of L)
            for (const texel of [[0, 0, 0], [0.2, 0.5, 0.9], [1, 1, 1]] as Rgb[])
              for (const f of [0, 1, 7]) {
                const out = composerLeCorps(texel, parts(mn, s, a, light, light), f, f)
                for (let c = 0; c < 3; c++) {
                  expect(out[c]!).toBeGreaterThanOrEqual(0)
                  expect(out[c]!).toBeLessThanOrEqual(1)
                }
                cas++
              }
    expect(cas).toBe(MN.length * S.length * A.length * L.length * 3 * 3)
  })

  it('UN DESSUS COMPOSE SANS SON FEU DIRECT (LG-R16) — et reste plus sombre qu’une face au même endroit', () => {
    const p = parts([0.35, 0.36, 0.42], 0, 0.42, [0.4, 0.32, 0.22], [0.3, 0.24, 0.16])
    const face = composerLeCorps(BLANC, p, 1, 1)
    const dessus = composerLeCorps(BLANC, sansFeuDirect(p), 1, 1)
    for (let c = 0; c < 3; c++) expect(dessus[c]!).toBeLessThan(face[c]!)
  })
})

describe('la courbe de l’ambiante', () => {
  it('EST CELLE DU JEU — redéclarée, jamais recopiée (motif de `reglages.ts:47`)', async () => {
    // L'import est DYNAMIQUE : `dynamic-lighting.ts` tire Phaser, et l'oracle doit rester jouable sans
    // lui. Si l'import échoue dans cet environnement, le test le DIT au lieu de passer au vert en creux.
    const mod = await import('../../scenes/world/dynamic-lighting').catch(() => null)
    expect(mod, 'dynamic-lighting doit être importable pour que cette garde prouve quelque chose').not.toBeNull()
    for (const day of [0, 0.05, 0.1, 0.15, 0.2, 0.5, 0.9, 1])
      for (const lueur of [0, 0.25, 0.5, 1])
        expect(ambianteDeLHeure(day, lueur)).toBe(mod!.ambianteDuCiel(day, lueur))
  })

  it('DESCEND LA NUIT ET MONTE LE JOUR', () => {
    const nuit = luminanceDuVoile(rgbDeCouleur(ambianteDeLHeure(0, 1)))
    const jour = luminanceDuVoile(rgbDeCouleur(ambianteDeLHeure(1, 1)))
    expect(jour).toBeGreaterThan(nuit)
    expect(ambianteDeLHeure(1, 1)).toBe(AMBIANTE.JOUR)
  })

  it('SANS LUNE, LA NUIT EST PLUS SOMBRE QU’À LA PLEINE LUNE', () => {
    const pleine = luminanceDuVoile(rgbDeCouleur(ambianteDeLHeure(0, 1)))
    const sans = luminanceDuVoile(rgbDeCouleur(ambianteDeLHeure(0, 0)))
    expect(sans).toBeLessThan(pleine)
  })
})
