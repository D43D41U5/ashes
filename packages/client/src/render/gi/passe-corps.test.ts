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
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EDGE_E, EDGE_N, EDGE_S } from '@ashes/sim'
import { MUR_HT } from '../bati-art'
import { DEMI_BANDE_TUILES, TILE_PX } from '../framing'
import { composerM } from './champ-ref'
import type { Rgb } from './corps-ref'
import { avecCeQuOnPorte, estNonTrivial, pixelDuCorps, type CielDeLHeure, type LectureDuChamp, type OracleDuChamp, type PixelDuCorps, type SourcesDuPixel } from './passe-corps'
import { GI } from './reglages'
import { ambianteDeLHeure, luminanceDuVoile, rgbDeCouleur } from './corps-ref'
import { ambientTint, daylight, heureCanonique, lueurDeLune, multiplicateurParCanal, voileDeNuit } from '../lighting'
import { expositionAuFeu, hauteurDeCrete, ligneDuPied, suitLaRegleDesFaces, type CorpsPose, type Normale } from './sol-du-corps'

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

/** Le grain du champ du jeu : 4 px monde par texel (LG-R2), origine à 0 pour que les comptes soient lisibles. */
const GRAIN = { x0: 0, pas: 4 }

/**
 * UN ORACLE, DES DEUX SAMPLERS. `fn` est le champ ; `palierEn` est `gi-paliers`, et sans lui TOUT est
 * du palier 0 — la scène plate d'avant les terrasses, où la garde de palier doit être strictement
 * inerte. C'est le contrôle négatif de toutes les épreuves qui précèdent.
 */
function oracle(fn: (x: number, y: number) => LectureDuChamp, palierEn?: (x: number, y: number) => number): OracleDuChamp {
  return Object.assign(fn, { palier: palierEn ?? ((): number => 0), grain: GRAIN })
}

/** Un champ constant, et le carnet de ce qu'on lui a demandé. */
function champ(valeur?: Partial<LectureDuChamp>): {
  lire: OracleDuChamp
  appels: { x: number; y: number }[]
} {
  const appels: { x: number; y: number }[] = []
  const v: LectureDuChamp = {
    light: [0.4, 0.32, 0.22],
    directFace: [0.3, 0.24, 0.16],
    ombre: 0,
    ...valeur,
  }
  return { lire: oracle((x, y) => { appels.push({ x, y }); return v }), appels }
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

  /**
   * LG-R16 ÉTENDU AU TOIT (Alexis, 2026-09-19, LG-Q13, planche 27 « Le toit sous le ciel » : « Le ciel
   * seul »). Un toit est au-dessus de toute crête : rien du champ ne l'atteint. La passe ne LIT donc
   * rien — ni lumière, ni ombre — et compose le plancher et l'astre entiers. C'est le décalque de
   * `uGiCiel` (`corps-gpu.ts`), que la garde LG-A8 tient face à face avec cette référence.
   */
  it('UN TOIT NE LIT PAS LE CHAMP — ni le feu, ni l’ombre d’astre des murs qu’il coiffe (LG-R16, planche 27)', () => {
    const toit: CorpsPose = { x: 400, y: LIGNE, arete: 0, ciel: true }
    // Un champ « d'enfer » : plein feu sous le toit, et dans l'ombre d'astre d'un mur.
    const enfer = champ({ light: [1, 0.8, 0.5], directFace: [1, 0.8, 0.5], ombre: 1 })
    const px = pixelDuCorps(toit, 12, LIGNE - 40, enfer.lire, CIEL, SOURCES, TEXEL, PLAT)
    expect(enfer.appels).toEqual([])
    expect(px.ou).toBe('sousLePixel')
    // Le même corps sans `ciel`, sous un champ NUL et sans ombre : le même pixel, au bit près.
    const plat: CorpsPose = { x: 400, y: LIGNE, arete: 0 }
    const nul = champ({ light: [0, 0, 0], directFace: [0, 0, 0], ombre: 0 })
    expect(pixelDuCorps(plat, 12, LIGNE - 40, nul.lire, CIEL, SOURCES, TEXEL, PLAT).rgb).toEqual(px.rgb)
    expect(nul.appels).toHaveLength(1)
    // Le contrôle positif : le corps plat SOUS le champ d'enfer rend autre chose — sinon la garde ne tiendrait rien.
    expect(pixelDuCorps(plat, 12, LIGNE - 40, enfer.lire, CIEL, SOURCES, TEXEL, PLAT).rgb).not.toEqual(px.rgb)
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

/**
 * ═══ UN SOL (LG-R14) — le quad de sol, porté là où il ne va pas ═══
 * Une image de terrain d'une strate ≥ 1 (`CorpsPose.sol`) est `texel × M` en UN point : ni parts, ni
 * normale, ni feu au pied. Le miroir GLSL est le bloc `uGiSol` de `corps-gpu.ts` (`pixelDeSol`).
 */
describe('un sol lit le champ à son point (LG-R14)', () => {
  const mParDefaut = (l: LectureDuChamp): Rgb => [
    composerM(CIEL.mn[0], l.ombre, CIEL.a, l.light[0]),
    composerM(CIEL.mn[1], l.ombre, CIEL.a, l.light[1]),
    composerM(CIEL.mn[2], l.ombre, CIEL.a, l.light[2]),
  ]
  const fois = (t: Rgb, m: Rgb): Rgb => [t[0] * m[0], t[1] * m[1], t[2] * m[2]]

  it('TUILE — sous le pixel, à sa place LOGIQUE (le lift retiré), et texel × M sans rien d’autre', () => {
    const c = champ({ ombre: 0.5 })
    const pose: CorpsPose = { x: 400, y: 900, arete: 0, lift: 32, sol: 'tuile' }
    const px = pixelDuCorps(pose, 410.5, 850.5, c.lire, CIEL, SOURCES, TEXEL, VERS_LE_SUD)
    expect(c.appels).toEqual([{ x: 410.5, y: 882.5 }])
    expect(px.ou).toBe('sol')
    expect(px.rgb).toEqual(fois(TEXEL, mParDefaut(c.lire(0, 0))))
    // Une normale plein sud n'y change rien : un sol n'a pas de facteur de normale.
    expect([px.fAstre, px.fFeu]).toEqual([1, 1])
    expect(estNonTrivial(px, TEXEL)).toBe(false)
  })

  it('PIED — à sa ligne, sur toute sa hauteur : deux rangs lisent le même point', () => {
    const c = champ()
    const pose: CorpsPose = { x: 400, y: 900, arete: 0, sol: 'pied' }
    pixelDuCorps(pose, 410.5, 850.5, c.lire, CIEL, SOURCES, TEXEL, PLAT)
    pixelDuCorps(pose, 410.5, 870.5, c.lire, CIEL, SOURCES, TEXEL, PLAT)
    expect(c.appels).toEqual([{ x: 410.5, y: 900 }, { x: 410.5, y: 900 }])
  })

  it('PIED SOUS LE VOILE — divisé par M à la place dessinée : fois le quad, le produit vaut texel × M(pied)', () => {
    const auPied: LectureDuChamp = { light: [0.1, 0.08, 0.05], directFace: [0, 0, 0], ombre: 1 }
    const dessine: LectureDuChamp = { light: [0.6, 0.5, 0.4], directFace: [0.3, 0.2, 0.1], ombre: 0 }
    const appels: number[] = []
    const lire = oracle((_x: number, y: number): LectureDuChamp => { appels.push(y); return y === 900 ? auPied : dessine })
    const pose: CorpsPose = { x: 400, y: 900, arete: 0, sol: 'piedSousLeVoile' }
    const px = pixelDuCorps(pose, 410.5, 850.5, lire, CIEL, SOURCES, TEXEL, PLAT)
    expect(appels).toEqual([900, 850.5])
    const mPied = mParDefaut(auPied)
    const mQuad = mParDefaut(dessine)
    for (let i = 0; i < 3; i++) expect(px.rgb[i]! * mQuad[i]!).toBeCloseTo(TEXEL[i]! * mPied[i]!, 12)
    // Et le contrôle : sans le voile, le même pixel vaut texel × M(pied) tout court — plus sombre.
    const nu = pixelDuCorps({ ...pose, sol: 'pied' }, 410.5, 850.5, lire, CIEL, SOURCES, TEXEL, PLAT)
    expect(nu.rgb).toEqual(fois(TEXEL, mPied))
    expect(nu.rgb[0]).toBeLessThan(px.rgb[0]!)
  })

  it('M LU TEL QUEL L’EMPORTE SUR LA RECOMPOSITION — la garde compare l’octet du quad, pas la loi refaite', () => {
    const c = champ({ m: [0.2, 0.3, 0.4] })
    const pose: CorpsPose = { x: 400, y: 900, arete: 0, sol: 'pied' }
    const px = pixelDuCorps(pose, 410.5, 850.5, c.lire, CIEL, SOURCES, TEXEL, PLAT)
    expect(px.rgb).toEqual(fois(TEXEL, [0.2, 0.3, 0.4]))
  })

  it('UN SOL S’ÉCRÊTE À 1 PAR CANAL — un pied plus clair que son voile ne rend pas plus que le texel', () => {
    const auPied: LectureDuChamp = { light: [1, 1, 1], directFace: [0, 0, 0], ombre: 0 }
    const dessine: LectureDuChamp = { light: [0, 0, 0], directFace: [0, 0, 0], ombre: 1 }
    const lire = oracle((_x: number, y: number): LectureDuChamp => (y === 900 ? auPied : dessine))
    const px = pixelDuCorps({ x: 400, y: 900, arete: 0, sol: 'piedSousLeVoile' }, 410.5, 850.5, lire, CIEL, SOURCES, [0.9, 0.9, 0.9], PLAT)
    expect(px.rgb).toEqual([1, 1, 1])
  })
})

/**
 * ═══ LA GARDE DE PALIER SUR LA LECTURE EN COLONNE (LG-R14) ═══
 *
 * LA SCÈNE : une tuile de palier 1 en `[400, 416)`, sa VOISINE de palier 2 en `[416, 432)` — dessinée
 * 32 px plus haut à l'écran. Un corps posé dans l'angle déborde sur la voisine, et E (« sous le
 * pixel ») lui fait lire, sur sept de ses quatorze colonnes, la lumière d'un sol qui est AU-DESSUS
 * de lui. C'est le défaut mesuré le 2026-09-26 (avatar en 910,94 · 832,08, palier 1, 17 h :
 * `0,559 ×7 · 0,651 ×4 · 0,742 ×3`, σ = 0,073 sur 12 px).
 *
 * ⚠ **CE FICHIER PORTE LES DEUX MOITIÉS, ET IL LE FAUT.** Rendre le sprite uniforme est facile en
 * lisant TOUT à l'ancre — et ce serait rouvrir E, que la planche 9 a ratifiée le 2026-09-16 : la
 * couture verticale au MILIEU d'une tuile est voulue. La seconde moitié (« au centre, rien ne
 * bouge ») est ce qui rougirait sous un correctif qui déborde. Le discriminant, lui, sépare « le
 * texel le plus proche du côté de l'ancre » de « le texel de l'ancre » : les deux coïncident dans la
 * pose mesurée, par accident, et un seul des deux est la loi.
 */
describe('un corps ne lit pas par-dessus une marche (LG-R14)', () => {
  const BORD = 416
  const palierDeuxAuDela = (bord: number) => (x: number): number => (x >= bord ? 2 : 1)

  /**
   * Un champ dont chaque TEXEL porte sa valeur, le carnet des points lus, et celui des valeurs
   * RENDUES — c'est sur ces dernières que se lit le σ du relevé, sans passer par la composition :
   * `facteurDeNormale` fait varier le pixel avec `p.x` de toute façon, et ce n'est pas lui qu'on juge.
   */
  function champDesTexels(valeurs: Record<number, number>, palierEn: (x: number, y: number) => number): {
    lire: OracleDuChamp
    appels: { x: number; y: number }[]
    lues: number[]
  } {
    const appels: { x: number; y: number }[] = []
    const lues: number[] = []
    const lire = oracle((x, y) => {
      appels.push({ x, y })
      const v = valeurs[Math.floor(x / GRAIN.pas)] ?? 0
      lues.push(v)
      return { light: [v, v, v], directFace: [0, 0, 0], ombre: 0 }
    }, palierEn)
    return { lire, appels, lues }
  }

  /** Le corps du relevé : un acteur — `arete` 0, aucune famille — donc ni dressé, ni dessus, ni feu au pied. */
  const acteur = (x: number): CorpsPose => ({ x, y: LIGNE, arete: 0 })
  /** Les 14 colonnes du sprite, au centre de chaque pixel. */
  const colonnes = (gauche: number): number[] => Array.from({ length: 14 }, (_, i) => gauche + i + 0.5)

  it('COLLÉ CONTRE UNE VOISINE PLUS HAUTE — les 14 colonnes lisent le palier du corps, et le sprite sort UNIFORME', () => {
    // Le relevé : t102 et t103 sont la tuile du corps (0,559), t104 et t105 la terrasse du dessus.
    const { lire, appels, lues } = champDesTexels({ 102: 0.559, 103: 0.559, 104: 0.651, 105: 0.742 }, palierDeuxAuDela(BORD))
    const c = acteur(415.04) // l'ancre, à 15,04 px du bord ouest de sa tuile — la pose mesurée
    for (const xw of colonnes(409)) pixelDuCorps(c, xw, LIGNE, lire, CIEL, SOURCES, TEXEL, PLAT)

    // ① AUCUNE LECTURE AU-DELÀ DE LA MARCHE — c'est la loi ; le reste en découle.
    expect(appels.filter((a) => a.x >= BORD)).toEqual([])
    // ② Les 7 colonnes débordantes retombent sur le texel de BORD du corps (t103, centre 414), pas plus loin.
    expect(appels.map((a) => a.x)).toEqual([409.5, 410.5, 411.5, 412.5, 413.5, 414.5, 415.5, 414, 414, 414, 414, 414, 414, 414])
    // ③ LA PRÉDICTION CHIFFRÉE : 14 colonnes à 0,559, σ = 0. Sans la garde, ce même champ rend
    // `0,559 ×7 · 0,651 ×4 · 0,742 ×3` — µ 0,625, σ 0,073 —, qui est le relevé du 26/09 au texel.
    // (Le relevé du 27/09 sur les PIXELS rendus donne 12 colonnes et σ/µ 0,099 → 0,001 ; journal.)
    expect(lues).toEqual(Array(14).fill(0.559))
  })

  it('AU CENTRE DE SA TUILE, RIEN NE BOUGE — la couture de E (planche 9, ratifiée) reste', () => {
    const { lire, appels, lues } = champDesTexels({ 100: 0.5, 101: 0.52, 102: 0.559, 103: 0.58 }, palierDeuxAuDela(BORD))
    const c = acteur(408)
    const xs = colonnes(401)
    for (const xw of xs) pixelDuCorps(c, xw, LIGNE, lire, CIEL, SOURCES, TEXEL, PLAT)

    // ① Le point lu est le point du pixel, INCHANGÉ : la garde n'a rien déplacé.
    expect(appels.map((a) => a.x)).toEqual(xs)
    // ② Et le corps reste dégradé sur ses quatre texels — quatre valeurs distinctes, pas une. C'est
    // la couture de E, et un correctif qui lirait tout à l'ancre la ferait tomber à 1.
    expect(new Set(lues).size).toBe(4)
  })

  it('DISCRIMINANT — on retombe sur le texel le plus proche DU CÔTÉ de l’ancre, pas sur celui de l’ancre', () => {
    // t102 est le texel de l'ANCRE, t103 le texel de BORD : deux valeurs bien distinctes.
    const { lire, appels, lues } = champDesTexels({ 102: 0.4, 103: 0.559, 104: 0.9 }, palierDeuxAuDela(BORD))
    const c = acteur(410) // au milieu de sa tuile, mais un corps large déborde quand même
    pixelDuCorps(c, 417.5, LIGNE, lire, CIEL, SOURCES, TEXEL, PLAT)

    expect(appels.map((a) => a.x)).toEqual([414]) // le centre de t103, jamais 410 (l'ancre) ni 417,5 (le débord)
    expect(lues).toEqual([0.559])
  })

  it('ELLE DÉPLACE LA LECTURE, PAS LA GÉOMÉTRIE — le `g` d’une colonne débordante ne gèle pas', () => {
    // Une normale INCLINÉE et un feu au ras du sol (z = 9,6) : c'est le régime où quelques pixels
    // de x déplacent `g` pour de bon. Si la garde emportait `g` avec la lecture, les colonnes
    // débordantes prendraient toutes le `g` du texel de bord — un APLAT au milieu du sprite, le
    // palier que la directive de feel refuse. Ici les deux `g` restent ceux de leurs pixels.
    const N: Normale = { x: 0.6, y: 0.5, z: 0.62 }
    const { lire } = champDesTexels({ 102: 0.559, 103: 0.559, 104: 0.651 }, palierDeuxAuDela(BORD))
    const sansMarche = champDesTexels({ 102: 0.559, 103: 0.559, 104: 0.651 }, () => 1)
    const c = acteur(415.04)
    for (const xw of [417.5, 421.5]) {
      const garde = pixelDuCorps(c, xw, LIGNE, lire, CIEL, SOURCES, TEXEL, N)
      const libre = pixelDuCorps(c, xw, LIGNE, sansMarche.lire, CIEL, SOURCES, TEXEL, N)
      expect(garde.fFeu, `fFeu en ${xw}`).toBe(libre.fFeu)
      expect(garde.fAstre, `fAstre en ${xw}`).toBe(libre.fAstre)
    }
    // Le contrôle positif : ces deux colonnes n'ont PAS le même `g` — sinon l'égalité ne dirait rien.
    const a = pixelDuCorps(c, 417.5, LIGNE, lire, CIEL, SOURCES, TEXEL, N)
    const b = pixelDuCorps(c, 421.5, LIGNE, lire, CIEL, SOURCES, TEXEL, N)
    expect(a.fFeu).not.toBe(b.fFeu)
  })

  it('LA MARCHE EST BORNÉE À UNE TUILE — au-delà, l’ancre ; et sans palier dans la scène, la garde est INERTE', () => {
    // Six texels de palier 2 d'affilée : la marche de 4 texels n'atteint jamais le palier 1, on retombe sur l'ancre.
    const loin = champDesTexels({ 102: 0.4, 108: 0.9 }, palierDeuxAuDela(412))
    pixelDuCorps(acteur(410), 434.5, LIGNE, loin.lire, CIEL, SOURCES, TEXEL, PLAT)
    expect(loin.appels.map((a) => a.x)).toEqual([410]) // le centre de t102, celui de l'ancre

    // LE CONTRÔLE NÉGATIF : le même corps, la même colonne, mais une scène SANS marches (`gi-paliers`
    // tout à zéro — un creux, ou un monde sans relief). La garde ne doit alors rien déplacer du tout.
    const plate = champDesTexels({ 102: 0.4, 108: 0.9 }, () => 0)
    pixelDuCorps(acteur(410), 434.5, LIGNE, plate.lire, CIEL, SOURCES, TEXEL, PLAT)
    expect(plate.appels.map((a) => a.x)).toEqual([434.5])
  })
})

/**
 * ═══ B-R13d — UN PORTEUR EST ÉCLAIRÉ PAR CE QU'IL PORTE ═══
 *
 * *« Non le personnage est sombre comme s'il n'était pas éclairé »* (Alexis, 2026-10-05), sur un
 * porteur de braise PLEINE, de nuit, debout dans sa propre flaque. La chaîne était branchée et
 * juste — le défaut était que le CORPS ne lit que le champ, qui plafonne au pic d'effacement du
 * voile (`profilFeu(0)` = 0,62) et où une lumière portée ne pèse que sa force (0,5).
 *
 * ⚠ **CE QUE LA SUITE PROUVAIT AVANT CE BLOC : RIEN.** Les 1866 gardes du client sont restées
 * vertes à la livraison du plancher, et c'était NORMAL — aucune ne pose `soi`, donc toutes
 * éprouvaient `soi = 0`, c'est-à-dire l'inertie. Une loi dont toute la couverture est l'inertie
 * n'est pas gardée : elle est seulement inoffensive.
 */
describe('B-R13d — le plancher de ce qu’on porte, sous le pixel du corps', () => {
  it('⑯ C’EST UN `max` PAR CANAL, INERTE À VIDE, ET IL MONTE À `TEINTE_FEU × soi`', () => {
    const noir: Rgb = [0, 0, 0]
    // INERTE : pas de braise, braise vide, et un `soi` absent (une façade d'avant B-R13d).
    expect(avecCeQuOnPorte(noir, 0)).toBe(noir) // LA MÊME RÉFÉRENCE : zéro travail, zéro allocation
    expect(avecCeQuOnPorte(noir, undefined)).toBe(noir)
    const champLu: Rgb = [0.4, 0.32, 0.22]
    expect(avecCeQuOnPorte(champLu, 0)).toBe(champLu)
    // IL MONTE À LA CLARTÉ DE L'AUTORITÉ, POSÉE À LA TEINTE DE LA FLAMME — et c'est bien un
    // plancher SCALAIRE : canal par canal divisé par sa teinte, on retrouve `soi` exactement.
    for (const soi of [1, 0.75, 0.5, 0.25, 0.05]) {
      const r = avecCeQuOnPorte(noir, soi)
      expect(r[0] / GI.TEINTE_FEU[0]).toBeCloseTo(soi, 12)
      expect(r[1] / GI.TEINTE_FEU[1]).toBeCloseTo(soi, 12)
      expect(r[2] / GI.TEINTE_FEU[2]).toBeCloseTo(soi, 12)
    }
    // ⚠ LA TEINTE EST CELLE D'UN FEU, PAS UN GRIS — c'est la raison pour laquelle le plancher est
    // le terme SUR SOI et non `clarteSurSoiAt` tout entier (voir l'en-tête de `nuit.ts`) : un
    // corps sous la lune prendrait sinon un plancher orange venu du clair de lune.
    expect(GI.TEINTE_FEU[0]).toBeGreaterThan(GI.TEINTE_FEU[2])
    // `max` ET NON SOMME (N1) : un canal déjà plus clair que le plancher ne bouge pas d'un bit.
    const clair: Rgb = [9, 9, 9]
    expect(avecCeQuOnPorte(clair, 1)).toEqual(clair)
    // …et le `max` est PAR CANAL, pas sur la luminance : un champ bleu garde son bleu et gagne le
    // rouge de la flamme. Une garde scalaire aurait laissé passer un plancher qui écrase la teinte.
    const bleu: Rgb = [0, 0, 5]
    const mele = avecCeQuOnPorte(bleu, 1)
    expect(mele[2]).toBe(5)
    expect(mele[0]).toBe(GI.TEINTE_FEU[0])
  })

  it('⑰ SOUS LE PIXEL D’UN ACTEUR, LE CORPS COMPOSE PLUS CLAIR — et la charge le vide toute seule', () => {
    // UN ACTEUR, c'est-à-dire `arete: 0` : la branche E, « lire le champ sous chacun de ses
    // pixels » — la seule que prenne un avatar, un PNJ ou une bête (`snapshot-view.ts`).
    // ⚠ `exactOptionalPropertyTypes` : un `soi: undefined` POSÉ n'est pas la même chose qu'un
    // champ absent — et c'est bien l'absence qu'on éprouve (une façade d'avant B-R13d).
    const acteur = (soi?: number): CorpsPose => (soi === undefined ? { x: 400, y: LIGNE, arete: 0 } : { x: 400, y: LIGNE, arete: 0, soi })
    const nuit: CielDeLHeure = { mn: [0.002, 0.006, 0.022], a: 0, ambiante: 1e9 }
    const noir = champ({ light: [0, 0, 0], directFace: [0, 0, 0] })
    const lum = (c: CorpsPose): number => {
      const px = pixelDuCorps(c, 12, LIGNE - 9, noir.lire, nuit, SOURCES, TEXEL, PLAT)
      expect(px.ou).toBe('sousLePixel') // LA PRÉMISSE : on est bien en branche E
      return (px.rgb[0] + px.rgb[1] + px.rgb[2]) / 3
    }
    // LA PRÉMISSE DU DÉFAUT, AFFIRMÉE : sans plancher, un corps dans un champ noir est noir — et
    // c'est exactement ce qu'Alexis a vu, à ceci près qu'au jeu le champ valait 0,62 × 0,5.
    const sansRien = lum(acteur())
    expect(sansRien).toBeLessThan(0.01)
    expect(lum(acteur(0))).toBe(sansRien) // braise VIDE ≡ pas de braise : AU BIT
    // LA LOI : la charge éclaire, et par marches décroissantes jusqu'au noir.
    let precedent = 1e9
    for (const soi of [1, 0.75, 0.5, 0.25]) {
      const v = lum(acteur(soi))
      expect(v).toBeGreaterThan(sansRien * 10) // il n'est PLUS sombre
      expect(v).toBeLessThan(precedent) // et ça se vide tout seul avec la charge
      precedent = v
    }
    expect(lum(acteur(1))).toBeGreaterThan(0.3) // L'ORDRE DE GRANDEUR MESURÉ : 158,122,67 sur 255
  })

  it('⑱ ÇA NE TOUCHE QUE CE QUI PORTE — un corps sans `soi` dans la MÊME scène ne bouge pas d’un bit', () => {
    // ⚠ C'EST LA TROISIÈME PROMESSE DE L'OPTION CHOISIE PAR ALEXIS (« ne touche que le CORPS »),
    // et la seule qui se prouve ici : les deux autres — le trou du voile et la flaque au sol —
    // n'ont pas de `soi` à passer, et c'est leur garde de source qui le dit (`braise-halo.test.ts`).
    const { lire } = champ()
    const sansSoi: CorpsPose = { x: 400, y: LIGNE, arete: 0 }
    const avant = pixelDuCorps(sansSoi, 12, LIGNE - 9, lire, CIEL, SOURCES, TEXEL, PLAT)
    const porteur: CorpsPose = { ...sansSoi, soi: 1 }
    const apres = pixelDuCorps(porteur, 12, LIGNE - 9, lire, CIEL, SOURCES, TEXEL, PLAT)
    expect(apres.rgb).not.toEqual(avant.rgb) // CONTRÔLE POSITIF : la scène n'est pas inerte
    // Le voisin, relu APRÈS le porteur, est identique au caractère — la loi est locale au pixel.
    expect(pixelDuCorps(sansSoi, 12, LIGNE - 9, lire, CIEL, SOURCES, TEXEL, PLAT).rgb).toEqual(avant.rgb)
    // ⚠ **ET CE QUI SUIT EST UN CONSTAT, PAS UNE PRESCRIPTION — c'est cette garde qui a démenti
    // mon en-tête.** J'avais écrit que le plancher « ne s'applique qu'en branche E, la branche
    // `auPied` d'une face dressée ne le voit pas » : **FAUX**. Il se pose en ②bis, sur la lecture
    // du champ, donc AVANT que la branche du feu direct ne soit choisie — une face dressée à qui
    // on poserait un `soi` monterait elle aussi, et un corps sous le ciel seul (`ciel: true`)
    // également, bien que son champ soit nul.
    //
    // Ce qui restreint vraiment la loi aux ACTEURS n'est pas ici, c'est l'ALIMENTATION : seul
    // `snapshot-view.ts` écrit un `soi`, et seulement sur la pose d'un acteur (garde de source
    // dans `braise-halo.test.ts`). L'écrire juste importe : le croire local au pixel ferait
    // chercher la restriction dans le mauvais fichier le jour où du bâti portera une lumière.
    const face = pixelDuCorps({ ...mur(EDGE_S), soi: 1 }, 437, rang(40), lire, CIEL, SOURCES, TEXEL, VERS_LE_SUD)
    expect(face.ou).toBe('auPied')
    expect(face.rgb).not.toEqual(pixelDuCorps(mur(EDGE_S), 437, rang(40), lire, CIEL, SOURCES, TEXEL, VERS_LE_SUD).rgb)
    const toit: CorpsPose = { x: 400, y: LIGNE, arete: EDGE_S, famille: 'wall-bois', ciel: true }
    expect(pixelDuCorps({ ...toit, soi: 1 }, 12, rang(17), lire, CIEL, SOURCES, TEXEL, PLAT).rgb)
      .not.toEqual(pixelDuCorps(toit, 12, rang(17), lire, CIEL, SOURCES, TEXEL, PLAT).rgb)
  })

  it('⑲ POURQUOI IL PASSE PAR UNE PORTE DE NUIT — à midi, sans elle, il APLATIT le modelé du soleil', () => {
    // ⚠ **CETTE CLAUSE EXISTE PARCE QUE J'ALLAIS LIVRER SANS LA PORTE, ET QU'ELLE EST MESURÉE.**
    // `soi` ne dépend d'aucune heure (`clarteDeCeQuOnPorte` ne lit que la torche et la braise), et
    // tout avatar naît avec une braise PLEINE : sans porte, le plancher serait à son maximum en
    // plein midi. Les quatre autres couches de lumière portée, elles, sont toutes gatées par la
    // nuit (`forceDeBraise` = `1 − day` × …, `torcheHoleRadius` × nuit, `jour = sousTerre ? 0 : day`).
    //
    // **CE QUI SE PASSE SANS PORTE, ET CE N'EST PAS UN SUR-ÉCLAIRAGE** : `partsDuCorps` compose
    // `m = 1 − (1 − x)(1 − l)`, qui **sature déjà à 1** sous un ciel plein — donc sur une normale
    // PLATE le pixel est identique au bit, et c'est ce qui rendait le défaut invisible à ⑯⑰⑱.
    // Mais `sigma = m / (x + l)` **rétrécit** quand `l` monte, et la part de l'ASTRE se contracte
    // au profit du PLAT : le modelé du soleil s'efface. Dans les DEUX sens, ce qui est le plus
    // mauvais signe — la face à l'ombre se remplit, la face au soleil **s'assombrit**.
    const h = heureCanonique(12)
    const amb = ambientTint(h)
    const lueur = lueurDeLune(h, 7)
    const mn = multiplicateurParCanal(voileDeNuit(amb, lueur))
    // `a` = `SHADOW_ALPHA × forceOmbre` dans `WorldScene` ; 0,42 est `SHADOW_ALPHA` relu à la
    // source (`world/contact-shadow.ts`), qu'on ne peut pas importer ici — il tire Phaser.
    const midi: CielDeLHeure = { mn: [mn[0], mn[1], mn[2]], a: 0.42, ambiante: luminanceDuVoile(rgbDeCouleur(ambianteDeLHeure(daylight(h), lueur))) }
    expect(daylight(h)).toBe(1) // LA PRÉMISSE : c'est bien le plein jour
    expect(mn[0]).toBeCloseTo(1, 6) // …et le voile de nuit est levé, donc `x` sature
    const noir = champ({ light: [0, 0, 0], directFace: [0, 0, 0] })
    const soleil: SourcesDuPixel = { astre: { x: 900, y: 200, z: 620 }, feu: null }
    const px = (soi: number | undefined, n: Normale): PixelDuCorps =>
      pixelDuCorps(soi === undefined ? { x: 400, y: LIGNE, arete: 0 } : { x: 400, y: LIGNE, arete: 0, soi }, 12, LIGNE - 9, noir.lire, midi, soleil, TEXEL, n)
    // ① NORMALE PLATE : identique à 10⁻¹⁵ — ⚠ **et PAS au bit, ce que j'avais écrit** : la
    // saturation (`m = 1`, donc `sigma × (x + l) = x + l`) est exacte dans ℝ et **fausse en
    // IEEE754** ; résidu MESURÉ **5,5 × 10⁻¹⁷** sur le bleu, soit 1,4 × 10⁻¹⁴ de niveau sur 255.
    // C'est la même leçon que `f × (1 − d/(R₀×f)) = f − d/R₀` (audit du 2026-10-05) : une
    // identité algébrique n'est pas une identité flottante. Rien à l'œil, mais l'ÉNONCÉ compte.
    for (let c = 0; c < 3; c++) expect(px(1, PLAT).rgb[c]!).toBeCloseTo(px(undefined, PLAT).rgb[c]!, 15)
    expect(px(1, PLAT).fAstre).toBe(1) // la prémisse de l'angle mort : le facteur ne module pas
    // ② NORMALE À L'OMBRE DU SOLEIL : la moitié sombre SE REMPLIT (×1,334 MESURÉ).
    const ombre: Normale = { x: -1, y: 0.3, z: 0.4 }
    expect(px(undefined, ombre).fAstre).toBe(0) // PRÉMISSE : cette face ne voit pas l'astre
    const lOmbre = (p: PixelDuCorps): number => (p.rgb[0] + p.rgb[1] + p.rgb[2]) / 3
    expect(lOmbre(px(1, ombre)) / lOmbre(px(undefined, ombre))).toBeGreaterThan(1.2)
    // ③ ET LE PIRE : NORMALE AU SOLEIL, LE PLANCHER ASSOMBRIT (×0,873 MESURÉ). Un plancher qui
    // SOUSTRAIT de la lumière en plein jour est faux dans n'importe quelle lecture de N2bis.
    const auSoleil: Normale = { x: 0.5, y: -0.5, z: 0.7 }
    expect(px(undefined, auSoleil).fAstre).toBeGreaterThan(1) // PRÉMISSE : cette face prend le soleil
    expect(lOmbre(px(1, auSoleil))).toBeLessThan(lOmbre(px(undefined, auSoleil)))
    // ④ LA PORTE, ELLE, EST DANS `WorldScene` — garde de SOURCE, parce que la quantité se lit sur
    // la façade d'état du client et qu'un facteur retiré compile sans un mot.
    //
    // ⚠ **ET CE N'EST PAS `1 − day`, QUE J'AVAIS ÉCRIT D'ABORD** (relevé par `determinisme-sim`,
    // MESURÉ) : `partDuCiel` ne rend 1 qu'à **ciel ouvert**. Sous un toit ou dans une maison à
    // midi il rend **0**, donc le terme sur soi PORTE dans `/sim` — clarté **0,9722** avec une
    // braise pleine contre **0** sans rien, parade rendue — là où `1 − day` mettait l'écran à 0,
    // c'est-à-dire **plus sombre que l'autorité sous tout abri**. La porte juste se DÉRIVE du
    // `max` de la sim : *ce que la lumière portée ajoute au-delà du ciel*, `porte − ciel`.
    const ws = readFileSync(new URL('../../scenes/WorldScene.ts', import.meta.url), 'utf8')
    expect(ws).toContain('const soi = porte - ciel')
    expect(ws).toContain('cielDeLHeure * partDuCiel(gel, Math.floor(e.x), Math.floor(e.y), niveauDuCorps(gel.map, e))')
    // …et la clause souterraine à part est PARTIE, parce qu'elle est subsumée (`partDuCiel` = 0
    // sous la roche). Qu'elle ne revienne pas : deux portes pour une loi, c'est la divergence.
    expect(ws).not.toContain('nuitDuPorte')
  })

})

/**
 * ═══ R2 — UNE CIME NE PREND AUCUNE OMBRE D'ASTRE (2026-10-09) ═══
 *
 * LE DÉFAUT. Un houppier est posé en branche E (`arete: 0`, `snapshot-view.ts`) : chaque pixel lit
 * le champ à LA LIGNE DU PIED DE SON TRONC, quatre-vingt-seize pixels plus bas — et `ombreDesCartes`
 * (LG-R8) projette la silhouette de ce même arbre AUTOUR DE CE MÊME PIED. À midi la carte couvre
 * son propre pied : la cime se lisait DANS SA PROPRE OMBRE.
 *
 * ⚠ **CE QUI FERAIT ROUGIR CES GARDES, ÉNONCÉ AVANT DE LES ÉCRIRE.** La ① est le CONTRÔLE POSITIF
 * et c'est elle qui porte tout : sans le drapeau, deux normales dont les facteurs d'astre diffèrent
 * (1,000 et 1,594) doivent rendre EXACTEMENT le même pixel — si cet écart n'était pas nul, il n'y
 * aurait pas de défaut et le correctif serait inutile. La ③ est le contrôle d'inertie : hors carte,
 * le drapeau ne doit rien changer AU BIT, sinon il touche autre chose que `S`.
 *
 * ⚠ **ET LE FEU EST RETIRÉ DU MONTAGE, PARCE QUE MA PREMIÈRE VERSION NE POUVAIT PAS ÉCHOUER** : avec
 * la source de feu de ce fichier, l'écart entre les deux normales valait 0,382663 sous la carte
 * contre 0,308129 hors carte — plus GRAND, et jamais nul. La part du feu n'est pas gatée par `S`
 * (`pFeu = sigma × df`) : elle masquait entièrement la perte de modelé qu'on prétend mesurer.
 */
describe('R2 — une cime ne lit pas l’ombre d’astre du sol', () => {
  /** Le houppier d'un arbre, tel que `snapshot-view.ts` le pose : branche E, sans face ni dessus. */
  const houppier = (cime: boolean): CorpsPose => ({ x: 400, y: LIGNE, arete: 0, lift: 0, ...(cime ? { cime: true as const } : {}) })
  /** Sans feu : `S` ne gate QUE l'astre, donc c'est le seul montage où la perte de modelé se voit. */
  const SANS_FEU: SourcesDuPixel = { astre: SOURCES.astre, feu: null }
  const VERS_ASTRE: Normale = { x: 0.6, y: -0.6, z: 0.53 }
  const lu = (cime: boolean, ombre: number, n: Normale): PixelDuCorps =>
    pixelDuCorps(houppier(cime), 400, LIGNE - 96, champ({ ombre }).lire, CIEL, SANS_FEU, TEXEL, n)

  it('① LE CONTRÔLE POSITIF — sous sa propre carte et SANS le drapeau, la cime est plate AU BIT', () => {
    const plat = lu(false, 1, PLAT)
    const astre = lu(false, 1, VERS_ASTRE)
    // PRÉMISSE : les deux normales ne reçoivent PAS la même part d'astre. Sans ça, l'égalité qui
    // suit serait vraie pour une raison qui n'a rien à voir avec l'ombre.
    expect(plat.fAstre).toBeCloseTo(1, 6)
    expect(astre.fAstre).toBeGreaterThan(1.5)
    // LE DÉFAUT, GELÉ : deux faces d'orientation différente, le même pixel, à la virgule.
    expect(astre.rgb).toEqual(plat.rgb)
    expect(plat.rgb[0]).toBeCloseTo(0.131099, 6)
  })

  it('② LA LOI — avec le drapeau, le modelé revient et le pixel est celui d’une cime au soleil', () => {
    const plat = lu(true, 1, PLAT)
    const astre = lu(true, 1, VERS_ASTRE)
    expect(astre.rgb).not.toEqual(plat.rgb)
    // Les nombres sont GELÉS ici, et non recalculés depuis `partsDuCorps` : une garde qui refait le
    // calcul de la chose qu'elle juge est verte quel que soit ce calcul.
    expect(plat.rgb[0]).toBeCloseTo(0.183, 6)
    expect(astre.rgb[0]).toBeCloseTo(0.21854, 5)
    // ET C'EST BIEN « AUCUNE OMBRE », pas « moins d'ombre » : identique AU BIT au champ sans carte.
    expect(plat.rgb).toEqual(lu(true, 0, PLAT).rgb)
    expect(astre.rgb).toEqual(lu(true, 0, VERS_ASTRE).rgb)
  })

  it('③ LE CONTRÔLE D’INERTIE — hors carte, le drapeau ne change RIEN au bit', () => {
    for (const n of [PLAT, VERS_ASTRE, VERS_LE_SUD]) {
      expect(lu(true, 0, n).rgb).toEqual(lu(false, 0, n).rgb)
      expect(lu(true, 0, n).fAstre).toBe(lu(false, 0, n).fAstre)
      expect(lu(true, 0, n).fFeu).toBe(lu(false, 0, n).fFeu)
    }
  })

  /**
   * ⚠ **GARDE DE SOURCE — PARCE QUE LA LOI A DEUX LECTEURS ET QUE L'UN EST DU GLSL.** `tsc` ne lit
   * pas une chaîne de shader, et une divergence entre le fragment et son miroir CPU est exactement
   * ce que LG-A8 existe pour interdire. On tient donc les deux textes face à face, plus les deux
   * sites qui ALIMENTENT le drapeau — la leçon de `syncActor` : un oracle pur prouve qu'une loi est
   * juste, jamais qu'elle arrive.
   */
  it('④ LE FRAGMENT, LE MIROIR ET LES DEUX SITES D’ALIMENTATION DISENT LA MÊME LOI', () => {
    const gpu = readFileSync(new URL('./corps-gpu.ts', import.meta.url), 'utf8')
    const vue = readFileSync(new URL('../../scenes/world/snapshot-view.ts', import.meta.url), 'utf8')
    // Le fragment : `cime` décodé AVANT `sol` (son poids est le plus fort), et la porte sur `S`.
    expect(gpu.indexOf('float cime = floor(drapeaux / 64.0)')).toBeGreaterThan(0)
    expect(gpu.indexOf('float cime = floor(drapeaux / 64.0)')).toBeLessThan(gpu.indexOf('float sol = floor(drapeaux / 8.0)'))
    expect(gpu).toContain('sousLeCiel || cime > 0.5 ? 0.0 : texture2D(uGiS, uvP).g')
    // La porte ne doit toucher QUE `S` : les deux autres lectures du champ restent nues.
    expect(gpu).toContain('sousLeCiel ? vec3(0.0) : texture2D(uGiF, uvP).rgb')
    // ⚠ LE SAC EST POOLÉ (`armerLeCorps` rend celui qui existe) : l'écriture est INCONDITIONNELLE,
    // sinon le 1 d'un houppier reste sur la pierre que le pool servira ensuite.
    expect(vue).toContain('sac.cime = corps.cime === true ? 1 : 0')
    // UN SEUL corps est une cime, et ce n'est PAS le fût : le pied d'un tronc est vraiment sur le
    // sol, son ombre propre est juste. Ce compte est la clause d'EXHAUSTIVITÉ.
    expect(vue.match(/cime: true/g)).toHaveLength(1)
    expect(vue).toContain('arete: 0, lift: py - pyPied, cime: true')
    const fut = vue.slice(vue.indexOf('isTree && !growing ? { fut: true }'))
    expect(fut.slice(0, 400)).not.toContain('cime: true')
  })

  it('⑤ LA PRÉMISSE — une cime est en branche E, donc la SECONDE lecture de `uGiS` lui est INATTEIGNABLE', () => {
    /**
     * ⚠ **POURQUOI CETTE CLAUSE EXISTE** : le fragment lit `uGiS` à **deux** endroits, et ②ter n'en
     * garde qu'un. Si la seconde lecture était atteignable pour un houppier, le correctif serait
     * incomplet — la cime reprendrait l'ombre d'astre par la porte d'à côté, et les gardes ①-③,
     * qui passent par l'oracle CPU, n'en verraient rien.
     *
     * Elle n'est PAS atteignable, et ce n'est pas une opinion : la seconde lecture vit dans
     * `else if (expo >= -0.5)`, et la pose d'une cime force `expo = −1`. On le PROUVE par la
     * chaîne entière plutôt que par un `grep` : la pose telle que la vue l'écrit → les deux
     * prédicats de `sol-du-corps` → la place de la lecture dans la source du fragment.
     */
    const vue = readFileSync(new URL('../../scenes/world/snapshot-view.ts', import.meta.url), 'utf8')
    const gpu = readFileSync(new URL('./corps-gpu.ts', import.meta.url), 'utf8')

    // ⓐ LA POSE, RELUE DANS LA VUE — pour que la clause suive une dérive du site d'alimentation
    // au lieu de rester verte sur une pose inventée ici. Ni `fut` ni `socle` : les deux premières
    // portes de `suitLaRegleDesFaces` les prennent avant même de regarder l'arête.
    const site = vue.slice(vue.indexOf('cime: true') - 200, vue.indexOf('cime: true') + 12)
    expect(site).toContain('arete: 0')
    expect(site).not.toContain('fut:')
    expect(site).not.toContain('socle:')

    // ⓑ LES DEUX PRÉDICATS, JOUÉS : pas de face, donc aucune exposition — c'est `expo = −1`.
    const cime = houppier(true)
    expect(suitLaRegleDesFaces(cime)).toBe(false)
    expect(expositionAuFeu(cime, { x: 400, y: LIGNE + 32 })).toBeNull()
    // LE CONTRÔLE POSITIF, SUR LA MÊME POSE : un fût, lui, est régi et S'EXPOSE. Sans lui, ⓑ
    // serait verte même si ces deux fonctions rendaient toujours `false`/`null`.
    const tronc: CorpsPose = { ...cime, fut: true }
    expect(suitLaRegleDesFaces(tronc)).toBe(true)
    expect(expositionAuFeu(tronc, { x: 400, y: LIGNE + 32 })).not.toBeNull()

    // ⓒ LA PLACE DE LA LECTURE DANS LE FRAGMENT : la seconde est bien DANS la branche gardée par
    // `expo >= -0.5`, que ⓑ rend inatteignable. Le compte est la clause d'exhaustivité : s'il
    // apparaissait une troisième lecture, cette garde rougirait au lieu de l'ignorer.
    const lectures = gpu.match(/texture2D\(uGiS,/g) ?? []
    expect(lectures).toHaveLength(2)
    const garde = gpu.indexOf('} else if (expo >= -0.5) {')
    expect(garde).toBeGreaterThan(gpu.indexOf('cime > 0.5 ? 0.0 : texture2D(uGiS, uvP).g'))
    expect(gpu.indexOf('texture2D(uGiS, uvPied).g')).toBeGreaterThan(garde)
  })
})

/**
 * ═══ LE SAC EST ÉCRIT EN ENTIER — LA GARDE QUI MANQUAIT (2026-10-09) ═══
 *
 * ⚠ **ELLE NAÎT D'UNE RÉGRESSION QUE J'AI ÉCRITE ET QUE RIEN N'A VUE.** En posant `sac.cime` dans
 * `poserLeCorps`, j'ai remplacé la ligne `sac.soi = corps.soi ?? 0` au lieu de m'ajouter après
 * elle : le plancher de ce qu'on porte (B-R13d) ne montait plus AU SHADER. `tsc` ne pouvait rien
 * dire — tous les champs de `CorpsPourLeShader` sont des `number` mutables avec un défaut à 0 —, et
 * la suite du client est restée verte — et structurellement, pas par chance : les gardes qui
 * éprouvent ce plancher appellent l'oracle CPU (`pixelDuCorps`) en lui donnant `soi` à la main,
 * et AUCUNE ne traverse `poserLeCorps`, c'est-à-dire le raccord où le champ se perdait.
 * ⚠ Le compte « 1 872 » que je citais ici n'avait jamais été relevé : la suite en porte **1 884**
 * au run du 2026-10-09. Un compte qu'on n'a pas mesuré n'ajoute rien à l'argument.
 *
 * LA CAUSE N'EST PAS L'INATTENTION, C'EST LA FORME : `armerLeCorps` rend le sac **existant** d'un
 * sprite poolé, donc `poserLeCorps` doit réécrire **tous** ses champs à chaque image, et un champ
 * oublié n'est pas « à zéro » — il garde la valeur du corps précédent. Une recopie champ par champ
 * sans clause d'exhaustivité est la même classe de défaut que le neuvième paramètre de `syncActor`.
 *
 * ⚠ CE QUI LA FERAIT ROUGIR : retirer n'importe quelle ligne `sac.X =` de `poserLeCorps`, ou
 * ajouter un champ à `CORPS_NEUTRE` sans l'alimenter. Les deux contrôles de non-vacuité disent
 * d'abord qu'on a bien trouvé les deux textes et un nombre plausible de champs.
 */
describe('la recopie pose → sac est EXHAUSTIVE', () => {
  it('`poserLeCorps` écrit chaque champ de `CorpsPourLeShader`, sans condition', () => {
    const noeud = readFileSync(new URL('./noeud-corps.ts', import.meta.url), 'utf8')
    const vue = readFileSync(new URL('../../scenes/world/snapshot-view.ts', import.meta.url), 'utf8')
    // Les champs se lisent sur `CORPS_NEUTRE`, qui est LA liste par construction : le sac neuf en
    // est une copie (`{ ...CORPS_NEUTRE }`), donc un champ absent d'ici n'existe pas.
    const neutre = noeud.slice(noeud.indexOf('const CORPS_NEUTRE'))
    const corps = neutre.slice(neutre.indexOf('{'), neutre.indexOf('}') + 1)
    const champs = [...corps.matchAll(/(\w+):/g)].map((m) => m[1])
    expect(champs.length).toBeGreaterThanOrEqual(11) // non-vacuité : on a bien lu un objet
    expect(champs).toContain('soi') // …et le champ même dont l'oubli a motivé cette garde
    expect(champs).toContain('cime')

    const i = vue.indexOf('private poserLeCorps(')
    expect(i).toBeGreaterThan(0) // non-vacuité : la méthode existe toujours sous ce nom
    const fin = vue.indexOf('\n  }\n', i)
    const bloc = vue.slice(i, fin)
    const manquants = champs.filter((c) => !bloc.includes(`sac.${c} =`))
    expect(manquants).toEqual([])
  })
})
