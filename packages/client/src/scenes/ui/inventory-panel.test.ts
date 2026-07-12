/**
 * La traduction geste → action est PURE, donc testable sans navigateur. C'est
 * LÀ que vivent les bugs de l'inventaire ; le dessin, lui, se vérifie à l'œil.
 *
 * On ne teste JAMAIS le RÉSULTAT d'un geste (ça, c'est la sim, seule source de
 * vérité — invariant §3) : on teste seulement quelle ACTION le client envoie.
 */
import type { Inventory, Slot } from '@braises/sim'
import { describe, expect, it } from 'vitest'
import { dragIntentFrom, dragToAction, firstFitSlot, quickMoveToAction } from './inventory-panel'

describe('dragToAction', () => {
  it('glisser d’une case du sac à une autre → move_slot', () => {
    expect(
      dragToAction({ from: { side: 'player', slot: 7 }, to: { side: 'player', slot: 2 }, split: false, count: 5, container: null }),
    ).toEqual({ type: 'move_slot', from: 7, to: 2 })
  })

  it('SHIFT-glisser sur une case vide → split_slot (la moitié)', () => {
    expect(
      dragToAction({ from: { side: 'player', slot: 0 }, to: { side: 'player', slot: 4 }, split: true, count: 10, container: null }),
    ).toEqual({ type: 'split_slot', from: 0, to: 4, count: 10 })
  })

  it('glisser du sac vers le conteneur ouvert → transfer', () => {
    expect(
      dragToAction({
        from: { side: 'player', slot: 3 },
        to: { side: 'container', slot: 1 },
        split: false,
        count: 12,
        container: { kind: 'structure', id: 42 },
      }),
    ).toEqual({
      type: 'transfer',
      kind: 'structure',
      containerId: 42,
      from: { side: 'player', slot: 3 },
      to: { side: 'container', slot: 1 },
      count: 12,
    })
  })

  it('glisser DEPUIS le conteneur vers le sac → transfer (l’autre sens)', () => {
    expect(
      dragToAction({
        from: { side: 'container', slot: 2 },
        to: { side: 'player', slot: 9 },
        split: false,
        count: 3,
        container: { kind: 'corpse', id: 7 },
      }),
    ).toEqual({
      type: 'transfer',
      kind: 'corpse',
      containerId: 7,
      from: { side: 'container', slot: 2 },
      to: { side: 'player', slot: 9 },
      count: 3,
    })
  })

  it('glisser vers un conteneur alors qu’AUCUN n’est ouvert → aucune action', () => {
    expect(
      dragToAction({ from: { side: 'player', slot: 3 }, to: { side: 'container', slot: 1 }, split: false, count: 1, container: null }),
    ).toBeNull()
  })

  it('glisser une case sur elle-même → aucune action', () => {
    expect(
      dragToAction({ from: { side: 'player', slot: 3 }, to: { side: 'player', slot: 3 }, split: false, count: 1, container: null }),
    ).toBeNull()
  })

  it('un transfert n’est jamais un split : SHIFT est ignoré côté conteneur', () => {
    // Le split ne concerne QUE le déplacement interne (case vide du même sac).
    // Traverser vers un conteneur reste un transfer partiel, porté par `count`.
    expect(
      dragToAction({
        from: { side: 'player', slot: 0 },
        to: { side: 'container', slot: 0 },
        split: true,
        count: 6,
        container: { kind: 'structure', id: 1 },
      }),
    ).toEqual({
      type: 'transfer',
      kind: 'structure',
      containerId: 1,
      from: { side: 'player', slot: 0 },
      to: { side: 'container', slot: 0 },
      count: 6,
    })
  })

  it('glisser conteneur → conteneur (même côté, cases ≠) → aucune action', () => {
    // Réarranger un conteneur en interne n'est pas supporté (transfer = cross-
    // inventaire) : la sim refuserait « transfert sur place ». On n'envoie rien.
    expect(
      dragToAction({
        from: { side: 'container', slot: 0 },
        to: { side: 'container', slot: 1 },
        split: false,
        count: 5,
        container: { kind: 'structure', id: 3 },
      }),
    ).toBeNull()
  })
})

describe('dragIntentFrom (décision split/move d’un glisser)', () => {
  const stack = (n: number): Slot => ({ item: 'wood', count: n })
  const P = (slot: number): { side: 'player'; slot: number } => ({ side: 'player', slot })
  const C = (slot: number): { side: 'container'; slot: number } => ({ side: 'container', slot })

  it('SHIFT + même côté joueur + case cible VIDE + pile de 10 → split, moitié', () => {
    const intent = dragIntentFrom(P(0), P(4), true, stack(10), null, null)
    expect(intent).toEqual({ from: P(0), to: P(4), split: true, count: 5, container: null })
  })

  it('SHIFT mais case cible OCCUPÉE → pas de split (pile entière)', () => {
    // On ne scinde que vers du vide — la sim rejette sinon.
    const intent = dragIntentFrom(P(0), P(4), true, stack(10), stack(2), null)
    expect(intent).toEqual({ from: P(0), to: P(4), split: false, count: 10, container: null })
  })

  it('SHIFT mais source non scindable (pile de 1, moitié < 1) → pas de split', () => {
    const intent = dragIntentFrom(P(0), P(4), true, { item: 'axe', count: 1 }, null, null)
    expect(intent.split).toBe(false)
    expect(intent.count).toBe(1)
  })

  it('SHIFT mais un côté touche le conteneur → pas de split (le split est intra-joueur)', () => {
    const intent = dragIntentFrom(P(0), C(0), true, stack(10), null, { kind: 'structure', id: 1 })
    expect(intent.split).toBe(false)
    expect(intent.count).toBe(10)
  })

  it('pas de SHIFT → pas de split, la pile entière', () => {
    const intent = dragIntentFrom(P(0), P(4), false, stack(10), null, null)
    expect(intent).toEqual({ from: P(0), to: P(4), split: false, count: 10, container: null })
  })

  it('composition dragIntentFrom → dragToAction : un SHIFT-glisser vers du vide sort un split_slot de la moitié', () => {
    const intent = dragIntentFrom(P(0), P(4), true, stack(10), null, null)
    expect(dragToAction(intent)).toEqual({ type: 'split_slot', from: 0, to: 4, count: 5 })
  })

  it('composition : sans SHIFT vers une case occupée, c’est un move_slot de la pile entière', () => {
    const intent = dragIntentFrom(P(0), P(4), false, stack(10), stack(2), null)
    expect(dragToAction(intent)).toEqual({ type: 'move_slot', from: 0, to: 4 })
  })
})

describe('firstFitSlot', () => {
  const wood = (n: number): Inventory[number] => ({ item: 'wood', count: n })

  it('vise d’abord une pile INCOMPLÈTE du même item', () => {
    // [wood 20 (pleine), wood 5, vide] → la pile de 5 accueille en priorité.
    const inv: Inventory = [wood(20), wood(5), null]
    expect(firstFitSlot(inv, 'wood')).toBe(1)
  })

  it('sinon la première case VIDE', () => {
    const inv: Inventory = [wood(20), null, wood(20)]
    expect(firstFitSlot(inv, 'wood')).toBe(1)
  })

  it('rien ne rentre (tout plein du même item, aucune vide) → null', () => {
    const inv: Inventory = [wood(20), wood(20)]
    expect(firstFitSlot(inv, 'wood')).toBeNull()
  })

  it('un outil (pile 1) ne complète jamais une pile — il lui faut une case vide', () => {
    const inv: Inventory = [{ item: 'axe', count: 1 }, null]
    expect(firstFitSlot(inv, 'axe')).toBe(1)
  })

  it('bornes lo/hi : ne fouille QUE la région demandée (le sac, hors ceinture)', () => {
    // Case 0 (ceinture) est vide, mais on ne cherche que dans [1, 3[.
    const inv: Inventory = [null, wood(20), null]
    expect(firstFitSlot(inv, 'wood', 1, inv.length)).toBe(2)
  })
})

describe('quickMoveToAction (clic droit)', () => {
  const wood = (n: number): Inventory[number] => ({ item: 'wood', count: n })

  it('sans conteneur, une case de la CEINTURE part vers le sac → move_slot', () => {
    // Ceinture = [0,6[. Case 0 tenue, on l’envoie dans le sac (première vide = 6).
    const inv: Inventory = [wood(10), null, null, null, null, null, null, null]
    expect(quickMoveToAction({ from: { side: 'player', slot: 0 }, playerInv: inv, container: null })).toEqual({
      type: 'move_slot',
      from: 0,
      to: 6,
    })
  })

  it('sans conteneur, une case du SAC part vers la ceinture → move_slot (première libre)', () => {
    // Case 6 (sac) → ceinture. La case 0 tient un AUTRE item (pas de fusion) :
    // la cible est donc la première case libre de la ceinture, la 1.
    const inv: Inventory = [{ item: 'stone', count: 4 }, null, null, null, null, null, wood(3), null]
    expect(quickMoveToAction({ from: { side: 'player', slot: 6 }, playerInv: inv, container: null })).toEqual({
      type: 'move_slot',
      from: 6,
      to: 1,
    })
  })

  it('sans conteneur, le SAC FUSIONNE dans une pile compatible de la ceinture', () => {
    // Case 0 tient une pile incomplète de wood : le clic droit l'y verse (R14).
    const inv: Inventory = [wood(10), null, null, null, null, null, wood(3), null]
    expect(quickMoveToAction({ from: { side: 'player', slot: 6 }, playerInv: inv, container: null })).toEqual({
      type: 'move_slot',
      from: 6,
      to: 0,
    })
  })

  it('conteneur ouvert : une case du joueur part vers le conteneur → transfer', () => {
    const playerInv: Inventory = [wood(12), null, null, null, null, null, null, null]
    const containerInv: Inventory = [null, null]
    expect(
      quickMoveToAction({
        from: { side: 'player', slot: 0 },
        playerInv,
        container: { kind: 'structure', id: 5, inv: containerInv },
      }),
    ).toEqual({
      type: 'transfer',
      kind: 'structure',
      containerId: 5,
      from: { side: 'player', slot: 0 },
      to: { side: 'container', slot: 0 },
      count: 12,
    })
  })

  it('conteneur ouvert : une case du conteneur revient vers le joueur → transfer', () => {
    const playerInv: Inventory = [null, null, null, null, null, null, null, null]
    const containerInv: Inventory = [wood(8), null]
    expect(
      quickMoveToAction({
        from: { side: 'container', slot: 0 },
        playerInv,
        container: { kind: 'corpse', id: 9, inv: containerInv },
      }),
    ).toEqual({
      type: 'transfer',
      kind: 'corpse',
      containerId: 9,
      from: { side: 'container', slot: 0 },
      to: { side: 'player', slot: 0 },
      count: 8,
    })
  })

  it('case cliquée VIDE → aucune action', () => {
    const inv: Inventory = [null, null]
    expect(quickMoveToAction({ from: { side: 'player', slot: 0 }, playerInv: inv, container: null })).toBeNull()
  })

  it('aucune place à l’arrivée → aucune action', () => {
    // Ceinture entière prise par un autre item, sac plein : rien à faire.
    const full: Inventory = [wood(20), wood(20), wood(20), wood(20), wood(20), wood(20)]
    expect(quickMoveToAction({ from: { side: 'player', slot: 0 }, playerInv: full, container: null })).toBeNull()
  })
})
