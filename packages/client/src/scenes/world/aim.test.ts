import { describe, expect, it } from 'vitest'
import type { Corpse, ResourceNode } from '@ashes/sim'
import { AGRICULTURE, EDGE_N, EDGE_O, EDGE_S, STRUCTURE_HP } from '@ashes/sim'
import { aimAt, clickToAction, demolishTargetAt, holdHarvest, type AimStructure, type DemolishStructure } from './aim'

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

/**
 * PANSER QUELQU'UN D'AUTRE — le troisième verbe chaud (décision d'Alexis 2026-07-28 : TOUT
 * blessé, étranger compris).
 *
 * `/sim` l'acceptait déjà et le récompensait (`combat.ts` → `HEAL_OUTSIDER_WARMTH`) ; le
 * client, lui, ne savait panser que SOI — il contredisait donc la sim, et le dilemme du
 * voisin n'avait que deux issues, donner ou piller. Ce qui manquait n'était pas une règle :
 * c'était le fil qui porte la PLAIE DE LA CIBLE jusqu'au résolveur.
 */
describe('clickToAction — panser un tiers : fibres en main + quelqu’un qui saigne', () => {
  const blesse = (id: number) => ({ id, x: 11.5, y: 11.5, wounds: { bleeding: true as const } })
  const indemne = (id: number) => ({ id, x: 11.5, y: 11.5, wounds: {} })
  const vise = (autres: { id: number; x: number; y: number; wounds: { bleeding?: true } }[]) =>
    aimAt(11, 11, PLAYER, [], [], RANGE, autres)
  const fibres = (wounded = false) => ({ held: 'fiber' as const, wounded, dx: 1, dy: 0 })

  it('un voisin qui SAIGNE sous le curseur → on le panse, LUI', () => {
    expect(clickToAction(vise([blesse(9)]), null, fibres())).toEqual({ type: 'bandage', targetEntityId: 9 })
  })

  it('un voisin INDEMNE → pas de soin : le clic retombe sur la frappe', () => {
    expect(clickToAction(vise([indemne(9)]), null, fibres())).toEqual({ type: 'attack', dx: 1, dy: 0 })
  })

  it('LE VISER PRIME SUR SE SOIGNER — viser quelqu’un dit « c’est pour toi »', () => {
    // Les deux saignent, et c'est LE cas qui décide de l'ordre des branches : si le soin sur
    // soi passait d'abord, cliquer sur le blessé se serait soigné moi. Même règle que le don.
    expect(clickToAction(vise([blesse(9)]), null, fibres(true))).toEqual({ type: 'bandage', targetEntityId: 9 })
  })

  it('personne sous le curseur, mais je saigne → je me panse (aucune régression)', () => {
    expect(clickToAction(vise([]), null, fibres(true))).toEqual({ type: 'bandage' })
  })

  it('un blessé HORS DE PORTÉE n’est pas une cible — le bras ne s’allonge pas', () => {
    const loin = [{ id: 9, x: 30.5, y: 30.5, wounds: { bleeding: true as const } }]
    const vu = aimAt(30, 30, PLAYER, [], [], RANGE, loin)
    // `aimAt` ne le retient même pas : la portée est jugée AVANT le reste. Le clic retombe
    // donc sur la frappe à mains nues, comme avec des fibres sans plaie — jamais sur un soin
    // que la sim refuserait (un refus n'est pas gratuit : la chronique le lit).
    expect(vu.entityId).toBeNull()
    expect(vu.entityWounded).toBe(false)
    expect(clickToAction(vu, null, fibres())).not.toMatchObject({ type: 'bandage' })
  })

  it('le MAINTIEN ne répète pas le soin d’un tiers non plus', () => {
    expect(holdHarvest(vise([blesse(9)]), null, 1000, 0, 200, fibres())).toBeNull()
  })

  it('la plaie lue est celle de la CIBLE, pas la mienne (aimAt porte le fil)', () => {
    expect(vise([blesse(9)]).entityWounded).toBe(true)
    expect(vise([indemne(9)]).entityWounded).toBe(false)
    expect(vise([]).entityWounded).toBe(false)
  })
})

describe('clickToAction — armé, le clic bâtit (A2)', () => {
  it('sur une tuile vide, il pose la structure choisie — mur en bois par défaut', () => {
    const t = aimAt(11, 11, PLAYER, [], [], RANGE)
    // SANS contexte de pose, l'arête retombe sur le NORD (R23) : le fantôme en dessine toujours
    // une, et le clic doit poser là où le fantôme se voit — jamais en pleine tuile.
    expect(clickToAction(t, 'wall')).toEqual({ type: 'build', structure: 'wall', tx: 11, ty: 11, material: 'wood', edges: EDGE_N })
  })

  it('R8 : le matériau choisi accompagne mur/porte, jamais les pièces molles', () => {
    const t = aimAt(11, 11, PLAYER, [], [], RANGE)
    expect(clickToAction(t, 'wall', undefined, { material: 'stone', edge: EDGE_O, onTile: null })).toEqual({
      type: 'build',
      structure: 'wall',
      tx: 11,
      ty: 11,
      material: 'stone',
      edges: EDGE_O,
    })
    // Le sol n'a ni palier de matériau ni arête : il prend la tuile (R23).
    expect(clickToAction(t, 'floor', undefined, { material: 'stone', edge: EDGE_O, onTile: null })).toEqual({
      type: 'build',
      structure: 'floor',
      tx: 11,
      ty: 11,
    })
  })

  it('R8 : cliquer un MUR existant, mur armé, l’AMÉLIORE au lieu de buter « occupé »', () => {
    const t = aimAt(11, 11, PLAYER, [], [], RANGE)
    // `onTile` désigne désormais la barrière qui porte l'ARÊTE VISÉE (R23), pas « la première
    // structure de la tuile » — c'est ce qui laisse fermer un coin sans améliorer son voisin.
    expect(clickToAction(t, 'wall', undefined, { material: 'stone', edge: EDGE_N, onTile: { id: 42, type: 'wall' } })).toEqual({
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
describe('viser un feu → fireId (pour ouvrir le modal à E, spec feu-station S17)', () => {
  it('un FEU sur la tuile visée → fireId = son id', () => {
    const fire = { id: 9, tx: 5, ty: 5, type: 'fire' as const, hp: 100 }
    const t = aimAt(5, 5, PLAYER, [], [], RANGE, [], [fire])
    expect(t.fireId).toBe(9)
    expect(t.onFire).toBe(true)
  })
  it('aucune structure feu sur la tuile → fireId null', () => {
    expect(aimAt(5, 5, PLAYER, [], [], RANGE).fireId).toBeNull()
  })
})

describe('la main décide du clic', () => {
  const vide = { tx: 5, ty: 5, nodeId: null, corpseId: null, entityId: null, entityWounded: false, onFire: false, fireId: null, repairableId: null, plantableId: null, harvestableId: null,
  pileId: null, inRange: true }
  const surUnArbre = { tx: 5, ty: 5, nodeId: 42, corpseId: null, entityId: null, entityWounded: false, onFire: false, fireId: null, repairableId: null, plantableId: null, harvestableId: null,
  pileId: null, inRange: true }
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

/**
 * DÉMOLIR AU MARTEAU (décision d'Alexis, 2026-08-01) : « on doit pouvoir détruire une
 * structure construite avec le marteau — seules ses propres constructions ».
 *
 * La sim sait démolir depuis V3 (spec village R9/A5) ; ce qui manquait, c'est la VISÉE.
 * Elle se prouve ici parce qu'une tuile n'est pas une structure : elle porte jusqu'à trois
 * couches (sol, toit, solide) ET quatre arêtes. « La première structure de la tuile »
 * détruirait au hasard, et la sim ne peut pas rattraper ça — elle accepte tout `structureId`
 * valide. Le seul garde-fou possible est ici.
 */
describe('demolishTargetAt — ce que le marteau détruirait', () => {
  const MOI = 7
  const AUTRE = 9
  /** Une structure du snapshot, réduite à ce que la visée regarde. */
  const bati = (over: Partial<DemolishStructure> & { id: number }): DemolishStructure =>
    ({ tx: 10, ty: 10, type: 'wall', ownerId: MOI, villageId: 1, ...over })
  /** LE BALAYAGE : 81 positions de curseur dans la tuile (10,10) — pas un cas choisi.
   *  Une règle de géométrie s'affirme sur tout l'espace, sinon on ne teste que sa moitié. */
  const CURSEURS: [number, number][] = []
  for (let i = 1; i <= 9; i++) for (let j = 1; j <= 9; j++) CURSEURS.push([10 + i / 10, 10 + j / 10])

  it('ne vise QUE mes constructions — le mur du voisin n’a aucune affordance', () => {
    const murs = [bati({ id: 1, ownerId: AUTRE, edges: EDGE_N }), bati({ id: 2, ownerId: MOI, edges: EDGE_S })]
    for (const [wx, wy] of CURSEURS) {
      expect(demolishTargetAt(murs, wx, wy, MOI)?.ownerId).not.toBe(AUTRE)
      // Et SEUL sur la tuile, il ne devient pas une cible pour autant : depuis aucune position
      // du curseur le marteau ne peut mordre le mur d'autrui.
      expect(demolishTargetAt([murs[0]!], wx, wy, MOI)).toBeUndefined()
    }
  })

  it('un COIN porte deux murs : c’est LE CURSEUR qui tranche — le trait le plus proche', () => {
    // Le défaut que la pose a déjà connu (R23) : lire la tuile désigne un mur au hasard. Ici la
    // propriété tient sur TOUTE la tuile — le mur nord gagne exactement là où le trait nord est
    // le plus proche (v < u), l'ouest partout ailleurs. Aucune position ne rend « rien ».
    const coin = [bati({ id: 1, edges: EDGE_N }), bati({ id: 2, edges: EDGE_O })]
    for (const [wx, wy] of CURSEURS) {
      const u = wx - 10
      const v = wy - 10
      // Sur la DIAGONALE (v === u) les deux traits sont à égalité parfaite : c'est l'ordre
      // déclaré (N, E, S, O) qui tranche, toujours dans le même sens. Une visée qui vacillerait
      // là serait pire qu'un choix arbitraire — le surlignage clignoterait entre deux murs.
      expect(demolishTargetAt(coin, wx, wy, MOI)?.id).toBe(v <= u ? 1 : 2)
    }
  })

  it('une SEULE barrière : elle est visée depuis n’importe où dans la tuile', () => {
    // Sans ambiguïté à lever, exiger de viser le bon trait ferait rater le clic pour rien.
    const seul = [bati({ id: 1, edges: EDGE_O })]
    for (const [wx, wy] of CURSEURS) expect(demolishTargetAt(seul, wx, wy, MOI)?.id).toBe(1)
  })

  it('le mur du VOISIN D’EN FACE compte : une arête se lit des DEUX côtés', () => {
    // Un trait est partagé. Le mur nord de ma tuile peut être déclaré comme le mur SUD de la
    // tuile au-dessus, selon d'où on l'a posé — et il serait alors indémolissable depuis la
    // tuile qu'on vise. C'est `edgeBarrierAt` qui règle ça pour la pose ; même dette ici.
    const enFace = [bati({ id: 1, ty: 9, edges: EDGE_S })]
    expect(demolishTargetAt(enFace, 10.5, 10.1, MOI)?.id).toBe(1)
  })

  it('LES TROIS COUCHES se démontent de haut en bas : le solide, puis le toit, puis le sol', () => {
    // La tuile la plus chargée que le jeu produise : deux murs d'arête, un coffre, un toit, un
    // sol. Une seule propriété affirmée — l'ordre de démontage — et sur tout le balayage.
    const pile = [
      bati({ id: 1, type: 'floor' }),
      bati({ id: 2, type: 'roof' }),
      bati({ id: 3, type: 'chest' }),
      bati({ id: 4, type: 'wall', edges: EDGE_N }),
      bati({ id: 5, type: 'wall', edges: EDGE_O }),
    ]
    // Les murs priment partout (on vise forcément un trait de plus près qu'autre chose)…
    for (const [wx, wy] of CURSEURS) expect([4, 5]).toContain(demolishTargetAt(pile, wx, wy, MOI)?.id)
    // …et sans eux, on descend : coffre, puis toit, puis sol — depuis n'importe où.
    const sansMurs = pile.filter((s) => s.edges === undefined)
    for (const [wx, wy] of CURSEURS) {
      expect(demolishTargetAt(sansMurs, wx, wy, MOI)?.id).toBe(3)
      expect(demolishTargetAt(sansMurs.filter((s) => s.id !== 3), wx, wy, MOI)?.id).toBe(2)
      expect(demolishTargetAt(sansMurs.filter((s) => s.type === 'floor'), wx, wy, MOI)?.id).toBe(1)
    }
  })

  it('le FEU d’un village ne se vise pas ; le feu de camp LIBRE, si', () => {
    // La sim refuse le premier (« un Feu ne s’éteint pas ») : ne pas l'offrir du tout.
    expect(demolishTargetAt([bati({ id: 1, type: 'fire', villageId: 3 })], 10.5, 10.5, MOI)).toBeUndefined()
    expect(demolishTargetAt([bati({ id: 1, type: 'fire', villageId: 0 })], 10.5, 10.5, MOI)?.id).toBe(1)
  })

  it('tant que je ne sais pas QUI je suis, rien n’est à moi', () => {
    // `playerId` vaut 0 dans WorldScene jusqu'au `ready`. Or `ownerId === 0` = « au village,
    // au monde » : sans garde, un snapshot arrivé trop tôt offrirait tout le bâti de POI.
    const poi = [bati({ id: 1, ownerId: 0, type: 'chest' }), bati({ id: 2, ownerId: 0, edges: EDGE_N })]
    for (const [wx, wy] of CURSEURS) expect(demolishTargetAt(poi, wx, wy, 0)).toBeUndefined()
  })

  it('une tuile vide, ou une autre tuile, ne rend rien', () => {
    expect(demolishTargetAt([], 10.5, 10.5, MOI)).toBeUndefined()
    // Une pièce PLEINE TUILE d'à côté ne déborde pas sur la mienne (les arêtes, elles, si).
    expect(demolishTargetAt([bati({ id: 1, tx: 12, type: 'chest' })], 10.5, 10.5, MOI)).toBeUndefined()
  })
})

describe('clickToAction — le mode DÉMOLIR est un mode : il dit ce que le clic fait', () => {
  const ctx = (onTile: { id: number; type: 'wall' } | null) =>
    ({ material: 'wood' as const, edge: EDGE_N, demolir: true, onTile })

  it('une cible sous le curseur → `demolish`, et rien d’autre', () => {
    const t = aimAt(10, 10, PLAYER, [], [], RANGE)
    expect(clickToAction(t, null, undefined, ctx({ id: 42, type: 'wall' }))).toEqual({
      type: 'demolish',
      structureId: 42,
    })
  })

  it('SANS cible, le clic ne fait RIEN — il ne retombe ni sur la récolte ni sur la frappe', () => {
    // Le piège qu'on refuse : marteau armé pour casser, on vise à côté, et l'on se met à
    // couper du bois (ou à frapper mains nues). Un mode qui fuit n'est pas un mode.
    const surArbre = aimAt(10, 10, PLAYER, [node(7, 10, 10)], [], RANGE)
    expect(clickToAction(surArbre, null, { held: null, dx: 1, dy: 0 }, ctx(null))).toBeNull()
  })
})
