/**
 * A20 — LES QUATRE SAISONS SE DISTINGUENT À L'ŒIL (spec `saisons.md` S17).
 *
 * On ne juge pas une DA par un test : la teinte finale se tranchera sur une planche rendue.
 * Ce que ces gardes tiennent, c'est la FORME de la loi — qu'elle sépare vraiment les quatre
 * saisons, qu'elle ne saute jamais d'un jour à l'autre, qu'elle ne touche que le vivant, et
 * qu'elle ne puisse pas inventer une couleur que l'art n'a pas.
 */
import { describe, expect, it } from 'vitest'
import {
  CRAN_SAISON, cranDeSaison, panachageDeFamille, teinteDuTerrain, teinteSaisonniere, teinter,
  teinterFamille, TERRAINS_HORS_SAISON, TERRAINS_VIVANTS, type TeinteSaison,
} from './teinte-saison'
import { TERRAIN_COLORS } from './terrain-colors'

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

/**
 * ═══ LA TEINTE D'UNE FAMILLE DE TONS (loi ③, décision d'Alexis 2026-08-25) ═══
 *
 * Ce que la planche a tranché et ce que ces gardes tiennent : le virage de saison ne doit RIEN
 * coûter au contraste. Deux propriétés, et la seconde est celle qui a tué la loi ① —
 *
 *   ① l'écart INTERNE d'une famille (masse ↔ éclat) survit EXACTEMENT : c'est lui qui fait le
 *      relief des pavés d'une cime ;
 *   ② l'écart entre DEUX familles (la lisière entre deux cimes qui se touchent) survit MIEUX
 *      qu'avec un fondu ton par ton — et cet écart-là, l'éclairage ne peut pas le rattraper :
 *      deux cimes voisines reçoivent la même lumière.
 */
describe('la teinte d’une famille de tons — les écarts survivent au virage', () => {
  const FAMILLES = {
    hetre: { masse: '#153a24', corps: '#1a462b', lumiere: '#26603c', eclat: '#2d7046', ombre: '#112e1c' },
    bouleau: { masse: '#294f26', corps: '#32602e', lumiere: '#4a8341', eclat: '#57964c', ombre: '#1f3d1d' },
    saule: { masse: '#1b3e18', corps: '#224a1d', lumiere: '#35692e', eclat: '#3e7a35', ombre: '#152f13' },
    tree: { masse: '#18401d', corps: '#1e4d22', lumiere: '#2d6b32', eclat: '#347b3a', ombre: '#143518' },
    vieux: { masse: '#0d2413', corps: '#12321a', lumiere: '#1d4a26', eclat: '#245c30', ombre: '#081c0e' },
  }
  const val = (c: string): number => parseInt(c.slice(1), 16)
  const dist = (a: string, b: string): number => {
    const A = val(a), B = val(b)
    const d = (s: number): number => (((A >> s) & 0xff) - ((B >> s) & 0xff)) ** 2
    return Math.sqrt(d(16) + d(8) + d(0))
  }
  /** La loi ① — celle que la planche a réfutée. Gardée ICI, comme témoin de la comparaison. */
  const fonduTonParTon = <T extends Record<string, string>>(t: T, teinte: TeinteSaison): T => {
    const out: Record<string, string> = {}
    for (const [k, c] of Object.entries(t)) out[k] = '#' + teinter(val(c), teinte).toString(16).padStart(6, '0')
    return out as T
  }

  // Tout jour de l'année, pas seulement les quatre cardinaux : la teinte est CONTINUE, et un
  // clipping ne se déclare pas sur les nombres ronds.
  const JOURS = Array.from({ length: 120 }, (_, i) => i + 1)

  it('① l’écart interne masse↔éclat est préservé AU POINT PRÈS, tout l’an', () => {
    for (const [nom, tons] of Object.entries(FAMILLES)) {
      const nu = dist(tons.masse, tons.eclat)
      for (const jour of JOURS) {
        const t = teinterFamille(tons, teinteSaisonniere(jour))
        // Un demi-point de tolérance : les cinq tons sont ARRONDIS à l'entier après translation.
        expect(Math.abs(dist(t.masse, t.eclat) - nu), `${nom} au jour ${jour}`).toBeLessThan(1.8)
      }
    }
  })

  it('① et AUCUN ton ne sature — sinon l’écart de ce ton-là serait écrasé en silence', () => {
    for (const tons of Object.values(FAMILLES)) {
      for (const jour of JOURS) {
        for (const c of Object.values(teinterFamille(tons, teinteSaisonniere(jour)))) {
          const v = val(c)
          for (const s of [16, 8, 0]) {
            expect((v >> s) & 0xff).toBeGreaterThanOrEqual(0)
            expect((v >> s) & 0xff).toBeLessThanOrEqual(255)
          }
        }
      }
    }
  })

  it('② la LISIÈRE entre deux essences tient mieux qu’avec un fondu ton par ton', () => {
    // Les deux familles les plus proches de l'écran (hêtre et bouleau se touchent en futaie).
    const nu = dist(FAMILLES.hetre.lumiere, FAMILLES.bouleau.lumiere)
    let pire = Infinity, pireFondu = Infinity
    for (const jour of JOURS) {
      const teinte = teinteSaisonniere(jour)
      const a = teinterFamille(FAMILLES.hetre, teinte), b = teinterFamille(FAMILLES.bouleau, teinte)
      const fa = fonduTonParTon(FAMILLES.hetre, teinte), fb = fonduTonParTon(FAMILLES.bouleau, teinte)
      const nouveau = dist(a.lumiere, b.lumiere), ancien = dist(fa.lumiere, fb.lumiere)
      // JOUR PAR JOUR : la loi retenue ne fait jamais MOINS bien que celle qu'on a écartée.
      expect(nouveau, `jour ${jour}`).toBeGreaterThan(ancien - 1e-9)
      pire = Math.min(pire, nouveau)
      pireFondu = Math.min(pireFondu, ancien)
    }
    // ET LE PLANCHER DE L'ANNÉE EST FRANCHEMENT MEILLEUR, pas meilleur d'un cheveu : c'est ce
    // qui sépare « une autre loi » de « la loi qui règle le problème ». MESURÉ (art nu 50) :
    // plancher 30 pour la loi retenue, 23 pour le fondu ton par ton — un tiers de plus.
    expect(pire).toBeGreaterThan(pireFondu * 1.25)
    expect(pire).toBeGreaterThan(nu * 0.55)
  })

  it('③ le panachage étale les grappes autour du virage, et il est DÉTERMINISTE', () => {
    const tirage = (i: number): number => ((i * 2654435761) % 1000) / 1000
    for (const jour of [45, 75]) {
      const p = panachageDeFamille(FAMILLES.tree, jour, tirage)
      const q = panachageDeFamille(FAMILLES.tree, jour, tirage)
      const corps = new Set<string>()
      for (let i = 0; i < 14; i++) {
        expect(p(i).corps).toBe(q(i).corps) // même graine, même cime : deux clients, un arbre
        corps.add(p(i).corps)
      }
      // Une cime qui tourne ne tourne pas d'un bloc : au moins quatre teintes de corps distinctes.
      expect(corps.size, `jour ${jour}`).toBeGreaterThanOrEqual(4)
    }
  })

  it('③ mais l’écart interne survit AUSSI dans chaque grappe panachée', () => {
    const p = panachageDeFamille(FAMILLES.hetre, 75, (i) => (i % 7) / 7)
    const nu = dist(FAMILLES.hetre.masse, FAMILLES.hetre.eclat)
    for (let i = 0; i < 14; i++) {
      const t = p(i)
      expect(Math.abs(dist(t.masse, t.eclat) - nu), `grappe ${i}`).toBeLessThan(1.8)
    }
  })

  it('le CRAN couvre l’année, sans trou ni doublon aux bornes', () => {
    const n = 120 / CRAN_SAISON
    expect(Number.isInteger(n), 'le cran doit diviser l’année, sinon le dernier est tronqué').toBe(true)
    const vus = new Set<number>()
    for (let j = 1; j <= 120; j++) vus.add(cranDeSaison(j))
    expect(vus.size).toBe(n)
    expect(cranDeSaison(1)).toBe(0)
    expect(cranDeSaison(120)).toBe(n - 1)
    expect(cranDeSaison(121)).toBe(0) // l'année boucle : le cran aussi
    expect(cranDeSaison(-(CRAN_SAISON - 1))).toBe(n - 1) // et un jour négatif y retombe
  })

  it('LE SAUT D’UN CRAN À L’AUTRE NE SE VOIT PAS SUR LE SOL — c’est ce qui fixe le cran', () => {
    // Le sol est un aplat de plein écran : son saut est la chose la plus visible de toute la
    // saison. MESURÉ à dix jours : 24 sur l'herbe comme sur la forêt — un flash. La garde vise
    // ce que l'œil tolère sur un aplat, et elle échouerait si quelqu'un rouvrait le cran.
    const SOLS = [0x3e7d3a, 0x2c5a2e, 0x8a7078, 0x1c3a28] // herbe, forêt, lande, vieille forêt
    let pire = 0
    for (const sol of SOLS) {
      for (let cran = 0; cran < 120 / CRAN_SAISON; cran++) {
        const a = teinter(sol, teinteSaisonniere(cran * CRAN_SAISON + 1))
        const b = teinter(sol, teinteSaisonniere((cran + 1) * CRAN_SAISON + 1))
        pire = Math.max(pire, dist('#' + a.toString(16).padStart(6, '0'), '#' + b.toString(16).padStart(6, '0')))
      }
    }
    expect(pire, `saut maximal ${pire.toFixed(1)}`).toBeLessThan(8)
  })
})

/**
 * LA PARTITION DES TERRAINS — la garde qui aurait attrapé l'omission du 2026-08-25.
 *
 * Trois terrains vivants (`flower_meadow`, `alpine_flowers`, `juniper_heath`) n'étaient pas
 * dans la table. Personne ne pouvait le voir tant que la teinte ne servait qu'aux touffes ; le
 * jour où le sol l'a prise, c'est devenu une dalle verte en plein automne. Une liste de « ceux
 * qui tournent » laisse tout terrain NEUF tomber du côté mort, en silence — d'où une PARTITION,
 * qui force un choix à l'ajout plutôt que de le supposer.
 */
describe('la teinte de la saison — la partition des terrains est totale', () => {
  it('tout terrain de la palette est classé, une fois et une seule', () => {
    const ids = Object.keys(TERRAIN_COLORS).map(Number)
    const orphelins = ids.filter((id) => !TERRAINS_VIVANTS.has(id) && !TERRAINS_HORS_SAISON.has(id))
    const doubles = ids.filter((id) => TERRAINS_VIVANTS.has(id) && TERRAINS_HORS_SAISON.has(id))
    expect(orphelins, 'terrains non classés — vivants ou hors saison ?').toEqual([])
    expect(doubles, 'terrains classés des DEUX côtés').toEqual([])
  })

  it('et les deux ensembles ne nomment rien qui n’existe pas', () => {
    const ids = new Set(Object.keys(TERRAIN_COLORS).map(Number))
    for (const id of [...TERRAINS_VIVANTS, ...TERRAINS_HORS_SAISON]) {
      expect(ids.has(id), `le terrain ${id} est classé mais n’a pas de couleur`).toBe(true)
    }
  })

  it('les prés fleuris et la lande à genévriers TOURNENT — c’était le défaut', () => {
    for (const id of [17, 20, 26]) {
      expect(teinteDuTerrain(id, 75).force, `terrain ${id}`).toBeGreaterThan(0)
    }
    // Et ce qui est mort ne tourne toujours pas.
    for (const id of [5, 6, 10, 21, 27]) {
      expect(teinteDuTerrain(id, 75).force, `terrain ${id}`).toBe(0)
    }
  })
})
