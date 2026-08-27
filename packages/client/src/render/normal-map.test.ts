import { describe, expect, it } from 'vitest'
import { mirrorAlpha, mirrorCracks, mirrorField, mirrorRelief } from './normal-map'

/**
 * ═══ LES CONVENTIONS DE SIGNE DU MIROIR — en DONNÉES PURES, sans canvas ═══
 *
 * Le pipeline `_lit_m` a deux moitiés, et une seule est éprouvée au navigateur. Tout ce qui
 * passe par `normalFromCanvas(mirrorCanvas(…))` est mesuré par le smoke `cubique` (il relève la
 * géométrie du retourné au pixel). Mais QUATRE fonctions portent le miroir pour le reste du
 * monde — le socle minéral, le Feu, les sillons, le relief d'écorce — et elles ne sont écrites
 * qu'en arithmétique de tableaux.
 *
 * Le défaut qu'elles peuvent produire ne LÈVE RIEN : la texture existe, la scène boote, la
 * pierre s'affiche — et elle est éclairée du mauvais côté. C'est exactement le défaut que tout
 * ce chantier corrige, et il reviendrait par la porte de service.
 *
 * ⚠ `normal-map.ts` n'importe Phaser qu'en TYPE, et ne touche à `document` que dans `newCanvas`.
 * Ces quatre-là sont donc appelables ici, dans l'environnement `node` du paquet client.
 *
 * ═══ CE QUE LA MESURE AU NAVIGATEUR A DIT (2026-08-27, sonde jetable sur les vraies textures) ═══
 *
 * Les deux conventions ÉCRITES À LA MAIN sortent **exactes au pixel** — `nd-rock-1` et
 * `nd-iron_vein-2` (le socle minéral, via `mirrorField`) et `st-fire` (via `mirrorNormalCanvas`) :
 * le retourné est le miroir en colonnes, canal X inversé, vert et bleu intacts.
 *
 * Et une chose qu'on ne devinait pas : **le chemin `normalFromCanvas(mirrorCanvas(…))` n'est PAS
 * un miroir au pixel près, et c'est normal.** La recette quantifie en cellules de `cell` px —
 * `cellsX = round(w / cell)` — et quand `cell` ne divise pas la largeur, la grille n'est pas
 * symétrique sous `x → w-1-x`. Le fût d'arbre (16 px, cell 2) sort exact ; le cairn (20 px,
 * cell 3 → cellules de 2,86 px) non. Ce n'est pas un défaut : la normale du retourné est dérivée
 * du canvas retourné par la MÊME fonction que la droite — elle est juste pour l'albédo qu'elle
 * accompagne, ce qui est tout ce qu'on lui demande. Ne pas écrire de garde d'identité au pixel
 * sur ce chemin-là : elle rougirait sur du code correct.
 */
describe('les conventions de signe du miroir', () => {
  it('mirrorField ÉCHANGE LES COLONNES ET NIE nx — ny et nz ne bougent pas', () => {
    // Trois pixels sur une rangée. La normale de gauche pointe plein EST (nx = +1).
    const champ = new Float32Array([
      1, 0.25, 0.5, //   col 0 — pente vers l'est
      0, 0, 1, //        col 1 — plate
      -0.5, 0.75, 0.25, // col 2 — pente vers l'ouest
    ])
    const m = mirrorField(champ, 3, 1)
    // La colonne 0 reçoit l'ancienne colonne 2, nx NIÉ : une pente qui montait vers l'ouest
    // monte vers l'est une fois la pierre retournée.
    expect([m[0], m[1], m[2]]).toEqual([0.5, 0.75, 0.25])
    expect([m[3], m[4], m[5]]).toEqual([-0, 0, 1]) // la plate reste plate (le -0 est celui de JSON)
    expect([m[6], m[7], m[8]]).toEqual([-1, 0.25, 0.5])
    // Et la garde qui compte VRAIMENT : sans la négation, la face éclairée resterait du même
    // côté et on aurait une pierre retournée qui prend la lumière comme avant.
    expect(m[6], 'nx doit changer de signe, pas seulement de place').toBe(-champ[0]!)
  })

  it('mirrorField laisse un champ symétrique symétrique — sauf pour le signe', () => {
    // Deux pixels qui se regardent : la mise en miroir doit être une INVOLUTION.
    const champ = new Float32Array([0.6, 0.1, 0.8, -0.6, 0.1, 0.8])
    const deuxFois = mirrorField(mirrorField(champ, 2, 1), 2, 1)
    for (let i = 0; i < champ.length; i++) expect(deuxFois[i]).toBe(champ[i])
  })

  it('mirrorRelief renverse chaque rangée, et seulement les rangées', () => {
    const rel = new Float32Array([1, 2, 3, 4, 5, 6]) // 3 × 2
    const m = mirrorRelief(rel, 3, 2)
    expect(Array.from(m)).toEqual([3, 2, 1, 6, 5, 4])
  })

  it('mirrorCracks fait passer un sillon de droite à gauche, et garde sa crevasse', () => {
    const m = mirrorCracks([{ path: [[2, 5], [3, 1]], crevasse: true }], 16)
    expect(m[0]!.path.map((p) => [...p])).toEqual([[13, 5], [12, 1]]) // x → w-1-x, y intact
    expect(m[0]!.crevasse).toBe(true)
    // Le bord gauche devient le bord droit, jamais un pixel hors cadre.
    expect(mirrorCracks([{ path: [[0, 0]] }], 16)[0]!.path[0]![0]).toBe(15)
  })

  it('mirrorAlpha déplace la matière du bord gauche au bord droit', () => {
    const a = new Uint8Array([1, 0, 0, 0, 0, 1]) // 3 × 2 : un pixel à chaque bout, en diagonale
    expect(Array.from(mirrorAlpha(a, 3, 2))).toEqual([0, 0, 1, 1, 0, 0])
  })
})
