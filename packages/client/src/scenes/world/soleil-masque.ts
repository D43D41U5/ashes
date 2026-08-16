/**
 * LE MASQUE DES TACHES DE SOLEIL — la densité de lumière par tuile (spec forets-vivantes
 * §5 R6, AMENDÉE le 2026-08-16 : décision d'Alexis).
 *
 * La première version suivait `map.profondeur` — la profondeur dans le MASSIF de zone —
 * et des clairières par blocs. Ce champ ne sait rien des arbres PEINTS : une couronne
 * dense en lisière recevait des taches en plein dessous, un trou de canopée au cœur
 * restait éteint (la Vieille Sylve est justement MOINS dense que la forêt ordinaire —
 * mesuré), et rien ne bougeait à l'abattage ni à la dérive. « Les taches s'affichent de
 * manière incohérente avec la couverture réelle des arbres » (Alexis, 2026-08-16).
 *
 * Le modèle amendé : LA LUMIÈRE EST CE QUE LA CANOPÉE LAISSE PASSER.
 *
 *   • CHAQUE COURONNE RÉELLE tamponne son emprise au sol (retombée quadratique du tronc
 *     au bord : une couronne n'est pas un disque dur) — l'OUVERTURE d'une tuile est ce
 *     qui reste : 1 dans un trou de canopée, 0 au pied d'un tronc. Les arbres sont ceux
 *     que le rendu peint (`view.nodes`, stock > 0) : abattre une trouée l'ÉCLAIRE, un
 *     arbre qui dérive emporte son ombre.
 *   • LA PÉNOMBRE DE CŒUR : l'ambiance de R6 survit en FACTEUR doux — l'ouverture se
 *     multiplie d'une pente continue de 1 (lisière) à 0,7 (au PROF_CAP du massif). Un
 *     trou au cœur reste une tache de lumière — juste un peu plus sourde qu'en lisière.
 *   • LES CLAIRIÈRES (A22) échappent à la pénombre : ce sont des chambres de lumière
 *     PLEINES, comme avant.
 *   • HORS DES BOIS (profondeur 0), pas de taches : c'est un effet de SOUS-BOIS.
 *
 * Module PUR (aucun import Phaser) : c'est lui qu'on teste ; `SoleilLayer` ne fait que
 * le verser dans son canvas.
 */
import { clairiereForet } from '@ashes/sim'

/** Ce que le masque lit de la carte — le strict nécessaire, pour rester testable. */
export interface ChampSoleil {
  width: number
  height: number
  /** La profondeur d'érosion dans le massif (0 = hors bois), le canal de l'assombrissement. */
  profondeur?: readonly number[]
}

/** Un arbre VIVANT tel que le rendu le peint : sa tuile, et le rayon au sol de sa couronne. */
export interface ArbreCouvert {
  tx: number
  ty: number
  rayonTuiles: number
}

/** Le plafond de la pente de pénombre — la valeur de `CREUX.PROF_CAP` (racine-relief),
 *  recopiée en littéral : ce module est client, le réglage du worldgen ne se règle pas
 *  d'ici. Si le cap bouge, la pente s'étire — rien ne casse. */
const PROF_CAP = 8
/** Au PROF_CAP, l'ouverture est multipliée par ce plancher : la pénombre de cœur.
 *  Jamais 0 — un trou de canopée au cœur reste une tache (c'est tout l'amendement). */
const PENOMBRE_COEUR = 0.7

/**
 * Le masque entier, R ∈ [0..255] par tuile. À bâtir au boot puis à CHAQUE changement
 * d'arbres (throttlé par l'appelant) — jamais par frame.
 */
export function masqueSoleil(carte: ChampSoleil, seed: number, arbres: readonly ArbreCouvert[]): Uint8Array {
  const { width, height } = carte
  const prof = carte.profondeur
  const N = width * height

  // ── LA COUVERTURE : chaque couronne retombe en cloche quadratique sur son emprise. ──
  // `max` entre couronnes (pas une somme) : deux houppiers qui se chevauchent ne font
  // pas une ombre plus noire que le plus sombre des deux — et la fonction reste
  // CONTINUE sur tout le domaine (règle maison : la pente, sur TOUT l'élément).
  const couverture = new Float32Array(N)
  for (const a of arbres) {
    const r = Math.max(0.5, a.rayonTuiles)
    const r2 = r * r
    const x0 = Math.max(0, Math.floor(a.tx - r))
    const x1 = Math.min(width - 1, Math.ceil(a.tx + r))
    const y0 = Math.max(0, Math.floor(a.ty - r))
    const y1 = Math.min(height - 1, Math.ceil(a.ty + r))
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const dx = tx - a.tx
        const dy = ty - a.ty
        const c = 1 - (dx * dx + dy * dy) / r2
        if (c <= 0) continue
        const i = ty * width + tx
        if (c > couverture[i]!) couverture[i] = c
      }
    }
  }

  // ── L'OUVERTURE × LA PÉNOMBRE → la densité. ──
  const out = new Uint8Array(N)
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      const d = prof?.[i] ?? 0
      if (d < 1) continue // hors des bois : pas de sous-bois, pas de taches
      const ouverture = 1 - Math.min(1, couverture[i]!)
      // La chambre de lumière (A22) reste pleine ; ailleurs, la pente de cœur.
      const penombre = clairiereForet(seed, tx, ty) > 0
        ? 1
        : 1 - (1 - PENOMBRE_COEUR) * Math.min(1, (d - 1) / (PROF_CAP - 1))
      out[i] = Math.round(ouverture * penombre * 255)
    }
  }
  return out
}
