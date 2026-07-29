/**
 * LES ÉCLATS DE LA RÉCOLTE — ce qui se PROUVE sans navigateur.
 *
 * Trois choses, et ce sont les trois qui peuvent mentir en silence : la direction de
 * projection (elle s'éloigne du récolteur, ou la gerbe se tasse sur son sprite — c'est
 * exactement le défaut qu'Alexis a vu le 29/07), la couleur (elle est lue sur le sprite,
 * jamais devinée), et la loi de vol (les familles cassantes se POSENT avant de s'effacer —
 * c'est affirmé dans `LOIS`, donc ça se vérifie).
 *
 * Ce que ce fichier NE prouve pas, et qui se voit à l'œil : que la gerbe est visible à
 * l'écran. Ça, c'est le smoke (`--scenario eclats`).
 */
import { describe, expect, it } from 'vitest'
import { NODE_DEFS } from '@ashes/sim'
import {
  CASSANTES,
  contactSol,
  directionProjection,
  FAMILLE_DE_NOEUD,
  LOIS,
  nuance,
  TON_DE_REPLI,
  tonsDominants,
  VALEURS,
  type Famille,
} from './recolte-fx'

describe('directionProjection — la gerbe part à L’OPPOSÉ du récolteur', () => {
  it('prolonge le coup : du récolteur vers le nœud, et au-delà', () => {
    // Récolteur au SUD du nœud (y croît vers le bas) : la matière ressort au NORD.
    expect(directionProjection(100, 100, 100, 140)).toEqual({ dx: 0, dy: -1 })
    // …au NORD : elle ressort au sud. Toujours de l’autre côté du nœud.
    expect(directionProjection(100, 100, 100, 60)).toEqual({ dx: 0, dy: 1 })
    // …à l’OUEST : elle ressort à l’est.
    expect(directionProjection(100, 100, 40, 100)).toEqual({ dx: 1, dy: 0 })
  })

  it('ne renvoie JAMAIS la matière vers le récolteur — c’est le défaut corrigé le 29/07', () => {
    // Balayage exhaustif : la gerbe empilée sur l’avatar était une faute de SIGNE, et une
    // faute de signe ne se prouve pas absente sur trois cas choisis.
    for (let a = 0; a < 360; a += 7) {
      const rad = (a * Math.PI) / 180
      const r = 3 + (a % 40)
      const fx = 100 + Math.cos(rad) * r
      const fy = 100 + Math.sin(rad) * r
      const { dx, dy } = directionProjection(100, 100, fx, fy)
      // Produit scalaire avec « nœud → récolteur » : strictement négatif = on s’en éloigne.
      expect(dx * (fx - 100) + dy * (fy - 100)).toBeLessThan(0)
    }
  })

  it('rend toujours un vecteur UNITAIRE, où que soit le récolteur', () => {
    for (let a = 0; a < 360; a += 7) {
      const r = 3 + (a % 40)
      const rad = (a * Math.PI) / 180
      const { dx, dy } = directionProjection(100, 100, 100 + Math.cos(rad) * r, 100 + Math.sin(rad) * r)
      expect(Math.sqrt(dx * dx + dy * dy)).toBeCloseTo(1, 6)
    }
  })

  it('un récolteur confondu avec le nœud projette VERS LA CAMÉRA — le seul repli visible', () => {
    // Impossible en jeu (l’emprise du nœud l’interdit), mais une division par zéro ne
    // s’excuse pas : le repli doit être une direction, pas un NaN. Sans côté opposé à
    // choisir, on prend celui qui se voit.
    const { dx, dy } = directionProjection(100, 100, 100, 100)
    expect(Number.isNaN(dx)).toBe(false)
    expect(dy).toBe(1)
  })
})

describe('tonsDominants — la couleur est LUE sur le sprite', () => {
  const px = (r: number, g: number, b: number, a = 255): [number, number, number, number] => [r, g, b, a]

  it('ignore le fond transparent : la silhouette n’est pas une couleur du nœud', () => {
    const pixels = [px(0, 0, 0, 0), px(0, 0, 0, 12), px(120, 80, 40)]
    expect(tonsDominants(pixels, 3)).toEqual([0x785028])
  })

  it('classe par SURFACE couverte — l’aplat dominant d’abord', () => {
    const pixels = [
      ...Array.from({ length: 5 }, () => px(0x6a, 0x6a, 0x72)), // la masse
      ...Array.from({ length: 9 }, () => px(0x45, 0x45, 0x4c)), // une masse plus large
      px(0xb0, 0x63, 0x2e), // l’accent (une veinule de rouille)
    ]
    expect(tonsDominants(pixels, 3)).toEqual([0x45454c, 0x6a6a72, 0xb0632e])
  })

  it('se borne à `max`, et garde l’accent quand il y a la place', () => {
    const pixels = [px(1, 1, 1), px(2, 2, 2), px(3, 3, 3), px(4, 4, 4)]
    expect(tonsDominants(pixels, 2)).toHaveLength(2)
  })

  it('à surface ÉGALE, l’ordre est stable — sinon la gerbe scintillerait d’un coup à l’autre', () => {
    const pixels = [px(0x22, 0x22, 0x22), px(0x11, 0x11, 0x11)]
    expect(tonsDominants(pixels, 2)).toEqual(tonsDominants([...pixels].reverse(), 2))
  })

  it('une texture illisible ne rend AUCUN ton — l’appelant se rabat, il ne devine pas', () => {
    expect(tonsDominants([], 3)).toEqual([])
    expect(tonsDominants([px(9, 9, 9, 0)], 3)).toEqual([])
  })
})

describe('nuance — la MATIÈRE se décline en valeurs, elle ne change pas de couleur', () => {
  it('la valeur juste rend le ton intact', () => {
    expect(nuance(0x5c4429, 1)).toBe(0x5c4429)
  })

  it('conserve la TEINTE : les trois canaux bougent du même facteur', () => {
    for (const ton of [0x5c4429, 0x3b682b, 0xc0392b, 0x6a6a72]) {
      for (const v of VALEURS) {
        const n = nuance(ton, v)
        for (const d of [16, 8, 0]) {
          expect((n >> d) & 0xff).toBe(Math.max(0, Math.min(255, Math.round((((ton >> d) & 0xff) * v)))))
        }
      }
    }
  })

  it('ne déborde jamais de l’octet — un ton déjà clair ne vire pas au négatif', () => {
    const n = nuance(0xf0f0f0, 1.22)
    for (const d of [16, 8, 0]) {
      expect((n >> d) & 0xff).toBe(255)
    }
    expect(n).toBe(0xffffff)
  })

  it('la déclinaison reste DANS la famille du ton — jamais une couleur étrangère', () => {
    // C’est la promesse tenue au joueur : « la couleur du nœud récolté ». Une valeur qui
    // s’éloignerait d’un tiers ferait de l’éclat une autre matière.
    for (const v of VALEURS) {
      expect(v).toBeGreaterThan(0.65)
      expect(v).toBeLessThan(1.35)
    }
    expect(VALEURS).toContain(1) // …et la valeur JUSTE fait toujours partie du jeu
  })
})

describe('FAMILLE_DE_NOEUD — chaque nœud du jeu a une matière', () => {
  it('couvre TOUS les types de nœud de la sim, sans trou ni surplus', () => {
    // La garde prouve d’abord sa prémisse : sans nœuds à couvrir, elle passerait au vert
    // pour rien.
    const types = Object.keys(NODE_DEFS)
    expect(types.length).toBeGreaterThan(8)
    expect(Object.keys(FAMILLE_DE_NOEUD).sort()).toEqual(types.sort())
  })

  it('chaque famille a sa loi de vol et son ton de repli', () => {
    for (const famille of Object.values(FAMILLE_DE_NOEUD)) {
      expect(LOIS[famille]).toBeDefined()
      expect(TON_DE_REPLI[famille]).toBeGreaterThan(0)
    }
  })
})

describe('LOIS — la matière cassante SE POSE avant de s’effacer', () => {
  /** Le pire cas : la morsure la plus HAUTE que le code autorise, et l’envol le plus fort
   *  — c’est cet éclat-là qui met le plus longtemps à revenir au sol. */
  const IMPACT_MAX_PX = 14

  it.each(CASSANTES)('%s touche le sol dans sa durée de vie', (famille: Famille) => {
    const loi = LOIS[famille]
    const t = contactSol(IMPACT_MAX_PX, loi.envol[1], loi.g)
    expect(t).toBeLessThan(loi.vie)
    // …et il lui reste de quoi être VU posé : sans cette marge, « il se pose » serait vrai
    // d’une frame, donc faux à l’œil.
    expect(loi.vie - t).toBeGreaterThan(60)
  })

  it('les familles LÉGÈRES flottent : un dixième de la gravité du bois, et plus de vie', () => {
    for (const famille of ['feuille', 'poussiere'] as const) {
      expect(LOIS[famille].g).toBeLessThan(LOIS.bois.g / 5)
      expect(LOIS[famille].vie).toBeGreaterThan(LOIS.bois.vie)
      expect(LOIS[famille].flotte).toBe(true)
    }
  })

  it('la poussière MONTE : elle est encore en l’air quand elle s’efface', () => {
    // C’est la promesse inverse des cassantes, et elle doit tenir aussi — une cendre qui
    // retomberait au sol lirait comme du gravier.
    const loi = LOIS.poussiere
    expect(contactSol(0, loi.envol[0], loi.g)).toBeGreaterThan(loi.vie)
  })

  it('aucune gerbe ne traverse la moitié d’une tuile par frame : les vitesses restent sages', () => {
    // Un éclat qui saute plus de 8 px en une frame de 50 ms (le `dt` borné) se téléporte.
    for (const loi of Object.values(LOIS)) {
      expect((loi.vitesse[1] / 1000) * 50).toBeLessThan(8)
      expect((loi.envol[1] / 1000) * 50).toBeLessThan(8)
    }
  })
})
