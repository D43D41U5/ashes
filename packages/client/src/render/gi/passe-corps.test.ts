/**
 * ═══ LA GARDE DE L'ASSEMBLAGE (LG-R7, LG-R16, LG-A8) ═══
 *
 * Les trois lois assemblées ici sont éprouvées chez elles (`sol-du-corps.test.ts`,
 * `corps-ref.test.ts`) : ce fichier ne les rejuge pas. Il éprouve L'ORDRE et LES POINTS DE LECTURE —
 * ce qu'un assemblage peut casser sans qu'aucune loi ne bouge.
 *
 * Le `lire` des épreuves ENREGISTRE ses appels : c'est la seule façon de dire OÙ la passe est allée
 * chercher, et c'est précisément ce qui se perd en silence quand on recâble.
 */
import { describe, expect, it } from 'vitest'
import { EDGE_E, EDGE_N, EDGE_S } from '@ashes/sim'
import { MUR_HT } from '../bati-art'
import { DEMI_BANDE_TUILES, TILE_PX } from '../framing'
import type { Rgb } from './corps-ref'
import { estNonTrivial, pixelDuCorps, type CielDeLHeure, type LectureDuChamp, type SourcesDuPixel } from './passe-corps'
import { hauteurDeCrete, ligneDuPied, type CorpsPose, type Normale } from './sol-du-corps'

const M = DEMI_BANDE_TUILES * TILE_PX
const HAUT_DU_CADRE = MUR_HT + TILE_PX + M
const LIGNE = 800
const rang = (r: number): number => LIGNE - HAUT_DU_CADRE + r
const mur = (arete: number): CorpsPose => ({ x: 400, y: LIGNE, arete, famille: 'wall-bois' })

/** Les sources du jeu, aux hauteurs de `dynamic-lighting.ts` (`SUN_Z`, et `TILE_PX × 0,6` pour le feu). */
const SOURCES: SourcesDuPixel = {
  astre: { x: 900, y: 200, z: 620 },
  feu: { x: 440, y: LIGNE + 48, z: TILE_PX * 0.6 },
}
const CIEL: CielDeLHeure = { mn: [0.35, 0.36, 0.42], a: 0.42, ambiante: 1e9 }
const TEXEL: Rgb = [0.5, 0.42, 0.32]
const PLAT: Normale = { x: 0, y: 0, z: 1 }
const VERS_LE_SUD: Normale = { x: 0, y: 1, z: 0 }

/** Un champ constant, et le carnet de ce qu'on lui a demandé. */
function champ(valeur?: Partial<LectureDuChamp>): {
  lire: (x: number, y: number) => LectureDuChamp
  appels: { x: number; y: number }[]
} {
  const appels: { x: number; y: number }[] = []
  const v: LectureDuChamp = {
    light: [0.4, 0.32, 0.22],
    directFace: [0.3, 0.24, 0.16],
    ombre: 0,
    ...valeur,
  }
  return { lire: (x, y) => { appels.push({ x, y }); return v }, appels }
}

describe('les points de lecture de la passe (LG-R7)', () => {
  it('UNE FACE LIT SOUS SON PIXEL, PUIS SON FEU AU PIED — ET LE PIED EST À `c.x`, PAS À `xw`', () => {
    const c = mur(EDGE_S)
    const { lire, appels } = champ()
    const xw = c.x + 37
    const px = pixelDuCorps(c, xw, rang(40), lire, CIEL, SOURCES, TEXEL, VERS_LE_SUD)
    expect(px.ou).toBe('auPied')
    // Deux lectures, et deux seulement : le pixel, puis le pied du sprite.
    expect(appels).toEqual([{ x: xw, y: LIGNE }, { x: c.x, y: LIGNE }])
  })

  it('UN DESSUS LIT UNE HAUTEUR DE CRÊTE PLUS BAS, ET NE LIT PAS SON FEU DU TOUT (LG-R16)', () => {
    const c = mur(EDGE_S)
    const { lire, appels } = champ()
    const yw = rang(17) // un rang de coiffe
    const px = pixelDuCorps(c, 7, yw, lire, CIEL, SOURCES, TEXEL, PLAT)
    expect(px.ou).toBe('nul')
    expect(appels).toEqual([{ x: 7, y: yw + hauteurDeCrete(c) }])
  })

  it('UN CORPS SANS FACE LIT SOUS SON PIXEL, UNE SEULE FOIS (E)', () => {
    const roche: CorpsPose = { x: 400, y: LIGNE, arete: 0 }
    const { lire, appels } = champ()
    const px = pixelDuCorps(roche, 12, LIGNE - 9, lire, CIEL, SOURCES, TEXEL, PLAT)
    expect(px.ou).toBe('sousLePixel')
    expect(appels).toEqual([{ x: 12, y: LIGNE }])
  })

  it('UN PIGNON NORD LIT SA BANDE, UNE TUILE AU-DESSUS DE SON ANCRAGE', () => {
    const c = mur(EDGE_N)
    const { lire, appels } = champ()
    pixelDuCorps(c, 7, rang(20), lire, CIEL, SOURCES, TEXEL, VERS_LE_SUD)
    expect(appels[0]).toEqual({ x: 7, y: LIGNE - TILE_PX })
    expect(appels[1]).toEqual({ x: c.x, y: ligneDuPied(c) })
  })

  /**
   * LG-R14 — sur une terrasse le sprite est DESSINÉ `lift` px plus haut que sa tuile ; le fragment
   * l'est donc aussi, et la loi le remonte avant de juger. Un mur de terrasse compose EXACTEMENT
   * comme le même mur au sol vu du même pixel logique : mêmes lectures, mêmes branches, même pixel.
   * Avant ce pas, le mur tombait tout entier sous son seuil (un dessus de haut en bas — MESURÉ, lift 32).
   */
  it('SUR UN PALIER, LE FRAGMENT DESSINÉ SE LIT À SA PLACE LOGIQUE — le même pixel qu’au sol (LG-R14)', () => {
    const sol = mur(EDGE_S)
    const haut: CorpsPose = { ...sol, lift: 32 }
    for (const [rangLogique, normale] of [[40, VERS_LE_SUD], [17, PLAT]] as const) {
      const auSol = champ()
      const enHaut = champ()
      const xw = sol.x + 5
      const pSol = pixelDuCorps(sol, xw, rang(rangLogique), auSol.lire, CIEL, SOURCES, TEXEL, normale)
      const pHaut = pixelDuCorps(haut, xw, rang(rangLogique) - 32, enHaut.lire, CIEL, SOURCES, TEXEL, normale)
      expect(pHaut.ou).toBe(pSol.ou)
      expect(enHaut.appels).toEqual(auSol.appels)
      expect(pHaut.rgb).toEqual(pSol.rgb)
    }
    // Et les deux rangs éprouvent bien les deux branches : une face, puis un dessus.
    expect(pixelDuCorps(haut, 7, rang(40) - 32, champ().lire, CIEL, SOURCES, TEXEL, VERS_LE_SUD).ou).toBe('auPied')
    expect(pixelDuCorps(haut, 7, rang(17) - 32, champ().lire, CIEL, SOURCES, TEXEL, PLAT).ou).toBe('nul')
    // Jugé DESSINÉ, le rang 40 serait un dessus : c'est le défaut mesuré, tenu ici pour qu'il ne revienne pas.
    expect(pixelDuCorps(sol, 7, rang(40) - 32, champ().lire, CIEL, SOURCES, TEXEL, VERS_LE_SUD).ou).toBe('nul')
  })

  it('SANS FEU DANS LA SCÈNE, RIEN NE S’ORIENTE ET RIEN NE LÈVE', () => {
    const c = mur(EDGE_S)
    const { lire, appels } = champ()
    const px = pixelDuCorps(c, 7, rang(40), lire, CIEL, { astre: SOURCES.astre, feu: null }, TEXEL, VERS_LE_SUD)
    expect(px.ou).toBe('sousLePixel')
    expect(px.fFeu).toBe(0)
    expect(appels).toHaveLength(1)
    for (const v of px.rgb) expect(v).toBeGreaterThan(0) // l'astre, lui, éclaire encore
  })
})

/**
 * LA TENSION DE LA PLANCHE 8, TENUE : *« un facteur par SOURCE et par sprite, lu sous le pied ;
 * seule la normale module au pixel »*. Les deux moitiés doivent se voir séparément — sinon un
 * recâblage qui ferait suivre le pied au pixel passerait au vert.
 */
describe('la part est PAR SPRITE, la normale AU PIXEL', () => {
  const c = mur(EDGE_S)

  it('LA PART DU FEU SE LIT AU MÊME ENDROIT TOUT LE LONG DE LA FACE', () => {
    for (const dx of [0, 13, -21, 60]) {
      const { lire, appels } = champ()
      pixelDuCorps(c, c.x + dx, rang(40), lire, CIEL, SOURCES, TEXEL, VERS_LE_SUD)
      expect(appels[1], `dx=${dx}`).toEqual({ x: c.x, y: LIGNE })
    }
  })

  /**
   * ⚠ CE QUE CE TEST M'A APPRIS EN ROUGISSANT, ET QUI EST LA RÈGLE — PAS UN DÉFAUT.
   *
   * J'attendais que le facteur varie le long de la face. Il ne varie pas, et c'est exact : avec une
   * normale constante `n = (0, 1, 0)`, `max(0, n·d)/z` se réduit à `(s.y − p.y)/s.z` — **le `x`
   * disparaît**. Le gain d'obliquité (`n·ℓ` grandit quand on s'approche) et la perte de distance
   * (`|d|` rapetisse) s'annulent EXACTEMENT, parce que `g = |d|/z` est précisément ce qui les
   * annule. C'est la phrase de LG-R7 : *« sans atténuation avec la distance (la GI la porte déjà) »*.
   *
   * Ce qui module au pixel, c'est donc LA NORMAL MAP, et rien d'autre. À retenir avant de lire une
   * capture : un mur au relief plat sera uni sous une source, et ce ne sera pas un bug.
   */
  it('À NORMALE CONSTANTE, LE FACTEUR NE VARIE PAS LE LONG DE LA FACE — l’annulation est EXACTE', () => {
    const f = (dx: number): number =>
      pixelDuCorps(c, c.x + dx, rang(40), champ().lire, CIEL, SOURCES, TEXEL, VERS_LE_SUD).fFeu
    const attendu = (SOURCES.feu!.y - LIGNE) / SOURCES.feu!.z // 48 / 9,6 = 5
    for (const dx of [0, 13, -21, 60, 240]) expect(f(dx), `dx=${dx}`).toBeCloseTo(attendu, 12)
    // Et ce 5 est BIEN au-dessus de 1 : l'écrêtage par terme n'est pas décoratif, il mord ici même.
    expect(attendu).toBeGreaterThan(1)
  })

  it('C’EST LA NORMALE QUI MODULE AU PIXEL — deux normales voisines ne rendent pas la même couleur', () => {
    const rgb = (n: Normale): Rgb =>
      pixelDuCorps(c, c.x, rang(40), champ().lire, CIEL, SOURCES, TEXEL, n).rgb
    const droite: Normale = { x: 0.3, y: 0.95, z: 0 }
    expect(rgb(VERS_LE_SUD)).not.toEqual(rgb(droite))
    // Et une normale qui se relève vers le ciel prend MOINS du feu, qui est bas, et PLUS de l'astre.
    const relevee = pixelDuCorps(c, c.x, rang(40), champ().lire, CIEL, SOURCES, TEXEL, { x: 0, y: 0.2, z: 0.98 })
    const plein = pixelDuCorps(c, c.x, rang(40), champ().lire, CIEL, SOURCES, TEXEL, VERS_LE_SUD)
    expect(relevee.fFeu).toBeLessThan(plein.fFeu)
    expect(relevee.fAstre).toBeGreaterThan(plein.fAstre)
  })
})

describe('le dessus contre la face (LG-R16)', () => {
  it('UN DESSUS EST PLUS SOMBRE QU’UNE FACE AU MÊME ENDROIT, MAIS PAS NOIR — le rebond lui reste', () => {
    const c = mur(EDGE_S)
    const dessus = pixelDuCorps(c, c.x, rang(17), champ().lire, CIEL, SOURCES, TEXEL, PLAT)
    const face = pixelDuCorps(c, c.x, rang(40), champ().lire, CIEL, SOURCES, TEXEL, PLAT)
    expect(dessus.ou).toBe('nul')
    expect(face.ou).toBe('auPied')
    for (let k = 0; k < 3; k++) {
      expect(dessus.rgb[k]!).toBeLessThan(face.rgb[k]!)
      expect(dessus.rgb[k]!).toBeGreaterThan(0)
    }
  })

  it('UN RUBAN EST DESSUS SUR TOUS SES RANGS — son art, pas sa géométrie', () => {
    const c = mur(EDGE_E)
    for (const r of [0, 10, 25, 51])
      expect(pixelDuCorps(c, c.x, rang(r), champ().lire, CIEL, SOURCES, TEXEL, PLAT).ou, `rang ${r}`).toBe('nul')
  })
})

/**
 * LE COMPTEUR DE PRÉMISSE — c'est LUI qui empêche un verdict vert de ne rien dire. Sur un dessus
 * plat, `facteurDeNormale` rend EXACTEMENT 1 : le terme de normale est muet. Une garde qui ne
 * comparerait que des dessus serait propre sans avoir éprouvé `g` une seule fois.
 */
describe('le compteur de prémisse de la passe', () => {
  const c = mur(EDGE_S)

  it('UN DESSUS PLAT EST TRIVIAL — les deux facteurs valent 1 au bit près', () => {
    const px = pixelDuCorps(c, c.x, rang(17), champ().lire, CIEL, SOURCES, TEXEL, PLAT)
    expect(px.fAstre).toBe(1)
    expect(px.fFeu).toBe(1)
    expect(estNonTrivial(px, TEXEL)).toBe(false)
  })

  it('UNE FACE DRESSÉE, ELLE, MET LE TERME À L’ÉPREUVE — le contrôle positif, sans lequel le compteur ne dirait rien', () => {
    const px = pixelDuCorps(c, c.x, rang(40), champ().lire, CIEL, SOURCES, TEXEL, VERS_LE_SUD)
    expect(estNonTrivial(px, TEXEL)).toBe(true)
  })

  it('ET SUR UNE FACE ENTIÈRE, LA MAJORITÉ DES RANGS EST NON TRIVIALE — sinon la garde serait vraie d’un rang', () => {
    let vus = 0
    let eprouves = 0
    for (let r = 20; r < 52; r++) {
      const px = pixelDuCorps(c, c.x + 8, rang(r), champ().lire, CIEL, SOURCES, TEXEL, VERS_LE_SUD)
      vus++
      if (estNonTrivial(px, TEXEL)) eprouves++
    }
    expect(vus).toBe(32)
    expect(eprouves).toBeGreaterThan(16)
  })

  it('UN TEXEL NOIR REND TOUT TRIVIAL — un écart qu’aucun octet ne porte n’éprouve rien', () => {
    const px = pixelDuCorps(c, c.x, rang(40), champ().lire, CIEL, SOURCES, TEXEL, VERS_LE_SUD)
    expect(estNonTrivial(px, [0, 0, 0])).toBe(false)
  })
})
