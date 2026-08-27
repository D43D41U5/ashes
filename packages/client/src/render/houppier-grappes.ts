/**
 * ═══ LA CIME EN GRAPPES — le houppier dans la DA du sol dessiné ═══
 *
 * *Décision d'Alexis, 2026-08-22, sur planches : houppier « G1 » (grappes lâches de pavés
 * chanfreinés), pied F4 (l'ombre de contact, rien sur le fût), et l'hiver = le fût + UNE branche par
 * touffe, sans brindilles — « cale-toi sur le houppier d'été ».*
 *
 * Une cime est un empilement de GRAPPES : des pavés chanfreinés (3-4 par niveau, quatre niveaux),
 * chacun avec la grammaire des pavés du sol (`render/paves.ts`) — arête claire en haut, liseré
 * sombre en bas, tranche, frange irrégulière qui déborde sur le pavé du dessous, ombre portée sur
 * lui, grain 4 px. Le pavé le plus bas est DEVANT. La forme (rond, étroit, large, conifère) vient
 * de l'essence ; cinq graines donnent cinq cimes cousines.
 *
 * LA CIME NUE SE DÉRIVE DE LA CIME FEUILLUE : chaque grappe est portée par une branche qui part
 * du fût (ou de la grappe posée la plus proche en dessous) et arrive à son centre. Même enveloppe,
 * mêmes masses — l'hiver est l'été sans les feuilles. L'essence ne donne que le CARACTÈRE du bois :
 * tortuosité des charpentières, et l'axe (monopodial : le bouleau monte jusqu'à la plus haute
 * touffe ; sympodial : l'axe se perd dans les charpentières).
 *
 * Ce module remplace `feuillage.ts` + `feuillage-nu.ts` (le champ de touffes et son déshabillage,
 * 2026-07-30 → 2026-08-22). Il rend le même `GrainHouppier` : `lit-trees.ts` n'a rien eu à
 * apprendre.
 *
 * PUR : aucun import Phaser. `hash2` de la sim pour le déterminisme (même graine → même cime, sur
 * tout moteur — une cime n'est pas dans la sim, mais deux clients doivent voir le même arbre).
 */
import { hash2 } from '@ashes/sim'
import type { TonsFut, TonsHouppier } from './arbre-art'
import { NEIGE_PAVE } from './manteau'

/** Ce que le pipeline `_lit` consomme (hérité de `feuillage.ts`, inchangé). */
export interface GrainHouppier {
  /** Hauteur de matière (0..1), 0 hors de la cime. C'est ce qu'on passe à `normalFromCanvas`. */
  relief: Float32Array
  /** Le ton à peindre, `null` là où la cime est ajourée. */
  ton: (string | null)[]
  /** La silhouette RÉELLE — celle que le reste du pipeline doit lire. */
  opaque: (x: number, y: number) => boolean
}

export type FormeCime = 'rond' | 'etroit' | 'large' | 'conifere'

/** La forme de chaque variante — ce que la planche validée montrait. */
export const FORME_PAR_VARIANTE: Record<string, FormeCime> = {
  tree: 'rond',
  old_tree: 'rond',
  chene_pre: 'rond',
  hetre: 'rond',
  baliveau: 'rond',
  bouleau: 'etroit',
  saule: 'large',
  vieux_pin: 'large',
  pin: 'conifere',
  sapin: 'conifere',
  meleze: 'conifere',
}

/** Le caractère du bois nu d'une variante (les conifères n'ont pas de cime nue). */
export interface PortNu {
  /** monopodial : l'axe monte jusqu'à la plus haute touffe et chaque touffe s'y accroche ;
   *  sympodial : chaque touffe s'accroche au fût ou à la touffe posée la plus proche en dessous. */
  axe: 'monopodial' | 'sympodial'
  /** La tortuosité des charpentières : déviation latérale des points intermédiaires, en part de la
   *  longueur. 0,22 un chêne noueux, 0,12 un hêtre presque droit. */
  tortueux: number
}
export const PORT_PAR_VARIANTE: Record<string, PortNu> = {
  tree: { axe: 'sympodial', tortueux: 0.22 },
  old_tree: { axe: 'sympodial', tortueux: 0.15 },
  chene_pre: { axe: 'sympodial', tortueux: 0.22 },
  hetre: { axe: 'sympodial', tortueux: 0.12 },
  baliveau: { axe: 'sympodial', tortueux: 0.15 },
  saule: { axe: 'sympodial', tortueux: 0.18 },
  bouleau: { axe: 'monopodial', tortueux: 0.08 },
}

/** Les réglages des grappes — ce qui se règle en REGARDANT une planche. */
export const GRAPPES = {
  /** Le chanfrein des coins d'un pavé, en px. */
  CHANFREIN: 4,
  /** La frange : le bas d'un pavé déborde de MIN..MAX px par colonne de 4 px. */
  FRANGE_MIN: 2,
  FRANGE_MAX: 5,
  /** De combien un niveau mord sur celui du dessous, en px. */
  MORD: 6,
  /** La gigue verticale d'une grappe, en px (± la moitié). */
  GIGUE_Y: 6,
  /** Part haute d'un pavé peinte au ton `lumiere` (le reste au ton `corps`). */
  PART_CLAIRE: 0.38,
  /** Le relief passé à la normale : plein sur le corps du pavé, creusé au liseré et à l'ombre. */
  RELIEF_CORPS: 1,
  RELIEF_LISERE: 0.72,
  RELIEF_OMBRE: 0.86,
  /** Le grain 4 px : une cellule sur cinq un cran plus sombre, une sur sept un cran plus clair. */
  GRAIN_SOMBRE: 0.93,
  GRAIN_CLAIR: 1.06,
  /** L'ombre portée d'un pavé sur ce qu'il recouvre : 2 px, puis 1 px de pénombre. */
  OMBRE: 0.72,
  PENOMBRE: 0.86,
} as const

/**
 * ═══ LA COIFFE DE NEIGE DES PERSISTANTS (demande d'Alexis, 2026-08-25) ═══
 *
 * *« Il faudrait ajouter une couche de neige sur les arbres persistants. »*
 *
 * Le feuillu résout l'hiver par la SILHOUETTE : il se dénude (G6). Le conifère, lui, garde la
 * même cime douze mois sur douze — et comme il ne prend pas non plus la teinte de la saison
 * (`VARIANTES_CADUQUES` ne le nomme pas, et c'est la promesse « la silhouette du conifère dit
 * qu'il tient »), il était la SEULE chose du paysage que le Grand Froid ne touchait pas.
 *
 * La neige se pose donc sur le HAUT de chaque pavé, et c'est exactement la grammaire du sol
 * dessiné : un pavé de neige sur un pavé d'herbe (`manteau.ts` — arête claire en haut, frange
 * irrégulière en bas, liseré d'ombre sur ce qu'elle recouvre). On ne peint pas un voile blanc
 * sur la cime : on empile une matière de plus, la même que celle qui couvre le sol au pied de
 * l'arbre — d'où la palette EMPRUNTÉE à `NEIGE_PAVE`, jamais recopiée.
 *
 * ⚠ **LE RELIEF DE LA COIFFE BOMBE, il ne monte pas.** `normalFromCanvas` lit un champ borné à
 * [0, 1] et `RELIEF_CORPS` y vaut déjà 1 : une neige « plus haute » n'aurait nulle part où
 * aller. La coiffe descend donc de son arête (1) vers sa frange (`RELIEF_FRANGE`), ce qui donne
 * à la normale un dôme — une congère prend la lumière par le dessus, pas par la tranche.
 */
export const NEIGE_CIME = {
  /** Part de la hauteur d'un pavé que la coiffe prend, à charge pleine. */
  PART: 0.42,
  /** Jamais moins que ça, sinon un petit pavé n'a pas de neige du tout (trous dans la cime). */
  MIN_PX: 2,
  /** La frange : le bas de la coiffe ondule de 0..FRANGE px, par colonne de 3 px. */
  FRANGE: 3,
  /** Les rangs du haut, au ton le plus clair — l'arête qui regarde le ciel. */
  ARETE_PX: 2,
  /** Le liseré d'ombre que la coiffe porte sur le feuillage juste dessous (facteur). */
  LISERE: 0.74,
  /** Le relief de la frange (l'arête vaut 1) : la coiffe bombe. */
  RELIEF_FRANGE: 0.78,
} as const

export interface Grappe {
  x0: number
  x1: number
  y0: number
  y1: number
}

/** [centre relatif, largeur relative, hauteur relative] d'un pavé, par niveau (du bas vers le haut). */
type Niveaux = readonly (readonly (readonly [number, number, number])[])[]
const NIVEAUX_FEUILLU: Niveaux = [
  [[-0.34, 0.38, 0.34], [-0.02, 0.4, 0.36], [0.3, 0.38, 0.34]],
  [[-0.36, 0.36, 0.32], [-0.08, 0.4, 0.34], [0.2, 0.36, 0.32], [0.4, 0.3, 0.28]],
  [[-0.2, 0.36, 0.3], [0.1, 0.38, 0.3], [0.34, 0.28, 0.26]],
  [[-0.05, 0.34, 0.26], [0.2, 0.28, 0.24]],
]

/**
 * LES GRAPPES d'une cime de W×H px (la boîte du houppier ; le fût est à W/2, le bas à H).
 * La graine déplace chaque pavé d'une gigue verticale et horizontale : cinq graines, cinq cimes.
 */
export function grappesDe(W: number, H: number, forme: FormeCime, graine: number): Grappe[] {
  const cx = W / 2
  const et: Grappe[] = []
  const gigue = (i: number, k: number, sel: number): number => (hash2(i, k, (graine ^ sel) | 0) - 0.5) * GRAPPES.GIGUE_Y
  if (forme === 'conifere') {
    // Cinq niveaux de PAIRES qui se resserrent, plus un pavé central par niveau : le cône.
    let y1 = H
    const n = 5
    for (let i = 0; i < n; i++) {
      const ew = Math.round(W * (0.55 - i * (0.42 / n)))
      const eh = Math.round(H * 0.22)
      const ecart = Math.round(W * (0.22 - i * (0.18 / n)))
      const g = Math.round(gigue(i, 1, 0x51))
      et.push({ x0: Math.round(cx - ecart - ew / 2), x1: Math.round(cx - ecart + ew / 2), y0: y1 - eh + g, y1: y1 + g })
      et.push({ x0: Math.round(cx + ecart - ew / 2), x1: Math.round(cx + ecart + ew / 2), y0: y1 - eh + 2 - g, y1: y1 + 2 - g })
      // le pavé central : l'assise au niveau bas (il touche le bas), en retrait ensuite
      et.push({ x0: Math.round(cx - ew / 2), x1: Math.round(cx + ew / 2), y0: y1 - eh - (i === 0 ? 0 : 3), y1: y1 - (i === 0 ? 0 : 3) })
      y1 -= eh - 5
    }
  } else {
    // Le feuillu : quatre niveaux de trois ou quatre pavés. L'étroit resserre les centres, le
    // large les écarte — la boîte fait le reste (elle est déjà plus large que haute).
    const serre = forme === 'etroit' ? 0.8 : forme === 'large' ? 1.1 : 1
    let yBase = H
    NIVEAUX_FEUILLU.forEach((niv, i) => {
      const eh = Math.round(H * niv[0]![2])
      // au niveau BAS, le pavé le plus proche de l'axe est l'ASSISE : il ne gigue pas et il
      // couvre le fût — la cime s'assoit dessus (V3 : la cime ne flotte pas).
      const kAssise = i === 0 ? niv.reduce((b, n, k) => (Math.abs(n[0]) < Math.abs(niv[b]![0]) ? k : b), 0) : -1
      niv.forEach(([c, lw, lh], k) => {
        const ew = Math.round(W * lw), hh = Math.round(H * lh)
        const dx = k === kAssise ? 0 : Math.round(gigue(i, k, 0x52) * 0.5)
        const x0 = k === kAssise ? Math.round(cx - ew / 2) : Math.round(cx + W * c * serre - ew / 2) + dx
        const dy = k === kAssise ? 0 : Math.round(gigue(i, k, 0x53))
        et.push({ x0, x1: x0 + ew, y0: yBase - hh + dy, y1: yBase + dy })
      })
      yBase -= eh - GRAPPES.MORD
    })
  }
  // Le pavé le plus bas touche le bas de la boîte : c'est l'assise (la cime ne flotte pas, V3).
  // Tout reste dans la boîte (V4) : on borne — un pavé qui gigue sous le bas se tronque de
  // quelques pixels, ça ne se voit pas, et l'assise (sans gigue) touche le bas.
  for (const g of et) {
    g.x0 = Math.max(0, g.x0); g.x1 = Math.min(W, g.x1); g.y0 = Math.max(0, g.y0); g.y1 = Math.min(H, g.y1)
  }
  return et
}

/** `#rrggbb` → triplet. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}
const ton = (c: readonly [number, number, number], k = 1): string =>
  `rgb(${Math.min(255, Math.round(c[0] * k))},${Math.min(255, Math.round(c[1] * k))},${Math.min(255, Math.round(c[2] * k))})`

/** Une toile de travail : couleur (triplet + facteur), relief, appartenance. */
class Toile {
  readonly base: Float32Array
  readonly fac: Float32Array
  readonly relief: Float32Array
  readonly dedans: Uint8Array
  constructor(readonly W: number, readonly H: number) {
    this.base = new Float32Array(W * H * 3)
    this.fac = new Float32Array(W * H)
    this.relief = new Float32Array(W * H)
    this.dedans = new Uint8Array(W * H)
  }
  est(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.W && y < this.H && this.dedans[y * this.W + x] === 1
  }
  pose(x: number, y: number, c: readonly [number, number, number], relief: number): void {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return
    const i = y * this.W + x
    this.base[i * 3] = c[0]; this.base[i * 3 + 1] = c[1]; this.base[i * 3 + 2] = c[2]
    this.fac[i] = 1; this.relief[i] = relief; this.dedans[i] = 1
  }
  mul(x: number, y: number, k: number, relief?: number): void {
    if (!this.est(x, y)) return
    const i = y * this.W + x
    this.fac[i] = this.fac[i]! * k
    if (relief !== undefined) this.relief[i] = Math.min(this.relief[i]!, relief)
  }
  grain(): GrainHouppier {
    const tons: (string | null)[] = new Array(this.W * this.H).fill(null)
    for (let i = 0; i < this.W * this.H; i++) {
      if (!this.dedans[i]) continue
      tons[i] = ton([this.base[i * 3]!, this.base[i * 3 + 1]!, this.base[i * 3 + 2]!], this.fac[i]!)
    }
    const dedans = this.dedans, W = this.W, H = this.H
    return { relief: this.relief, ton: tons, opaque: (x, y) => x >= 0 && y >= 0 && x < W && y < H && dedans[y * W + x] === 1 }
  }
}

/**
 * LA COIFFE DE NEIGE D'UN PAVÉ : une bande sur son haut, frangée en bas, avec son liseré
 * d'ombre sur le feuillage qu'elle recouvre. Même grammaire que le manteau au sol.
 */
function coiffer(t: Toile, s: Grappe, neige: number, graine: number): void {
  const C = GRAPPES.CHANFREIN
  const hp = s.y1 - s.y0
  const ep = Math.max(NEIGE_CIME.MIN_PX, Math.round(hp * NEIGE_CIME.PART * neige))
  const corps = rgb('#' + NEIGE_PAVE.NEIGE.toString(16).padStart(6, '0'))
  const arete = rgb('#' + NEIGE_PAVE.NEIGE_PROFONDE.toString(16).padStart(6, '0'))
  for (let x = s.x0; x < s.x1; x++) {
    // La frange ONDULE par colonne de 3 px — la neige ne s'arrête pas à la règle.
    const d = Math.floor(hash2(x / 3 | 0, s.y0, (graine ^ 0x7e1) | 0) * (NEIGE_CIME.FRANGE + 1))
    const bas = s.y0 + ep + d
    for (let y = s.y0; y < bas; y++) {
      // Le chanfrein du pavé : la neige n'a pas le droit de déborder de ses coins coupés.
      const ex = Math.min(x - s.x0, s.x1 - 1 - x), ey = Math.min(y - s.y0, s.y1 - 1 - y)
      if (ex + ey < C) continue
      if (!t.est(x, y)) continue // hors de la cime : rien à coiffer
      // Le relief BOMBE de l'arête (1) vers la frange — la normale y lit un dôme.
      const u = (y - s.y0) / Math.max(1, bas - s.y0)
      t.pose(x, y, y - s.y0 < NEIGE_CIME.ARETE_PX ? arete : corps, 1 - (1 - NEIGE_CIME.RELIEF_FRANGE) * u)
    }
    // LE LISERÉ : le rang de feuillage juste sous la frange s'assombrit. C'est lui qui donne
    // son ÉPAISSEUR à la neige — sans lui, la coiffe se lit comme une décoloration.
    t.mul(x, bas, NEIGE_CIME.LISERE, GRAPPES.RELIEF_LISERE)
  }
}

/**
 * LA CIME FEUILLUE : les grappes empilées, chacune habillée. Du haut vers le bas — le pavé le plus
 * bas se peint en dernier, il est devant ; avant de le peindre, on porte son ombre sur ce qui est
 * déjà là. Même grammaire que `render/paves.ts`, sur une toile de sprite.
 */
export function cimeEnGrappes(
  W: number, H: number, forme: FormeCime, tons: TonsHouppier, graine: number,
  panache?: (index: number) => TonsHouppier,
  neige = 0,
): GrainHouppier {
  const t = new Toile(W, H)
  const et = grappesDe(W, H, forme, graine)
  // Le plus bas en dernier — et il garde son INDEX, car la teinte peut varier d'une grappe à
  // l'autre (`panache` : une cime qui tourne ne tourne pas d'un bloc).
  const ordre = et.map((g, i) => ({ g, i })).sort((a, b) => a.g.y1 - b.g.y1)
  const C = GRAPPES.CHANFREIN
  for (const { g: s, i: iG } of ordre) {
    const tg = panache?.(iG) ?? tons
    const corps = rgb(tg.corps), lumiere = rgb(tg.lumiere), eclat = rgb(tg.eclat), masse = rgb(tg.masse), ombre = rgb(tg.ombre)
    // l'ombre du pavé sur ce qu'il recouvre (2 px + 1 px), avant de le peindre
    for (let x = s.x0 - 1; x <= s.x1; x++) for (let k = 0; k < 3; k++) t.mul(x, s.y1 + k, k < 2 ? GRAPPES.OMBRE : GRAPPES.PENOMBRE, GRAPPES.RELIEF_OMBRE)
    // le corps, chanfreiné, clair sur son tiers haut
    for (let y = s.y0; y < s.y1; y++) for (let x = s.x0; x < s.x1; x++) {
      const ex = Math.min(x - s.x0, s.x1 - 1 - x), ey = Math.min(y - s.y0, s.y1 - 1 - y)
      if (ex + ey < C) continue
      t.pose(x, y, (y - s.y0) < (s.y1 - s.y0) * GRAPPES.PART_CLAIRE ? lumiere : corps, GRAPPES.RELIEF_CORPS)
    }
    // la frange : le bas déborde de 2-5 px par colonne de 4 px
    for (let x = s.x0; x < s.x1; x++) {
      const ex = Math.min(x - s.x0, s.x1 - 1 - x)
      if (ex < C) continue
      const d = GRAPPES.FRANGE_MIN + Math.floor(hash2(x >> 2, s.y1, (graine ^ 0x31) | 0) * (GRAPPES.FRANGE_MAX - GRAPPES.FRANGE_MIN + 1))
      for (let k = 0; k < d; k++) if (s.y1 + k < H) t.pose(x, s.y1 + k, corps, GRAPPES.RELIEF_CORPS)
    }
    // les marques de CE pavé, lues sur le masque courant dans son rect élargi
    const m: [number, number, readonly [number, number, number], number][] = []
    for (let y = s.y0 - 3; y < s.y1 + 8; y++) for (let x = s.x0 - 3; x <= s.x1 + 3; x++) {
      if (!t.est(x, y)) continue
      if (!t.est(x, y - 1) || !t.est(x, y - 2)) m.push([x, y, eclat, GRAPPES.RELIEF_CORPS])
      else if (!t.est(x, y + 1) || !t.est(x, y + 2)) m.push([x, y, masse, GRAPPES.RELIEF_LISERE])
      else if (!t.est(x, y + 3)) m.push([x, y, ombre, GRAPPES.RELIEF_OMBRE])
      else if (!t.est(x - 1, y) || !t.est(x + 1, y)) m.push([x, y, ombre, GRAPPES.RELIEF_OMBRE])
    }
    for (const [x, y, c, r] of m) t.pose(x, y, c, r)
    // LA COIFFE DE NEIGE — après les marques de CE pavé, jamais avant : l'arête claire du
    // feuillage repeindrait sinon le rang du haut de la neige en vert. Un pavé posé plus bas
    // (donc plus tard, donc DEVANT) recouvrira la coiffe de celui-ci — c'est ce qu'il faut.
    if (neige > 0) coiffer(t, s, neige, graine)
  }
  // le grain 4 px, sur toute la cime
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!t.est(x, y)) continue
    const h = hash2(x >> 2, y >> 2, (graine ^ 0x3) | 0)
    if (h < 0.2) t.mul(x, y, GRAPPES.GRAIN_SOMBRE)
    else if (h > 0.86) t.mul(x, y, GRAPPES.GRAIN_CLAIR)
  }
  return t.grain()
}

/** Un segment de bois d'épaisseur `ep` (qui s'effile d'un pixel vers l'arrivée) : clair à gauche,
 *  corps au milieu, sombre à droite — la lumière d'en haut à gauche, comme les pavés. */
function segment(t: Toile, fut: TonsFut, x0: number, y0: number, x1: number, y1: number, ep: number): void {
  const clair = rgb(fut.clair), corps = rgb(fut.corps), sombre = rgb(fut.sombre)
  // Le nombre de pas se lit sur les extrémités ARRONDIES : sur des flottants, un delta de 1,2 px
  // donnait un seul pas entre deux rangées arrondies à 2 d'écart — une rangée vide, la branche
  // coupée (vu par la garde de composantes).
  const X0 = Math.round(x0), Y0 = Math.round(y0), X1 = Math.round(x1), Y1 = Math.round(y1)
  const n = Math.max(1, Math.abs(X1 - X0), Math.abs(Y1 - Y0))
  let xp = X0, yp = Y0
  for (let i = 0; i <= n; i++) {
    const u = i / n
    const x = Math.round(X0 + (X1 - X0) * u), y = Math.round(Y0 + (Y1 - Y0) * u)
    const e = Math.max(1, Math.round(ep - u))
    const g = Math.floor(e / 2)
    const relief = 0.55 + 0.45 * Math.min(1, e / 4)
    for (let k = 0; k < e; k++) {
      const c = e >= 3 ? (k === 0 ? clair : k === e - 1 ? sombre : corps) : e === 2 ? (k === 0 ? corps : sombre) : corps
      t.pose(x - g + k, y, c, relief)
    }
    // un pas en diagonale est 8-connexe : on pose le pixel d'angle pour que le bois soit d'UN tenant
    // en 4-connexité (la normale et la garde de composantes le lisent ainsi)
    if (x !== xp && y !== yp) t.pose(x - g, yp, corps, relief)
    xp = x; yp = y
  }
}
/** Une branche : trois segments, les deux points intermédiaires déviés latéralement (la tortuosité). */
function branche(t: Toile, fut: TonsFut, x0: number, y0: number, x1: number, y1: number, ep: number, tort: number, k: number, graine: number): void {
  const dx = x1 - x0, dy = y1 - y0, L = Math.sqrt(dx * dx + dy * dy) || 1
  const nx = -dy / L, ny = dx / L
  const pts: [number, number][] = [[x0, y0]]
  for (let i = 1; i <= 2; i++) {
    const u = i / 3
    const d = (hash2(k, i, (graine ^ 0x21) | 0) - 0.5) * 2 * tort * L * 0.35
    pts.push([Math.max(1, Math.min(t.W - 2, x0 + dx * u + nx * d)), Math.max(1, Math.min(t.H - 2, y0 + dy * u + ny * d))])
  }
  pts.push([x1, y1])
  for (let i = 0; i < 3; i++) segment(t, fut, pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1], ep - (i === 2 ? 1 : 0))
}

/**
 * LA CIME NUE : le fût continue depuis `H − recouvrement` (le sommet du fût d'été, que la cime
 * recouvre), et chaque grappe reçoit sa branche. Rien d'autre — pas de brindilles (Alexis).
 */
export function cimeNue(
  W: number, H: number, forme: FormeCime, fut: TonsFut, port: PortNu,
  recouvrement: number, colonneW: number, graine: number,
): GrainHouppier {
  const t = new Toile(W, H)
  const et = grappesDe(W, H, forme, graine)
  const xAxe = Math.floor(W / 2)
  const yTop = H - recouvrement // le sommet du fût, en coordonnées de cime
  const noeuds = et.map((g, i) => ({ g, i, cx: (g.x0 + g.x1) / 2, cy: (g.y0 + g.y1) / 2 })).sort((a, b) => b.cy - a.cy)
  const epDe = (ordre: number): number => Math.max(2, Math.round(colonneW * 0.66) - (ordre - 1))
  // Le fût continue depuis le BAS de la boîte (il recouvre le sommet du fût d'été, mêmes tons) :
  // ainsi une grappe basse, dont le centre est sous le sommet du fût, s'accroche à du bois.
  segment(t, fut, xAxe, H - 1, xAxe, yTop + 2, colonneW + 1)
  if (port.axe === 'monopodial') {
    const yHaut = Math.max(2, Math.min(...noeuds.map((n) => n.cy)) - 4)
    segment(t, fut, xAxe, yTop + 2, xAxe, yHaut, colonneW)
    for (const n of noeuds) {
      if (Math.abs(n.cx - xAxe) < 4) {
        // une touffe centrée sur l'axe : la branche va d'un bord à l'autre
        branche(t, fut, xAxe, n.cy + 1, n.g.x0 + 2, n.cy + 1, epDe(1), port.tortueux, n.i + 1, graine)
        branche(t, fut, xAxe, n.cy + 1, n.g.x1 - 2, n.cy + 1, epDe(1), port.tortueux, n.i + 101, graine)
      } else {
        branche(t, fut, xAxe, Math.min(H - 2, n.cy + 2), n.cx, n.cy, epDe(1), port.tortueux, n.i + 1, graine)
      }
    }
    return t.grain()
  }
  // sympodial : la touffe s'accroche au nœud posé le plus proche EN DESSOUS (le fût d'abord)
  const poses: { x: number; y: number; ordre: number }[] = [{ x: xAxe, y: yTop + 2, ordre: 0 }]
  for (const n of noeuds) {
    let meilleur = poses[0]!, dMin = Infinity
    for (const q of poses) {
      if (q.y < n.cy + 3) continue
      const d = (q.x - n.cx) ** 2 + (q.y - n.cy) ** 2 + q.ordre * 60
      if (d < dMin) { dMin = d; meilleur = q }
    }
    const ordre = meilleur.ordre + 1
    branche(t, fut, meilleur.x, meilleur.y, n.cx, n.cy, epDe(ordre), port.tortueux, n.i + 1, graine)
    poses.push({ x: n.cx, y: n.cy, ordre })
  }
  return t.grain()
}

/** Les centres des grappes — pour les tests : chaque touffe doit « avoir sa branche ». */
export function centresDe(W: number, H: number, forme: FormeCime, graine: number): [number, number][] {
  return grappesDe(W, H, forme, graine).map((g) => [Math.round((g.x0 + g.x1) / 2), Math.round((g.y0 + g.y1) / 2)])
}
