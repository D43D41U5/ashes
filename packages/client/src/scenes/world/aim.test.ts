import { describe, expect, it } from 'vitest'
import type { Corpse, ResourceNode } from '@braises/sim'
import { aimAt, clickToAction, holdHarvest } from './aim'

const RANGE = 1.5
const node = (id: number, tx: number, ty: number, stock = 10): ResourceNode =>
  ({ id, tx, ty, stock, type: 'tree', regrowAt: 0 }) as ResourceNode
const corpse = (id: number, x: number, y: number): Corpse => ({ id, x, y }) as Corpse

/** Le joueur est collé à la tuile (10,10) : elle est à portée, (20,20) non. */
const PLAYER = { x: 10.5, y: 11.6 }

describe('aimAt', () => {
  it('voit le nœud récoltable de la tuile visée, et le sait à portée', () => {
    const t = aimAt(10, 10, PLAYER, [node(7, 10, 10)], [], RANGE)
    expect(t.nodeId).toBe(7)
    expect(t.corpseId).toBeNull()
    expect(t.inRange).toBe(true)
  })

  it('ignore un nœud ÉPUISÉ : il n’y a rien à récolter dessus', () => {
    expect(aimAt(10, 10, PLAYER, [node(7, 10, 10, 0)], [], RANGE).nodeId).toBeNull()
  })

  it('le cadavre PRIME sur le nœud (on ouvre ce qu’on vient de tuer)', () => {
    const t = aimAt(10, 10, PLAYER, [node(7, 10, 10)], [corpse(3, 10.2, 10.9)], RANGE)
    expect(t.corpseId).toBe(3)
    expect(clickToAction(t, null)).toEqual({ type: 'loot_corpse', corpseId: 3 })
  })

  it('sait qu’une tuile lointaine est hors de portée', () => {
    expect(aimAt(20, 20, PLAYER, [node(7, 20, 20)], [], RANGE).inRange).toBe(false)
  })
})

describe('clickToAction — désarmé, le clic ne bâtit JAMAIS (A1)', () => {
  it('une tuile vide n’émet AUCUNE action', () => {
    // LE bug d'origine : ceci renvoyait `build`, et posait un mur.
    expect(clickToAction(aimAt(11, 11, PLAYER, [], [], RANGE), null)).toBeNull()
  })

  it('un nœud à portée émet `harvest` (A3)', () => {
    const t = aimAt(10, 10, PLAYER, [node(7, 10, 10)], [], RANGE)
    expect(clickToAction(t, null)).toEqual({ type: 'harvest', nodeId: 7 })
  })

  it('le MÊME nœud hors de portée n’émet rien — on n’émet pas une action perdue d’avance (A3)', () => {
    const t = aimAt(20, 20, PLAYER, [node(7, 20, 20)], [], RANGE)
    expect(clickToAction(t, null)).toBeNull()
  })
})

describe('clickToAction — armé, le clic bâtit (A2)', () => {
  it('sur une tuile vide, il pose la structure choisie', () => {
    const t = aimAt(11, 11, PLAYER, [], [], RANGE)
    expect(clickToAction(t, 'wall')).toEqual({ type: 'build', structure: 'wall', tx: 11, ty: 11 })
  })

  it('le mode dit ce que le clic fait : armé, on ne récolte pas « en passant »', () => {
    const t = aimAt(10, 10, PLAYER, [node(7, 10, 10)], [], RANGE)
    expect(clickToAction(t, 'chest')).toMatchObject({ type: 'build' })
  })
})

describe('holdHarvest — le maintien n’inonde pas la sim (A4, A6)', () => {
  const t = () => aimAt(10, 10, PLAYER, [node(7, 10, 10)], [], RANGE)
  const COOLDOWN = 1000

  it('frappe au premier appel, puis se TAIT jusqu’au rechargement', () => {
    expect(holdHarvest(t(), null, 1000, 0, COOLDOWN)).toEqual({ type: 'harvest', nodeId: 7 })
    // 50 ms plus tard (une frame) : rien. Sans ça, 20 refus « trop tôt » par seconde.
    expect(holdHarvest(t(), null, 1050, 1000, COOLDOWN)).toBeNull()
    expect(holdHarvest(t(), null, 1999, 1000, COOLDOWN)).toBeNull()
    expect(holdHarvest(t(), null, 2000, 1000, COOLDOWN)).toEqual({ type: 'harvest', nodeId: 7 })
  })

  it('sur 3 s de maintien à 20 Hz, il n’émet que 3 coups, pas 60 (A4)', () => {
    let last = -COOLDOWN // prêt à frapper au premier tour
    let sent = 0
    for (let now = 0; now < 3000; now += 50) {
      if (holdHarvest(t(), null, now, last, COOLDOWN)) {
        sent++
        last = now
      }
    }
    expect(sent).toBe(3)
  })

  it('cesse dès que le nœud s’ÉPUISE — la cible se ré-évalue à chaque coup (A5)', () => {
    const vide = aimAt(10, 10, PLAYER, [node(7, 10, 10, 0)], [], RANGE)
    expect(holdHarvest(vide, null, 5000, 0, COOLDOWN)).toBeNull()
  })

  it('cesse dès qu’on s’ÉLOIGNE, sans rien émettre', () => {
    const loin = aimAt(20, 20, PLAYER, [node(7, 20, 20)], [], RANGE)
    expect(holdHarvest(loin, null, 5000, 0, COOLDOWN)).toBeNull()
  })

  it('en mode construction, le maintien ne martèle rien', () => {
    expect(holdHarvest(t(), 'wall', 5000, 0, COOLDOWN)).toBeNull()
  })
})
