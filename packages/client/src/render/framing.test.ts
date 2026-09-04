import { describe, expect, it } from 'vitest'
import {
  actorPlacement,
  barriereAvale,
  barriereDepth,
  seuilDepth,
  AMBIENT_DEPTH,
  AMBIENT_DEPTH_LIT,
  CANOPY_DEPTH,
  CROWN_ALPHA_MIN,
  CROWN_R_IN,
  CROWN_R_OUT,
  crownAlpha,
  crownDepth,
  clutterDepth,
  fireflyDepth,
  FLOOR_DEPTH,
  corpseDepth,
  GROUND_FIRE_DEPTH,
  GROUND_PROP_DEPTH,
  lookaheadOffset,
  nodeDepth,
  OVERLAY_DEPTH,
  structureDepth,
  decalageDEtage,
  strateDEtage,
  ETAGE_STRATE,
  LIFT_TUILES,
  plateauAlpha,
  PLATEAU_ALPHA_MIN,
  PLATEAU_R_IN,
  PLATEAU_R_OUT,
  alphaDeDecouvert,
  ROOF_DEPTH,
  TIE_ACTOR,
  TIE_SOCLE,
  TIE_STRUCTURE,
  VISIBLE_TILES_TALL,
  Y_SORT_BASE,
  ySortDepth,
  zoomForFraming,
} from './framing'
import { ARBRES, hauteurTuiles } from './arbre-art'

const TILE = 16

describe('zoomForFraming (R10)', () => {
  it('dérive le zoom du cadrage voulu : 20 tuiles de haut sur 720 px → 2,25', () => {
    expect(zoomForFraming(20, TILE, 720)).toBeCloseTo(2.25, 5)
  })
  it('un cadrage plus serré donne un zoom plus fort', () => {
    expect(zoomForFraming(18, TILE, 720)).toBeGreaterThan(zoomForFraming(20, TILE, 720))
  })
})

describe('lookaheadOffset (R11)', () => {
  const CX = 640
  const CY = 360
  it('pointeur au centre → aucun décalage', () => {
    expect(lookaheadOffset(CX, CY, CX, CY, 0.2, 6, TILE)).toEqual({ x: 0, y: 0 })
  })
  it('décale vers le curseur (signe conservé)', () => {
    const off = lookaheadOffset(CX + 100, CY - 50, CX, CY, 0.2, 6, TILE)
    expect(off.x).toBeGreaterThan(0)
    expect(off.y).toBeLessThan(0)
  })
  it('borne le décalage à maxTiles (clamp radial)', () => {
    // strength énorme → doit être clampé à 6 tuiles = 96 px, en magnitude
    const off = lookaheadOffset(CX + 640, CY, CX, CY, 10, 6, TILE)
    const mag = Math.sqrt(off.x * off.x + off.y * off.y)
    expect(mag).toBeCloseTo(6 * TILE, 5)
  })
  it('le clamp est radial (diagonale bornée à maxTiles, pas maxTiles par axe)', () => {
    const off = lookaheadOffset(CX + 640, CY + 360, CX, CY, 10, 6, TILE)
    const mag = Math.sqrt(off.x * off.x + off.y * off.y)
    expect(mag).toBeCloseTo(6 * TILE, 5)
  })
  it('sous la borne, renvoie strength × écart au centre sans clamp', () => {
    // écart 100 px × strength 0.2 = 20 px < 6 tuiles (96 px) → passe tel quel
    const off = lookaheadOffset(CX + 100, CY, CX, CY, 0.2, 6, TILE)
    expect(off).toEqual({ x: 20, y: 0 })
  })
})

describe('actorPlacement (R12 + R13)', () => {
  it('ancre les pieds au bas de l’emprise logique et découple la taille de l’art', () => {
    const p = actorPlacement(5, 10, { widthTiles: 1, heightTiles: 1.6 }, TILE, 0.6)
    // feetY = 10 + 0.6/2 = 10.3
    expect(p.px).toBeCloseTo(80, 5) // 5 * 16, centre horizontal inchangé
    expect(p.py).toBeCloseTo(10.3 * TILE, 5) // pieds
    expect(p.displayW).toBeCloseTo(16, 5) // 1 tuile — indépendant du 12×12 natif
    expect(p.displayH).toBeCloseTo(25.6, 5) // 1,6 tuile : le sprite « monte »
    expect(p.depth).toBeCloseTo(ySortDepth(10.3, TILE, TIE_ACTOR), 5)
  })
  it('la taille d’affichage ne dépend QUE de l’emprise et de tilePx (A9)', () => {
    const a = actorPlacement(0, 0, { widthTiles: 2, heightTiles: 2 }, 32, 0.6)
    expect(a.displayW).toBe(64)
    expect(a.displayH).toBe(64)
  })
  it('un acteur plus au sud (y plus grand) a une depth plus grande → rendu devant', () => {
    const nord = actorPlacement(0, 5, { widthTiles: 1, heightTiles: 1.6 }, TILE, 0.6)
    const sud = actorPlacement(0, 8, { widthTiles: 1, heightTiles: 1.6 }, TILE, 0.6)
    expect(sud.depth).toBeGreaterThan(nord.depth)
  })
})

const actorAt = (y: number): number => actorPlacement(0, y, { widthTiles: 1, heightTiles: 1.6 }, TILE, 0.6).depth

describe('structureDepth (R13)', () => {
  it('trie une structure par son bord bas, dans la même couche que les acteurs', () => {
    expect(structureDepth(9, TILE)).toBeCloseTo(Y_SORT_BASE + 10 * TILE + 0.6, 5) // pieds = ty+1
  })
  it('un acteur au nord d’une structure (feetY < ty+1) passe DERRIÈRE elle', () => {
    const wallDepth = structureDepth(9, TILE) // pieds à y=10
    expect(actorAt(9)).toBeLessThan(wallDepth) // feetY=9.3 → dessous → occulté
  })
  it('un acteur au sud d’une structure passe DEVANT elle', () => {
    expect(actorAt(10)).toBeGreaterThan(structureDepth(9, TILE)) // feetY=10.3
  })
})

describe('les props verticaux trient avec les acteurs', () => {
  it('un arbre au SUD du joueur le masque (le bug : les nœuds étaient à plat)', () => {
    // Arbre sur la tuile 10 → pieds à y=11. Joueur sur la tuile 9 → feetY=9.8.
    expect(nodeDepth(10, TILE)).toBeGreaterThan(actorAt(9.5))
  })
  it('un arbre au NORD du joueur est masqué par lui', () => {
    expect(nodeDepth(10, TILE)).toBeLessThan(actorAt(11.5))
  })
  it('un conifère du décor trie lui aussi avec les acteurs', () => {
    expect(clutterDepth(12, TILE)).toBeGreaterThan(actorAt(9.5))
    expect(clutterDepth(8, TILE)).toBeLessThan(actorAt(9.5))
  })
  it('le décor trie sur ses pieds RÉELS, décalage sub-tuile compris', () => {
    // Deux props de la rangée ty=5 : celui posé plus bas dans la tuile passe devant.
    expect(clutterDepth(6 + 0.3, TILE)).toBeGreaterThan(clutterDepth(6 - 0.3, TILE))
  })
})

describe('départage à pieds ÉGAUX (constantes TIE_*)', () => {
  it('décor < nœud < structure < acteur', () => {
    const feet = 10
    expect(clutterDepth(feet, TILE)).toBeLessThan(nodeDepth(feet - 1, TILE))
    expect(nodeDepth(feet - 1, TILE)).toBeLessThan(structureDepth(feet - 1, TILE))
    expect(structureDepth(feet - 1, TILE)).toBeLessThan(actorAt(feet - 0.3))
    expect(corpseDepth(feet, TILE)).toBeLessThan(clutterDepth(feet, TILE))
  })
  it('un départage ne renverse JAMAIS un écart de profondeur réel (< 1 px monde)', () => {
    // Un acteur (tie le plus fort) reste derrière un décor d'un pixel plus bas.
    expect(actorAt(10 - 0.3)).toBeLessThan(clutterDepth(10 + 1 / TILE, TILE))
  })
})

describe('budget des profondeurs', () => {
  it('le sol plat reste sous la bande de tri', () => {
    expect(GROUND_FIRE_DEPTH).toBeLessThan(Y_SORT_BASE)
  })
  it('la vallée canonique (3600 tuiles) ne perce pas la canopée ni la nuit', () => {
    // Le bug latent : depth = BASE + y suffisait pour 192 tuiles, pas pour 3600.
    const leBasDeLaCarte = actorAt(3600)
    expect(leBasDeLaCarte).toBeLessThan(CANOPY_DEPTH)
    expect(leBasDeLaCarte).toBeLessThan(AMBIENT_DEPTH)
    expect(leBasDeLaCarte).toBeLessThan(OVERLAY_DEPTH)
  })
})

describe('houppiers : la bande de profondeur (A9)', () => {
  it('un houppier coiffe TOUT acteur atteignable sur la vallée canonique (3600 tuiles)', () => {
    const acteurLePlusAuSud = ySortDepth(3600, TILE, TIE_ACTOR)
    expect(crownDepth(0, TILE)).toBeGreaterThan(acteurLePlusAuSud)
  })

  it('un houppier reste SOUS la canopée, la nuit et les halos', () => {
    expect(crownDepth(3601, TILE)).toBeLessThan(CANOPY_DEPTH)
  })

  it('deux houppiers se trient entre eux par leur rangée', () => {
    expect(crownDepth(11, TILE)).toBeGreaterThan(crownDepth(10, TILE))
  })
})

describe('lucioles : entre le sol et le houppier (Alexis, 2026-08-26)', () => {
  // La vallée canonique fait 3600 tuiles : une luciole peut dériver n'importe où dedans, et
  // elle flotte, donc son y n'est pas borné par une rangée entière. On balaie TOUT le domaine
  // au pas de la tuile, plus les bords fractionnaires — la propriété est de BANDE, pas
  // d'échantillon, et c'est ce qui la rend prouvable.
  const domaine: number[] = []
  for (let y = 0; y <= 3600; y++) domaine.push(y, y + 0.5)

  it('AUCUNE luciole ne passe devant un houppier, où qu\'elles soient toutes deux', () => {
    // Le houppier LE PLUS BAS de la carte (rangée 0) contre la luciole LA PLUS BASSE (y max) :
    // si celui-là gagne, tous gagnent, puisque `crownDepth` croît avec la rangée.
    const houppierLePlusHaut = crownDepth(0, TILE)
    for (const y of domaine) expect(fireflyDepth(y, TILE)).toBeLessThan(houppierLePlusHaut)
  })

  it('AUCUNE luciole ne tombe sous le sol, ni sous ce qui rampe dessus', () => {
    for (const y of domaine) {
      expect(fireflyDepth(y, TILE)).toBeGreaterThan(Y_SORT_BASE - 1)
      expect(fireflyDepth(y, TILE)).toBeGreaterThan(GROUND_PROP_DEPTH)
      expect(fireflyDepth(y, TILE)).toBeGreaterThan(GROUND_FIRE_DEPTH)
      expect(fireflyDepth(y, TILE)).toBeGreaterThan(FLOOR_DEPTH)
    }
  })

  it('elle trie AVEC le sous-bois : un fût plus au sud la couvre, un fût plus au nord non', () => {
    // C'est TOUT l'objet du changement — avant, elle passait devant les deux.
    expect(fireflyDepth(10, TILE)).toBeLessThan(nodeDepth(10, TILE)) // le fût de la rangée d'en dessous
    expect(fireflyDepth(10, TILE)).toBeGreaterThan(nodeDepth(8, TILE)) // celui d'au-dessus
  })

  it('elle survit au voile de nuit du mode ÉCLAIRÉ (le mode nominal)', () => {
    // AMBIENT_DEPTH_LIT passe sous la bande Y : c'est la condition qui rend la descente possible.
    for (const y of domaine) expect(fireflyDepth(y, TILE)).toBeGreaterThan(AMBIENT_DEPTH_LIT)
  })
})

describe('houppiers : le disque de découvert (A8)', () => {
  it('sous la cime (d ≤ R_IN) le houppier s\'efface à A_MIN', () => {
    expect(crownAlpha(0)).toBe(CROWN_ALPHA_MIN)
    expect(crownAlpha(CROWN_R_IN)).toBe(CROWN_ALPHA_MIN)
  })

  it('au-delà de R_OUT la forêt est un couvert opaque', () => {
    expect(crownAlpha(CROWN_R_OUT)).toBe(1)
    expect(crownAlpha(50)).toBe(1)
  })

  it('entre les deux, l\'alpha croît continûment (pas de scintillement en marchant)', () => {
    const mid = crownAlpha((CROWN_R_IN + CROWN_R_OUT) / 2)
    expect(mid).toBeGreaterThan(CROWN_ALPHA_MIN)
    expect(mid).toBeLessThan(1)
    let prev = crownAlpha(0)
    for (let d = 0; d <= 6; d += 0.05) {
      const a = crownAlpha(d)
      expect(a).toBeGreaterThanOrEqual(prev - 1e-9) // monotone croissante
      prev = a
    }
  })

  it('les jointures sont continues (R_IN et R_OUT)', () => {
    expect(crownAlpha(CROWN_R_IN + 1e-6)).toBeCloseTo(CROWN_ALPHA_MIN, 5)
    expect(crownAlpha(CROWN_R_OUT - 1e-6)).toBeCloseTo(1, 5)
  })

  /**
   * LES DEUX RAYONS SONT DES DÉRIVÉS — et c'est ça qu'on garde.
   *
   * Les trois gardes ci-dessus s'écrivent en fonction des constantes qu'elles testent : elles
   * passent à N'IMPORTE QUELLE valeur, y compris celle du 28/07 qui avait poussé `R_OUT` hors
   * du cadre (21 tuiles pour une demi-diagonale d'écran de 20,4 — plus un seul houppier opaque
   * dans l'image, mesuré 5/131 au navigateur). Ce qui suit affirme le MONDE : le cadre, et la
   * hauteur des arbres. Un futur agrandissement des cimes ne peut plus emporter le disque.
   */
  it('le couvert se referme DANS le cadre, pas au-delà', () => {
    // Le bord haut/bas de l'image : au-delà, la forêt est pleine. Sinon la borne extérieure
    // n'existe que dans la fonction.
    expect(CROWN_R_OUT).toBeLessThanOrEqual(VISIBLE_TILES_TALL / 2)
    // …et elle se referme quand même APRÈS le cœur clair : un disque, pas une marche.
    expect(CROWN_R_OUT).toBeGreaterThan(CROWN_R_IN)
  })

  it('le cœur clair couvre EXACTEMENT les cimes capables de te cacher', () => {
    // Un houppier ne déborde que vers le HAUT de l'écran, sur la hauteur de son arbre : au-delà
    // de la hauteur du plus haut, aucune cime ne peut plus couvrir l'avatar. En deçà, il en
    // resterait une qui te cache — l'aide de jeu manquerait sa raison d'être.
    const plusHaut = Math.max(...Object.values(ARBRES).map(hauteurTuiles))
    expect(CROWN_R_IN).toBe(plusHaut)
    // La confrontation que `framing` ne peut pas faire lui-même (il est en amont d'`arbre-art`,
    // qui lit `TILE_PX` : l'importer ferait un cycle). Si les arbres grandissent, ça tombe ici.
    expect(hauteurTuiles(ARBRES.old_tree)).toBe(6)
  })
})

/**
 * ═══ LE TRI Y, DANS TOUS LES SENS (décision d'Alexis, 2026-07-27) ═══
 *
 * Deux choses distinctes, et il faut les deux :
 *   1. L'ORDRE — un acteur au sud d'une barrière passe DEVANT, au nord il passe DERRIÈRE. C'est
 *      le tri Y nu, et il est juste dans les quatre directions.
 *   2. L'AVALEMENT — « derrière » devient invisible dès que la barrière est HAUTE (deux tuiles).
 *      `barriereAvale` désigne alors la barrière à trancher. Une garde par direction, plus les
 *      diagonales, plus les deux hauteurs : un mur avale à deux tuiles, une clôture non.
 */
describe('le tri Y et l’avalement des barrières', () => {
  const MUR = { hauteurPx: 32, largeurPx: 20 }
  const CLOTURE = { hauteurPx: 8, largeurPx: 20 }
  const ACTEUR = { largeurPx: 12, hauteurPx: 12 }
  /** Le mur de référence : la tuile (10,10). */
  const mur = { tx: 10, ty: 10, ...MUR }
  const acteur = (x: number, y: number) => ({ x, y, ...ACTEUR })

  it('l’ORDRE : au sud on passe devant, au nord on passe derrière', () => {
    const devant = ySortDepth(11.5, TILE, TIE_ACTOR) //   un acteur UNE tuile au sud
    const derriere = ySortDepth(10.0, TILE, TIE_ACTOR) // un acteur au nord
    expect(devant).toBeGreaterThan(structureDepth(10, TILE))
    expect(derriere).toBeLessThan(structureDepth(10, TILE))
  })

  it('un MUR avale qui se tient dans les deux rangées au NORD, et le dit', () => {
    expect(barriereAvale(mur, acteur(10.5, 10.4), TILE), 'même tuile, au-dessus du bas').toBe(true)
    expect(barriereAvale(mur, acteur(10.5, 9.6), TILE), 'une tuile au nord').toBe(true)
    expect(barriereAvale(mur, acteur(10.5, 8.9), TILE), 'deux tuiles au nord').toBe(true)
  })

  it('mais PAS au-delà de sa hauteur : à trois tuiles, il ne cache plus rien', () => {
    expect(barriereAvale(mur, acteur(10.5, 7.5), TILE)).toBe(false)
  })

  it('ni au SUD — là, c’est l’acteur qui passe devant, il n’y a rien à trancher', () => {
    for (const y of [11.2, 12.5, 14]) expect(barriereAvale(mur, acteur(10.5, y), TILE), `y=${y}`).toBe(false)
  })

  it('ni À CÔTÉ : une colonne d’écart et les deux sprites ne se touchent plus', () => {
    expect(barriereAvale(mur, acteur(12.2, 9.6), TILE), 'loin à l’est').toBe(false)
    expect(barriereAvale(mur, acteur(8.8, 9.6), TILE), 'loin à l’ouest').toBe(false)
    // En revanche le sprite du mur DÉBORDE de sa tuile (20 px pour 16) : un acteur qui mord sur
    // la colonne voisine est bel et bien recouvert, et la garde doit le voir.
    expect(barriereAvale(mur, acteur(11.3, 9.6), TILE), 'à cheval sur la colonne voisine').toBe(true)
  })

  it('LES DIAGONALES suivent la même règle, sans cas particulier', () => {
    const clot = { tx: 10, ty: 10, ...CLOTURE }
    // Au nord-ouest et au nord-est, à portée du sprite : avalé par le mur, PAS par la clôture
    // (8 px : elle ne monte pas jusqu’à la rangée du dessus).
    for (const [x, y] of [[10.2, 9.6], [10.8, 9.6]] as const) {
      expect(barriereAvale(mur, acteur(x, y), TILE), `mur (${x},${y})`).toBe(true)
      expect(barriereAvale(clot, acteur(x, y), TILE), `clôture (${x},${y})`).toBe(false)
    }
    // Au sud-ouest et au sud-est : jamais.
    for (const [x, y] of [[10.2, 11.4], [10.8, 11.4]] as const) {
      expect(barriereAvale(mur, acteur(x, y), TILE), `mur (${x},${y})`).toBe(false)
    }
  })

  it('une CLÔTURE basse n’avale que ce qui la touche vraiment', () => {
    const clot = { tx: 10, ty: 10, ...CLOTURE }
    expect(barriereAvale(clot, acteur(10.5, 10.5), TILE), 'dans sa tuile').toBe(true)
    expect(barriereAvale(clot, acteur(10.5, 9.2), TILE), 'une tuile au nord').toBe(false)
  })
})

describe('le seuil se dessine APRÈS le mur (il ne doit pas être mordu)', () => {
  it('à pieds ÉGAUX, le seuil passe devant le mur — et reste sous l’acteur', () => {
    // Une bande de mur déborde d'une demi-épaisseur chez ses voisins pour se recoudre à eux ;
    // sans ce départage, la pierre du mur d'à côté recouvrait le bois de la porte.
    expect(seuilDepth(10, TILE)).toBeGreaterThan(structureDepth(10, TILE))
    expect(seuilDepth(10, TILE)).toBeLessThan(ySortDepth(11, TILE, TIE_ACTOR))
  })
  it('mais le départage ne renverse jamais une rangée d’écart', () => {
    expect(seuilDepth(10, TILE)).toBeLessThan(structureDepth(11, TILE))
  })
})

/**
 * SE COLLER À UN MUR PAR LE BAS (rapport d'Alexis, 2026-07-27) — on doit passer DEVANT.
 *
 * Une clôture, ou le mur du bas d'une ferme, porte son arête au NORD de sa tuile. Qui se colle
 * à elle par le sud partage donc SA TUILE tout en étant au sud d'elle : trier la barrière sur
 * `ty + 1` la faisait passer devant le personnage, qui disparaissait dans un mur qu'il longeait.
 */
describe('une barrière trie sur sa BANDE, pas sur sa tuile', () => {
  const N = 1, S = 4, E = 2
  const DEMI = 0.125 //  WALL_EDGE_SUB/2 sur SUBTILES_PER_TILE

  it('collé par le BAS à une clôture (arête nord), le personnage passe DEVANT', () => {
    const cloture = barriereDepth(18, N, TILE, DEMI)
    const joueurColle = ySortDepth(18.5 + 0.3, TILE, TIE_ACTOR) //  pieds à 18,8
    expect(joueurColle).toBeGreaterThan(cloture)
  })

  it('mais au NORD de la même bande, il passe bien DERRIÈRE', () => {
    const cloture = barriereDepth(18, N, TILE, DEMI)
    // La collision l'arrête bande comprise : ses pieds ne dépassent pas le bord nord.
    const joueurDerriere = ySortDepth(17.575 + 0.3, TILE, TIE_ACTOR)
    expect(joueurDerriere).toBeLessThan(cloture)
  })

  it('une bande SUD ou VERTICALE garde les pieds au bas de sa tuile (elle y descend)', () => {
    expect(barriereDepth(18, S, TILE, DEMI)).toBe(structureDepth(18, TILE))
    expect(barriereDepth(18, E, TILE, DEMI)).toBe(structureDepth(18, TILE))
    expect(barriereDepth(18, N | E, TILE, DEMI), 'un angle descend aussi').toBe(structureDepth(18, TILE))
  })
})

/* ═══ LES ÉTAGES — LA STRATE, ET LE DISQUE DE DÉCOUVERT ══════════════════════
 *
 * CE QUI FAIT ROUGIR CE BLOC, et c'est le défaut qu'on ferme (Alexis, 2026-09-01 : « on le voit
 * comme s'il était SUR la mesa par transparence ») : que la profondeur d'un plancher d'étage
 * retombe sous celle d'un corps de l'étage du dessous. C'était le cas EXACT d'avant — le plateau
 * triait entre 0 et 1, les corps à partir de 1 000 — et aucune garde ne le voyait, parce
 * qu'aucune ne confrontait les deux échelles.
 *
 * On balaie donc la vallée canonique (3 600 tuiles) au lieu d'échantillonner : la propriété est
 * de BANDE, pas de cas particulier, et c'est ce qui la rend prouvable.
 */
describe('étages : une strate se peint par-dessus l’autre, en entier', () => {
  const solDEtage = (ty: number, niveau: number): number => strateDEtage(niveau) + ySortDepth(ty, TILE, 0)
  const acteur = (feetY: number, niveau: number): number => strateDEtage(niveau) + ySortDepth(feetY, TILE, TIE_ACTOR)

  it('AUCUN corps de l’étage 0 ne passe devant le plancher de l’étage 1, où qu’ils soient tous deux', () => {
    // Le plancher LE PLUS AU NORD (rangée 0, donc le moins profond de sa strate) contre le corps
    // LE PLUS AU SUD (le plus profond de la sienne) : si celui-là gagne, tous gagnent.
    const leMoinsProfondDesPlanchers = solDEtage(0, 1)
    for (let feet = 0; feet <= 3600; feet += 1) {
      expect(acteur(feet, 0)).toBeLessThan(leMoinsProfondDesPlanchers)
    }
  })

  it('un corps POSÉ sur le plateau reste devant le plancher qui le porte', () => {
    // ⚠ C'est ce qui interdit de trier le plancher sur `ty + 1` : les pieds d'un corps debout sur
    // la tuile `ty` sont en `ty + AVATAR_HITBOX_DEPTH_TILES / 2` (0,1875), pas en `ty + 1`. Sur
    // `ty + 1`, le plancher passerait devant celui qui se tient dessus.
    for (let ty = 0; ty <= 3600; ty += 7) {
      expect(acteur(ty + 0.1875, 1)).toBeGreaterThan(solDEtage(ty, 1))
      // …et voici l'autre branche, celle qu'on a écartée : sur `ty + 1`, le plancher REPASSE
      // devant. C'est ce qu'il faut voir pour croire la ligne du dessus.
      expect(ySortDepth(ty + 1, TILE, 0)).toBeGreaterThan(ySortDepth(ty + 0.1875, TILE, TIE_ACTOR))
    }
  })

  it('à l’intérieur d’une strate, le tri en Y départage comme partout ailleurs', () => {
    expect(solDEtage(11, 1)).toBeGreaterThan(solDEtage(10, 1))
    expect(acteur(11, 1)).toBeGreaterThan(acteur(10, 1))
  })

  it('la strate dépasse toute la bande Y, et reste sous les toits et la canopée', () => {
    expect(ETAGE_STRATE).toBeGreaterThan(ySortDepth(3600, TILE, TIE_ACTOR))
    const leBasDuPalier = acteur(3600, 1)
    expect(leBasDuPalier).toBeLessThan(ROOF_DEPTH)
    expect(leBasDuPalier).toBeLessThan(CANOPY_DEPTH)
    expect(leBasDuPalier).toBeLessThan(OVERLAY_DEPTH)
  })

  it('le dessin monte, le tri change de monde — les deux nombres ne se confondent pas', () => {
    // Le défaut d'avant tenait en une ligne : `depth = p.depth + decalageDEtage(etage)`, c'est-à-
    // dire trier un corps du haut à la rangée où il est DESSINÉ. Il repassait alors derrière son
    // propre plancher dès que le lift dépassait sa demi-hitbox.
    expect(decalageDEtage(1)).toBeLessThan(0) // à l'écran, on monte
    expect(strateDEtage(1)).toBeGreaterThan(0) // en profondeur, on passe devant
  })
})

describe('étages : le disque de découvert (Alexis, 2026-09-01)', () => {
  it('sous le plateau (d ≤ R_IN) il s’efface, au-delà de R_OUT il est plein', () => {
    expect(plateauAlpha(0)).toBe(PLATEAU_ALPHA_MIN)
    expect(plateauAlpha(PLATEAU_R_IN)).toBe(PLATEAU_ALPHA_MIN)
    expect(plateauAlpha(PLATEAU_R_OUT)).toBe(1)
    expect(plateauAlpha(PLATEAU_R_OUT + 50)).toBe(1)
  })

  it('la pente est continue et monotone — sinon la découpe CLIGNOTE quand on marche', () => {
    let precedent = -1
    for (let d = 0; d <= PLATEAU_R_OUT + 1; d += 0.05) {
      const a = plateauAlpha(d)
      expect(a).toBeGreaterThanOrEqual(precedent)
      precedent = a
    }
  })

  it('le rayon clair COUVRE toute la portée d’occultation d’un plateau', () => {
    // ⚠ LA GARDE QUI COMPTE, et elle s'énonce sur la position DESSINÉE : le centre d'une tuile
    // capable de recouvrir un corps tombe dans `[f − 1 ; f + 0,5]` en Y et à ±0,9 en X — au plus
    // ~1,2 tuile de lui. Un `R_IN` plus court laisserait, à la lisière, des tuiles à demi opaques
    // par-dessus le joueur : le défaut qu'on prétend corriger, en moins visible.
    const porteeReelle = Math.sqrt(0.9 * 0.9 + 1 * 1)
    expect(PLATEAU_R_IN).toBeGreaterThanOrEqual(porteeReelle)
    expect(PLATEAU_R_OUT).toBeGreaterThan(PLATEAU_R_IN)
    // …et il reste NETTEMENT plus court que le disque du houppier : à six tuiles, le trou aurait
    // fait douze tuiles de diamètre sur un cadre qui en montre vingt.
    expect(PLATEAU_R_OUT).toBeLessThan(VISIBLE_TILES_TALL / 2)
  })

  it('le découvert se lit sur la position DESSINÉE, et se tait sans regard d’en bas', () => {
    const corps = { x: 10, y: 20, niveau: 0 }
    expect(alphaDeDecouvert(corps, 10.5, 20.5)).toBe(PLATEAU_ALPHA_MIN)
    expect(alphaDeDecouvert(corps, 10.5 + PLATEAU_R_OUT, 20.5)).toBe(1)
    expect(alphaDeDecouvert(null, 10.5, 20.5)).toBe(1)
    expect(alphaDeDecouvert(undefined, 10.5, 20.5)).toBe(1)
  })

  it('le découvert ne part que vers le HAUT : une pièce à son niveau ou dessous reste opaque', () => {
    // Un joueur au palier 1 d'une terrasse (spec `terrasses.md` T-R8) : la touffe du palier 1
    // et celle du palier 0 sous lui ne cèdent pas, celle de la mesa au niveau 2 cède.
    const corps = { x: 10, y: 20, niveau: 1 }
    expect(alphaDeDecouvert(corps, 10.5, 20.5, 1)).toBe(1)
    expect(alphaDeDecouvert(corps, 10.5, 20.5, 0)).toBe(1)
    expect(alphaDeDecouvert(corps, 10.5, 20.5, 2)).toBe(PLATEAU_ALPHA_MIN)
    // Sans niveau de pièce, l'appelant a déjà trié : elle est réputée plus haute.
    expect(alphaDeDecouvert(corps, 10.5, 20.5)).toBe(PLATEAU_ALPHA_MIN)
  })
})

describe('étages : le socle noir encadre le corps découvert (Alexis, 2026-09-01)', () => {
  const socle = (yDessine: number): number => ySortDepth(yDessine, TILE, TIE_SOCLE)
  const acteur = (feetY: number): number => ySortDepth(feetY, TILE, TIE_ACTOR)

  it('le socle passe DERRIÈRE tout corps qu’il pourrait couvrir', () => {
    // ⚠ CE QUI FERAIT ROUGIR : un socle qui passe devant le personnage — on aurait bouché la
    // transparence au lieu de lui donner un fond. La propriété se balaie sur toute la vallée
    // canonique : une pièce dessinée à la rangée `r` ne peut chevaucher un corps que si `r ≤ f`
    // (elle occupe `[r, r+1]`, le sprite `[f−1,5 ; f]`), et là elle doit perdre.
    for (let f = 0; f <= 3600; f += 1) {
      expect(socle(f)).toBeLessThan(acteur(f)) // le cas SERRÉ : même rangée, 0,05 d'écart
      expect(socle(f - 1)).toBeLessThan(acteur(f))
    }
  })

  it('mais DEVANT le décor, les nœuds et le bâti — sinon il ne bouche rien', () => {
    expect(TIE_SOCLE).toBeGreaterThan(TIE_STRUCTURE)
    expect(TIE_SOCLE).toBeLessThan(TIE_ACTOR)
    for (const r of [0, 10, 3600]) {
      expect(socle(r)).toBeGreaterThan(clutterDepth(r, TILE))
      expect(socle(r)).toBeGreaterThan(nodeDepth(r - 1, TILE))
      expect(socle(r)).toBeGreaterThan(structureDepth(r - 1, TILE))
    }
  })

  it('et SOUS le plancher de sa propre tuile : les deux encadrent le corps', () => {
    // Le plancher est dans la strate du haut, le socle dans celle du bas — l'écart ne peut pas
    // se refermer, quelle que soit la rangée.
    for (const ty of [0, 100, 3600]) {
      expect(socle(ty - LIFT_TUILES)).toBeLessThan(strateDEtage(1) + ySortDepth(ty, TILE, 0))
    }
  })
})
