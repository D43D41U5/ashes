/**
 * LA CIME NUE — ce qu'il reste d'un feuillu quand ses feuilles sont tombées (spec `gel.md` G6).
 *
 * `/sim` dit QUAND (`feuillageDenude`, sur le jour de saison, jamais sur la température : une
 * feuille qui tombe ne remonte pas). Ce module dit À QUOI ÇA RESSEMBLE, et rien d'autre.
 *
 * ═══ ON NE REDESSINE PAS L'ARBRE — ON LE DÉSHABILLE ═══
 *
 * La cime feuillue est déjà un CHAMP (`champDeFeuillage`) : une hauteur de matière par pixel et
 * un ton par pixel. On part de ce champ-là, celui de la cime feuillue de cet arbre-ci, et on en
 * retire les feuilles. D'où trois propriétés qu'un dessin neuf n'aurait pas :
 *
 *   • l'arbre nu a EXACTEMENT la même emprise que l'arbre feuillu — il ne bouge pas, ne grandit
 *     pas et ne se décale pas d'un pixel en se dénudant. C'est la même boîte, la même assise ;
 *   • les cinq cimes restent cinq : chaque graine donne son propre squelette, une futaie nue
 *     n'est pas une grille (la leçon de `CIMES_PAR_ARBRE`) ;
 *   • ça ne coûte presque rien à cuire : le champ, qui est la partie chère, est PARTAGÉ avec
 *     la cime feuillue — on ne repaie que l'albédo et la normale.
 *
 * ═══ CE QUI RESTE : DES BRANCHES, DENSES AU CŒUR, RARES AU BORD ═══
 *
 * Un feuillu nu vu de dessus n'est pas une cime trouée au hasard : c'est une ramure, dense
 * près du tronc et de plus en plus clairsemée vers l'extérieur, où les rameaux sont fins. Le
 * taux de survie d'un pixel décroît donc du centre vers le bord (`DENSITE_COEUR` →
 * `DENSITE_BORD`), et le tirage est un HASH DE LA POSITION — pas un PRNG : la même cime doit
 * rendre le même squelette à chaque cuisson, sinon le bois change de forme au rechargement.
 *
 * La MATIÈRE aide le tirage : un pixel de fort relief (une masse, une fourche) survit plus
 * volontiers qu'un pixel de bord de touffe. La ramure suit donc le volume de la cime au lieu
 * de le contredire.
 *
 * ═══ LA COULEUR : DU BOIS, PAS DU VERT ÉTEINT ═══
 *
 * Les tons viennent du FÛT de la variante (`TonsFut`) — le bouleau garde son bois pâle, le
 * saule son bois noir. Un vert désaturé aurait lu « arbre malade » ; du bois lit « arbre nu ».
 * Trois tons, choisis par le relief : c'est la grammaire de tout l'art du jeu (des crans
 * francs, jamais un dégradé).
 */
import type { GrainHouppier } from './feuillage'
import type { TonsFut } from './arbre-art'

/** Part des pixels qui survivent AU CŒUR de la cime — près du tronc, la ramure est dense. */
const DENSITE_COEUR = 0.5
/** Part des pixels qui survivent AU BORD — là il ne reste que des rameaux. */
const DENSITE_BORD = 0.1
/**
 * Ce que le relief pèse dans le tirage : à 0, la ramure ignore le volume de la cime ; à 1,
 * elle ne garde que les masses. La moitié laisse la ramure suivre les fourches sans devenir
 * un simple seuillage du relief (qui aurait rendu des plaques, pas des branches).
 */
const POIDS_RELIEF = 0.5

/** Le hash de la maison — entier, `Math.imul`, aucune transcendante ; rend [0, 1). */
function hachePixel(x: number, y: number, graine: number): number {
  let h = Math.imul(x | 0, 0x27d4_eb2d) ^ Math.imul(y | 0, 0x1656_67b1) ^ Math.imul(graine | 0, 0x85eb_ca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2545_f491)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

/** Mélange deux `#rrggbb` et rend un `#rrggbb`. */
function melangerHex(a: string, b: string, k: number): string {
  const n = (h: string): number => parseInt(h.slice(1), 16)
  const va = n(a)
  const vb = n(b)
  const c = (d: number): number => {
    const x = Math.round((((va >> d) & 255) * (1 - k)) + (((vb >> d) & 255) * k))
    return Math.max(0, Math.min(255, x))
  }
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0')}`
}

/** `#rrggbb` → `rgb(r,g,b)` — le format que `crownAlbedo` sait relire. */
function versRgb(hex: string): string {
  const v = parseInt(hex.slice(1), 16)
  return `rgb(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255})`
}

/**
 * LE SQUELETTE D'UNE CIME. Rend un `GrainHouppier` neuf — l'original n'est pas touché, il
 * sert encore à cuire la cime feuillue.
 *
 * `graine` doit être celle de la cime : deux cimes de la même variante ne partagent pas leur
 * ramure, sans quoi les cinq cimes se ramèneraient à une seule une fois nues.
 */
export function grainDenude(
  grain: GrainHouppier,
  W: number,
  H: number,
  fut: TonsFut,
  graine: number,
): GrainHouppier {
  const relief = new Float32Array(W * H)
  const ton: (string | null)[] = new Array<string | null>(W * H).fill(null)
  // LES TROIS TONS DE LA RAMURE — du bois SOMBRE, jamais l'éclat du fût.
  //
  // Première version : `[sombre, corps, clair]`. Sur le BOULEAU, dont le fût est pâle par
  // signature (`TONS_FUT_PALE`, corps #9a9484, clair #bdb7a4), la ramure sortait BLANCHE —
  // une cime de neige, pas des rameaux. Or l'écorce claire est celle du TRONC ; les rameaux
  // d'un bouleau sont bruns presque noirs. On travaille donc dans la moitié sombre de la
  // palette du fût, ce qui garde l'identité de chaque espèce (le saule reste plus noir que
  // le chêne) sans jamais monter jusqu'à l'éclat.
  const mi = melangerHex(fut.sombre, fut.corps, 0.6)
  const bois = [versRgb(fut.sombre), versRgb(mi), versRgb(fut.corps)] as const

  // LE CENTRE ET LE RAYON de la cime — mesurés sur la silhouette RÉELLE (après découpe), pas
  // sur la boîte : une cime décentrée aurait vu sa ramure décentrée à l'envers.
  let sx = 0
  let sy = 0
  let n = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grain.ton[y * W + x] === null) continue
      sx += x; sy += y; n++
    }
  }
  if (n === 0) return { relief, ton, opaque: () => false }
  const cx = sx / n
  const cy = sy / n
  // Le rayon caractéristique : celui d'un disque de même aire. Il donne une décroissance qui
  // s'adapte à la taille de la cime au lieu d'un nombre de pixels écrit à la main.
  const rayon = Math.max(1, Math.sqrt(n / Math.PI))

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (grain.ton[i] === null) continue
      const dx = (x - cx) / rayon
      const dy = (y - cy) / rayon
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy))
      const r = Math.max(0, Math.min(1, grain.relief[i] ?? 0))
      // Le seuil de survie : la distance au cœur commande, le relief penche la balance.
      const seuil = (DENSITE_COEUR + (DENSITE_BORD - DENSITE_COEUR) * d)
        * (1 - POIDS_RELIEF + POIDS_RELIEF * 2 * r)
      if (hachePixel(x, y, graine) >= seuil) continue
      // Trois crans de bois, choisis par le relief : les fourches attrapent la lumière.
      ton[i] = bois[r > 0.66 ? 2 : r > 0.33 ? 1 : 0]!
      // La ramure garde du VOLUME, mais moins qu'une masse de feuilles : une branche est fine.
      relief[i] = 0.35 + 0.4 * r
    }
  }
  return { relief, ton, opaque: (x, y) => x >= 0 && y >= 0 && x < W && y < H && ton[y * W + x] !== null }
}
