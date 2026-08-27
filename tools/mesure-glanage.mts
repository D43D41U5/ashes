/**
 * COMBIEN DE PAS AVANT LA PREMIÈRE HACHE ?
 *
 * L'instrument de `CONTENU.GLANAGE_CHANCE` (spec `glanage.md` G3). Depuis que le bois et la
 * pierre exigent un outil de fortune, ce nombre décide du tempo de la première heure : il n'y
 * a plus de « couper un arbre » avant d'avoir glané de quoi tailler un hachereau.
 *
 * Il ne mesure PAS une densité moyenne — une moyenne sur 600 000 tuiles ne dit rien de ce que
 * le joueur vit. Il mesure ce que coûte L'AMORÇAGE depuis un vrai point de spawn : le rayon
 * qu'il faut balayer pour trouver 2 bois + 3 pierre (le hachereau), puis 5 + 5 (les deux
 * outils). Le rayon est un majorant honnête du trajet : on ne marche pas en ligne droite.
 *
 * Il vit ICI et non dans /sim parce qu'il imprime : le lint de /sim l'interdit.
 *
 *   node --import tsx tools/mesure-glanage.mts [seed…]
 */
import {
  generateZonedTerrain, placeZoneNodes, emplacementsDeVillage, pointsDeSpawn,
  MONDE, MONDE_JOUE, NODE_DEFS, placeHuntingGrounds, nidsAMonstre, type NodeType,
} from '../packages/sim/src/index'

const graines = process.argv.slice(2).filter((a) => !a.startsWith('--')).map(Number)
const SEEDS = graines.length > 0 ? graines : [2026, 7, 42]

/**
 * Le coût des deux outils de fortune (RECIPES), EN RAMASSAGES — la corde vient de la fibre,
 * qui reste libre. Le hachereau coûte 2 bois + 3 pierre : tout est glané, on n'a rien d'autre.
 * La pioche coûte ensuite 3 bois + 2 pierre, mais SON BOIS SE COUPE — la hache est faite. Seule
 * la pierre reste à glaner : 5 au total. Compter 5 bois glanés serait mesurer une partie que
 * personne ne joue.
 */
const HACHEREAU = { wood: 2, stone: 3 }
const LES_DEUX = { wood: 2, stone: 5 }

/** Le rayon Chebyshev à balayer depuis `(sx, sy)` pour réunir ce panier. -1 = jamais. */
function rayonPour(
  glane: readonly { tx: number; ty: number; item: string }[],
  sx: number,
  sy: number,
  panier: { wood: number; stone: number },
): number {
  const d = glane
    .map((g) => ({ r: Math.max(Math.abs(g.tx - sx), Math.abs(g.ty - sy)), item: g.item }))
    .sort((a, b) => a.r - b.r)
  let bois = 0
  let pierre = 0
  for (const g of d) {
    if (g.item === 'wood') bois++
    else pierre++
    if (bois >= panier.wood && pierre >= panier.stone) return g.r
  }
  return -1
}

const PARENTS: readonly NodeType[] = ['tree', 'old_tree', 'rock', 'bloc']

console.log('graine │ nœuds  glanage │ part parents │  hachereau │ + la pioche')
console.log('───────┼─────────────────┼──────────────┼────────────┼────────────')
for (const seed of SEEDS) {
  const carte = generateZonedTerrain(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
  const nodes = placeZoneNodes(carte)
  const glane = nodes
    .filter((n) => n.type === 'branche_au_sol' || n.type === 'pierre_au_sol')
    .map((n) => ({ tx: n.tx, ty: n.ty, item: NODE_DEFS[n.type].item as string }))
  const parents = nodes.filter((n) => PARENTS.includes(n.type)).length
  const emplacements = emplacementsDeVillage(carte, nodes, {
    coinsDeChasse: placeHuntingGrounds(carte.map, seed),
    nids: nidsAMonstre(carte.map),
  })
  const spawns = pointsDeSpawn(carte, emplacements, Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE))
  const r1 = spawns.map((s) => rayonPour(glane, s.tx, s.ty, HACHEREAU)).filter((r) => r >= 0).sort((a, b) => a - b)
  const r2 = spawns.map((s) => rayonPour(glane, s.tx, s.ty, LES_DEUX)).filter((r) => r >= 0).sort((a, b) => a - b)
  const med = (xs: number[]): string => (xs.length === 0 ? '  —' : String(xs[Math.floor(xs.length / 2)]).padStart(3))
  const pire = (xs: number[]): string => (xs.length === 0 ? '  —' : String(xs[xs.length - 1]).padStart(3))
  console.log(
    `${String(seed).padStart(6)} │ ${String(nodes.length).padStart(6)} ${String(glane.length).padStart(8)} │` +
      ` ${((100 * glane.length) / Math.max(1, parents)).toFixed(1).padStart(5)} % de ${String(parents).padStart(5)} │` +
      ` ${med(r1)} / ${pire(r1)} t │ ${med(r2)} / ${pire(r2)} t   (médiane / pire spawn, en tuiles)`,
  )
}
