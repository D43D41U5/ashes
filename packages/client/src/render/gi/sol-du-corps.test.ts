import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  EDGE_E,
  EDGE_N,
  EDGE_O,
  EDGE_S,
  LUMIERE,
  TERRAIN_GRASS,
  createEmptyMap,
  type MondeEclaire,
  type Structure,
} from '@ashes/sim'
import { EDGE_SPRITE, MUR_HT } from '../bati-art'
import { DEMI_BANDE_TUILES, TILE_PX, barriereDepth } from '../framing'
import { CROWN, EMERGENCE } from '../socle-mineral'
import { grilleDuMonde } from './grille'
import { GI } from './reglages'
import {
  SANS_DESSUS,
  auDessusDeLaCrete,
  estDessus,
  estRuban,
  expositionAuFeu,
  facteurDeNormale,
  hauteurDeCrete,
  lectureDuFeu,
  ligneDuPied,
  ordonneeLogique,
  pointAuSol,
  porteeDeLaNormale,
  seuilDuDessus,
  suitLaRegleDesFaces,
  type CorpsPose,
  type Normale,
  type Source3,
} from './sol-du-corps'

/**
 * LE REPÈRE DE L'ÉPREUVE — le CADRE d'une barrière, tel que `bati-art` le fabrique.
 *
 * `formatBarriere(ht) = {w: T+2M, h: ht+T+2M}` → 52 rangs pour un MUR (il ne dépend que de `ht`).
 * `originY = (ht+T+M)/(ht+T+2M)` : le rang 50 du cadre tombe sur le `y` du sprite. Un rang `r` du
 * cadre est donc au monde en `y = sprite.y − 50 + r`.
 */
const M = DEMI_BANDE_TUILES * TILE_PX //         2 px — la demi-épaisseur de bande
const HAUT_DU_CADRE = MUR_HT + TILE_PX + M //    50 — du haut du cadre à la ligne du sprite
const LIGNE = 800 //                             un `y` de sprite quelconque, rond pour la lecture
const rang = (r: number): number => LIGNE - HAUT_DU_CADRE + r

const mur = (arete: number): CorpsPose => ({ x: 400, y: LIGNE, arete, famille: 'wall-bois' })

/**
 * CE QUE `bati-art` PEINT RÉELLEMENT, lu à la source (`bande()` + les deux passes de
 * `dessinerBarriere`) — c'est contre CES rangs que le seuil doit tomber juste.
 *
 *   `bande(bit, 32)` : N → {y:32, h:4} · S → {y:48, h:4} · E/O → {y:32, h:20}
 *   passe 0 (face)   : `rect(ton, b.x, b.y + b.h − ht, b.w, ht)`
 *   passe 1 (coiffe) : `rect(top, b.x, b.y − ht,       b.w, b.h)`
 *
 * | bande | coiffe  | face    |
 * |-------|---------|---------|
 * | nord  | [0, 4)  | [4, 36) |
 * | sud   | [16,20) | [20,52) |
 * | ruban | [0,20)  | [20,52) — mais peint au ton du DESSUS, comme le reste |
 */
const COIFFE = { [EDGE_N]: [0, 4], [EDGE_S]: [16, 20] } as const
const FACE = { [EDGE_N]: [4, 36], [EDGE_S]: [20, 52] } as const

describe('la ligne du pied (LG-A9, corrigé du terme nord)', () => {
  it('UNE BANDE SUD SE TIENT SUR SA LIGNE — le cas où LG-A9 est vrai tel qu’écrit', () => {
    expect(ligneDuPied(mur(EDGE_S))).toBe(LIGNE)
  })

  it('UNE BANDE NORD SE TIENT UNE TUILE PLUS HAUT — le sprite est ancré au bas de sa tuile, sa bande est sur le bord haut', () => {
    expect(ligneDuPied(mur(EDGE_N))).toBe(LIGNE - TILE_PX)
  })

  it('UN CORPS SANS ARÊTE LIT SA PROPRE LIGNE — un arbre, une roche, un acteur', () => {
    expect(pointAuSol({ x: 10, y: LIGNE, arete: 0 }, 10, 10)).toEqual({ x: 10, y: LIGNE })
  })
})

describe('le seuil du dessus tombe sur la coiffe peinte (LG-R16)', () => {
  for (const [nom, bit] of [['nord', EDGE_N], ['sud', EDGE_S]] as const) {
    it(`BANDE ${nom.toUpperCase()} — chaque rang de coiffe est un dessus, chaque rang de face n'en est pas un`, () => {
      const c = mur(bit)
      const [c0, c1] = COIFFE[bit]
      const [f0, f1] = FACE[bit]
      for (let r = c0; r < c1; r++)
        expect(estDessus(c, rang(r)), `coiffe, rang ${r}`).toBe(true)
      for (let r = f0; r < f1; r++)
        expect(estDessus(c, rang(r)), `face, rang ${r}`).toBe(false)
    })
  }

  it('LA RÉGRESSION — sans le terme nord, 16 des 32 rangs de face d’une bande nord passaient en dessus', () => {
    // La règle d'avant lisait `sprite.y + 2 − MUR_HT` pour toute arête : seuil au rang 20, quelle
    // que soit la bande. Au nord, la face commence au rang 4 : les rangs [4, 20) y tombaient.
    const seuilDAvant = LIGNE + M - MUR_HT
    const c = mur(EDGE_N)
    let sauves = 0
    for (let r = 4; r < 20; r++) {
      expect(rang(r) < seuilDAvant, `rang ${r} était classé dessus par la règle d'avant`).toBe(true)
      if (!estDessus(c, rang(r))) sauves++
    }
    expect(sauves).toBe(16)
  })

  it('UN DESSUS LIT LE SOL DROIT SOUS LUI, UNE FACE LIT LE PIED DE SA BANDE', () => {
    const n = mur(EDGE_N)
    expect(pointAuSol(n, 7, rang(0))).toEqual({ x: 7, y: rang(0) + MUR_HT })
    expect(pointAuSol(n, 7, rang(20))).toEqual({ x: 7, y: LIGNE - TILE_PX })
    const s = mur(EDGE_S)
    expect(pointAuSol(s, 7, rang(16))).toEqual({ x: 7, y: rang(16) + MUR_HT })
    expect(pointAuSol(s, 7, rang(40))).toEqual({ x: 7, y: LIGNE })
  })
})

describe('le ruban est dessus par son ART, pas par sa géométrie', () => {
  for (const bit of [EDGE_E, EDGE_O]) {
    it(`BANDE ${bit === EDGE_E ? 'EST' : 'OUEST'} — dessus sur les 52 rangs du cadre`, () => {
      const c = mur(bit)
      expect(estRuban(c)).toBe(true)
      for (let r = 0; r < 52; r++) expect(estDessus(c, rang(r)), `rang ${r}`).toBe(true)
    })
  }

  it('ET SON SEUIL NE SUFFIRAIT PAS — la géométrie seule n’élirait que ses 20 rangs hauts', () => {
    const c = mur(EDGE_O)
    const parLaGeometrie = Array.from({ length: 52 }, (_, r) => auDessusDeLaCrete(c, rang(r)))
    expect(parLaGeometrie.filter(Boolean).length).toBe(20)
  })
})

/**
 * LA HAUTEUR DE CRÊTE EST CELLE DU JEU, PAR FAMILLE — `MUR_HT` n'est pas universel.
 *
 * `dessinerBarriere(mask, ht, tons)` est générique en hauteur : trois vivent dans `EDGE_SPRITE`.
 * Une clôture lue à 32 px placerait sa crête 24 px SOUS son propre pied, et tout son art passerait
 * en dessus. C'est la garde qui tient la redéclaration de `reglages.ts` honnête.
 */
describe('la hauteur de crête est celle du jeu, famille par famille', () => {
  it('CHAQUE FAMILLE D’`EDGE_SPRITE` EST DÉCLARÉE, ET À LA MÊME HAUTEUR', () => {
    for (const [famille, sprite] of Object.entries(EDGE_SPRITE)) {
      expect(GI.CORPS.HAUTEUR_PAR_FAMILLE[famille], `famille ${famille}`).toBe(sprite.hauteurPx)
      expect(hauteurDeCrete({ x: 0, y: LIGNE, arete: EDGE_S, famille })).toBe(sprite.hauteurPx)
    }
  })

  it('ET AUCUNE N’EST DE TROP — une famille déclarée que le jeu ne dessine pas serait un nombre mort', () => {
    for (const famille of Object.keys(GI.CORPS.HAUTEUR_PAR_FAMILLE))
      expect(EDGE_SPRITE[famille], `famille ${famille}`).toBeDefined()
  })

  it('LES TROIS HAUTEURS SONT BIEN DISTINCTES — sinon la garde passerait au vert sans rien tenir', () => {
    expect(new Set(Object.values(GI.CORPS.HAUTEUR_PAR_FAMILLE)).size).toBe(3)
  })

  it('UNE FAMILLE INCONNUE RETOMBE SUR LE MUR — un défaut, jamais un zéro qui ferait tout dessus', () => {
    expect(hauteurDeCrete({ x: 0, y: LIGNE, arete: EDGE_S })).toBe(MUR_HT)
  })

  it('UNE CLÔTURE A SA CRÊTE À 8 px — son seuil tombe 24 rangs plus bas que celui d’un mur', () => {
    // Le SEUIL, donc `auDessusDeLaCrete` : c'est lui la géométrie. `estDessus` y ajoute le parcage
    // des familles, éprouvé plus bas — mêler les deux ici ferait un test qui ne dit plus lequel a
    // bougé quand il rougit.
    const clot: CorpsPose = { x: 400, y: LIGNE, arete: EDGE_S, famille: 'cloture' }
    const seuilClot = ligneDuPied(clot) + M - 8
    const seuilMur = ligneDuPied(mur(EDGE_S)) + M - MUR_HT
    expect(seuilClot - seuilMur).toBe(24)
    expect(auDessusDeLaCrete(clot, seuilClot - 1)).toBe(true)
    expect(auDessusDeLaCrete(clot, seuilClot)).toBe(false)
    // Lue à MUR_HT, elle aurait pris pour dessus 24 rangs qui sont sa face.
    expect(auDessusDeLaCrete(mur(EDGE_S), seuilClot - 1)).toBe(false)
  })
})

/**
 * L'EXPOSITION À LA FLAMME (LG-R7, O) — *« un mur prend la part directe du feu lue à son pied
 * × max(0, cos θ), un tronc × (1 + cos θ)/2, θ l'angle entre le sud et la direction du feu »*.
 */
describe('les faces ont un sens (LG-R7, O)', () => {
  // Un feu posé par rapport à la LIGNE DU PIED, en px logiques — le lift n'y entre pas (LG-R14).
  const feuAu = (dx: number, dy: number, c: CorpsPose): { x: number; y: number } =>
    ({ x: c.x + dx, y: ligneDuPied(c) + dy })

  it('UN MUR FACE AU FEU PREND TOUT — le feu droit au sud, cos = 1', () => {
    const c = mur(EDGE_S)
    expect(expositionAuFeu(c, feuAu(0, 64, c))).toBeCloseTo(1, 12)
  })

  it('UN MUR DOS AU FEU S’ÉTEINT FRANCHEMENT — le feu au nord, max(0, cos) = 0', () => {
    const c = mur(EDGE_S)
    expect(expositionAuFeu(c, feuAu(0, -64, c))).toBe(0)
  })

  it('DE CÔTÉ, IL EST À ZÉRO — le seuil de max(0, ·) tombe exactement à l’est franc', () => {
    const c = mur(EDGE_S)
    expect(expositionAuFeu(c, feuAu(64, 0, c))).toBe(0)
    expect(expositionAuFeu(c, feuAu(64, 1, c))).toBeGreaterThan(0)
  })

  it('UN FÛT TOURNE, IL NE S’ÉTEINT PAS — (1 + cos)/2 vaut 1, ½ et 0 aux trois quarts de tour', () => {
    const t: CorpsPose = { x: 400, y: LIGNE, arete: 0, fut: true }
    expect(expositionAuFeu(t, feuAu(0, 64, t))).toBeCloseTo(1, 12)
    expect(expositionAuFeu(t, feuAu(64, 0, t))).toBeCloseTo(0.5, 12)
    expect(expositionAuFeu(t, feuAu(0, -64, t))).toBeCloseTo(0, 12)
  })

  it('UN RUBAN GARDE E — vu de champ, il n’a pas de face à exposer', () => {
    for (const bit of [EDGE_E, EDGE_O]) expect(expositionAuFeu(mur(bit), { x: 0, y: 0 })).toBeNull()
  })

  it('UNE CIME, UNE ROCHE, UN ACTEUR GARDENT E — rien à orienter sans face dressée', () => {
    expect(expositionAuFeu({ x: 400, y: LIGNE, arete: 0 }, { x: 0, y: 0 })).toBeNull()
  })

  it('LA CLÔTURE EST PLATE — la flamme la domine (Alexis, 2026-09-18, planche « la clôture au pied du feu »)', () => {
    expect(expositionAuFeu({ x: 400, y: LIGNE, arete: EDGE_S, famille: 'cloture' }, { x: 400, y: LIGNE + 64 }))
      .toBeNull()
  })

  /**
   * LA PORTE SE DÉRIVE DE LA CRÊTE, PAS D'UNE LISTE — exhaustive sur la table des hauteurs : une
   * barrière se dresse si et seulement si sa crête DÉPASSE la flamme. Une liste de familles aurait
   * laissé une famille neuve tomber en silence d'un côté ou de l'autre.
   */
  it('UNE BARRIÈRE SE DRESSE SI ET SEULEMENT SI SA CRÊTE DÉPASSE LA FLAMME — toute la table', () => {
    for (const [famille, hauteur] of Object.entries(GI.CORPS.HAUTEUR_PAR_FAMILLE)) {
      const c: CorpsPose = { x: 400, y: LIGNE, arete: EDGE_S, famille }
      expect(suitLaRegleDesFaces(c), famille).toBe(hauteur > GI.CORPS.HAUTEUR_FLAMME_PX)
    }
    // Et la table sépare bien les deux camps : la clôture seule sous la flamme, tout le reste dessus.
    const plates = Object.entries(GI.CORPS.HAUTEUR_PAR_FAMILLE).filter(([, h]) => h <= GI.CORPS.HAUTEUR_FLAMME_PX).map(([f]) => f)
    expect(plates).toEqual(['cloture'])
  })

  /**
   * LE PARCAGE EST TOTAL, PAS À MOITIÉ. O et LG-R16 sont les deux faces d'une même question
   * (« ce corps a-t-il un dessus et une face ? ») : une clôture sans orientation mais AVEC une
   * coiffe serait une demi-position que personne n'a choisie. Un corps sous la flamme garde E entier,
   * comme la composition ratifiée l'a rendue — c'est ce que cette garde tient.
   */
  it('UN CORPS SOUS LA FLAMME GARDE E DES DEUX CÔTÉS — ni orientation, NI coiffe', () => {
    const clot: CorpsPose = { x: 400, y: LIGNE, arete: EDGE_S, famille: 'cloture' }
    expect(suitLaRegleDesFaces(clot)).toBe(false)
    // Sa géométrie dirait pourtant « dessus » sur ses rangs hauts : c'est bien la porte qui tranche.
    const hautDeSaCoiffe = ligneDuPied(clot) + M - 8 - 1
    expect(auDessusDeLaCrete(clot, hautDeSaCoiffe)).toBe(true)
    expect(estDessus(clot, hautDeSaCoiffe)).toBe(false)
    expect(lectureDuFeu(clot, hautDeSaCoiffe, { x: 400, y: LIGNE + 64 })).toEqual({ ou: 'sousLePixel' })
  })

  it('ET UN RUBAN DE CLÔTURE NE PASSE PAS NON PLUS — la porte est avant l’art du ruban', () => {
    const clot: CorpsPose = { x: 400, y: LIGNE, arete: EDGE_O, famille: 'cloture' }
    expect(estRuban(clot)).toBe(true)
    expect(estDessus(clot, rang(10))).toBe(false)
  })

  it('UN MUR, LUI, PASSE LA PORTE — sinon la garde ci-dessus serait vraie de tout', () => {
    expect(suitLaRegleDesFaces(mur(EDGE_S))).toBe(true)
    expect(suitLaRegleDesFaces({ x: 0, y: LIGNE, arete: 0, fut: true })).toBe(true)
  })

  it('L’ENCADREMENT, LUI, EST UN MUR — 32 px, et la spec dit « un mur »', () => {
    const e: CorpsPose = { x: 400, y: LIGNE, arete: EDGE_S, famille: 'encadrement' }
    expect(expositionAuFeu(e, feuAu(0, 64, e))).toBeCloseTo(1, 12)
  })

  /**
   * LE PIÈGE : l'angle se mesure depuis la LIGNE DU PIED, jamais depuis l'ancrage du sprite. Dans le
   * harnais, `orient` lit `s.y` APRÈS que `planche14.mjs:416` a remappé les pignons nord de −16 px.
   * Sur un pignon nord, `c.y` et `ligneDuPied(c)` diffèrent d'une tuile entière — et c'est là que le
   * feu est le plus proche, donc là que l'erreur d'angle est la plus grande.
   */
  it('UN PIGNON NORD SE JUGE DEPUIS SA BANDE — prendre `c.y` déplacerait l’angle d’une tuile', () => {
    const n = mur(EDGE_N)
    const feu = { x: n.x, y: ligneDuPied(n) + TILE_PX } // une tuile sous la BANDE : plein sud
    expect(expositionAuFeu(n, feu)).toBeCloseTo(1, 12)
    // Le même feu, jugé depuis l'ancrage du sprite, tomberait EXACTEMENT dessus : d = 0, cos = 0.
    expect(feu.y).toBe(n.y)
  })

  /**
   * LG-R14 : `c.y` est LOGIQUE (la tuile, le lift retiré) et la source aussi — le lift ne touche pas
   * l'angle. La version d'avant ajoutait `lift` à une ligne déjà logique : MESURÉ au village PNJ 2
   * (lift 32), une palissade à un pas et demi devant un feu se jugeait de dos (`expo` 0).
   */
  it('LE LIFT N’ENTRE PAS DEUX FOIS DANS L’ANGLE — `c.y` est déjà logique, la source aussi (LG-R14)', () => {
    const haut: CorpsPose = { ...mur(EDGE_S), lift: 32 }
    const feu = feuAu(0, 24, haut) // un pas et demi devant la face, en logique
    expect(expositionAuFeu(haut, feu)).toBeCloseTo(1, 12)
    expect(expositionAuFeu(haut, feu)).toBe(expositionAuFeu(mur(EDGE_S), feu))
    // Le même feu jugé DESSINÉ (sa lumière est posée `lift` plus haut) passerait derrière l'arête.
    expect(expositionAuFeu(haut, { x: feu.x, y: feu.y - 32 })).toBe(0)
  })

  it('UN PIXEL DESSINÉ SE JUGE À SA PLACE LOGIQUE — `ordonneeLogique` remonte du lift (LG-R14)', () => {
    const haut: CorpsPose = { ...mur(EDGE_S), lift: 32 }
    // Le dernier rang de FACE, tel qu'il est dessiné : un pixel au-dessus du pied dessiné.
    const ywDessine = ligneDuPied(haut) - 32 - 1
    expect(ordonneeLogique(haut, ywDessine)).toBe(ligneDuPied(haut) - 1)
    expect(estDessus(haut, ordonneeLogique(haut, ywDessine))).toBe(false)
    // Jugé tel quel, il tomberait sous le seuil logique : un dessus — tout le mur l'était (MESURÉ).
    expect(estDessus(haut, ywDessine)).toBe(true)
    // Au sol, c'est l'identité.
    expect(ordonneeLogique(mur(EDGE_S), ywDessine)).toBe(ywDessine)
  })
})

describe('les trois branches de la lecture du feu', () => {
  const feuAuSud = { x: 400, y: LIGNE + 64 }

  it('UN DESSUS : NUL (LG-R16) — et c’est `estDessus` qui répond, pour la raison de l’ART', () => {
    expect(lectureDuFeu(mur(EDGE_S), rang(17), feuAuSud)).toEqual({ ou: 'nul' })
    expect(lectureDuFeu(mur(EDGE_E), rang(40), feuAuSud)).toEqual({ ou: 'nul' })
  })

  it('UNE FACE DRESSÉE : AU PIED, FOIS SON EXPOSITION (LG-R7, O)', () => {
    const c = mur(EDGE_S)
    const l = lectureDuFeu(c, rang(40), feuAuSud)
    expect(l.ou).toBe('auPied')
    if (l.ou !== 'auPied') throw new Error('branche inattendue')
    expect(l.y).toBe(ligneDuPied(c))
    expect(l.facteur).toBeCloseTo(1, 12)
  })

  it('TOUT LE RESTE : SOUS LE PIXEL (E) — une roche, un acteur, une clôture', () => {
    expect(lectureDuFeu({ x: 400, y: LIGNE, arete: 0 }, LIGNE - 10, feuAuSud)).toEqual({ ou: 'sousLePixel' })
    expect(lectureDuFeu({ x: 400, y: LIGNE, arete: EDGE_S, famille: 'cloture' }, LIGNE - 1, feuAuSud))
      .toEqual({ ou: 'sousLePixel' })
  })

  it('UN PIGNON NORD LIT SA BANDE, PAS SON ANCRAGE — le pied rendu est bien 16 px plus haut', () => {
    const n = mur(EDGE_N)
    const l = lectureDuFeu(n, rang(20), { x: n.x, y: LIGNE + 64 })
    if (l.ou !== 'auPied') throw new Error('une face nord doit lire au pied')
    expect(l.y).toBe(LIGNE - TILE_PX)
  })
})

/**
 * LA GARDE : la ligne du pied est CELLE DE LA SIM (LG-R11/R12, « une loi, un lecteur »).
 *
 * `lumiere.ts` ne l'exporte pas comme géométrie d'une structure seule — on la lui fait donc
 * produire, par le vrai chemin, et on compare. Si la sim déplace une bande, cette garde rougit
 * plutôt que de laisser les deux moitiés de la GI diverger en silence.
 */
describe('la géométrie de bande est celle de la sim (LG-R11)', () => {
  const T = LUMIERE.TEXELS_PAR_TUILE
  const TX = 50, TY = 48
  const F = { x0: 46, y0: 44, x1: 55, y1: 53 }

  function bandeDeLaSim(arete: number): { y0: number; y1: number } {
    const map = createEmptyMap(96, 96, TERRAIN_GRASS)
    const structures = [{
      id: 1, type: 'wall', tx: TX, ty: TY, villageId: 0, ownerId: 0, access: 'public', hp: 100, edges: arete,
    } as unknown as Structure]
    const monde: MondeEclaire = { map, structures, nodes: [] }
    const g = grilleDuMonde(monde, 0, F)
    expect(g.murs.length, 'la sim doit avoir retenu la bande — sinon la garde ne prouve rien').toBe(1)
    const b = g.murs[0]!
    // texels de grille → texels absolus → px monde
    const px = (t: number): number => (t + g.oy) * (TILE_PX / T)
    return { y0: px(b.y0), y1: px(b.y1) }
  }

  it('LE TRI Y DIT DÉJÀ QUE LA BANDE NORD SE TIENT PLUS HAUT — `barriereDepth`, et ce module doit l’ordonner pareil', () => {
    // `framing.ts:508` : `feetY = (edges & (S|E|O)) ? ty+1 : ty+DEMI_BANDE_TUILES`. Le tri Y est
    // le SEUL système livré qui connaissait déjà le décalage nord ; si quelqu'un l'y retire,
    // cette garde rougit ici plutôt que de laisser la GI seule avec une géométrie orpheline.
    const nord = barriereDepth(TY, EDGE_N, TILE_PX, DEMI_BANDE_TUILES)
    const sud = barriereDepth(TY, EDGE_S, TILE_PX, DEMI_BANDE_TUILES)
    expect(nord).toBeLessThan(sud)
    expect(ligneDuPied({ x: 0, y: (TY + 1) * TILE_PX, arete: EDGE_N }))
      .toBeLessThan(ligneDuPied({ x: 0, y: (TY + 1) * TILE_PX, arete: EDGE_S }))
  })

  for (const [nom, bit, attendu] of [
    ['nord', EDGE_N, TY * TILE_PX],
    ['sud', EDGE_S, (TY + 1) * TILE_PX],
  ] as const) {
    it(`BANDE ${nom.toUpperCase()} — la ligne du pied tombe au CENTRE de la bande de la sim`, () => {
      const b = bandeDeLaSim(bit)
      expect((b.y0 + b.y1) / 2).toBe(attendu)
      expect(ligneDuPied({ x: 0, y: (TY + 1) * TILE_PX, arete: bit })).toBe(attendu)
    })
  }

  for (const [nom, bit] of [['est', EDGE_E], ['ouest', EDGE_O]] as const) {
    it(`BANDE ${nom.toUpperCase()} — elle COURT SUR TOUTE SA TUILE : aucune ligne unique, d’où le test de type`, () => {
      const b = bandeDeLaSim(bit)
      expect(b.y1 - b.y0).toBe(TILE_PX + 2 * M)
    })
  }

  it('LA DEMI-BANDE VAUT 2 px ET LA HAUTEUR DE MUR EST CELLE DU JEU', () => {
    expect(M).toBe(2)
    expect(GI.ASTRE.HAUTEUR_MUR_PX).toBe(MUR_HT)
  })
})

/**
 * ═══ LA NORMALE ET SA PORTÉE `g` (LG-R7, « La normale ») ═══
 *
 * Les deux sources de l'ORACLE, relevées dans `p16-nuit-grilles.json` — la donnée même qui a servi à
 * ratifier la règle. Elles ne sont pas décoratives : leurs hauteurs sont dans un rapport de 65, et
 * c'est ce rapport qui rend l'écrêtage à 1 nécessaire plutôt que cosmétique.
 */
const LUNE: Source3 = { x: 7582, y: -248, z: 620 }
const FEU: Source3 = { x: 6600, y: 1347.2, z: 9.6 }
/** Un dessus plat regarde le ciel ; une face sud regarde le sud (`+y`) ; une face nord, le nord. */
const PLAT: Normale = { x: 0, y: 0, z: 1 }
const VERS_LE_SUD: Normale = { x: 0, y: 1, z: 0 }
const VERS_LE_NORD: Normale = { x: 0, y: -1, z: 0 }

describe('la normale et sa portée g (LG-R7)', () => {
  /** La forme de la SPEC, écrite littéralement — c'est elle que `facteurDeNormale` doit égaler. */
  const parLaSpec = (n: Normale, p: { x: number; y: number }, s: Source3): number => {
    const dx = s.x - p.x, dy = s.y - p.y, dz = s.z
    const d = Math.hypot(dx, dy, dz)
    const nl = (n.x * dx + n.y * dy + n.z * dz) / d // n·ℓ, ℓ normalisé
    return Math.max(0, nl) * porteeDeLaNormale(p, s)
  }

  const POINTS = [
    { x: 6600, y: 1347 }, // sous le feu
    { x: 6400, y: 1200 }, { x: 6800, y: 1500 }, { x: 6600, y: 1200 }, { x: 6600, y: 1500 },
    { x: 6200, y: 1400 }, { x: 7000, y: 1300 }, { x: 6601, y: 1348 },
  ]

  it('UN DESSUS PLAT REÇOIT EXACTEMENT SA PART — la phrase de la spec, et elle est EXACTE, pas approchée', () => {
    // `d = 0·dx + 0·dy + 1·z = z`, puis `z / z` : le 1 est au bit près, pour toute source.
    for (const s of [LUNE, FEU, { x: 0, y: 0, z: 1e-6 }, { x: 1e6, y: -1e6, z: 4 }])
      for (const p of POINTS) expect(facteurDeNormale(PLAT, p, s), `source z=${s.z}`).toBe(1)
  })

  it('ET C’EST BIEN LA FORME DE LA SPEC — `max(0, n·d)/z` égale `max(0, n·ℓ) × g`, partout', () => {
    let cas = 0
    for (const s of [LUNE, FEU])
      for (const p of POINTS)
        for (const n of [PLAT, VERS_LE_SUD, VERS_LE_NORD, { x: 0.6, y: 0.8, z: 0 }, { x: 0, y: 0.6, z: 0.8 }]) {
          expect(facteurDeNormale(n, p, s)).toBeCloseTo(parLaSpec(n, p, s), 10)
          cas++
        }
    expect(cas).toBe(2 * POINTS.length * 5) // la garde prouve sa prémisse : un balayage vide serait vert
  })

  it('UNE FACE QUI TOURNE LE DOS NE PREND RIEN — et celle d’en face prend, sinon la garde serait vraie de tout', () => {
    const p = { x: FEU.x, y: FEU.y - 64 } // le feu est au SUD de ce point
    expect(facteurDeNormale(VERS_LE_NORD, p, FEU)).toBe(0)
    expect(facteurDeNormale(VERS_LE_SUD, p, FEU)).toBeGreaterThan(0)
  })

  /**
   * LA TRANSCRIPTION DU HARNAIS — et c'en est une, pas une preuve indépendante : `planche9.mjs:176`
   * écrit `Math.hypot(ra.x − p.x, ra.y − p.y, ra.z) / ra.z`, et ce test dit que j'ai recopié cette
   * ligne sans faute, sur les sources réelles de l'oracle. Ce qu'il éprouve vraiment, c'est l'UNITÉ
   * (px monde des deux côtés) et l'ORDRE des termes — les deux façons de se tromper en transcrivant.
   */
  it('`g` EST LA LIGNE DU HARNAIS, TERME POUR TERME', () => {
    for (const s of [LUNE, FEU])
      for (const p of POINTS)
        expect(porteeDeLaNormale(p, s)).toBe(Math.hypot(s.x - p.x, s.y - p.y, s.z) / s.z)
  })

  it('UN FEU BAS DONNE UN `g` ÉNORME — 6,7 à quatre tuiles, ce qui rend l’écrêtage à 1 nécessaire', () => {
    const p = { x: FEU.x - 4 * TILE_PX, y: FEU.y }
    expect(porteeDeLaNormale(p, FEU)).toBeCloseTo(Math.hypot(64, 0, 9.6) / 9.6, 12)
    expect(porteeDeLaNormale(p, FEU)).toBeGreaterThan(6.7)
    // La lune, elle, est 65 fois plus haute : son `g` vaut 3,24 au même point, et il varie à peine
    // sur tout le cadre là où celui du feu double en deux tuiles. C'est CE rapport qui compte.
    expect(porteeDeLaNormale(p, LUNE)).toBeLessThan(porteeDeLaNormale(p, FEU) / 2)
    expect(porteeDeLaNormale(p, LUNE)).toBeCloseTo(3.235, 3)
  })

  /**
   * `g` APPARTIENT AU POINT LU, PAS AU CORPS — le harnais calcule deux `g` dans le même pixel
   * (`gA` au point lu `:176`, `gAD` à l'ancrage `:131`) et ne les confond jamais. Sur un dessus, le
   * point lu est une hauteur de crête plus BAS que l'ancrage : les prendre au sprite rendrait tout
   * un mur avec le `g` de son pied.
   */
  it('IL SE PREND AU POINT LU — sur un dessus, l’ancrage donnerait un AUTRE nombre', () => {
    const c = mur(EDGE_S)
    const yw = rang(17) // un rang de coiffe
    const lu = pointAuSol(c, c.x, yw)
    expect(lu.y).not.toBe(ligneDuPied(c))
    const feuProche: Source3 = { x: c.x + 40, y: LIGNE + 40, z: 9.6 }
    expect(porteeDeLaNormale(lu, feuProche)).not.toBe(porteeDeLaNormale({ x: c.x, y: c.y }, feuProche))
  })

  it('UNE SOURCE SANS HAUTEUR REND ZÉRO, JAMAIS L’INFINI — la garde, dont aucune donnée ratifiée n’a besoin', () => {
    for (const z of [0, -1]) {
      expect(porteeDeLaNormale({ x: 0, y: 0 }, { x: 10, y: 10, z })).toBe(0)
      expect(facteurDeNormale(PLAT, { x: 0, y: 0 }, { x: 10, y: 10, z })).toBe(0)
    }
    // Et la prémisse de la garde : les sources de l'oracle, elles, ont bien une hauteur.
    expect(LUNE.z).toBeGreaterThan(0)
    expect(FEU.z).toBeGreaterThan(0)
  })

  /**
   * ⚠ CE QUE LA MESURE DIT DE LA CLÔTURE. LG-R16 justifiait le dessus par « la flamme est à 10 px
   * au-dessus de son sol, sous toute crête ». Le feu de l'oracle est à 9,6 px : au-dessus de
   * `CLOT_HT` (8), sous `PALIS_HT` (24) — et c'est cette hauteur-là, redite dans `reglages.ts`, qui
   * tient lieu de porte à la règle des faces. La garde tient la redite égale à la donnée ratifiée.
   */
  it('LA FLAMME PASSE AU-DESSUS D’UNE CLÔTURE ET SOUS UNE PALISSADE — mesuré, pas déduit', () => {
    const clot = hauteurDeCrete({ x: 0, y: LIGNE, arete: EDGE_S, famille: 'cloture' })
    const palis = hauteurDeCrete({ x: 0, y: LIGNE, arete: EDGE_S, famille: 'palissade' })
    expect(FEU.z).toBeGreaterThan(clot)
    expect(FEU.z).toBeLessThan(palis)
    expect(FEU.z).toBeLessThan(MUR_HT)
    expect(GI.CORPS.HAUTEUR_FLAMME_PX).toBe(FEU.z)
  })
})

/**
 * ═══ LES NŒUDS ARMENT — fût, socle, cime (LG-R7 sur ce qui n'est pas une barrière) ═══
 *
 * Un FÛT est un cylindre : il tourne face au feu et n'a pas de dessus (sa cime le coiffe). Un SOCLE
 * est rond — son corps ne tourne le dos à rien — mais son art lui peint une COURONNE plane
 * (`socle-mineral.ts`, `CROWN` rangées) et LG-R16 la fait regarder le ciel. Une CIME n'a ni face ni
 * dessus : elle lit le champ à la ligne du pied de son tronc, et c'est tout.
 */
describe('les nœuds arment — fût, socle, cime (LG-R7, LG-R16)', () => {
  const fut: CorpsPose = { x: 400, y: LIGNE, arete: 0, fut: true }
  const socle = (taille: number): CorpsPose => ({ x: 400, y: LIGNE, arete: 0, socle: taille })
  const cime: CorpsPose = { x: 400, y: LIGNE, arete: 0 }

  it('UN FÛT N’A PAS DE DESSUS — aucun rang, si haut soit-il, et son seuil le dit', () => {
    expect(seuilDuDessus(fut)).toBe(SANS_DESSUS)
    for (const yw of [LIGNE, LIGNE - 10, LIGNE - 100, LIGNE - 1000]) expect(estDessus(fut, yw)).toBe(false)
    expect(suitLaRegleDesFaces(fut)).toBe(true)
  })

  it('un fût TOURNE face au feu — (1 + cos)/2 : plein au sud, nul au nord, moitié de côté', () => {
    expect(expositionAuFeu(fut, { x: 400, y: LIGNE + 100 })).toBe(1)
    expect(expositionAuFeu(fut, { x: 400, y: LIGNE - 100 })).toBe(0)
    expect(expositionAuFeu(fut, { x: 500, y: LIGNE })).toBe(0.5)
    expect(lectureDuFeu(fut, LIGNE - 40, { x: 400, y: LIGNE + 100 })).toEqual({ ou: 'auPied', y: LIGNE, facteur: 1 })
  })

  it('LA COURONNE D’UN SOCLE REGARDE LE CIEL — les CROWN rangées planes, ni plus ni moins (LG-R16)', () => {
    for (const taille of [0, 1, 2]) {
      const c = socle(taille)
      const E = EMERGENCE[taille]!
      expect(hauteurDeCrete(c)).toBe(E)
      expect(seuilDuDessus(c)).toBe(LIGNE - E + CROWN)
      // `formeDeSocle` : la texture fait E + 1 rangs, le premier vide ; le rang r (1 ≤ r ≤ E) porte
      // dy = r − 1 et tombe au monde en y = LIGNE − (E + 1) + r (+ ½ au centre du texel, comme le
      // fragment). Couronne ⇔ dy < CROWN.
      for (let r = 1; r <= E; r++) {
        const dy = r - 1
        expect(estDessus(c, LIGNE - (E + 1) + r + 0.5), `taille ${taille}, rang ${r}`).toBe(dy < CROWN)
      }
    }
  })

  it('la couronne lit le sol une émergence plus bas ; le corps lit sa ligne', () => {
    const c = socle(2)
    const E = EMERGENCE[2]
    expect(pointAuSol(c, 400, LIGNE - E + 0.5)).toEqual({ x: 400, y: LIGNE + 0.5 })
    expect(pointAuSol(c, 400, LIGNE - 3)).toEqual({ x: 400, y: LIGNE })
  })

  it('UNE PIERRE EST RONDE : son corps garde E, et sa couronne ne prend rien du feu', () => {
    const c = socle(1)
    const feu = { x: 400, y: LIGNE + 50 }
    expect(expositionAuFeu(c, feu)).toBeNull()
    expect(lectureDuFeu(c, LIGNE - 3, feu)).toEqual({ ou: 'sousLePixel' })
    expect(lectureDuFeu(c, LIGNE - EMERGENCE[1] + 1, feu)).toEqual({ ou: 'nul' })
  })

  it('une cime — ni arête, ni fût, ni socle — lit sa ligne partout et garde E', () => {
    expect(suitLaRegleDesFaces(cime)).toBe(false)
    expect(estDessus(cime, LIGNE - 30)).toBe(false)
    expect(pointAuSol(cime, 400, LIGNE - 30)).toEqual({ x: 400, y: LIGNE })
    expect(expositionAuFeu(cime, { x: 0, y: 0 })).toBeNull()
  })
})

/**
 * ═══ L'ORACLE LIT LE POINT DU SHADER (LG-A8) ═══
 *
 * Le GPU choisit `p` sur son `dessus` — qui compte le RUBAN sur toutes ses rangées et ne s'ouvre
 * qu'aux familles dressées. `pointAuSol` lisait la GÉOMÉTRIE seule : un ruban lisait sa ligne sur ses
 * rangs bas, une clôture lisait la crête sur ses rangs hauts, et le GPU lisait autre chose. Aucun
 * test ne les mettait face à face ; ces deux-ci le font.
 */
describe('l’oracle lit le point du shader (LG-A8 — le ruban et la clôture)', () => {
  it('UN RUBAN LIT UNE HAUTEUR DE CRÊTE PLUS BAS SUR TOUS SES RANGS — pas seulement au-dessus de la crête', () => {
    const c = mur(EDGE_E)
    for (const r of [0, 10, 19, 20, 30, 51]) {
      expect(pointAuSol(c, c.x, rang(r)), `rang ${r}`).toEqual({ x: c.x, y: rang(r) + hauteurDeCrete(c) })
    }
  })

  it('UNE CLÔTURE, PLATE, LIT SA LIGNE SUR TOUS SES RANGS — la géométrie seule dirait « crête » en haut', () => {
    const c: CorpsPose = { x: 400, y: LIGNE, arete: EDGE_S, famille: 'cloture' }
    expect(auDessusDeLaCrete(c, rang(17))).toBe(true)
    expect(pointAuSol(c, c.x, rang(17))).toEqual({ x: c.x, y: ligneDuPied(c) })
  })
})

describe('l’astre des corps — le relais soleil → lune, sans saut (2026-09-18)', () => {
  it('ASTRE_LOIN_PX est SUN_FAR : la redite se relit dans la source de `dynamic-lighting.ts`', () => {
    // `dynamic-lighting` tire toute la scène (Phaser) : on ne l'importe pas ici, on lit sa source. Un
    // `SUN_FAR` qui bouge sans `GI.CORPS.ASTRE_LOIN_PX` mettrait l'astre des corps à une autre distance
    // que le soleil du jeu — et une face ne regarderait plus le même astre que l'ombre de son mur.
    const source = readFileSync(new URL('../../scenes/world/dynamic-lighting.ts', import.meta.url), 'utf8')
    const m = /const SUN_FAR = ([0-9.]+)/.exec(source)
    expect(m, 'SUN_FAR introuvable dans dynamic-lighting.ts').not.toBeNull()
    expect(GI.CORPS.ASTRE_LOIN_PX).toBe(Number(m![1]))
  })
})
