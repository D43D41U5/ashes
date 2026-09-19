import { describe, expect, it } from 'vitest'
import { BALANCE, type ResourceNode } from '@ashes/sim'
import { rochersQuiLuisent } from './flank-glow'
import { indexerParTuile, noeudVu } from './index-noeuds'

const noeud = (id: number, tx: number, ty: number, etage?: number, type = 'rock', stock = 12): ResourceNode =>
  ({ id, type, tx, ty, stock, regrowAt: 0, ...(etage !== undefined ? { etage } : {}) }) as ResourceNode

const ids = (ns: readonly ResourceNode[]): number[] => ns.map((n) => n.id).sort((a, b) => a - b)
const toujours = (): boolean => true

/**
 * ═══ SOUS LA ROCHE, SEUL LE ROCHER DE LA SALLE LUIT (Alexis, 2026-09-14) ═══
 *
 * « Je vois la pastille de récolte d'un rock node dans une cave alors que le node est soit à
 * l'étage au-dessus ou à l'extérieur. » La lueur ne comptait que la distance à plat : le rocher
 * de la terrasse qui coiffe la salle (même tuile, un autre monde) et celui du dehors (une tuile
 * plus loin, un autre étage) luisaient dans la grotte. Elle pose désormais les deux questions de
 * la visée — le nœud que le regard voit (`noeudVu`), joignable depuis mon étage (E-R5) — et ce
 * sont elles qu'on éprouve ici, chacune seule, puis ensemble.
 */
describe('rochersQuiLuisent — la lueur ne promet que ce que la visée prendrait', () => {
  const SALLE = -2 // gueule de palier 1 → salle à −(1 + 1) (G-R1)
  const dansLaSalle = noeud(1, 10, 10, SALLE)
  const aLAplomb = noeud(2, 10, 10) // la terrasse qui coiffe la salle : MÊME tuile
  const dehors = noeud(3, 11, 11) // le palier, derrière la paroi : une diagonale
  const idx = indexerParTuile([dansLaSalle, aLAplomb, dehors])
  const moi = { x: 10.5, y: 11.5 } // à une tuile des trois
  const sousLaRoche = (tx: number, ty: number) => noeudVu(idx, tx, ty, true)
  const aLaSurface = (tx: number, ty: number) => noeudVu(idx, tx, ty, false)
  // Dans la salle, sans gueule à portée : on n'atteint que son propre étage.
  const depuisLaSalle = (_tx: number, _ty: number, etage?: number): boolean => etage === SALLE

  it('dans la salle : le rocher de la salle luit — ni celui de l’aplomb, ni celui du dehors', () => {
    expect(ids(rochersQuiLuisent(sousLaRoche, moi, depuisLaSalle))).toEqual([1])
  })

  it('le regard seul écarte l’aplomb : la tuile rend le nœud de la salle, pas celui de la terrasse', () => {
    expect(ids(rochersQuiLuisent(sousLaRoche, moi, toujours))).toEqual([1, 3])
  })

  it('la joignabilité seule écarte le dehors — et elle reçoit l’étage DU NŒUD', () => {
    const vus: (number | undefined)[] = []
    rochersQuiLuisent(sousLaRoche, moi, (_tx, _ty, etage) => (vus.push(etage), false))
    expect(vus.sort()).toEqual([SALLE, undefined])
  })

  it('à la surface : la salle n’existe pas, la terrasse et le dehors luisent', () => {
    expect(ids(rochersQuiLuisent(aLaSurface, moi, toujours))).toEqual([2, 3])
  })

  it('un épuisé, un arbre, un rocher hors de portée ne luisent pas', () => {
    const autres = indexerParTuile([noeud(4, 10, 10, undefined, 'rock', 0), noeud(5, 11, 11, undefined, 'tree'), noeud(6, 13, 11)])
    expect(rochersQuiLuisent((tx, ty) => noeudVu(autres, tx, ty, false), moi, toujours)).toEqual([])
  })
})

/**
 * ═══ LE PARCOURS PAR TUILES NE PERD AUCUN ROCHER QUE LE BALAYAGE TROUVAIT ═══
 *
 * La lueur balayait le tableau ; elle parcourt désormais les tuiles autour du joueur, par
 * l'index. Le risque qu'on introduit est dans les BORNES de ce parcours (une rangée oubliée au
 * bord du disque). Pas trois cas choisis : un rocher sur chaque tuile d'une fenêtre, et le
 * joueur promené au huitième de tuile — le parcours doit rendre exactement le balayage.
 */
describe('rochersQuiLuisent — les bornes du parcours (garde exhaustive)', () => {
  const nodes: ResourceNode[] = []
  let id = 0
  for (let ty = 0; ty < 12; ty++) for (let tx = 0; tx < 12; tx++) nodes.push(noeud(id++, tx, ty))
  const idx = indexerParTuile(nodes)
  const r = BALANCE.INTERACT_RANGE

  it('coïncide avec le balayage sur toute la fenêtre 3..9 × 3..9', () => {
    let comparees = 0
    for (let y = 3; y <= 9; y += 0.125) {
      for (let x = 3; x <= 9; x += 0.125) {
        const balayage = nodes.filter((n) => (n.tx + 0.5 - x) ** 2 + (n.ty + 0.5 - y) ** 2 <= r * r)
        expect(ids(rochersQuiLuisent((tx, ty) => noeudVu(idx, tx, ty, false), { x, y }, toujours))).toEqual(ids(balayage))
        comparees++
      }
    }
    expect(comparees).toBe(49 * 49)
  })
})
