import { describe, expect, it } from 'vitest'
import {
  CLIFF_TILE_PX,
  COINS,
  dessinDeCoin,
  dessinDeLevre,
  dessinDeParoi,
  dessinDuDessus,
  dessinDuFlanc,
  FLANC_CRANS,
  LEVRE,
  levreDe,
  OMBRE_CRANS,
  PAROI_RANGEES,
  roleDeFalaise,
  VARIANTES_PAROI,
  type RectArt,
} from './cliff-art'
import { cranDeDerive, CRANS } from './ombre-socle'
import { PAVE } from './paves'

/**
 * On PEINT les rectangles et on relit les pixels : c'est la sortie qui est affirmée, jamais la
 * liste d'entrée. Un rect qui en recouvre un autre change ce qu'on voit — une garde qui lirait la
 * liste ne le verrait pas.
 */
function peindre(rects: readonly RectArt[]): Int32Array {
  const T = CLIFF_TILE_PX
  const px = new Int32Array(T * T).fill(-1)
  for (const r of rects) {
    expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= T && r.y + r.h <= T, `rect hors tuile : ${JSON.stringify(r)}`).toBe(true)
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) px[y * T + x] = r.c
    }
  }
  return px
}
const at = (px: Int32Array, x: number, y: number): number => px[y * CLIFF_TILE_PX + x]!

/** Une colonne de roche de `hauteur` tuiles en (0, y0). Hors de la colonne : du sol — SAUF hors
 *  carte, qui est de la roche (l'anneau de bordure), exactement comme dans le jeu. */
function colonne(hauteur: number, y0 = 4, hauteurCarte = 20) {
  return (tx: number, ty: number): boolean => {
    if (ty < 0 || ty >= hauteurCarte) return true
    return tx === 0 && ty >= y0 && ty < y0 + hauteur
  }
}

describe('roleDeFalaise — le rôle se COMPTE, il ne se stocke pas', () => {
  it('une masse épaisse : du dessus partout, puis l’arête, puis le pied', () => {
    for (let h = PAROI_RANGEES + 1; h <= 8; h++) {
      const roche = colonne(h)
      const roles = Array.from({ length: h }, (_, k) => roleDeFalaise(roche, 0, 4 + k))
      for (let k = 0; k < h - PAROI_RANGEES; k++) {
        expect(roles[k]!.role, `h=${h} rangée ${k}`).toBe('dessus')
      }
      const arete = roles[h - 2]!
      const pied = roles[h - 1]!
      expect(arete).toEqual({ role: 'paroi', arete: true, pied: false })
      expect(pied).toEqual({ role: 'paroi', arete: false, pied: true })
    }
  })

  it('une masse de deux rangées : l’arête et le pied, sans dessus', () => {
    const roche = colonne(2)
    expect(roleDeFalaise(roche, 0, 4)).toEqual({ role: 'paroi', arete: true, pied: false })
    expect(roleDeFalaise(roche, 0, 5)).toEqual({ role: 'paroi', arete: false, pied: true })
  })

  it('une masse d’UNE rangée (le mur de frontière d’aujourd’hui) est à la fois arête et pied', () => {
    const roche = colonne(1)
    expect(roleDeFalaise(roche, 0, 4)).toEqual({ role: 'paroi', arete: true, pied: true })
  })

  it('le bord SUD du monde ne se dresse pas devant le vide', () => {
    // Une colonne qui descend jusqu'à la dernière rangée : le hors-carte est de la roche, donc
    // toutes ses tuiles ont deux roches sous elles — du dessus, pas une paroi.
    const roche = colonne(6, 14, 20)
    for (let k = 0; k < 6; k++) expect(roleDeFalaise(roche, 0, 14 + k).role).toBe('dessus')
  })

  it('balayage exhaustif : le pied est UNIQUE par colonne, et il est la tuile la plus au sud', () => {
    for (let h = 1; h <= 8; h++) {
      const roche = colonne(h)
      const pieds = Array.from({ length: h }, (_, k) => 4 + k).filter((ty) => roleDeFalaise(roche, 0, ty).pied)
      expect(pieds, `h=${h}`).toEqual([4 + h - 1])
    }
  })
})

describe('dessinDeParoi — ce qu’on voit, pixel par pixel', () => {
  it('couvre toute la tuile, sur les 16 masques et toutes les variantes', () => {
    for (let mask = 0; mask < 16; mask++) {
      for (let v = 0; v < VARIANTES_PAROI; v++) {
        const px = peindre(dessinDeParoi(mask, v))
        expect(px.some((c) => c === -1), `masque ${mask} variante ${v} : un pixel nu`).toBe(false)
      }
    }
  })

  it('l’arête prend le jour en HAUT, le pied s’assombrit en BAS — et jamais l’inverse', () => {
    for (let v = 0; v < VARIANTES_PAROI; v++) {
      const avecArete = peindre(dessinDeParoi(1, v))
      const sansArete = peindre(dessinDeParoi(0, v))
      // la rangée du haut est plus claire avec l'arête qu'elle ne l'est sans
      for (let x = 1; x < 15; x++) {
        expect(at(avecArete, x, 0)).toBeGreaterThan(at(sansArete, x, 0))
      }
      // ⚠ **SUR LA MOYENNE DE LA RANGÉE, ET PLUS PIXEL PAR PIXEL** — depuis que la fracture est
      // ROMPUE (2026-09-01 : le joint continu rendait un appareillage de blocs sur la pierre
      // claire, il s'interrompt maintenant par tronçons). Un pixel du pied peut donc être plus
      // clair que celui de l'arête à la même abscisse : c'est le joint qui manque là, pas la
      // chute qui s'inverse. Ce qu'on affirme reste ce qui compte — **la paroi s'assombrit en
      // descendant** —, énoncé sur la seule mesure que la rupture ne perturbe pas.
      const avecPied = peindre(dessinDeParoi(8, v))
      const moyenne = (px: Int32Array, y: number): number => {
        let s = 0
        for (let x = 0; x < 16; x++) s += at(px, x, y)
        return s / 16
      }
      expect(moyenne(avecPied, 15), `variante ${v}`).toBeLessThan(moyenne(avecArete, 15))
    }
  })

  it('le soleil est au nord-OUEST : le bord ouest est plus clair que le bord est', () => {
    for (let v = 0; v < VARIANTES_PAROI; v++) {
      const px = peindre(dessinDeParoi(2 | 4, v))
      for (let y = 2; y < 14; y++) {
        expect(at(px, 0, y), `variante ${v} rangée ${y}`).toBeGreaterThan(at(px, 15, y))
      }
    }
  })
})

describe('dessinDuDessus — inchangé par le retour de la paroi', () => {
  it('couvre la tuile et pose son liseré nord quand le bord est ouvert', () => {
    const nu = peindre(dessinDuDessus(0, 0))
    expect(nu.some((c) => c === -1)).toBe(false)
    const liseré = peindre(dessinDuDessus(1, 0))
    for (let x = 0; x < 16; x++) expect(at(liseré, x, 0)).toBeGreaterThan(at(nu, x, 0))
  })
})

/**
 * La lèvre se lit en deux calques : la ROCHE (opaque) et le CONTOUR (un voile d'alpha sur le sol).
 * `peindre` ignore l'alpha ; ici on garde les deux — un pixel de sol voilé n'est pas de la roche.
 */
function peindreAvecVoile(rects: readonly RectArt[]): { c: Int32Array; a: Float64Array } {
  const T = CLIFF_TILE_PX
  const c = new Int32Array(T * T).fill(-1)
  const a = new Float64Array(T * T)
  for (const r of rects) {
    expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= T && r.y + r.h <= T, `rect hors tuile : ${JSON.stringify(r)}`).toBe(true)
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        c[y * T + x] = r.c
        a[y * T + x] = r.a ?? 1
      }
    }
  }
  return { c, a }
}
const lum = (c: number): number => ((c >> 16) & 255) * 0.299 + ((c >> 8) & 255) * 0.587 + (c & 255) * 0.114
/** Roche = un pixel OPAQUE (le voile du contour est toujours < 1). */
const roche = (t: { c: Int32Array; a: Float64Array }, x: number, y: number): boolean =>
  t.c[y * CLIFF_TILE_PX + x]! >= 0 && t.a[y * CLIFF_TILE_PX + x]! >= 1
const voile = (t: { c: Int32Array; a: Float64Array }, x: number, y: number): number =>
  t.c[y * CLIFF_TILE_PX + x]! < 0 ? 0 : t.a[y * CLIFF_TILE_PX + x]! < 1 ? t.a[y * CLIFF_TILE_PX + x]! : 0

describe('dessinDeLevre — le bord d’un palier, sur tout son pourtour', () => {
  const T = CLIFF_TILE_PX
  const variantes = Array.from({ length: LEVRE.VARIANTES }, (_, v) => v)

  it('la roche ne vit que sur les côtés OUVERTS : le cœur et les côtés fermés restent du sol', () => {
    for (let cotes = 1; cotes < 16; cotes++) {
      for (const v of variantes) {
        const t = peindreAvecVoile(dessinDeLevre(cotes, v))
        expect(roche(t, 8, 8), `cotes=${cotes} v=${v} cœur`).toBe(false)
        // Un côté fermé : son pixel de bord, au milieu, est du sol (peut-être voilé, jamais roche).
        if ((cotes & 1) === 0) expect(roche(t, 8, 0), `cotes=${cotes} nord fermé`).toBe(false)
        if ((cotes & 8) === 0) expect(roche(t, 8, T - 1), `cotes=${cotes} sud fermé`).toBe(false)
        if ((cotes & 4) === 0) expect(roche(t, 0, 8), `cotes=${cotes} ouest fermé`).toBe(false)
        if ((cotes & 2) === 0) expect(roche(t, T - 1, 8), `cotes=${cotes} est fermé`).toBe(false)
      }
    }
  })

  it('la bande a la profondeur du pavé : arête + FRANGE_MIN..FRANGE_MAX, par colonne de 4 px', () => {
    const borne = (arete: number) => [arete + PAVE.FRANGE_MIN, arete + PAVE.FRANGE_MAX] as const
    for (const v of variantes) {
      const n = peindreAvecVoile(dessinDeLevre(1, v))
      const e = peindreAvecVoile(dessinDeLevre(2, v))
      const w = peindreAvecVoile(dessinDeLevre(4, v))
      const s = peindreAvecVoile(dessinDeLevre(8, v))
      for (let k = 0; k < T; k += 4) {
        let dn = 0; while (dn < T && roche(n, k, dn)) dn++
        let ds = 0; while (ds < T && roche(s, k, T - 1 - ds)) ds++
        let dw = 0; while (dw < T && roche(w, dw, k)) dw++
        let de = 0; while (de < T && roche(e, T - 1 - de, k)) de++
        const [n0, n1] = borne(LEVRE.ARETE_N_PX)
        const [l0, l1] = borne(LEVRE.ARETE_LAT_PX)
        const [s0, s1] = borne(0)
        expect(dn >= n0 && dn <= n1, `v=${v} col ${k} nord ${dn}`).toBe(true)
        expect(ds >= s0 && ds <= s1, `v=${v} col ${k} sud ${ds}`).toBe(true)
        expect(dw >= l0 && dw <= l1, `v=${v} rangée ${k} ouest ${dw}`).toBe(true)
        expect(de >= l0 && de <= l1, `v=${v} rangée ${k} est ${de}`).toBe(true)
      }
    }
  })

  it('la frange VARIE d’une variante à l’autre — un long bord ne se répète pas à l’œil', () => {
    const profils = new Set<string>()
    for (const v of variantes) {
      const n = peindreAvecVoile(dessinDeLevre(1, v))
      const prof: number[] = []
      for (let k = 0; k < T; k += 4) { let d = 0; while (d < T && roche(n, k, d)) d++; prof.push(d) }
      profils.add(prof.join(','))
    }
    expect(profils.size).toBeGreaterThan(LEVRE.VARIANTES / 2)
  })

  it('les arêtes : le nord et l’ouest prennent le jour, l’est passe dans l’ombre (soleil au nord-ouest)', () => {
    for (const v of variantes) {
      const n = peindreAvecVoile(dessinDeLevre(1, v))
      const e = peindreAvecVoile(dessinDeLevre(2, v))
      const w = peindreAvecVoile(dessinDeLevre(4, v))
      // La base de la pierre : au fond de la bande nord, sous l'ombre du sol — un pixel de roche
      // qui n'est ni arête ni voisin du sol. On la lit sur la bande la plus profonde.
      const base = lum(n.c[3 * T + 8]!)
      expect(lum(n.c[0 * T + 8]!), `v=${v} arête nord`).toBeGreaterThan(base)
      expect(lum(w.c[8 * T + 0]!), `v=${v} arête ouest`).toBeGreaterThan(base)
      expect(lum(e.c[8 * T + (T - 1)]!), `v=${v} arête est`).toBeLessThan(base)
    }
  })

  it('le contour du sol, grammaire du pavé : le sol est la dalle, la roche ce qu’elle domine', () => {
    // Sur le pavé, le pixel de la dalle dont le voisin du BAS (ou de côté) est plus bas prend le
    // LISERÉ sombre ; celui dont le voisin du HAUT est plus bas prend l'ARÊTE claire ; deux rangées
    // au-dessus du bord bas, la TRANCHE. Ici la dalle est le sol du palier, et ce qu'elle domine,
    // la bande de roche — les mêmes voiles, en alpha sur un sol qu'on ne connaît pas.
    // On lit au MILIEU d'une colonne (ou d'une rangée) de frange, x = 10 : ses voisins latéraux
    // sont dans la même colonne, donc à la même profondeur — seul le bord qu'on éprouve joue.
    const m = 10
    for (const v of variantes) {
      const n = peindreAvecVoile(dessinDeLevre(1, v))
      const s = peindreAvecVoile(dessinDeLevre(8, v))
      const e = peindreAvecVoile(dessinDeLevre(2, v))
      const w = peindreAvecVoile(dessinDeLevre(4, v))
      // Nord : la roche est AU-DESSUS du sol → l'arête haute, un voile BLANC.
      let d = 0; while (roche(n, m, d)) d++
      expect(n.c[d * T + m], `v=${v} sous le nord`).toBe(0xffffff)
      expect(voile(n, m, d), `v=${v} sous le nord`).toBeCloseTo(PAVE.ARETE_HAUTE - 1, 5)
      // Sud : la roche est SOUS le sol → le liseré, un voile NOIR ; et la tranche une rangée plus haut.
      d = 0; while (roche(s, m, T - 1 - d)) d++
      expect(s.c[(T - 1 - d) * T + m], `v=${v} sur le sud`).toBe(0x000000)
      expect(voile(s, m, T - 1 - d), `v=${v} sur le sud`).toBeCloseTo(1 - PAVE.LISERE, 5)
      expect(voile(s, m, T - 2 - d), `v=${v} tranche du sud`).toBeCloseTo(1 - PAVE.TRANCHE, 5)
      // Est et ouest : la roche est À CÔTÉ → le liseré, noir.
      d = 0; while (roche(e, T - 1 - d, m)) d++
      expect(e.c[m * T + (T - 1 - d)], `v=${v} à côté de l’est`).toBe(0x000000)
      expect(voile(e, T - 1 - d, m), `v=${v} à côté de l’est`).toBeCloseTo(1 - PAVE.LISERE, 5)
      d = 0; while (roche(w, d, m)) d++
      expect(w.c[m * T + d], `v=${v} à côté de l’ouest`).toBe(0x000000)
      expect(voile(w, d, m), `v=${v} à côté de l’ouest`).toBeCloseTo(1 - PAVE.LISERE, 5)
    }
  })

  it('un coin rentrant ne vit que dans SON quadrant', () => {
    for (let coin = 0; coin < COINS.length; coin++) {
      const nord = coin < 2
      const ouest = (coin & 1) === 0
      for (const v of variantes) {
        const t = peindreAvecVoile(dessinDeCoin(coin, v))
        const x0 = ouest ? 0 : T - 1
        const y0 = nord ? 0 : T - 1
        expect(roche(t, x0, y0), `${COINS[coin]} v=${v} son angle`).toBe(true)
        expect(roche(t, T - 1 - x0, y0), `${COINS[coin]} v=${v} l’angle d’en face`).toBe(false)
        expect(roche(t, x0, T - 1 - y0), `${COINS[coin]} v=${v} l’angle d’en face`).toBe(false)
        expect(roche(t, 8, 8), `${COINS[coin]} v=${v} cœur`).toBe(false)
      }
    }
  })
})

describe('levreDe — où va la lèvre, lu des voisines', () => {
  const bas = (...offsets: (readonly [number, number])[]) =>
    (dx: number, dy: number) => offsets.some(([ox, oy]) => ox === dx && oy === dy)

  it('un côté plus bas ouvre son bit ; aucun voisin plus bas, rien', () => {
    expect(levreDe(() => false)).toEqual({ cotes: 0, coins: 0 })
    expect(levreDe(bas([0, -1]))).toEqual({ cotes: 1, coins: 0 })
    expect(levreDe(bas([1, 0]))).toEqual({ cotes: 2, coins: 0 })
    expect(levreDe(bas([-1, 0]))).toEqual({ cotes: 4, coins: 0 })
    expect(levreDe(bas([0, 1]))).toEqual({ cotes: 8, coins: 0 })
    expect(levreDe(() => true).cotes).toBe(15)
  })

  it('une diagonale plus basse pose un coin — sauf si un côté adjacent est déjà ouvert, qui le couvre', () => {
    expect(levreDe(bas([-1, -1]))).toEqual({ cotes: 0, coins: 1 })
    expect(levreDe(bas([1, -1]))).toEqual({ cotes: 0, coins: 2 })
    expect(levreDe(bas([-1, 1]))).toEqual({ cotes: 0, coins: 4 })
    expect(levreDe(bas([1, 1]))).toEqual({ cotes: 0, coins: 8 })
    expect(levreDe(bas([-1, -1], [0, -1]))).toEqual({ cotes: 1, coins: 0 })
    expect(levreDe(bas([1, 1], [1, 0]))).toEqual({ cotes: 2, coins: 0 })
    expect(levreDe(() => true).coins).toBe(0)
  })
})

describe('LEVRE.OMBRE_FLANC — l’ombre du flanc est, celle du pied couchée', () => {
  /**
   * Décision du 2026-09-04 (A/B à l'œil) : soleil au nord-ouest à ~45°, une ombre jetée à l'est
   * est aussi large que celle jetée au sud. À la moitié (4/3/1), l'œil prenait le liseré pour le
   * contour de la lèvre et le bord est se lisait plat. La garde tient les deux tables ENSEMBLE :
   * qui recalibre l'ombre du pied recalibre le flanc, et l'inverse ne peut pas se faire en douce.
   */
  it('a exactement les crans de l’ombre du pied, et ils remplissent la tuile', () => {
    expect(LEVRE.OMBRE_FLANC).toEqual(OMBRE_CRANS)
    expect(LEVRE.OMBRE_FLANC.reduce((acc, [w]) => acc + w, 0)).toBe(CLIFF_TILE_PX)
    // Trois crans qui s'éteignent vers l'est — jamais un dégradé, jamais un cran qui remonte.
    const alphas = LEVRE.OMBRE_FLANC.map(([, a]) => a)
    expect(alphas.length).toBe(3)
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeLessThan(alphas[i - 1] ?? 0)
  })
})

describe('dessinDuFlanc — le flanc suit l’astre, au cran des socles', () => {
  /**
   * Décision du 2026-09-04 : l'ombre du flanc n'est plus figée « soleil au nord-ouest, flanc est,
   * pleine à toute heure ». Elle se couche sur `2 × |cran|` px, où `cran` est le cisaillement des
   * socles (`cranDeDerive`) — même loi, même quantification. MESURÉ avant : à 9 h le rocher
   * couchait sa coulée 8 texels à l'ouest, la marche à côté restait ombrée à l'est.
   */
  /** L'alpha d'une colonne, relu des rects (le dernier rect qui couvre le pixel gagne). */
  const alphaEn = (rects: readonly RectArt[], x: number): number => {
    let a = 0
    for (const r of rects) if (x >= r.x && x < r.x + r.w) a = r.a ?? 1
    return a
  }
  const largeur = (rects: readonly RectArt[]): number => {
    let fin = 0
    for (const r of rects) fin = Math.max(fin, r.x + r.w)
    return fin
  }

  it('les crans du flanc SONT ceux des socles : une seule quantification pour les deux ombres', () => {
    expect(FLANC_CRANS).toBe(CRANS)
    // Le cran extrême de la dérive remplit exactement le plein.
    expect(Math.abs(cranDeDerive(1))).toBe(FLANC_CRANS)
    expect(Math.abs(cranDeDerive(-1))).toBe(FLANC_CRANS)
  })

  it('au plein, c’est LEVRE.OMBRE_FLANC, pixel pour pixel ; au zénith, rien', () => {
    const plein = dessinDuFlanc(FLANC_CRANS)
    peindre(plein)
    expect(largeur(plein)).toBe(CLIFF_TILE_PX)
    let x = 0
    for (const [w, a] of LEVRE.OMBRE_FLANC) {
      for (let i = x; i < x + w; i++) expect(alphaEn(plein, i), `colonne ${i}`).toBe(a)
      x += w
    }
    expect(dessinDuFlanc(0)).toEqual([])
  })

  it('la largeur est une pente continue du cran (2 px par cran), et l’ombre part du bord ouest', () => {
    for (let k = 1; k <= FLANC_CRANS; k++) {
      const r = dessinDuFlanc(k)
      peindre(r)
      expect(largeur(r), `cran ${k}`).toBe((CLIFF_TILE_PX * k) / FLANC_CRANS)
      expect(Math.min(...r.map((q) => q.x))).toBe(0)
      // Pleine hauteur : le flanc est une bande verticale, jamais un coin.
      for (const q of r) expect([q.y, q.h]).toEqual([0, CLIFF_TILE_PX])
      // Et les alphas s'éteignent en s'éloignant du mur — le même ordre que le plein.
      let prev = Infinity
      for (let x = 0; x < largeur(r); x++) {
        const a = alphaEn(r, x)
        expect(a, `cran ${k}, colonne ${x}`).toBeLessThanOrEqual(prev)
        prev = a
      }
    }
  })

  it('le signe ne change pas le dessin — le miroir est l’affaire de la couche (flipX)', () => {
    for (let k = 1; k <= FLANC_CRANS; k++) expect(dessinDuFlanc(-k)).toEqual(dessinDuFlanc(k))
  })
})
