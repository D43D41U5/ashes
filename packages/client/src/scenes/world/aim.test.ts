import { describe, expect, it } from 'vitest'
import type { Corpse, ResourceNode } from '@braises/sim'
import { AGRICULTURE, STRUCTURE_HP } from '@braises/sim'
import { aimAt, clickToAction, holdHarvest, type AimStructure } from './aim'

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

describe('clickToAction — se panser : fibres en main + une plaie (V0-2)', () => {
  const empty = () => aimAt(11, 11, PLAYER, [], [], RANGE) // tuile vide à portée
  const fibers = (wounded: boolean) => ({ held: 'fiber' as const, wounded, dx: 1, dy: 0 })

  it('fibres en main ET blessé → on se bande', () => {
    expect(clickToAction(empty(), null, fibers(true))).toEqual({ type: 'bandage' })
  })

  it('fibres en main SANS blessure → pas de bandage : le clic reste une frappe (défense du pauvre)', () => {
    expect(clickToAction(empty(), null, fibers(false))).toEqual({ type: 'attack', dx: 1, dy: 0 })
  })

  it('se panser PRIME sur récolter : blessé, fibres en main, on soigne — on ne récolte pas « en passant »', () => {
    const onNode = aimAt(10, 10, PLAYER, [node(7, 10, 10)], [], RANGE)
    expect(clickToAction(onNode, null, fibers(true))).toEqual({ type: 'bandage' })
  })

  it('blessé mais mains vides → pas de bandage (il faut un matériau de soin)', () => {
    expect(clickToAction(empty(), null, { held: null, wounded: true, dx: 1, dy: 0 })).toEqual({ type: 'attack', dx: 1, dy: 0 })
  })

  it('le MAINTIEN ne répète PAS le bandage — c’est un tap délibéré, une plaie à la fois', () => {
    expect(holdHarvest(empty(), null, 1000, 0, 200, fibers(true))).toBeNull()
  })
})

describe('clickToAction — armé, le clic bâtit (A2)', () => {
  it('sur une tuile vide, il pose la structure choisie — mur en bois par défaut', () => {
    const t = aimAt(11, 11, PLAYER, [], [], RANGE)
    expect(clickToAction(t, 'wall')).toEqual({ type: 'build', structure: 'wall', tx: 11, ty: 11, material: 'wood' })
  })

  it('R8 : le matériau choisi accompagne mur/porte, jamais les pièces molles', () => {
    const t = aimAt(11, 11, PLAYER, [], [], RANGE)
    expect(clickToAction(t, 'wall', undefined, { material: 'stone', onTile: null })).toEqual({
      type: 'build',
      structure: 'wall',
      tx: 11,
      ty: 11,
      material: 'stone',
    })
    // Le sol n'a pas de palier de matériau : pas de champ `material`.
    expect(clickToAction(t, 'floor', undefined, { material: 'stone', onTile: null })).toEqual({
      type: 'build',
      structure: 'floor',
      tx: 11,
      ty: 11,
    })
  })

  it('R8 : cliquer un MUR existant, mur armé, l’AMÉLIORE au lieu de buter « occupé »', () => {
    const t = aimAt(11, 11, PLAYER, [], [], RANGE)
    expect(clickToAction(t, 'wall', undefined, { material: 'stone', onTile: { id: 42, type: 'wall' } })).toEqual({
      type: 'upgrade_structure',
      structureId: 42,
    })
  })

  it('le mode dit ce que le clic fait : armé, on ne récolte pas « en passant »', () => {
    const t = aimAt(10, 10, PLAYER, [node(7, 10, 10)], [], RANGE)
    // Un TOIT armé pose une pièce structurelle (le coffre, lui, se pose en objet tenu).
    expect(clickToAction(t, 'roof')).toMatchObject({ type: 'build', structure: 'roof' })
  })

  it('le COFFRE tenu se pose comme un objet (décision d’Alexis), pas au marteau', () => {
    const t = aimAt(11, 11, PLAYER, [], [], RANGE)
    expect(clickToAction(t, 'chest')).toEqual({ type: 'place_component', tx: 11, ty: 11 })
  })
})

describe('poser un feu de camp : la main tient un feu, le clic POSE', () => {
  it('placing = "fire" → `place_campfire` sur la tuile visée', () => {
    const t = aimAt(11, 11, PLAYER, [], [], RANGE)
    expect(clickToAction(t, 'fire')).toEqual({ type: 'place_campfire', tx: 11, ty: 11 })
  })

  it('poser PRIME sur tout : même sur un nœud, on pose (on ne récolte pas « en passant »)', () => {
    const t = aimAt(10, 10, PLAYER, [node(7, 10, 10)], [], RANGE)
    const main = { held: 'campfire' as const, dx: 1, dy: 0 }
    expect(clickToAction(t, 'fire', main)).toEqual({ type: 'place_campfire', tx: 10, ty: 10 })
  })

  it('en pose, le maintien ne martèle rien (pas de feux à la chaîne)', () => {
    const t = aimAt(10, 10, PLAYER, [node(7, 10, 10)], [], RANGE)
    expect(holdHarvest(t, 'fire', 5000, 0, 1000)).toBeNull()
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

/**
 * L'OBJET EN MAIN DÉCIDE DU CLIC (décision utilisateur, 2026-07-13).
 *
 * C'est LA règle d'interaction du jeu — celle qui remplace les quinze touches de
 * verbes qu'on a débranchées. Elle doit tenir : sans elle, un joueur ne peut ni
 * manger, ni se défendre, et la nuit qui chasse devient une exécution.
 */
describe('la main décide du clic', () => {
  const vide = { tx: 5, ty: 5, nodeId: null, corpseId: null, entityId: null, onFire: false, repairableId: null, plantableId: null, harvestableId: null, inRange: true }
  const surUnArbre = { tx: 5, ty: 5, nodeId: 42, corpseId: null, entityId: null, onFire: false, repairableId: null, plantableId: null, harvestableId: null, inRange: true }
  const versLest = { dx: 1, dy: 0 }

  it('DE LA NOURRITURE EN MAIN → on mange (et le maintien répète)', () => {
    const main = { held: 'berries' as const, ...versLest }
    expect(clickToAction(surUnArbre, null, main)).toEqual({ type: 'eat', item: 'berries' })
    // Même sur un arbre : ce qu'on tient prime. On ne coupe pas du bois avec une baie.
    expect(holdHarvest(surUnArbre, null, 1000, 0, 100, main)).toEqual({ type: 'eat', item: 'berries' })
  })

  it('UNE ARME EN MAIN → on frappe, vers le curseur — même face à un buisson', () => {
    const main = { held: 'spear' as const, ...versLest }
    expect(clickToAction(surUnArbre, null, main)).toEqual({ type: 'attack', dx: 1, dy: 0 })
    // C'est vital : un clic de panique ne doit PAS partir récolter un buisson
    // pendant qu'un loup arrive.
  })

  it('MAINS NUES SUR UN ARBRE → on récolte (c’est la minute 0 du jeu)', () => {
    const main = { held: null, ...versLest }
    expect(clickToAction(surUnArbre, null, main)).toEqual({ type: 'harvest', nodeId: 42 })
  })

  it('MAINS NUES DANS LE VIDE → ON FRAPPE. La défense du pauvre doit exister', () => {
    const main = { held: null, ...versLest }
    // Sans ce cran, un joueur sans arme serait SANS DÉFENSE la nuit — or la nuit
    // chasse. Une punition sans parade n'est pas une punition, c'est un impôt.
    expect(clickToAction(vide, null, main)).toEqual({ type: 'attack', dx: 1, dy: 0 })
  })

  it('un OUTIL en main ne frappe pas : il récolte (la hache n’est pas une arme)', () => {
    const main = { held: 'crude_axe' as const, ...versLest }
    expect(clickToAction(surUnArbre, null, main)).toEqual({ type: 'harvest', nodeId: 42 })
  })
})

describe('DONNER : nourriture en main + un voisin visé → le don chaud (V1-10)', () => {
  it('viser un PNJ à portée, nourriture en main → on DONNE (et pas manger)', () => {
    const voisin = [{ id: 7, x: 11.5, y: 11.5 }] // un PNJ, sous le curseur (tuile 11,11)
    const t = aimAt(11, 11, PLAYER, [], [], RANGE, voisin)
    expect(t.entityId).toBe(7)
    expect(clickToAction(t, null, { held: 'berries' as const, heldCount: 4, dx: 1, dy: 0 })).toEqual({
      type: 'give',
      targetEntityId: 7,
      item: 'berries',
      count: 4,
    })
  })

  it('sans voisin visé, la nourriture se MANGE (le don ne se déclenche que sur une cible)', () => {
    const t = aimAt(11, 11, PLAYER, [], [], RANGE, [])
    expect(t.entityId).toBeNull()
    expect(clickToAction(t, null, { held: 'berries' as const, heldCount: 4, dx: 1, dy: 0 })).toEqual({ type: 'eat', item: 'berries' })
  })

  it('un voisin HORS de portée du joueur n’est pas une cible de don', () => {
    const loin = [{ id: 7, x: 50, y: 50 }]
    expect(aimAt(50, 50, PLAYER, [], [], RANGE, loin).entityId).toBeNull()
  })
})

describe('clickToAction — nourrir le Feu & réparer (grappe entretien : bois en main + structure)', () => {
  const struct = (id: number, tx: number, ty: number, type: AimStructure['type'], hp: number): AimStructure =>
    ({ id, tx, ty, type, hp })
  const wood = { held: 'wood' as const, dx: 1, dy: 0 }

  it('bois en main + le Feu sous le curseur, à portée → feed_fire', () => {
    const t = aimAt(10, 10, PLAYER, [], [], RANGE, [], [struct(5, 10, 10, 'fire', STRUCTURE_HP.fire)])
    expect(t.onFire).toBe(true)
    expect(clickToAction(t, null, wood)).toEqual({ type: 'feed_fire' })
  })

  it('bois en main + Feu HORS de portée → pas de feed (la défense du pauvre : on frappe)', () => {
    const t = aimAt(20, 20, PLAYER, [], [], RANGE, [], [struct(5, 20, 20, 'fire', STRUCTURE_HP.fire)])
    expect(t.onFire).toBe(true)
    expect(t.inRange).toBe(false)
    expect(clickToAction(t, null, wood)).toEqual({ type: 'attack', dx: 1, dy: 0 })
  })

  it('bois en main + un mur ABÎMÉ sous le curseur, à portée → repair avec son id', () => {
    const t = aimAt(10, 10, PLAYER, [], [], RANGE, [], [struct(42, 10, 10, 'wall', STRUCTURE_HP.wall - 50)])
    expect(t.repairableId).toBe(42)
    expect(clickToAction(t, null, wood)).toEqual({ type: 'repair', structureId: 42 })
  })

  it('bois en main + un mur INTACT (hp = max) → rien à réparer (on frappe)', () => {
    const t = aimAt(10, 10, PLAYER, [], [], RANGE, [], [struct(42, 10, 10, 'wall', STRUCTURE_HP.wall)])
    expect(t.repairableId).toBeNull()
    expect(clickToAction(t, null, wood)).toEqual({ type: 'attack', dx: 1, dy: 0 })
  })

  it('le FEU ne se répare JAMAIS (il se nourrit) : un Feu à bas PV → onFire, pas repairable', () => {
    const t = aimAt(10, 10, PLAYER, [], [], RANGE, [], [struct(5, 10, 10, 'fire', 1)])
    expect(t.onFire).toBe(true)
    expect(t.repairableId).toBeNull()
    expect(clickToAction(t, null, wood)).toEqual({ type: 'feed_fire' })
  })

  it('MAINS NUES sur le Feu → rien (pas de bois à donner)', () => {
    const t = aimAt(10, 10, PLAYER, [], [], RANGE, [], [struct(5, 10, 10, 'fire', STRUCTURE_HP.fire)])
    expect(clickToAction(t, null)).toBeNull()
  })

  it('de la NOURRITURE en main sur le Feu → on mange (feed exige du BOIS, pas n’importe quoi)', () => {
    const t = aimAt(10, 10, PLAYER, [], [], RANGE, [], [struct(5, 10, 10, 'fire', STRUCTURE_HP.fire)])
    expect(clickToAction(t, null, { held: 'berries' as const, dx: 1, dy: 0 })).toEqual({ type: 'eat', item: 'berries' })
  })
})

describe('clickToAction — le potager : semer & récolter (agriculture voie A)', () => {
  const wood = { held: 'wood' as const, dx: 1, dy: 0 }
  const graine = { held: 'graine' as const, dx: 1, dy: 0 }
  /** Une parcelle sur la tuile visée (10,10) : `plantedAt` absent = vide ; posé = semée. */
  const parcelle = (plantedAt?: number): AimStructure => ({
    id: 8,
    tx: 10,
    ty: 10,
    type: 'parcelle',
    hp: STRUCTURE_HP.parcelle,
    ...(plantedAt !== undefined ? { plantedAt } : {}),
  })
  const RIPE = AGRICULTURE.GROW_TICKS // parcelle semée au tick 0, mûre à ce tick

  it('graine en main + parcelle VIDE à portée → plant', () => {
    const t = aimAt(10, 10, PLAYER, [], [], RANGE, [], [parcelle()], 0)
    expect(t.plantableId).toBe(8)
    expect(t.harvestableId).toBeNull()
    expect(clickToAction(t, null, graine)).toEqual({ type: 'plant', structureId: 8 })
  })

  it('mains libres + parcelle MÛRE à portée → harvest_crop', () => {
    const t = aimAt(10, 10, PLAYER, [], [], RANGE, [], [parcelle(0)], RIPE)
    expect(t.harvestableId).toBe(8)
    expect(t.plantableId).toBeNull()
    expect(clickToAction(t, null)).toEqual({ type: 'harvest_crop', structureId: 8 })
  })

  it('une parcelle semée mais PAS mûre n’est ni plantable ni récoltable', () => {
    const t = aimAt(10, 10, PLAYER, [], [], RANGE, [], [parcelle(0)], RIPE - 1)
    expect(t.plantableId).toBeNull()
    expect(t.harvestableId).toBeNull()
    // graine en main sur une parcelle occupée non mûre → rien à semer, on frappe (fallback).
    expect(clickToAction(t, null, graine)).toEqual({ type: 'attack', dx: 1, dy: 0 })
  })

  it('mains libres sur une parcelle vide → rien (pas de graine à semer)', () => {
    const t = aimAt(10, 10, PLAYER, [], [], RANGE, [], [parcelle()], 0)
    expect(clickToAction(t, null)).toBeNull()
  })

  it('du bois sur une parcelle ABÎMÉE → repair (l’agriculture n’écrase pas la réparation)', () => {
    const abimee: AimStructure = { id: 8, tx: 10, ty: 10, type: 'parcelle', hp: STRUCTURE_HP.parcelle - 10 }
    const t = aimAt(10, 10, PLAYER, [], [], RANGE, [], [abimee], 0)
    expect(t.repairableId).toBe(8)
    expect(clickToAction(t, null, wood)).toEqual({ type: 'repair', structureId: 8 })
  })
})
