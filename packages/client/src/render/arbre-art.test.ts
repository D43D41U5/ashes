/**
 * LA GARDE DE L'ÉCHELLE VERTICALE.
 *
 * Elle balaie TOUS les objets verticaux du monde et affirme d'eux UNE SEULE chose : leur
 * hauteur déclarée est la hauteur qu'ils occupent réellement à l'écran. Exhaustive par
 * construction — la table des arbres est parcourue entière, celle des barrières aussi, et
 * un type d'arbre ajouté sans ses mesures ne compile même pas.
 *
 * Et surtout : elle CONFRONTE le dessin à la collision. La largeur de la colonne du fût et le
 * `blockHalfSub` de `/sim` disaient la même chose par hasard (4 px ↔ 1 sous-tuile) ; ils le
 * disent maintenant par contrat. C'est le seul endroit du projet où l'art et la sim se
 * regardent, et c'est là que se voit une dérive qui, sinon, ne se verrait qu'en jouant.
 */
import { describe, it, expect } from 'vitest'
import { BALANCE, NODE_DEFS } from '@ashes/sim'
import {
  ARBRES,
  ancrageHouppierPx,
  colonneX,
  demiTroncAppele,
  hauteurPx,
  hauteurTuiles,
  houppierOpaque,
  houppierRects,
  futRects,
  type TypeArbre,
} from './arbre-art'
import { EDGE_SPRITE } from './bati-art'
import { TILE_PX } from './framing'

const TYPES = Object.keys(ARBRES) as TypeArbre[]
const TONS_F = { corps: '#000000', clair: '#111111', sombre: '#222222' }
const TONS_H = { masse: '#000000', corps: '#111111', lumiere: '#222222', eclat: '#333333', ombre: '#444444' }

describe('l’échelle verticale : ce qui est déclaré est ce qui est dessiné', () => {
  it('E1 — la hauteur d’un arbre est un compte ENTIER de tuiles', () => {
    // Les tailles actées : l'arbre à 4 tuiles, le gros bois à 6 (décision d'Alexis 2026-07-28).
    expect(hauteurTuiles(ARBRES.tree)).toBe(4)
    expect(hauteurTuiles(ARBRES.old_tree)).toBe(6)
    // Et la règle, pour tout arbre présent ou à venir : jamais de demi-tuile.
    for (const t of TYPES) expect(hauteurTuiles(ARBRES[t]) % 1).toBe(0)
  })

  it('E2 — la silhouette RENDUE (fût + houppier − recouvrement) vaut la hauteur déclarée', () => {
    for (const t of TYPES) {
      const m = ARBRES[t]
      // Ce que le rendu compose : le houppier est ancré à `ancrageHouppierPx` au-dessus des
      // pieds et monte de son côté. Son sommet est donc à cette somme — la hauteur déclarée.
      expect(ancrageHouppierPx(m) + m.houppierS).toBe(hauteurPx(m))
      expect(hauteurPx(m)).toBe(hauteurTuiles(m) * TILE_PX)
    }
  })

  it('E3 — LE DESSIN ET LA COLLISION DISENT LA MÊME LARGEUR (ou la dérogation est déclarée)', () => {
    const SUB = BALANCE.SUBTILES_PER_TILE
    for (const t of TYPES) {
      // La table du client recopie le nombre de `/sim` pour être confrontée : ils ne peuvent
      // plus s'écarter en silence. `/sim` reste la seule vérité de la collision.
      expect(ARBRES[t].demiTroncSub).toBe(NODE_DEFS[t].blockHalfSub)
    }
    // L'ARBRE : sa colonne dessinée EST son cœur bloquant, à la sous-tuile près.
    expect(demiTroncAppele(ARBRES.tree, SUB)).toBe(NODE_DEFS.tree.blockHalfSub)
    // LE GROS BOIS : dérogation ASSUMÉE — il se dessine bien plus large qu'il ne bloque, pour
    // que la Vieille Sylve reste traversable et que sa bande reste centrée (il n'est pas
    // décalé). On affirme le SENS de l'écart : il bloque MOINS qu'il ne paraît, jamais plus.
    expect(demiTroncAppele(ARBRES.old_tree, SUB)).toBeGreaterThan(NODE_DEFS.old_tree.blockHalfSub)
  })

  it('E4 — la borne dure du décalage d’origine tient pour l’arbre', () => {
    // Le carré bloquant d'un arbre décalé doit rester DANS sa tuile, sinon il échappe à la
    // collision. C'est la borne que l'épaississement du tronc a failli manger.
    const h = NODE_DEFS.tree.blockHalfSub / BALANCE.SUBTILES_PER_TILE
    expect(BALANCE.TREE_JITTER_TILES + h).toBeLessThanOrEqual(0.5)
  })

  it('E5 — la colonne du fût est centrée sur la texture, au pixel entier', () => {
    for (const t of TYPES) {
      const m = ARBRES[t]
      expect(colonneX(m) % 1).toBe(0) // sinon le tronc se dessine entre deux pixels
      expect(colonneX(m) * 2 + m.colonneW).toBe(m.futW) // symétrique : le sprite est en origine 0,5
      expect(m.colonneW).toBeLessThanOrEqual(m.futW)
    }
  })

  it('E6 — la SILHOUETTE _lit est exactement l’union des deux premiers rects peints', () => {
    // Elle était déclarée deux fois (BootScene peignait, lit-trees redéclarait la forme) ; elle
    // se DÉDUIT maintenant du dessin. On le prouve en balayant tout le carré, pas trois points.
    for (const t of TYPES) {
      const S = ARBRES[t].houppierS
      const rects = houppierRects(t, TONS_H)
      const opaque = houppierOpaque(t)
      const dans = (r: readonly [number, number, number, number], x: number, y: number): boolean =>
        x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3]
      let peints = 0
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const union = dans(rects[0]![0], x, y) || dans(rects[1]![0], x, y)
          expect(opaque(x, y)).toBe(union)
          if (union) peints++
        }
      }
      expect(peints).toBeGreaterThan(0) // une silhouette vide passerait le balayage sans rien dire
    }
  })

  it('E7 — tout rect peint reste DANS sa texture', () => {
    for (const t of TYPES) {
      const m = ARBRES[t]
      for (const [[x, y, w, h]] of futRects(t, TONS_F)) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(x + w).toBeLessThanOrEqual(m.futW)
        expect(y + h).toBeLessThanOrEqual(m.futH)
      }
      for (const [[x, y, w, h]] of houppierRects(t, TONS_H)) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(x + w).toBeLessThanOrEqual(m.houppierS)
        expect(y + h).toBeLessThanOrEqual(m.houppierS)
      }
    }
  })

  it('E8 — les BARRIÈRES aussi déclarent leur hauteur, et elle est plausible', () => {
    // L'autre table de hauteurs du client. On la balaie entière : elle relève de la même
    // discipline, et une famille ajoutée sans hauteur se verrait ici.
    const familles = Object.keys(EDGE_SPRITE)
    expect(familles.length).toBeGreaterThan(0)
    for (const f of familles) {
      const s = EDGE_SPRITE[f]!
      expect(s.hauteurPx).toBeGreaterThan(0)
      expect(s.largeurPx).toBeGreaterThan(0)
      // Un mur ne monte pas plus haut qu'un arbre : c'est l'ordre du monde, et il se vérifie.
      expect(s.hauteurPx).toBeLessThan(hauteurPx(ARBRES.tree))
    }
  })

  it('E9 — l’ordre des tailles : joueur < mur < arbre < gros bois', () => {
    // La comparaison qu'Alexis a demandée le 2026-07-28, figée en invariant. Le joueur fait
    // 1,5 tuile (son emprise visuelle, cf. ACTOR_FOOTPRINTS) ; on la reprend en dur ICI et
    // seulement ici, parce que c'est précisément ce rapport qu'on garde.
    const JOUEUR_PX = 1.5 * TILE_PX
    const MUR_PX = EDGE_SPRITE.wall!.hauteurPx
    expect(JOUEUR_PX).toBeLessThan(MUR_PX)
    expect(MUR_PX).toBeLessThan(hauteurPx(ARBRES.tree))
    expect(hauteurPx(ARBRES.tree)).toBeLessThan(hauteurPx(ARBRES.old_tree))
    // Et les rapports actés : l'arbre vaut 2,67 fois le joueur, le gros bois 4 fois.
    expect(hauteurPx(ARBRES.tree) / JOUEUR_PX).toBeCloseTo(2.67, 2)
    expect(hauteurPx(ARBRES.old_tree) / JOUEUR_PX).toBe(4)
  })
})
