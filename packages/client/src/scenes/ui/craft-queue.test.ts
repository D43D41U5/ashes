import type { CraftOrder } from '@ashes/sim'
import { describe, expect, it } from 'vitest'
import { DEPOP_MS, FINI_HOLD_MS, PICKUP_FADE_MS, PICKUP_HOLD_MS, finishedPhase, pickupOpacity, reconcile, type TileModel } from './craft-queue'

/**
 * LA PILE D'ARTISANAT — la mécanique pure (maquette « Pile d'artisanat », 2026-08-22).
 *
 * La sim ne numérote pas ses ordres : la file est positionnelle, et c'est `reconcile` qui
 * fait le lien entre ce que la pile montrait et ce que la sim dit maintenant. C'est elle qui
 * décide si une tuile SORT EN VERT (son `item_crafted` est passé) ou disparaît sans
 * cérémonie (annulée) — donc c'est elle qu'on prouve.
 */
const order = (recipeId: CraftOrder['recipeId'], count = 1, p: Partial<CraftOrder> = {}): CraftOrder => ({
  recipeId,
  count,
  remainingTicks: 100,
  totalTicks: 100,
  paused: false,
  ...p,
})

const keys = () => {
  let k = 0
  return () => ++k
}

describe('la réconciliation file ↔ tuiles', () => {
  it('une file neuve fait des tuiles neuves : la tête court, les autres attendent', () => {
    const r = reconcile([], [order('rope', 3), order('crude_axe')], [], 0, keys())
    expect(r.live.map((t) => [t.recipeId, t.count, t.phase])).toEqual([
      ['rope', 3, 'run'],
      ['crude_axe', 1, 'wait'],
    ])
    expect(r.finished).toEqual([])
  })

  it('une unité du lot sort : la tuile reste, son compte baisse, rien ne finit', () => {
    const a = reconcile([], [order('rope', 3)], [], 0, keys()).live
    const r = reconcile(a, [order('rope', 2)], ['rope'], 10, keys())
    expect(r.finished).toEqual([])
    expect(r.live[0]!.key).toBe(a[0]!.key)
    expect(r.live[0]!.count).toBe(2)
  })

  it('la dernière unité sort : la tuile FINIT (vert) et la suivante prend la tête', () => {
    const nk = keys()
    const a = reconcile([], [order('rope', 1), order('crude_axe')], [], 0, nk).live
    const r = reconcile(a, [order('crude_axe')], ['rope'], 10, nk)
    expect(r.finished.map((t) => [t.key, t.phase, t.since, t.progress])).toEqual([[a[0]!.key, 'done', 10, 1]])
    expect(r.live.map((t) => [t.key, t.phase])).toEqual([[a[1]!.key, 'run']])
  })

  it('deux unités dans la même frame (rattrapage) : le lot à 2 sort d’un coup', () => {
    const nk = keys()
    const a = reconcile([], [order('rope', 2)], [], 0, nk).live
    const r = reconcile(a, [], ['rope', 'rope'], 10, nk)
    expect(r.finished).toHaveLength(1)
    expect(r.live).toEqual([])
  })

  it('un ordre qui disparaît SANS événement a été annulé : pas de vert, la tuile s’en va', () => {
    const nk = keys()
    const a = reconcile([], [order('rope'), order('crude_axe')], [], 0, nk).live
    const r = reconcile(a, [order('crude_axe')], [], 10, nk)
    expect(r.finished).toEqual([])
    expect(r.live.map((t) => [t.key, t.phase])).toEqual([[a[1]!.key, 'run']])
  })

  it('annuler au MILIEU garde les tuiles des deux côtés (identité stable)', () => {
    const nk = keys()
    const a = reconcile([], [order('rope'), order('crude_axe'), order('crude_spear')], [], 0, nk).live
    const r = reconcile(a, [order('rope'), order('crude_spear')], [], 10, nk)
    expect(r.live.map((t) => t.key)).toEqual([a[0]!.key, a[2]!.key])
  })

  it('un événement qui ne porte pas la sortie de la tête est ignoré (jamais un faux vert)', () => {
    const nk = keys()
    const a = reconcile([], [order('rope')], [], 0, nk).live
    const r = reconcile(a, [order('rope')], ['crude_axe'], 10, nk)
    expect(r.finished).toEqual([])
    expect(r.live[0]!.count).toBe(1)
  })

  it('pause et sac plein sont des PHASES de la tête, pas des sorties', () => {
    const nk = keys()
    const paused = reconcile([], [order('crude_axe', 1, { paused: true, remainingTicks: 40 })], [], 0, nk)
    expect(paused.live[0]!.phase).toBe('paused')
    expect(paused.live[0]!.progress).toBeCloseTo(0.6)
    const blocked = reconcile([], [order('crude_axe', 1, { remainingTicks: 0 })], [], 0, nk)
    expect(blocked.live[0]!.phase).toBe('blocked')
    expect(blocked.live[0]!.progress).toBe(1)
    expect(blocked.finished).toEqual([])
  })

  it('la barre suit la sim, sans décompte local', () => {
    const nk = keys()
    const a = reconcile([], [order('rope', 1, { remainingTicks: 100 })], [], 0, nk).live
    const r = reconcile(a, [order('rope', 1, { remainingTicks: 25 })], [], 10, nk)
    expect(r.live[0]!.progress).toBeCloseTo(0.75)
    expect(r.live[0]!.remainingTicks).toBe(25)
  })
})

describe('la sortie d’une tuile finie, en niveau sur l’horloge', () => {
  it('vert tenu, puis dépop, puis plus rien — bornes exactes', () => {
    expect(finishedPhase(1000, 1000)).toBe('done')
    expect(finishedPhase(1000, 1000 + FINI_HOLD_MS - 1)).toBe('done')
    expect(finishedPhase(1000, 1000 + FINI_HOLD_MS)).toBe('depop')
    expect(finishedPhase(1000, 1000 + FINI_HOLD_MS + DEPOP_MS - 1)).toBe('depop')
    expect(finishedPhase(1000, 1000 + FINI_HOLD_MS + DEPOP_MS)).toBeNull()
  })

  it('un bond d’horloge enjambe les phases sans bloquer la tuile (niveau, pas front)', () => {
    expect(finishedPhase(1000, 1000 + 60_000)).toBeNull()
  })

  it('le modèle fini garde sa clé : c’est la MÊME tuile qui passe au vert', () => {
    const nk = keys()
    const a = reconcile([], [order('rope')], [], 0, nk).live
    const t: TileModel = reconcile(a, [], ['rope'], 5, nk).finished[0]!
    expect(t.key).toBe(a[0]!.key)
  })
})

describe('la tuile de récolte, dans la même pile', () => {
  it('tenue pleine, puis fondu, puis partie — les valeurs des anciens toasts', () => {
    expect(pickupOpacity(1000, 1000)).toBe(1)
    expect(pickupOpacity(1000, 1000 + PICKUP_HOLD_MS)).toBe(1)
    expect(pickupOpacity(1000, 1000 + PICKUP_HOLD_MS + PICKUP_FADE_MS / 2)).toBeCloseTo(0.5)
    expect(pickupOpacity(1000, 1000 + PICKUP_HOLD_MS + PICKUP_FADE_MS)).toBe(0)
  })
})
