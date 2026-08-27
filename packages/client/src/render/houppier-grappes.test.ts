/**
 * LA CIME EN GRAPPES — les gardes (décision d'Alexis, 2026-08-22).
 *
 * Sur les ONZE variantes × CINQ graines (les mêmes que `lit-trees.ts` : 11 + cime × 7919), ce qui
 * doit rester vrai : la cime tient dans sa boîte et s'assoit sur le fût (V3 du 07-29 ne flotte pas),
 * elle est d'UN SEUL tenant, elle porte au moins trois tons, elle est déterministe, et les cinq
 * graines donnent cinq cimes. Et pour les feuillus, LA CIME NUE EST DÉRIVÉE : chaque touffe a sa
 * branche — le centre de chaque grappe est du bois — et le bois part du sommet du fût.
 */
import { describe, expect, it } from 'vitest'
import {
  TOUTES_VARIANTES, VARIANTES_CADUQUES, CIMES_PAR_ARBRE, cleHouppier, estRamure,
  etatsDeCime, houppierLargeur, pariteDeCime, prendLaSaison, tonsMorts,
} from './arbre-art'
import { TERRAIN_COLORS } from './terrain-colors'
import { TERRAIN_BURNT_FOREST, TERRAIN_CENDRE_BOIS } from '@ashes/sim'
import { FORME_PAR_VARIANTE, PORT_PAR_VARIANTE, centresDe, cimeEnGrappes, cimeNue, grappesDe, type GrainHouppier } from './houppier-grappes'

const GRAINES = Array.from({ length: CIMES_PAR_ARBRE }, (_, c) => 11 + c * 7919)

function composantes(g: GrainHouppier, W: number, H: number): number {
  const vu = new Uint8Array(W * H)
  let n = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!g.opaque(x, y) || vu[y * W + x]) continue
    n++
    const file = [y * W + x]
    vu[y * W + x] = 1
    while (file.length) {
      const i = file.pop()!
      const px = i % W, py = (i - px) / W
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = px + dx, ny = py + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const j = ny * W + nx
        if (vu[j] || !g.opaque(nx, ny)) continue
        vu[j] = 1; file.push(j)
      }
    }
  }
  return n
}
const masse = (g: GrainHouppier, W: number, H: number): number => {
  let n = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g.opaque(x, y)) n++
  return n / (W * H)
}

describe('la cime en grappes — onze variantes, cinq graines', () => {
  it('chaque variante a une forme et chaque feuillu un port', () => {
    for (const v of TOUTES_VARIANTES) expect(FORME_PAR_VARIANTE[v.slug], v.slug).toBeDefined()
    for (const slug of VARIANTES_CADUQUES) expect(PORT_PAR_VARIANTE[slug], slug).toBeDefined()
  })

  it('les grappes tiennent dans la boîte et la plus basse touche le bas (l’assise, V3)', () => {
    for (const v of TOUTES_VARIANTES) for (const graine of GRAINES) {
      const W = houppierLargeur(v.mesures), H = v.mesures.houppierS
      const et = grappesDe(W, H, FORME_PAR_VARIANTE[v.slug]!, graine)
      expect(et.length).toBeGreaterThanOrEqual(8)
      for (const g of et) {
        expect(g.x0).toBeGreaterThanOrEqual(0); expect(g.x1).toBeLessThanOrEqual(W)
        expect(g.y0).toBeGreaterThanOrEqual(0); expect(g.y1).toBeLessThanOrEqual(H)
        expect(g.x1 - g.x0).toBeGreaterThan(4); expect(g.y1 - g.y0).toBeGreaterThan(4)
      }
      expect(Math.max(...et.map((g) => g.y1)), `${v.slug} g${graine} : la cime flotte`).toBe(H)
      // l'assise : une grappe couvre le sommet du fût (la colonne, au centre)
      const cx = W / 2
      expect(et.some((g) => g.y1 === H && g.x0 <= cx - 3 && g.x1 >= cx + 3), `${v.slug} g${graine} : rien n'assoit la cime sur le fût`).toBe(true)
    }
  })

  it('la cime est d’un seul tenant, opaque dans sa boîte, et couvre au moins 40 % de la boîte', () => {
    for (const v of TOUTES_VARIANTES) for (const graine of GRAINES) {
      const W = houppierLargeur(v.mesures), H = v.mesures.houppierS
      const g = cimeEnGrappes(W, H, FORME_PAR_VARIANTE[v.slug]!, v.tons, graine)
      expect(composantes(g, W, H), `${v.slug} g${graine} : cime en morceaux`).toBe(1)
      expect(masse(g, W, H), `${v.slug} g${graine} : cime trop creuse`).toBeGreaterThan(0.38)
      expect(g.opaque(-1, 0)).toBe(false); expect(g.opaque(W, 0)).toBe(false)
      // la dernière rangée est occupée au centre : la cime s'assoit sur le fût
      expect(g.opaque(Math.floor(W / 2), H - 1), `${v.slug} g${graine} : la cime ne touche pas le fût`).toBe(true)
    }
  })

  it('au moins trois tons, un relief qui varie, et le ton est toujours un rgb()', () => {
    for (const v of TOUTES_VARIANTES) {
      const W = houppierLargeur(v.mesures), H = v.mesures.houppierS
      const g = cimeEnGrappes(W, H, FORME_PAR_VARIANTE[v.slug]!, v.tons, GRAINES[0]!)
      const tons = new Set<string>()
      let rMin = 1, rMax = 0
      for (let i = 0; i < W * H; i++) {
        const t = g.ton[i]
        if (t === null || t === undefined) { expect(g.relief[i]).toBe(0); continue }
        expect(t).toMatch(/^rgb\(\d+,\d+,\d+\)$/)
        tons.add(t)
        rMin = Math.min(rMin, g.relief[i]!); rMax = Math.max(rMax, g.relief[i]!)
      }
      expect(tons.size, v.slug).toBeGreaterThanOrEqual(3)
      expect(rMax - rMin, `${v.slug} : relief plat`).toBeGreaterThan(0.1)
    }
  })

  it('déterministe, et cinq graines donnent cinq cimes', () => {
    for (const v of TOUTES_VARIANTES) {
      const W = houppierLargeur(v.mesures), H = v.mesures.houppierS
      const forme = FORME_PAR_VARIANTE[v.slug]!
      const a = cimeEnGrappes(W, H, forme, v.tons, GRAINES[0]!), b = cimeEnGrappes(W, H, forme, v.tons, GRAINES[0]!)
      expect(a.ton).toEqual(b.ton)
      const empreintes = new Set(GRAINES.map((gr) => cimeEnGrappes(W, H, forme, v.tons, gr).ton.join('|')))
      expect(empreintes.size, `${v.slug} : des graines donnent la même cime`).toBe(CIMES_PAR_ARBRE)
    }
  })
})

describe('la cime nue — dérivée de la feuillue, une branche par touffe', () => {
  it('chaque centre de grappe est du bois, et le bois part du sommet du fût', () => {
    for (const slug of VARIANTES_CADUQUES) for (const graine of GRAINES) {
      const v = TOUTES_VARIANTES.find((x) => x.slug === slug)!
      const W = houppierLargeur(v.mesures), H = v.mesures.houppierS
      const forme = FORME_PAR_VARIANTE[slug]!
      const nue = cimeNue(W, H, forme, v.fut, PORT_PAR_VARIANTE[slug]!, v.mesures.recouvrementPx, v.mesures.colonneW, graine)
      const bois = (x: number, y: number): boolean => {
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (nue.opaque(x + dx, y + dy)) return true
        return false
      }
      for (const [cx, cy] of centresDe(W, H, forme, graine)) expect(bois(cx, cy), `${slug} g${graine} : la touffe (${cx}, ${cy}) n'a pas sa branche`).toBe(true)
      expect(bois(Math.floor(W / 2), H - v.mesures.recouvrementPx + 1), `${slug} g${graine} : le bois ne part pas du fût`).toBe(true)
      // nue : bien moins de matière que la feuillue, mais jamais rien
      const m = masse(nue, W, H)
      expect(m).toBeGreaterThan(0.04); expect(m).toBeLessThan(0.5)
      expect(composantes(nue, W, H), `${slug} g${graine} : des branches en l'air`).toBe(1)
    }
  })
})

/**
 * ═══ LA COIFFE DE NEIGE DES PERSISTANTS (demande d'Alexis, 2026-08-25) ═══
 *
 * Ce qui doit rester vrai, et qui n'est vrai d'aucune façon triviale : la neige se pose SUR la
 * cime sans la déformer (la silhouette est la même — la collision, le tri en Y et l'assise en
 * dépendent), elle croît avec la charge, elle se pose EN HAUT, et elle ne coiffe que ceux qui
 * gardent leur feuillage.
 */
describe('la coiffe de neige — les persistants sous la charge', () => {
  const PERSISTANTS = TOUTES_VARIANTES.filter((v) => !VARIANTES_CADUQUES.includes(v.slug))
  /** Un pixel de neige : franchement clair ET franchement désaturé — aucun ton de feuillage
   *  n'en approche (le plus clair de la table, l'éclat du bouleau, vaut 87,150,76). */
  const estNeige = (t: string | null): boolean => {
    if (t === null) return false
    const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(t)
    if (!m) return false
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return Math.min(r, g, b) > 170 && Math.max(r, g, b) - Math.min(r, g, b) < 40
  }
  const compte = (g: GrainHouppier, W: number, H: number, p: (t: string | null) => boolean): number => {
    let n = 0
    for (let i = 0; i < W * H; i++) if (p(g.ton[i] ?? null)) n++
    return n
  }
  const cime = (v: typeof TOUTES_VARIANTES[number], graine: number, neige: number): GrainHouppier =>
    cimeEnGrappes(
      houppierLargeur(v.mesures), v.mesures.houppierS,
      FORME_PAR_VARIANTE[v.slug] ?? 'rond', v.tons, graine, undefined, neige,
    )

  it('la SILHOUETTE ne bouge pas d’un pixel sous la neige — elle se pose, elle ne gonfle pas', () => {
    // BALAYAGE EXHAUSTIF, UNE SEULE ASSERTION : on parcourt tous les pixels de toutes les
    // variantes × graines × charges et on n'affirme qu'une chose — la liste des écarts est
    // vide. Un `expect` par pixel serait le même balayage à 300 000 appels près, et il
    // expirerait avant d'avoir rien prouvé.
    const ecarts: string[] = []
    for (const v of PERSISTANTS) {
      const W = houppierLargeur(v.mesures), H = v.mesures.houppierS
      for (const graine of GRAINES) {
        const nu = cime(v, graine, 0)
        for (const charge of [0.35, 0.7, 1]) {
          const coiffe = cime(v, graine, charge)
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            if (coiffe.opaque(x, y) !== nu.opaque(x, y) && ecarts.length < 5) {
              ecarts.push(`${v.slug} graine ${graine} charge ${charge} en ${x},${y}`)
            }
          }
        }
      }
    }
    expect(ecarts).toEqual([])
  })

  it('la neige CROÎT avec la charge, et elle est nulle à charge nulle', () => {
    for (const v of PERSISTANTS) {
      const W = houppierLargeur(v.mesures), H = v.mesures.houppierS
      for (const graine of GRAINES) {
        const n0 = compte(cime(v, graine, 0), W, H, estNeige)
        const n1 = compte(cime(v, graine, 0.35), W, H, estNeige)
        const n2 = compte(cime(v, graine, 0.7), W, H, estNeige)
        expect(n0, `${v.slug} sans charge`).toBe(0)
        // Elle doit SE VOIR : au moins un vingtième de la masse de la cime, sinon c'est un liseré.
        expect(n1, `${v.slug} poudrée`).toBeGreaterThan(masse(cime(v, graine, 0.35), W, H) / 20)
        expect(n2, `${v.slug} chargée`).toBeGreaterThan(n1)
      }
    }
  })

  it('la neige est EN HAUT : son barycentre est au-dessus de celui de la cime', () => {
    for (const v of PERSISTANTS) {
      const W = houppierLargeur(v.mesures), H = v.mesures.houppierS
      for (const graine of GRAINES) {
        const g = cime(v, graine, 0.7)
        let yn = 0, nn = 0, yc = 0, nc = 0
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (!g.opaque(x, y)) continue
          yc += y; nc++
          if (estNeige(g.ton[y * W + x] ?? null)) { yn += y; nn++ }
        }
        expect(nn, `${v.slug} n’a pas de neige`).toBeGreaterThan(0)
        expect(yn / nn, `${v.slug} : neige à ${(yn / nn).toFixed(1)}, cime à ${(yc / nc).toFixed(1)}`)
          .toBeLessThan(yc / nc)
      }
    }
  })

  it('un CADUC ne se coiffe jamais : `etatsDeCime` ne lui propose pas de neige', () => {
    for (const v of TOUTES_VARIANTES) {
      const etats = etatsDeCime(v.slug)
      const caduc = VARIANTES_CADUQUES.includes(v.slug)
      expect(etats.includes('nu'), v.slug).toBe(caduc)
      expect(etats.some((e) => e === 'neige1' || e === 'neige2'), v.slug).toBe(!caduc)
      // Et l'exclusion est ENTIÈRE : aucune variante ne porte les deux.
      expect(etats.includes('nu') && etats.includes('neige1')).toBe(false)
    }
  })

  it('chaque état d’une variante a sa PROPRE clé — aucune ne s’écrase à la cuisson', () => {
    const vues = new Set<string>()
    for (const v of TOUTES_VARIANTES) {
      for (let c = 0; c < CIMES_PAR_ARBRE; c++) {
        for (const e of etatsDeCime(v.slug)) {
          // LES DEUX CRANS VOISINS : c'est le balayage qui compte, parce que la parité doit
          // rendre DEUX clés au feuillage caduc (le fondu de saison en dépend) et UNE SEULE
          // partout ailleurs — cuire deux fois la même image serait la moitié du travail perdu.
          for (const cran of [0, 1]) {
            vues.add(cleHouppier(v.slug, true, c, e, pariteDeCime(v.slug, e, cran)))
          }
        }
      }
    }
    // 7 caducs × 5 cimes × (feuillu × 2 parités + nu) = 105
    // le MÉLÈZE, seul conifère saisonnier : 5 cimes × (2 coiffes + feuillu) × 2 parités + son
    //   CHICOT, qui ne tourne pas (5) = 35
    // 3 autres persistants × 5 cimes × 4 états = 60
    expect(vues.size).toBe(7 * 5 * 3 + (5 * 3 * 2 + 5) + 3 * 5 * 4)
  })

  it('la PARITÉ suit « prend la saison », et la cime NUE ne tourne jamais', () => {
    for (const v of TOUTES_VARIANTES) {
      for (const e of etatsDeCime(v.slug)) {
        const bascule = pariteDeCime(v.slug, e, 0) !== pariteDeCime(v.slug, e, 1)
        // UNE RAMURE NE TOURNE JAMAIS — ni la cime nue de l'hiver, ni le CHICOT de la cendre.
        // Le mélèze est le cas qui mord : il est `prendLaSaison`, donc sans le test son bois
        // mort virerait à l'or aux Pluies et se ferait recuire à chaque cran.
        expect(bascule, `${v.slug}/${e}`).toBe(prendLaSaison(v.slug) && !estRamure(e))
      }
    }
  })

  it('LE MÉLÈZE DORE MAIS NE SE DÉNUDE PAS — les deux notions sont bien séparées', () => {
    // C'est la seule variante du jeu à faire les deux, et c'est ce qu'est un mélèze. Si un jour
    // quelqu'un refond « tourne » et « se dénude » en un seul test, ce cas-ci rougira.
    expect(prendLaSaison('meleze')).toBe(true)
    expect(VARIANTES_CADUQUES.includes('meleze')).toBe(false)
    // `mort` est le CHICOT (`cendre.md` R13) : il ne dit rien de la saison, c'est la cendre
    // qui le pose. Un persistant en porte un précisément parce qu'il ne se dénude pas.
    expect(etatsDeCime('meleze')).toEqual(['feuillu', 'neige1', 'neige2', 'mort'])
    // Et les autres conifères, eux, ne tournent pas.
    for (const slug of ['pin', 'sapin', 'vieux_pin']) {
      expect(prendLaSaison(slug), slug).toBe(false)
    }
    // Tout caduc tourne : « se dénuder » implique « tourner », l'inverse est faux.
    for (const slug of VARIANTES_CADUQUES) expect(prendLaSaison(slug), slug).toBe(true)
  })
})


/**
 * ═══ LE CHICOT — ce que la cendre fait d'un conifère (spec `cendre.md` R13, 2026-08-27) ═══
 *
 * *(Décision d'Alexis : « ok pour les conifères transforme les en chicot gris ».)*
 *
 * Le persistant n'avait AUCUNE façon de dire qu'il meurt : G6 lui interdit de se dénuder
 * (« la silhouette du conifère dit qu'il tient »), et la cendre le faisait donc disparaître
 * d'un coup, vert, au cinquième jour. L'état `mort` le dit par la couleur — et ce que ces
 * gardes tiennent, c'est la RAISON de cette couleur : elle est claire PARCE QUE le fond est
 * de la cendre, pas parce qu'un gris a été choisi.
 */
describe('le chicot — l\'arbre que la cendre a tué', () => {
  const PERSISTANTS = TOUTES_VARIANTES.filter((v) => !VARIANTES_CADUQUES.includes(v.slug))
  const luma = (n: number): number =>
    (0.2126 * ((n >> 16) & 0xff) + 0.7152 * ((n >> 8) & 0xff) + 0.0722 * (n & 0xff)) / 255
  const hex = (c: string): number => parseInt(c.slice(1), 16)

  it('les persistants — et EUX SEULS — portent un chicot', () => {
    expect(PERSISTANTS.length, 'la garde doit d’abord VOIR des persistants').toBe(4)
    for (const v of PERSISTANTS) expect(etatsDeCime(v.slug), v.slug).toContain('mort')
    // Le caduc n'en a pas besoin : l'agonie lui reprend sa cime `nu`, qui existait pour l'hiver.
    for (const slug of VARIANTES_CADUQUES) expect(etatsDeCime(slug), slug).not.toContain('mort')
    // Et les deux sont la MÊME matière — c'est ce que `estRamure` dit aux quatre appelants.
    expect(estRamure('nu') && estRamure('mort')).toBe(true)
    expect(estRamure('feuillu') || estRamure('neige1') || estRamure('neige2')).toBe(false)
  })

  /**
   * ═══ LA PROPRIÉTÉ QUI COMMANDE LA COULEUR — ET SON ÉTALON N'EST PAS UN NOMBRE ═══
   *
   * Un chicot se voit sur de la CENDRE, jamais sur de l'herbe. Le premier réflexe (« du bois
   * brûlé », donc sombre) l'aurait fait disparaître dans son propre sol : `cendre_bois` est à
   * luma 0,21 et le fût du sapin à 0,17 — l'arbre mort aurait été MOINS visible que le vivant.
   *
   * L'étalon est donc le FEUILLAGE VIVANT de la même essence : c'est le contraste que le jeu a
   * déjà validé sur ce sol, et un chicot qui fait moins bien que lui n'est pas lisible. Rien
   * n'est comparé à un seuil écrit à la main.
   *
   * ⚠ **SUR LES DEUX SOLS QU'UN CONIFÈRE RENCONTRE, ET SUR EUX SEULS.** `terrainCendre` envoie
   * le BOISÉ sur `cendre_bois` à la frange et `burnt_forest` au cœur ; `cendre_pre` est ce que
   * devient l'HERBE, et le peuplement n'envoie de conifère que sur `pine`/`larch`. Mesurer le
   * pré ferait rougir la garde sur un cas que le jeu ne produit pas — et le vrai risque, si un
   * conifère y arrivait un jour, serait un chicot à luma 0,43 sur un sol à 0,41 : invisible.
   */
  it('le chicot se détache de son sol AU MOINS autant que l’arbre vivant', () => {
    for (const sol of [TERRAIN_CENDRE_BOIS, TERRAIN_BURNT_FOREST]) {
      const fond = luma(TERRAIN_COLORS[sol]!)
      expect(fond, 'un sol de cendre boisée est SOMBRE').toBeLessThan(0.3)
      for (const v of PERSISTANTS) {
        const ecorce = Math.abs(luma(hex(v.fut.corps)) - fond)
        const feuillage = Math.abs(luma(hex(v.tons.lumiere)) - fond)
        const mort = Math.abs(luma(hex(tonsMorts(v.fut).corps)) - fond)
        expect(mort, `${v.slug} : le chicot doit battre son écorce vivante`).toBeGreaterThan(ecorce)
        expect(mort, `${v.slug} : et tenir la comparaison avec son feuillage`).toBeGreaterThanOrEqual(feuillage)
      }
    }
  })

  /** LA MORT DÉSATURE ET RASSEMBLE : quatre essences très différentes (le pin est saumon, le
   *  sapin brun sombre) convergent vers la même famille. Ce qui les sépare encore est leur
   *  SILHOUETTE, ce qui est exactement ce que le jeu veut dire. */
  it('la mort désature, et rapproche les essences les unes des autres', () => {
    const ecart = (c: string): number => {
      const n = hex(c), r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff
      return Math.max(r, g, b) - Math.min(r, g, b)
    }
    for (const v of PERSISTANTS) {
      expect(ecart(tonsMorts(v.fut).corps), `${v.slug} désaturé`).toBeLessThan(ecart(v.fut.corps))
    }
    const corps = PERSISTANTS.map((v) => luma(hex(tonsMorts(v.fut).corps)))
    expect(Math.max(...corps) - Math.min(...corps), 'les quatre morts se ressemblent').toBeLessThan(0.1)
  })

  /** UN CHICOT EST UNE RAMURE, pas une cime : il passe par `cimeNue`, donc il occupe une petite
   *  part de sa boîte — et il ne reste pas un pixel de vert dedans. */
  it('le chicot est un squelette gris — pas une cime repeinte', () => {
    for (const v of PERSISTANTS) {
      const m = v.mesures, W = houppierLargeur(m)
      const forme = FORME_PAR_VARIANTE[v.slug]!
      const port = PORT_PAR_VARIANTE[v.slug]!
      expect(port.axe, `${v.slug} : un conifère mort garde sa flèche`).toBe('monopodial')
      const mort = cimeNue(W, m.houppierS, forme, tonsMorts(v.fut), port, m.recouvrementPx, m.colonneW, GRAINES[2]!)
      const vive = cimeEnGrappes(W, m.houppierS, forme, v.tons, GRAINES[2]!, undefined, 0)
      const pleins = (g: GrainHouppier): number => g.ton.reduce((n, t) => n + (t === null ? 0 : 1), 0)
      expect(pleins(mort), `${v.slug} : le chicot doit être MAIGRE`).toBeLessThan(pleins(vive) / 2)
      expect(pleins(mort), `${v.slug} : et exister quand même`).toBeGreaterThan(40)
      for (const t of mort.ton) {
        if (t === null) continue
        const mm = /rgb\((\d+),(\d+),(\d+)\)/.exec(t)!
        const [r, g, b] = [Number(mm[1]), Number(mm[2]), Number(mm[3])]
        expect(g <= Math.max(r, b) + 4, `${v.slug} : il reste du feuillage dans le chicot (${t})`).toBe(true)
      }
    }
  })
})
