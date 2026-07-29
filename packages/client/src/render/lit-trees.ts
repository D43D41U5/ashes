/**
 * LES ARBRES ÉCLAIRABLES (DA actée, docs/decisions.md 2026-07-20 ; vague A du 25/07).
 *
 * Variantes `_lit` de l'arbre ordinaire ET du GROS BOIS — MÊME forme et MÊME famille de
 * couleur que l'art d'origine (demande d'Alexis), mais ALBÉDO UNIFORME (à plat) : on retire
 * l'ombrage PEINT pour ne pas le cumuler avec la lumière calculée. Tout le relief vient de la
 * carte de NORMALES + des lumières (dynamic-lighting).
 *
 * LE HOUPPIER passe par la recette commune (`normal-map.ts`) : masque lissé 7 passes,
 * facettes de 4 px (cell), gain 3,2 — les cadrans historiques de ce module, conservés à
 * l'identique (le smoke `cubique` en témoigne). LE TRONC reste ANALYTIQUE : un cylindre ne se
 * dérive pas d'une silhouette — la colonne du fût reçoit sa normale de section directement.
 *
 * Le vieux chêne (gros bois) : houppier 40×40 un cran PLUS SOMBRE (il ferme le ciel — son
 * identité), fût de 10 px (2,5× l'ordinaire), cœur clair en bout (il est VIEUX, ça se voit).
 * C'était le SEUL sprite du monde volontairement éteint — l'exception tombe (da-feeling R3).
 */
import type Phaser from 'phaser'
import { newCanvas, normalFromCanvas, registerLit as register } from './normal-map'
import {
  colonneX, houppierLargeur, houppierOpaqueDe, TOUTES_VARIANTES, TONS_HOUPPIER_VIEUX,
  type MesuresArbre, type TonsFut,
} from './arbre-art'
import { champDeHauteur, ecorceDe, facteurPied, type Ecorce, type GrainFut } from './ecorce'

/* LES COULEURS NE SONT PLUS RÉÉCRITES ICI NON PLUS. Elles étaient recopiées de l'art peint —
 * la garde de palette a fini par le voir (trois fichiers pour un même brun sans nom). C'est
 * l'arête CLAIRE de chaque famille qu'on aplatit : l'albédo se pose au niveau « éclairé », pour
 * que la lumière calculée SCULPTE vers le bas plutôt que de partir dans le noir. */

/** `#rrggbb` → triplet. Aucune dépendance à Phaser : ce module tourne aussi hors scène. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** Albédo UNIFORME d'un houppier : sa silhouette, à plat. La boîte n'est plus forcément carrée
 *  (le saule et le parasol du vieux pin sont plus larges que hauts). */
function crownAlbedo(W: number, S: number, opaque: (x: number, y: number) => boolean, ton: string): HTMLCanvasElement {
  const [r, g, b] = rgb(ton)
  const { c, ctx } = newCanvas(W, S)
  const d = ctx.createImageData(W, S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < W; x++) {
      if (!opaque(x, y)) continue
      const i = (y * W + x) * 4
      d.data[i] = r; d.data[i + 1] = g; d.data[i + 2] = b; d.data[i + 3] = 255
    }
  }
  ctx.putImageData(d, 0, 0)
  return c
}

/* LES SILHOUETTES NE SONT PLUS RÉÉCRITES ICI. Elles étaient déclarées une deuxième fois, à la
 * main, en face des rects de `BootScene` — deux écritures d'une même forme, qui finissent
 * toujours par différer d'un pixel. `houppierOpaque` les DÉDUIT du dessin peint (union de la
 * masse et du corps), donc elles ne peuvent plus s'écarter. */

/* LE CYLINDRE ANALYTIQUE A DISPARU (2026-07-29). `trunkNormal` calculait la normale du fût à la
 * main — `norm3(t * 0.9, 0, 0.7)`, un dégradé CONTINU en travers de la colonne, avec `dy` nul
 * partout. C'était la définition d'un tube, et le tronc était la seule surface du pipeline à ne
 * pas passer par la recette commune. Il y passe désormais, avec un champ de hauteur d'ÉCORCE :
 * voir `ecorce.ts`, qui explique pourquoi le grain se taille en Y et pas en X. */

/** Mélange deux teintes `#rrggbb`. Sert au pied sombre du pin et du bouleau. */
function melanger(a: [number, number, number], b: [number, number, number], k: number): string {
  const v = (i: number): number => Math.round(a[i]! * (1 - k) + b[i]! * k)
  return `rgb(${v(0)},${v(1)},${v(2)})`
}

/**
 * Albédo d'un fût : sa colonne, à plat, aux mesures déclarées — mais avec son ÉCORCE.
 *
 * Il remplissait un rectangle d'une seule couleur : c'est pour ça qu'il n'y avait aucune texture
 * à voir sur un tronc. Les tons restent de la MATIÈRE (creux du sillon, plaque claire, lenticelle,
 * pied sombre), donc ils survivent à l'aplatissement — comme le `coeur` du vieux bois, qui n'a
 * jamais été un ombrage.
 */
function futAlbedo(m: MesuresArbre, tons: TonsFut, e: Ecorce, grain: GrainFut): HTMLCanvasElement {
  const { c, ctx } = newCanvas(m.futW, m.futH)
  const x = colonneX(m)
  const creux = rgb(tons.sombre)
  for (let y = 0; y < m.futH; y++) {
    const k = facteurPied(e, y, m.futH)
    for (let px = x; px < x + m.colonneW; px++) {
      const t = grain.ton[y * m.futW + px]
      if (t === null || t === undefined) continue
      ctx.fillStyle = k > 0 ? melanger(rgb(t), creux, k) : t
      ctx.fillRect(px, y, 1, 1)
    }
  }
  if (tons.coeur !== undefined) {
    ctx.fillStyle = tons.coeur
    ctx.fillRect(x + 2, Math.round(m.futH * 0.125), m.colonneW - 4, Math.max(2, Math.round(m.futH * 0.08)))
  }
  return c
}

/**
 * Enregistre les `_lit` de TOUTES les variantes : albédo uniforme + normale (houppier par la
 * recette commune, tronc analytique).
 *
 * UNE SEULE BOUCLE DEPUIS LE 2026-07-29 — elle remplace les deux blocs écrits à la main, et elle
 * rend le même résultat AU BIT PRÈS pour `tree` et `old_tree` : mêmes cadrans (7 passes,
 * facettes de 4 px, K 3,2), même silhouette (`houppierOpaqueDe` sur une variante de silhouette 2
 * est exactement l'ancien `houppierOpaque`), mêmes tons (la table les tient déjà). On garde la
 * TAILLE de facette et non le compte de cellules : le houppier grandit, le grain non.
 */
export function generateLitTrees(scene: Phaser.Scene): void {
  for (const v of TOUTES_VARIANTES) {
    const m = v.mesures
    const crown = crownAlbedo(houppierLargeur(m), m.houppierS, houppierOpaqueDe(v), v.tons.lumiere)
    register(scene, `nd-${v.slug}_crown_lit`, crown, normalFromCanvas(crown, 7, 3.2, 4))

    // LE FÛT — même recette que tout le reste du pipeline, sur un champ de hauteur d'écorce.
    // Les cadrans sont ceux du « cube franc » du 24/07 : `passes:1`, `k:3,5`, facettes de 2 px.
    // À 6 px de colonne, `cell:2` donne trois pans — le budget exact d'un tronc d'arbre.
    const e = ecorceDe(v.slug)
    const x0 = colonneX(m)
    const grain = champDeHauteur(e, m.futW, m.futH, x0, x0 + m.colonneW, v.fut)
    const alb = futAlbedo(m, v.fut, e, grain)
    register(scene, `nd-${v.slug}_trunk_lit`, alb, normalFromCanvas(alb, 1, 3.5, 2, false, [], grain.relief))
  }
}

// (Le vert du gros bois est exporté pour d'éventuels consommateurs de cohérence — la pousse
// du vieux bois, si elle naît un jour, devra le reprendre : aucun pop de couleur à l'âge.
// Réexporté depuis `arbre-art`, qui le possède désormais.)
export const OLD_TREE_CROWN_GREEN = TONS_HOUPPIER_VIEUX.lumiere
