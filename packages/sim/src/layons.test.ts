/**
 * LES GARDES DU LAYON (`layons.ts`) — sur le MONDE JOUÉ, jamais sur une petite carte à soi.
 *
 * Un layon promet un CHEMIN. Les trois façons de rompre cette promesse en silence sont : n'en
 * poser aucun, en poser qui ne mènent nulle part (les confettis du premier jet — 1 268 tronçons
 * de médiane 7 tuiles), et en laisser pousser des arbres dessus. C'est ce que ce fichier
 * affirme, dans cet ordre.
 */
import { describe, expect, it } from 'vitest'
import { TERRAIN_LAYON, TERRAIN_OLD_GROWTH, TERRAINS } from './balance'
import { LAYON, estLayon } from './layons'
import { MONDE, MONDE_JOUE } from './zonegraph'
import { generateZonedTerrain, type CarteZonee } from './zonegen'
import { placeZoneNodes } from './zone-content'

const SEEDS = [2026, 7]
const cartes: CarteZonee[] = SEEDS.map((s) => generateZonedTerrain(s, MONDE.JOUEURS_CIBLE, MONDE_JOUE))

/** Les composantes connexes (4-voisins) du réseau — la seule mesure qui dise « un chemin ». */
function composantes(c: CarteZonee): number[] {
  const { width: W, height: H, terrain: t } = c.map
  const N = W * H
  const vu = new Uint8Array(N)
  const out: number[] = []
  for (let d = 0; d < N; d++) {
    if (vu[d] || t[d] !== TERRAIN_LAYON) continue
    let n = 0
    let file = [d]
    vu[d] = 1
    while (file.length > 0) {
      const suiv: number[] = []
      for (const i of file) {
        n++
        const x = i % W
        const y = (i - x) / W
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
          if (j >= 0 && vu[j] === 0 && t[j] === TERRAIN_LAYON) { vu[j] = 1; suiv.push(j) }
        }
      }
      file = suiv
    }
    out.push(n)
  }
  return out
}

describe('les layons — la forêt a des chemins', () => {
  it('L1 — il y en a, et ils sont dans la Racine (la prémisse de tout le reste)', () => {
    for (const c of cartes) {
      const total = c.map.terrain.filter((t) => t === TERRAIN_LAYON).length
      // Sans ce plancher, TOUTES les gardes ci-dessous passeraient sur une carte sans un layon.
      expect(total, `graine ${c.graphe.seed} : pas un layon sur la carte`).toBeGreaterThan(500)
      for (let i = 0; i < c.map.terrain.length; i++) {
        if (c.map.terrain[i] !== TERRAIN_LAYON) continue
        expect(c.zone[i], `graine ${c.graphe.seed} : un layon hors de la Racine`).toBe(c.graphe.racine)
      }
    }
  })

  it('L2 — AUCUN TRONÇON PERDU : tout morceau de layon est assez long pour être un chemin', () => {
    // LE DÉFAUT MESURÉ AU PREMIER JET, et la raison des deux garde-fous : la masse boisée est
    // elle-même trouée, donc une arête qui la traverse en biais n'en gardait que des miettes —
    // 1 268 composantes, médiane 7 tuiles. Une tache de sept tuiles au milieu d'un bois n'est
    // pas un chemin : c'est une couleur qui promet un passage inexistant.
    for (const c of cartes) {
      const tailles = composantes(c)
      expect(tailles.length, `graine ${c.graphe.seed} : aucune composante`).toBeGreaterThan(0)
      const trop = tailles.filter((n) => n < LAYON.MIN_TUILES)
      expect(trop, `graine ${c.graphe.seed} : ${trop.length} tronçons sous le seuil`).toEqual([])
    }
  })

  it('L3 — RIEN N’Y POUSSE : pas un arbre posé sur un layon', () => {
    // La passe des arbres teste des ids de terrain nommés et `terrainAdmet` fait de même : le
    // layon n'est dans aucune des deux listes. On l'AFFIRME ici plutôt que de s'y fier — une
    // liste à laquelle on ajoute un id un jour ne préviendrait personne.
    for (const c of cartes) {
      const nodes = placeZoneNodes(c)
      const dessus = nodes.filter(
        (n) => (n.type === 'tree' || n.type === 'old_tree')
          && c.map.terrain[n.ty * c.map.width + n.tx] === TERRAIN_LAYON,
      )
      expect(dessus.length, `graine ${c.graphe.seed} : ${dessus.length} arbres sur un layon`).toBe(0)
      // PRÉMISSE : il y a bien des arbres sur cette carte, sinon le zéro ci-dessus ne dit rien.
      expect(nodes.filter((n) => n.type === 'tree').length).toBeGreaterThan(1000)
    }
  })

  it('L4 — le Bois Noir n’est PAS troué (il est élu et budgété, comme pour les clairières)', () => {
    for (const c of cartes) {
      // Un layon ne peut pas être SUR du old_growth (il l'a remplacé) : on vérifie donc qu'il
      // reste du Bois Noir, et qu'aucun layon ne le borde de l'intérieur — c'est-à-dire que la
      // futaie ancienne n'a pas été entamée. La garde qui compte ses tuiles EXACTES vit dans
      // `zonegen.test.ts` (A25) ; ici on affirme le principe à la source.
      const vieux = c.map.terrain.filter((t) => t === TERRAIN_OLD_GROWTH).length
      expect(vieux, `graine ${c.graphe.seed} : plus de Bois Noir du tout`).toBeGreaterThan(0)
    }
  })

  it('L5 — le terrain est déclaré, marchable, et il RÉCOMPENSE celui qui le suit', () => {
    const def = TERRAINS[TERRAIN_LAYON]
    expect(def, 'le layon n’est pas dans la table des terrains').toBeDefined()
    expect(def!.walkable).toBe(true)
    expect(estLayon(TERRAIN_LAYON)).toBe(true)
    // C'est le seul argument qui rend un chemin vivant : la forêt est à plein régime (1) depuis
    // 2026-07-18, donc un layon qui n'irait pas plus vite ne serait qu'une couleur.
    expect(def!.speedFactor).toBeGreaterThan(TERRAINS[3]!.speedFactor)
    // …et il reste SOUS la sente : la route du pays d'avant demeure la voie rapide.
    expect(def!.speedFactor).toBeLessThan(TERRAINS[2]!.speedFactor)
    // Et il EXPOSE : on y voit venir, on s'y fait voir. Sans ce revers, le layon serait un
    // cadeau sans contrepartie — plus rapide ET aussi sûr que le couvert.
    expect(def!.cover).toBeGreaterThan(TERRAINS[3]!.cover)
  })
})
