import { describe, expect, it } from 'vitest'
import { collectNodeDeltas, createNodeShadow, seedNodeShadow } from './node-shadow'
import type { ResourceNode } from './economy'
import type { NodeDelta } from './protocol'

const noeud = (id: number, stock: number, tx = id, ty = 0): ResourceNode =>
  ({ id, type: 'berry_bush', tx, ty, stock, regrowAt: 0 }) as ResourceNode

/** Ce qu'une PREMIÈRE VUE doit porter : de quoi FABRIQUER le nœud, pas seulement le corriger. */
const premiereVue = (n: ResourceNode): NodeDelta =>
  ({ id: n.id, stock: n.stock, tx: n.tx, ty: n.ty, regrowAt: n.regrowAt, neuf: n.type })

describe('ombre des nœuds — le diff de stocks partagé par les deux hôtes', () => {
  it("n'émet que les stocks qui ont bougé, et avance l'ombre", () => {
    const nodes = [noeud(1, 10), noeud(2, 5)]
    const ombre = createNodeShadow(nodes)
    // Ombre vierge : tout est INÉDIT, donc chacun part avec de quoi être fabriqué (cf. `neuf`).
    expect(collectNodeDeltas(nodes, ombre)).toEqual([premiereVue(nodes[0]!), premiereVue(nodes[1]!)])
    // Rien n'a bougé : aucun delta.
    expect(collectNodeDeltas(nodes, ombre)).toEqual([])
    nodes[0]!.stock = 8
    expect(collectNodeDeltas(nodes, ombre)).toEqual([{ id: 1, stock: 8 }])
  })

  it('amorcée, elle se tait au premier tick (le client a déjà reçu la liste complète)', () => {
    const nodes = [noeud(1, 10), noeud(2, 5)]
    const ombre = createNodeShadow(nodes)
    seedNodeShadow(ombre, nodes)
    expect(collectNodeDeltas(nodes, ombre)).toEqual([])
  })

  it('joint position et repousse quand un nœud tombe à zéro (il a pu DÉRIVER)', () => {
    const nodes = [noeud(1, 3, 7, 9)]
    const ombre = createNodeShadow(nodes)
    seedNodeShadow(ombre, nodes)
    nodes[0]!.stock = 0
    nodes[0]!.tx = 20
    nodes[0]!.ty = 21
    nodes[0]!.regrowAt = 4242
    expect(collectNodeDeltas(nodes, ombre)).toEqual([{ id: 1, stock: 0, tx: 20, ty: 21, regrowAt: 4242 }])
    // La repousse repart : delta ordinaire, sans position.
    nodes[0]!.stock = 3
    expect(collectNodeDeltas(nodes, ombre)).toEqual([{ id: 1, stock: 3 }])
  })

  it('un stock de 0 se distingue d\'un nœud jamais vu', () => {
    // Le piège du sentinelle : si « jamais vu » valait 0, un nœud né vide serait muet.
    const nodes = [noeud(1, 0, 4, 4)]
    const ombre = createNodeShadow(nodes)
    expect(collectNodeDeltas(nodes, ombre)).toEqual([premiereVue(nodes[0]!)])
    expect(collectNodeDeltas(nodes, ombre)).toEqual([])
  })

  /**
   * LA FUITE QUI N'EXISTE PLUS. L'ombre était une `Map` : les nœuds détruits par la Cendre
   * (MESURÉ : 26 805 au jour 60, 21 % du total) y gardaient leur entrée à vie. Le serveur
   * avait reçu une purge, le worker Veillée jamais — deux hôtes, deux comportements. Le
   * tableau typé rend la question sans objet : une case morte est une case, pas une fuite.
   */
  it('ne grossit pas quand la Cendre détruit des nœuds', () => {
    const nodes = [noeud(1, 5), noeud(2, 5), noeud(3, 5)]
    const ombre = createNodeShadow(nodes)
    seedNodeShadow(ombre, nodes)
    const avant = ombre.stocks.length
    const rescapes = [nodes[1]!] // la Cendre remplace le tableau, deux nœuds ont brûlé
    expect(collectNodeDeltas(rescapes, ombre)).toEqual([])
    expect(ombre.stocks.length).toBe(avant) // l'empreinte est FIXE
  })

  it('voit un nœud SEMÉ en cours de partie, et lui donne DE QUOI NAÎTRE', () => {
    // ⚠ LE DÉFAUT QUE CE TEST COUVRAIT AUTREFOIS. Il exigeait `{ id, stock }` — un delta qui
    //   CORRIGE un nœud que le client possède déjà. Or le client ne reçoit la liste complète
    //   qu'au `ready` : un nœud né après n'existe chez lui NULLE PART, et un delta de stock seul
    //   ne peut pas le faire naître. Le filon de la Brume portait ce défaut depuis son premier
    //   jour, invisible, et la fumerolle allait le porter à son tour (`nFum: 0` au navigateur).
    //   Une première vue transporte donc position, repousse ET type.
    const nodes = [noeud(1, 5)]
    const ombre = createNodeShadow(nodes)
    seedNodeShadow(ombre, nodes)
    nodes.push(noeud(9_000, 7))
    expect(collectNodeDeltas(nodes, ombre)).toEqual([premiereVue(nodes[1]!)])
    expect(ombre.stocks.length).toBeGreaterThan(9_000)
    expect(collectNodeDeltas(nodes, ombre)).toEqual([]) // et il est connu ensuite
  })

  it("est insensible à l'ORDRE du tableau (indexée par id, pas par position)", () => {
    const nodes = [noeud(1, 5), noeud(2, 6), noeud(3, 7)]
    const ombre = createNodeShadow(nodes)
    seedNodeShadow(ombre, nodes)
    expect(collectNodeDeltas([nodes[2]!, nodes[0]!, nodes[1]!], ombre)).toEqual([])
  })
})

/**
 * LE TEST DIFFÉRENTIEL — il prouve qu'on n'a rien changé au COMPORTEMENT en changeant la
 * structure de données. On rejoue l'ancienne implémentation à côté de la nouvelle, sur le même
 * monde et les mêmes ticks, et on exige le même flux de deltas, tick par tick.
 *
 * ⚠ LA RÉFÉRENCE A BOUGÉ UNE FOIS, LE 2026-08-24, et il faut le dire au lieu de le subir : la
 *   `Map` des deux hôtes émettait `{ id, stock }` sur une PREMIÈRE VUE, donc un nœud né en cours
 *   de partie n'arrivait jamais. La référence ci-dessous porte la correction ; l'écart lui-même
 *   est affirmé à part, juste au-dessus, pour qu'il reste un CHOIX lisible et pas une dérive.
 */
describe('ombre des nœuds — équivalence stricte avec l\'implémentation `Map` remplacée', () => {
  /** La `Map` des deux hôtes, avec la règle de première vue (cf. le bandeau ci-dessus). */
  function ancienne(nodes: readonly ResourceNode[], shadow: Map<number, number>): NodeDelta[] {
    const deltas: NodeDelta[] = []
    for (const n of nodes) {
      const inedit = !shadow.has(n.id)
      if (!inedit && shadow.get(n.id) === n.stock) continue
      shadow.set(n.id, n.stock)
      deltas.push(
        inedit
          ? { id: n.id, stock: n.stock, tx: n.tx, ty: n.ty, regrowAt: n.regrowAt, neuf: n.type }
          : n.stock === 0
            ? { id: n.id, stock: 0, tx: n.tx, ty: n.ty, regrowAt: n.regrowAt }
            : { id: n.id, stock: n.stock },
      )
    }
    return deltas
  }

  it('rend exactement le même flux sur 3 000 ticks de vie de nœuds', () => {
    // Un monde de nœuds joué à la main : récolte, épuisement + dérive, repousse, et la
    // Cendre qui remplace le tableau — les quatre régimes que le diff doit encaisser.
    const nodes: ResourceNode[] = []
    for (let i = 1; i <= 400; i++) nodes.push(noeud(i, 5 + (i % 7), i % 40, Math.floor(i / 40)))

    const neuve = createNodeShadow(nodes)
    const vieille = new Map<number, number>()
    seedNodeShadow(neuve, nodes)
    for (const n of nodes) vieille.set(n.id, n.stock)

    let courant = nodes
    let semes = 0
    for (let t = 0; t < 3_000; t++) {
      // Récolte : quelques nœuds perdent du stock, l'un tombe à zéro et DÉRIVE.
      const cible = courant[t % courant.length]!
      cible.stock = Math.max(0, cible.stock - 1)
      if (cible.stock === 0) {
        cible.tx = (cible.tx + 3) % 40
        cible.regrowAt = t + 200
      }
      // Repousse : ce qui était à zéro depuis assez longtemps repart.
      for (const n of courant) if (n.stock === 0 && n.regrowAt !== 0 && t >= n.regrowAt) { n.stock = 6; n.regrowAt = 0 }
      // La Cendre : tous les 500 ticks, elle REMPLACE le tableau et en brûle une partie.
      if (t > 0 && t % 500 === 0) courant = courant.filter((n) => n.id % 11 !== t / 500 % 11)
      // Un semis tardif, une fois : le cas « id inconnu » doit se comporter pareil.
      if (t === 1_500) { courant = [...courant, noeud(5_000 + semes++, 4, 1, 1)] }

      const a = ancienne(courant, vieille)
      const b = collectNodeDeltas(courant, neuve)
      expect(b, `tick ${t}`).toEqual(a)
    }
    // Garde du test lui-même : il doit avoir VU passer des deltas, sinon il compare deux vides.
    expect(vieille.size).toBeGreaterThan(300)
  })
})
