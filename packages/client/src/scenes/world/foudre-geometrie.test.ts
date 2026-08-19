/**
 * LA FOUDRE SE PROUVE HEADLESS — le trait, la salve, la rampe de secousse, la gerbe.
 *
 * Le rendu se juge sur des pixels (scénario smoke `foudre`), mais une GÉOMÉTRIE se démontre.
 * On balaie donc des domaines entiers plutôt que trois cas choisis (patron « garde
 * exhaustive plutôt que cas choisis ») — 512 graines pour le trait, tout l'axe des distances
 * pour la secousse — et chaque propriété est affirmée SEULE.
 */
import { describe, expect, it } from 'vitest'
import {
  BATTEMENTS,
  BRANCHE_GARDE_TUILES,
  BUDGET_GERBE,
  GERBE_MS,
  GerbeFoudre,
  SECOUSSE_MAX,
  SECOUSSE_PLEIN_TUILES,
  SECOUSSE_PORTEE_TUILES,
  DEVIATION_TUILES,
  GRAIN_PX,
  SUBDIVISIONS,
  TRAIT_MS,
  battementA,
  cranDage,
  secousseA,
  segmentEnRuns,
  traceEnRuns,
  tracerEclair,
  type Point,
  type Run,
} from './foudre-geometrie'

const IMPACT: Point = { x: 420.5, y: 260.25 }
const HAUT_Y = IMPACT.y - 22 // le plafond du cadre : ~22 tuiles au-dessus de la frappe

/** Les 512 premières graines — un tick de frappe est un entier, elles se suivent. */
const GRAINES = Array.from({ length: 512 }, (_, i) => 1000 + i)

describe('① le trait va du ciel au point d’impact', () => {
  it('finit EXACTEMENT sur l’impact, sur 512 graines', () => {
    // C'est une garantie de JEU, pas d'ambiance : le télégraphe a promis une tuile pendant
    // 1,5 s, et le trait doit tomber dessus. Un éclair qui frappe à côté fait mentir
    // l'annonce à retardement, et le joueur qui s'est décalé a eu tort d'écouter.
    for (const g of GRAINES) {
      const t = tracerEclair(g, IMPACT, HAUT_Y)
      const fin = t.tronc[t.tronc.length - 1]!
      expect(fin.x).toBeCloseTo(IMPACT.x, 10)
      expect(fin.y).toBeCloseTo(IMPACT.y, 10)
    }
  })

  it('part du plafond demandé', () => {
    for (const g of GRAINES) {
      expect(tracerEclair(g, IMPACT, HAUT_Y).tronc[0]!.y).toBe(HAUT_Y)
    }
  })

  it('compte 2^SUBDIVISIONS + 1 points', () => {
    for (const g of GRAINES) {
      expect(tracerEclair(g, IMPACT, HAUT_Y).tronc).toHaveLength(2 ** SUBDIVISIONS + 1)
    }
  })

  it('descend sans jamais remonter — un éclair ne rebrousse pas', () => {
    // Le déplacement de milieu est PERPENDICULAIRE au segment local : sur un canal très
    // penché, il porte du vertical, et une amplitude trop grande ferait boucler le trait.
    // C'est la garde qui dit que l'amplitude reste compatible avec la chute.
    for (const g of GRAINES) {
      const { tronc } = tracerEclair(g, IMPACT, HAUT_Y)
      for (let i = 1; i < tronc.length; i++) {
        expect(tronc[i]!.y).toBeGreaterThan(tronc[i - 1]!.y)
      }
    }
  })
})

describe('① le détail du trait SURVIT à la grille de 4 px', () => {
  it('le déplacement le plus fin dépasse le grain — sinon on peint un FAISCEAU', () => {
    /**
     * LA GARDE QUI A COÛTÉ UNE PLANCHE. À `SUBDIVISIONS = 5`, le déplacement du dernier
     * niveau valait `2,6 × 0,5⁴ = 0,16` tuile, soit 2,6 px monde — SOUS le grain de 4 px.
     * Les trois derniers niveaux étaient quantifiés à ZÉRO : le trait rendu à l'écran
     * n'avait plus qu'un coude et lisait « faisceau », alors que la géométrie, elle, était
     * riche. On payait le calcul et les rectangles pour rien.
     *
     * L'amplitude se divise par deux à chaque niveau, donc la plus fine est celle du
     * DERNIER : `DEVIATION_TUILES × 0,5^(SUBDIVISIONS−1)`. Elle doit dépasser une cellule.
     * Monter `SUBDIVISIONS` ou baisser `DEVIATION_TUILES` sans regarder casserait ça en
     * silence — c'est exactement ce que cette garde empêche.
     */
    const TUILE_PX = 16
    const finPx = DEVIATION_TUILES * 0.5 ** (SUBDIVISIONS - 1) * TUILE_PX
    expect(finPx).toBeGreaterThan(GRAIN_PX)
  })
})

describe('① la déviation latérale décroît vers le sol', () => {
  /**
   * L'ÉTALON EST LA VERTICALE DE L'IMPACT, PAS LA CORDE — et c'est le premier jet de ce
   * test qui l'a appris (MESURÉ). Mesurée à la corde ciel → impact, la déviation d'un
   * déplacement de milieu est une BOSSE SYMÉTRIQUE : elle vaut 0 aux deux bouts (ils sont
   * épinglés, par construction) et culmine au milieu. Ce nombre-là ne dit rien de ce que la
   * directive demande. « Déviation latérale décroissante vers le sol » parle de l'écart à la
   * CHUTE VERTICALE au-dessus de la tuile frappée : c'est ce que l'œil lit, et c'est ce que
   * le penché de naissance porte.
   */
  const ecartVertical = (p: Point): number => Math.abs(p.x - IMPACT.x)

  it('décroît À CHAQUE PAS en moyenne, du plafond à l’impact — 32 pas, aucune remontée', () => {
    // Garde exhaustive plutôt que cas choisis : on n'oppose pas deux tiers, on affirme la
    // décroissance sur TOUS les pas. Un renflement au milieu (le défaut exact du premier
    // jet) passerait une comparaison haut/bas et échouerait ici.
    const n = 2 ** SUBDIVISIONS + 1
    const somme = new Array<number>(n).fill(0)
    for (const g of GRAINES) {
      const { tronc } = tracerEclair(g, IMPACT, HAUT_Y)
      for (let i = 0; i < n; i++) somme[i]! += ecartVertical(tronc[i]!)
    }
    for (let i = 1; i < n; i++) expect(somme[i]!).toBeLessThan(somme[i - 1]!)
  })

  it('vaut EXACTEMENT 0 à l’impact, sur chaque graine', () => {
    // La borne exacte de la rampe (« feel = pente continue »), côté géométrie : le trait
    // ne s'approche pas de la tuile frappée, il finit DESSUS.
    for (const g of GRAINES) {
      const { tronc } = tracerEclair(g, IMPACT, HAUT_Y)
      expect(ecartVertical(tronc[tronc.length - 1]!)).toBe(0)
    }
  })

  it('le QUART BAS reste sous 2,4 tuiles d’écart — le plafond que le taper garantit', () => {
    /**
     * CE QUI EST VRAI PAR GRAINE, ET CE QUI NE L'EST PAS — MESURÉ, et il faut le dire.
     *
     * « Le quart bas s'écarte moins que le quart haut » est vrai en MOYENNE mais FAUX sur
     * 95 graines sur 4 096 (2,3 %) : le déplacement de milieu est un tirage, et sur une
     * graine dont le penché de naissance est presque nul, un coude bas peut dépasser un
     * haut sage. Affirmer cet ordre par graine serait affirmer quelque chose de faux.
     *
     * Ce qui est vrai sur toutes les graines, c'est le PLAFOND : près du sol le facteur
     * `1 − u` étrangle l'amplitude, et le trait reste dans une colonne étroite au-dessus de
     * la tuile qu'il va frapper. C'est cette borne-là qu'on garde (relevé sur 8 192 graines :
     * pire cas 2,13 tuiles en bas contre 5,48 en haut), parce que c'est celle que l'œil lit
     * — « il converge » — et parce qu'elle casserait si on montait l'amplitude.
     */
    for (const g of GRAINES) {
      const { tronc } = tracerEclair(g, IMPACT, HAUT_Y)
      const bas = tronc.slice(Math.floor((3 * tronc.length) / 4)).map(ecartVertical)
      expect(Math.max(...bas)).toBeLessThan(2.4)
    }
  })

  it('le tiers HAUT s’écarte au moins trois fois plus que le tiers BAS', () => {
    // La lecture à l'œil, chiffrée : le trait erre en haut et converge en bas.
    let haut = 0
    let bas = 0
    for (const g of GRAINES) {
      const { tronc } = tracerEclair(g, IMPACT, HAUT_Y)
      for (let i = 0; i < tronc.length; i++) {
        const u = i / (tronc.length - 1)
        if (u < 1 / 3) haut += ecartVertical(tronc[i]!)
        else if (u > 2 / 3) bas += ecartVertical(tronc[i]!)
      }
    }
    expect(haut).toBeGreaterThan(bas * 3)
  })

  it('le détail fin existe quand même — le trait n’est pas une droite penchée', () => {
    // La décroissance ci-dessus serait aussi vraie d'un simple segment incliné. C'est la
    // garde qui prouve que la SUBDIVISION sert à quelque chose : l'écart à la corde doit
    // être franchement non nul quelque part.
    let pire = 0
    for (const g of GRAINES) {
      const { tronc } = tracerEclair(g, IMPACT, HAUT_Y)
      const a = tronc[0]!
      const b = tronc[tronc.length - 1]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.sqrt(dx * dx + dy * dy)
      for (const p of tronc) {
        pire = Math.max(pire, Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len)
      }
    }
    expect(pire).toBeGreaterThan(0.75) // au moins trois quarts de tuile de coude
  })
})

describe('① les ramifications n’atteignent JAMAIS le sol', () => {
  it('reste au moins BRANCHE_GARDE_TUILES au-dessus de la ligne d’impact, sur 512 graines', () => {
    // RÈGLE DE JEU, pas de goût : une branche qui touche dessinerait un SECOND impact là où
    // la sim n'en résout qu'un, et un joueur s'en servirait pour décider où se mettre.
    let pire = -Infinity
    for (const g of GRAINES) {
      for (const br of tracerEclair(g, IMPACT, HAUT_Y).branches) {
        for (const p of br) pire = Math.max(pire, p.y)
      }
    }
    expect(pire).toBeLessThanOrEqual(IMPACT.y - BRANCHE_GARDE_TUILES + 1e-9)
  })

  it('il y en a une ou deux, jamais zéro ni trois', () => {
    const vus = new Set<number>()
    for (const g of GRAINES) vus.add(tracerEclair(g, IMPACT, HAUT_Y).branches.length)
    expect([...vus].sort()).toEqual([1, 2])
  })

  it('elles ont une longueur non nulle même quand la garde les raccourcit', () => {
    // La garde raccourcit la LONGUEUR (elle ne couche pas la pointe) — mais sur une chute
    // courte elle pourrait tout manger. On vérifie sur une chute serrée, où elle mord.
    for (const g of GRAINES.slice(0, 128)) {
      for (const br of tracerEclair(g, IMPACT, IMPACT.y - 8).branches) {
        const a = br[0]!
        const b = br[br.length - 1]!
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0)
      }
    }
  })
})

describe('① le trait est FIGÉ : même graine, même trait', () => {
  it('deux appels sur le même tick rendent le même trait au flottant près', () => {
    // Un éclair ne se tortille pas d'une image à l'autre. La forme est tirée du TICK, donc
    // elle est reproductible — c'est aussi ce qui permet au smoke de la photographier.
    for (const g of GRAINES.slice(0, 64)) {
      expect(tracerEclair(g, IMPACT, HAUT_Y)).toEqual(tracerEclair(g, IMPACT, HAUT_Y))
    }
  })

  it('deux ticks voisins ne rendent PAS le même trait', () => {
    let differents = 0
    for (const g of GRAINES.slice(0, 64)) {
      const a = tracerEclair(g, IMPACT, HAUT_Y)
      const b = tracerEclair(g + 1, IMPACT, HAUT_Y)
      if (JSON.stringify(a) !== JSON.stringify(b)) differents++
    }
    expect(differents).toBe(64)
  })
})

describe('① l’escalier de 4 px : des carrés durs, jamais un trait lissé', () => {
  it('un segment couvre l’axe dominant sans trou et sans doublon', () => {
    // La propriété qui compte pour l'œil : pas de cellule sautée le long du trait (des
    // pointillés), pas de recouvrement (des paliers plus opaques que les autres).
    const hors: Run[] = []
    for (let dx = -40; dx <= 40; dx += 3) {
      for (let dy = -40; dy <= 40; dy += 3) {
        const n = segmentEnRuns(0, 0, dx, dy, 1, hors, 0)
        const majX = Math.abs(dx) >= Math.abs(dy)
        let couvert = 0
        for (let i = 0; i < n; i++) couvert += majX ? hors[i]!.w : hors[i]!.h
        expect(couvert).toBe(Math.abs(majX ? dx : dy) + 1)
      }
    }
  })

  it('les runs se suivent : la mineure ne bouge que d’une cellule à la fois', () => {
    const hors: Run[] = []
    for (let dx = -40; dx <= 40; dx += 7) {
      for (let dy = -40; dy <= 40; dy += 7) {
        const n = segmentEnRuns(0, 0, dx, dy, 1, hors, 0)
        const majX = Math.abs(dx) >= Math.abs(dy)
        for (let i = 1; i < n; i++) {
          const avant = majX ? hors[i - 1]!.cy : hors[i - 1]!.cx
          const apres = majX ? hors[i]!.cy : hors[i]!.cx
          expect(Math.abs(apres - avant)).toBe(1)
        }
      }
    }
  })

  it('un segment de longueur nulle rend UN carré, pas zéro', () => {
    const hors: Run[] = []
    expect(segmentEnRuns(7, 9, 7, 9, 2, hors, 0)).toBe(1)
    expect(hors[0]).toEqual({ cx: 7, cy: 9, w: 2, h: 2 })
  })

  it('écrit à partir de `depart` sans écraser ce qui précède', () => {
    const hors: Run[] = [{ cx: -1, cy: -1, w: -1, h: -1 }]
    segmentEnRuns(0, 0, 5, 1, 1, hors, 1)
    expect(hors[0]).toEqual({ cx: -1, cy: -1, w: -1, h: -1 })
  })
})

describe('① ce que le trait coûte en rectangles', () => {
  it('reste sous 200 runs par éclair SUR TOUTE LA PLAGE DE CHUTE — pas seulement la nominale', () => {
    /**
     * LE COMPTE CROÎT AVEC LA CHUTE, et c'est ce que la première version avait manqué.
     *
     * Elle n'affirmait le plafond que pour UNE hauteur (22 tuiles), et `foudre-fx` faisait
     * partir le trait du haut du CADRE — or une frappe hors champ met le haut du cadre à des
     * centaines de tuiles du point. MESURÉ au smoke : **1 326 rectangles pour un éclair**
     * (chute ~450 tuiles), deux fois et demie le rideau de pluie entier. `foudre-fx` borne
     * désormais la chute à `CHUTE_MAX_TUILES` = 26 ; on balaie donc TOUTE la plage légale
     * [8, 26], pas la valeur confortable. Les deux passes de peinture sont comptées
     * ensemble, parce que c'est ce que la couche paie réellement.
     */
    const hors: Run[] = []
    let pire = 0
    let moindre = Infinity
    for (let chute = 8; chute <= 26; chute += 1) {
      for (const g of GRAINES) {
        const t = tracerEclair(g, IMPACT, IMPACT.y - chute)
        const n = traceEnRuns(t, 4, [3, 2], hors) + traceEnRuns(t, 4, [1, 1], hors)
        pire = Math.max(pire, n)
        moindre = Math.min(moindre, n)
      }
    }
    expect(moindre).toBeGreaterThan(30) // une garde prouve sa prémisse : il DESSINE quelque chose
    expect(pire).toBeLessThan(200) // ~1/3 du rideau de pluie (543 rectangles), et 172 ms seulement
  })
})

describe('② la salve : un éclair BAT, il ne s’éteint pas', () => {
  it('alterne pleins et creux — au moins trois crans hauts séparés par des bas', () => {
    // Ce qui fait le stroboscope : ce n'est pas la durée, c'est l'ALTERNANCE. On l'affirme
    // sur la table plutôt que sur une impression.
    const hauts = BATTEMENTS.filter((b) => b.cran >= 0.4).length
    const bas = BATTEMENTS.filter((b) => b.cran < 0.25).length
    expect(hauts).toBeGreaterThanOrEqual(3)
    expect(bas).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < BATTEMENTS.length; i++) {
      // Jamais deux crans identiques d'affilée : ce serait un palier, pas un battement.
      expect(BATTEMENTS[i]!.cran).not.toBe(BATTEMENTS[i - 1]!.cran)
    }
  })

  it('les bornes montent strictement, et TRAIT_MS est la dernière', () => {
    for (let i = 1; i < BATTEMENTS.length; i++) {
      expect(BATTEMENTS[i]!.finMs).toBeGreaterThan(BATTEMENTS[i - 1]!.finMs)
    }
    expect(TRAIT_MS).toBe(BATTEMENTS[BATTEMENTS.length - 1]!.finMs)
  })

  it('chaque battement dure 2 à 3 images à 60 Hz', () => {
    // « Scintillement sur 2-3 images » : on le vérifie, on ne l'espère pas.
    let debut = 0
    for (const b of BATTEMENTS) {
      const images = (b.finMs - debut) / (1000 / 60)
      expect(images).toBeGreaterThanOrEqual(1.4)
      expect(images).toBeLessThanOrEqual(3.0)
      debut = b.finMs
    }
  })

  it('`battementA` balaie toute la fenêtre puis rend 0, ms par ms', () => {
    for (let ms = 0; ms < TRAIT_MS; ms++) {
      const b = battementA(ms)
      expect(b.index).toBeGreaterThanOrEqual(0)
      expect(b.cran).toBe(BATTEMENTS[b.index]!.cran)
    }
    for (let ms = TRAIT_MS; ms < TRAIT_MS + 200; ms++) {
      expect(battementA(ms)).toEqual({ index: -1, cran: 0 })
    }
    expect(battementA(-1)).toEqual({ index: -1, cran: 0 })
  })

  it('le premier battement est PLEIN — le coup ne monte pas en fondu', () => {
    expect(battementA(0).cran).toBe(1)
  })
})

describe('③ la secousse décroît avec la distance, aux bornes exactes', () => {
  it('vaut SECOUSSE_MAX à la borne de plein et en deçà', () => {
    for (let d = 0; d <= SECOUSSE_PLEIN_TUILES; d += 0.05) expect(secousseA(d)).toBe(SECOUSSE_MAX)
  })

  it('vaut EXACTEMENT 0 à la portée et au-delà — un coup à trente tuiles ne secoue rien', () => {
    for (let d = SECOUSSE_PORTEE_TUILES; d <= 200; d += 0.25) expect(secousseA(d)).toBe(0)
  })

  it('décroît sur TOUT l’intervalle, sans palier ni plateau', () => {
    // « Feel = pente continue » : on balaie l'axe au vingtième de tuile et on affirme la
    // décroissance STRICTE entre les deux bornes — un palier au milieu passerait un test
    // à trois points choisis, pas celui-ci.
    let prec = Infinity
    for (let d = SECOUSSE_PLEIN_TUILES; d < SECOUSSE_PORTEE_TUILES; d += 0.05) {
      const v = secousseA(d)
      expect(v).toBeLessThan(prec)
      expect(v).toBeGreaterThanOrEqual(0)
      prec = v
    }
  })

  it('ne dépasse jamais le plafond, sur tout l’axe et sur les valeurs sales', () => {
    for (let d = 0; d <= 200; d += 0.05) expect(secousseA(d)).toBeLessThanOrEqual(SECOUSSE_MAX)
    expect(secousseA(Number.NaN)).toBe(0)
    expect(secousseA(-5)).toBe(0)
    expect(secousseA(Infinity)).toBe(0)
  })

  it('« un peu » : le plafond vaut moins de huit pixels d’écran', () => {
    // L'unité de `camera.shake` est une FRACTION DU CADRE, pas un pixel : Phaser déplace de
    // ±intensité × camera.width × zoom. Le nombre qu'on juge est donc celui-là, calculé —
    // pas la constante nue, qui ne dit rien à personne.
    const px = SECOUSSE_MAX * 1280 * 2.25
    expect(px).toBeGreaterThan(3)
    expect(px).toBeLessThan(8)
  })
})

describe('④ la gerbe part À L’OPPOSÉ du point de frappe', () => {
  const OU: Point = { x: 100, y: 50 }

  it('CHAQUE éclat s’éloigne : le produit scalaire (position − impact)·vitesse est > 0', () => {
    // Rappel maison MESURÉ : une gerbe dirigée vers le centre se tasse sur elle-même. On
    // l'affirme sur tous les éclats, à toutes les images de leur vie — pas seulement à la
    // naissance, où c'est trivial : la traînée pourrait inverser un signe.
    const gerbe = new GerbeFoudre(7)
    gerbe.frapper(OU.x, OU.y)
    for (let img = 0; img < 20; img++) {
      gerbe.update(1000 / 60)
      for (const e of gerbe.eclats) {
        if (!e.vive) continue
        const dot = (e.x - OU.x) * e.vx + (e.y - OU.y) * e.vy
        expect(dot).toBeGreaterThan(0)
      }
    }
  })

  it('couvre TOUS les quadrants — une gerbe borgne n’est pas radiale', () => {
    const gerbe = new GerbeFoudre(11)
    gerbe.frapper(OU.x, OU.y)
    gerbe.update(1000 / 60)
    const quadrants = new Set<string>()
    for (const e of gerbe.eclats) {
      if (!e.vive) continue
      quadrants.add(`${e.x >= OU.x ? '+' : '-'}${e.y >= OU.y ? '+' : '-'}`)
    }
    expect(quadrants.size).toBe(4)
  })

  it('couvre le cercle sans TROU : aucun secteur de 30° n’est vide', () => {
    // L'éventail régulier existe pour ça. Un tirage libre laisserait des grumeaux, et une
    // gerbe grumeleuse lit « débris » au lieu de « souffle ».
    for (const graine of [1, 2, 3, 99, 12345]) {
      const gerbe = new GerbeFoudre(graine)
      gerbe.frapper(OU.x, OU.y)
      gerbe.update(1000 / 60)
      const secteurs = new Array<number>(12).fill(0)
      for (const e of gerbe.eclats) {
        if (!e.vive) continue
        let a = Math.atan2(e.y - OU.y, e.x - OU.x)
        if (a < 0) a += Math.PI * 2
        secteurs[Math.min(11, Math.floor((a / (Math.PI * 2)) * 12))]! += 1
      }
      for (const c of secteurs) expect(c).toBeGreaterThan(0)
    }
  })

  it('naît AU point de frappe, pas autour', () => {
    const gerbe = new GerbeFoudre(5)
    gerbe.frapper(OU.x, OU.y)
    for (const e of gerbe.eclats) {
      expect(e.x).toBe(OU.x)
      expect(e.y).toBe(OU.y)
    }
  })
})

describe('④ la gerbe est BRÈVE et bornée', () => {
  it('tout est mort à GERBE_MS, et rien avant le premier tiers', () => {
    const gerbe = new GerbeFoudre(3)
    gerbe.frapper(0, 0)
    expect(gerbe.vivants).toBe(BUDGET_GERBE)
    // À un tiers de vie, tout le monde est encore là (c'est une gerbe, pas une fuite).
    for (let t = 0; t < GERBE_MS / 3; t += 1000 / 60) gerbe.update(1000 / 60)
    expect(gerbe.vivants).toBe(BUDGET_GERBE)
    for (let t = 0; t < GERBE_MS; t += 1000 / 60) gerbe.update(1000 / 60)
    expect(gerbe.vivants).toBe(0)
  })

  it('ne dépasse jamais son budget, même frappée deux fois de suite', () => {
    const gerbe = new GerbeFoudre(3)
    gerbe.frapper(0, 0)
    gerbe.update(1000 / 60)
    gerbe.frapper(10, 10)
    expect(gerbe.vivants).toBeLessThanOrEqual(BUDGET_GERBE)
    expect(gerbe.eclats).toHaveLength(BUDGET_GERBE)
  })

  it('reste dans un rayon de deux tuiles — une gerbe, pas un cratère', () => {
    // Elle doit se lire comme la marque du coup, à l'échelle du rayon de dégâts (1,5 tuile).
    // Une gerbe de dix tuiles dirait un rayon que la sim ne frappe pas.
    const gerbe = new GerbeFoudre(21)
    gerbe.frapper(0, 0)
    let pire = 0
    for (let t = 0; t < GERBE_MS; t += 1000 / 60) {
      gerbe.update(1000 / 60)
      for (const e of gerbe.eclats) if (e.vive) pire = Math.max(pire, Math.hypot(e.x, e.y))
    }
    expect(pire).toBeGreaterThan(0.5) // prémisse : elle BOUGE
    expect(pire).toBeLessThan(2)
  })

  it('compte cumulativement — une gerbe de 300 ms ne se photographie pas, elle se compte', () => {
    const gerbe = new GerbeFoudre(3)
    gerbe.frapper(0, 0)
    for (let t = 0; t < GERBE_MS * 2; t += 1000 / 60) gerbe.update(1000 / 60)
    expect(gerbe.vivants).toBe(0)
    expect(gerbe.total).toBe(BUDGET_GERBE)
    gerbe.frapper(1, 1)
    expect(gerbe.total).toBe(BUDGET_GERBE * 2)
  })

  it('`vider()` éteint tout', () => {
    const gerbe = new GerbeFoudre(3)
    gerbe.frapper(0, 0)
    gerbe.vider()
    expect(gerbe.vivants).toBe(0)
    expect(gerbe.eclats.every((e) => !e.vive)).toBe(true)
  })

  it('les crans d’âge vont par TROIS, dans l’ordre, sur toute la vie', () => {
    let prec = -1
    for (let ms = 0; ms < GERBE_MS; ms += 1) {
      const c = cranDage(ms)
      expect(c).toBeGreaterThanOrEqual(prec)
      expect([0, 1, 2]).toContain(c)
      prec = c
    }
    expect(cranDage(0)).toBe(0)
    expect(cranDage(GERBE_MS - 1)).toBe(2)
  })
})
