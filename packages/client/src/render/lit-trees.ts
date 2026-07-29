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
import { enc, FLIP_G, newCanvas, norm3, normalFromCanvas, registerLit as register } from './normal-map'
import { colonneX, houppierOpaqueDe, TOUTES_VARIANTES, TONS_HOUPPIER_VIEUX, type MesuresArbre } from './arbre-art'

/* LES COULEURS NE SONT PLUS RÉÉCRITES ICI NON PLUS. Elles étaient recopiées de l'art peint —
 * la garde de palette a fini par le voir (trois fichiers pour un même brun sans nom). C'est
 * l'arête CLAIRE de chaque famille qu'on aplatit : l'albédo se pose au niveau « éclairé », pour
 * que la lumière calculée SCULPTE vers le bas plutôt que de partir dans le noir. */

/** `#rrggbb` → triplet. Aucune dépendance à Phaser : ce module tourne aussi hors scène. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** Albédo UNIFORME d'un houppier : sa silhouette, à plat. */
function crownAlbedo(S: number, opaque: (x: number, y: number) => boolean, ton: string): HTMLCanvasElement {
  const [r, g, b] = rgb(ton)
  const { c, ctx } = newCanvas(S, S)
  const d = ctx.createImageData(S, S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!opaque(x, y)) continue
      const i = (y * S + x) * 4
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

/** Carte de normales d'un TRONC : cylindre analytique sur la colonne du fût. */
function trunkNormal(W: number, H: number, x0: number, x1: number): HTMLCanvasElement {
  const { c, ctx } = newCanvas(W, H)
  const d = ctx.createImageData(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      let dx = 0, dy = 0, dz = 1
      if (x >= x0 && x < x1) {
        const t = ((x - x0 + 0.5) / (x1 - x0)) * 2 - 1
        ;[dx, dy, dz] = norm3(t * 0.9, 0, 0.7)
      }
      d.data[i] = enc(dx)
      d.data[i + 1] = enc(FLIP_G ? -dy : dy)
      d.data[i + 2] = enc(dz)
      d.data[i + 3] = 255
    }
  }
  ctx.putImageData(d, 0, 0)
  return c
}

/**
 * Albédo UNIFORME d'un fût : sa colonne, à plat, aux mesures déclarées. `coeur` (le bout clair
 * du vieux bois) est un MATÉRIAU, pas un ombrage : il reste sur l'albédo aplati.
 */
function futAlbedo(m: MesuresArbre, ton: string, coeur?: string): HTMLCanvasElement {
  const { c, ctx } = newCanvas(m.futW, m.futH)
  const x = colonneX(m)
  ctx.fillStyle = ton
  ctx.fillRect(x, 0, m.colonneW, m.futH)
  if (coeur !== undefined) {
    ctx.fillStyle = coeur
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
    const crown = crownAlbedo(m.houppierS, houppierOpaqueDe(v), v.tons.lumiere)
    register(scene, `nd-${v.slug}_crown_lit`, crown, normalFromCanvas(crown, 7, 3.2, 4))
    register(
      scene,
      `nd-${v.slug}_trunk_lit`,
      futAlbedo(m, v.fut.clair, v.fut.coeur),
      trunkNormal(m.futW, m.futH, colonneX(m), colonneX(m) + m.colonneW),
    )
  }
}

// (Le vert du gros bois est exporté pour d'éventuels consommateurs de cohérence — la pousse
// du vieux bois, si elle naît un jour, devra le reprendre : aucun pop de couleur à l'âge.
// Réexporté depuis `arbre-art`, qui le possède désormais.)
export const OLD_TREE_CROWN_GREEN = TONS_HOUPPIER_VIEUX.lumiere
