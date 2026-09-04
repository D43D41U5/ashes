/**
 * ═══ E-A3 — AUCUNE INTERACTION NE TRAVERSE UN PLANCHER (spec `etages.md`) ═══
 *
 * *« `/sim` n'a AUJOURD'HUI ni ligne de vue ni occlusion : tout ce qui est à distance est une
 * distance euclidienne sur x,y. MESURÉ le 2026-08-31 : 67 sites dans 24 fichiers. La règle
 * d'étage s'écrit donc UNE FOIS, dans `atteignableEntreEtages`, et les sites l'APPELLENT. »*
 *
 * La spec ne pouvait pas encore affirmer E-A3 : **deux sites sur 67** passaient par l'accesseur
 * (la chasse du loup, la récolte). Cette garde est le reste — et elle est BEHAVIORALE, pas
 * structurelle : elle ne compte pas les appels, elle pose deux corps à UNE TUILE l'un de l'autre,
 * **séparés par un plancher et hors de portée du connecteur**, puis demande à chaque système s'il
 * les voit. Un site qu'on oublierait de brancher rougit ici, et un site NOUVEAU aussi.
 *
 * ⚠ **CE QUI LA FERAIT ROUGIR, énoncé avant d'accepter son vert** : rendre `atteignableEntreEtages`
 * à `return true` — tous les cas « à travers le plancher » doivent alors passer. Et le TÉMOIN de
 * chaque cas (les deux corps au MÊME étage, à la même distance) doit rester vrai : sans lui, une
 * garde verte ne dirait que « ce système ne fait rien ».
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, FAUNA, HUNT, TERRAIN_GRASS, TERRAIN_ROCK, TERRAIN_SCREE } from './balance'
import { createEmptyMap, type WorldMap } from './map'
import { type EtageCreux } from './etages'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { nearestPrey, spawnMonster } from './monsters'
import { prowlerNear } from './nighthunt'
import { advanceDecouverte } from './decouverte'
import { applyVillageAction } from './village'
import { advanceCendreux } from './cendreux'
import { CENDREUX, COMBAT } from './balance'
import { applyInventoryAction, poserAuSol } from './inventory-actions'

/* ══════════ LA MESA DE LABORATOIRE — et le point AVEUGLE qu'elle offre ══════════
 *
 * Chapeau 6×6 de roche en (10..15, 10..15), rampe au sud en (12, 16). Les deux corps se posent
 * à l'OUEST : (9,5 ; 10,5) au sol et (10,5 ; 10,5) sur le plateau — **une tuile d'écart**, et à
 * 6,7 tuiles du connecteur, donc bien au-delà de `ETAGE_PORTEE_CONNECTEUR` (3). Tout ce qui les
 * relie traverse donc de la roche.
 */
const CAP_X0 = 10
const CAP_Y0 = 10
const CAP_N = 6
const RAMPE = { x: 12, y: CAP_Y0 + CAP_N }
/** Au sol, à l'ouest du chapeau. */
const BAS = { x: CAP_X0 - 0.5, y: CAP_Y0 + 0.5 }
/** Sur le plateau, la tuile d'à côté — une tuile d'écart, un plancher entre les deux. */
const HAUT = { x: CAP_X0 + 0.5, y: CAP_Y0 + 0.5 }

function mesaDeLabo(): WorldMap {
  const map = createEmptyMap(24, 24, TERRAIN_GRASS)
  const tuiles: number[] = []
  for (let dy = 0; dy < CAP_N; dy++) {
    for (let dx = 0; dx < CAP_N; dx++) {
      const x = CAP_X0 + dx
      const y = CAP_Y0 + dy
      map.terrain[y * map.width + x] = TERRAIN_ROCK
      tuiles.push(y * map.width + x)
    }
  }
  tuiles.push(RAMPE.y * map.width + RAMPE.x)
  tuiles.sort((a, b) => a - b)
  const etage: EtageCreux = {
    niveau: 1, idx: tuiles, terrain: tuiles.map(() => TERRAIN_SCREE),
    x0: CAP_X0, y0: CAP_Y0, x1: CAP_X0 + CAP_N, y1: RAMPE.y + 1,
  }
  map.etages = [etage]
  map.connecteurs = [{ x: RAMPE.x, y: RAMPE.y, de: 0, vers: 1, type: 'rampe' }]
  return map
}

function monde(): SimState {
  return createSim(1, { map: mesaDeLabo(), worldEvents: false, faunaCap: 0, meteoActive: false, nightHunt: false })
}

/** Un corps posé, avec son étage. */
function poser(state: SimState, at: { x: number; y: number }, etage: number): number {
  const id = spawnEntity(state, at.x, at.y)
  const e = state.entities.find((k) => k.id === id)!
  if (etage !== 0) e.etage = etage
  return id
}

/**
 * LE PATRON DE CHAQUE CAS : la même question posée DEUX fois — une fois à travers le plancher
 * (elle doit répondre non), une fois au même étage (elle doit répondre oui). Le second n'est pas
 * décoratif : sans lui, un système qui ne ferait rien du tout passerait pour étanche.
 */
function lesDeuxSens(essai: (etageDuBas: number) => boolean): { aTravers: boolean; temoin: boolean } {
  return { aTravers: essai(0), temoin: essai(1) }
}

describe('E-A3 — un plancher ne se traverse que par un connecteur', () => {
  it('LA PROIE D’UN MONSTRE : celui d’en bas ne choisit pas celui d’en haut', () => {
    const r = lesDeuxSens((etageDuBas) => {
      const state = monde()
      // Le CHASSEUR est le monstre : il naît à sa position, et on lui pose son étage.
      const chasseurId = spawnMonster(state, 'wolf', BAS.x, BAS.y)
      const chasseur = state.entities.find((k) => k.id === chasseurId)!
      if (etageDuBas !== 0) chasseur.etage = etageDuBas
      poser(state, HAUT, 1)
      return nearestPrey(state, chasseur, FAUNA.PURSUIT_RANGE_RAGE) !== undefined
    })
    expect(r.temoin, 'témoin : au même étage, la proie EST vue').toBe(true)
    expect(r.aTravers, 'à travers le plancher : elle ne l’est pas').toBe(false)
  })

  it('LE RÔDEUR DE LA NUIT : il ne « rôde près » de personne à travers un plancher', () => {
    const r = lesDeuxSens((etageDuBas) => {
      const state = monde()
      const rodeurId = spawnMonster(state, 'wolf', BAS.x, BAS.y)
      const rodeur = state.entities.find((k) => k.id === rodeurId)!
      if (etageDuBas !== 0) rodeur.etage = etageDuBas
      // Le regard vient du plateau : `prowlerNear` doit savoir d'OÙ on regarde.
      return prowlerNear(state, HAUT.x, HAUT.y, 8, 1)
    })
    expect(r.temoin, 'témoin : au même étage, il rôde bien près').toBe(true)
    expect(r.aTravers, 'à travers le plancher : non').toBe(false)
  })

  it('LA FRAPPE : on ne cogne pas quelqu’un à travers douze mètres de roche', () => {
    const r = lesDeuxSens((etageDuBas) => {
      const state = monde()
      const frappeur = poser(state, BAS, etageDuBas)
      const cible = poser(state, HAUT, 1)
      const avant = state.entities.find((k) => k.id === cible)!.hp
      // Le wind-up puis sa résolution : une phase seule ne résout aucun coup.
      for (let t = 0; t < 40; t++) {
        // Le geste réel : une frappe est DIRIGÉE (`combat.test.ts`), ici plein est.
        step(state, [{ entityId: frappeur, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
      }
      return state.entities.find((k) => k.id === cible)!.hp < avant
    })
    expect(r.temoin, 'témoin : au même étage, le coup porte').toBe(true)
    expect(r.aTravers, 'à travers le plancher : il ne porte pas').toBe(false)
  })
})

/* ══════════ LE BÂTI, LA STATION, LA PILE — tout cela vit AU SOL ══════════ */

describe('E-A3 — le sol reste au sol : bâti, stations, piles', () => {
  /** Un feu de camp posé au pied de la mesa, sur la tuile voisine de celle du plateau. */
  function avecUnFeu(state: SimState): number {
    const id = state.nextStructureId
    state.structures.push({
      id, type: 'fire', tx: Math.floor(BAS.x), ty: Math.floor(BAS.y), hp: 100,
      villageId: null, ownerId: null, access: 'public',
    } as unknown as SimState['structures'][number])
    state.nextStructureId += 1
    return id
  }

  it('LA STATION ne révèle pas ses recettes à qui est un étage au-dessus', () => {
    const r = lesDeuxSens((etageDuCorps) => {
      const state = monde()
      avecUnFeu(state)
      const id = poser(state, etageDuCorps === 0 ? BAS : HAUT, etageDuCorps)
      advanceDecouverte(state)
      const e = state.entities.find((k) => k.id === id)!
      return (e.seen ?? []).length > 0
    })
    // ⚠ ICI le témoin est le corps AU SOL (0) et le cas est celui d'EN HAUT (1) : la question
    // se pose dans l'autre sens que pour la chasse, et il faut le dire plutôt que le supposer.
    expect(r.aTravers, 'témoin : au sol, la station enseigne').toBe(true)
    expect(r.temoin, 'depuis le plateau : elle n’enseigne rien').toBe(false)
  })

  it('LA PILE AU SOL ne se ramasse pas depuis le plateau', () => {
    const r = lesDeuxSens((etageDuCorps) => {
      const state = monde()
      poserAuSol(state, Math.floor(BAS.x) + 0.5, Math.floor(BAS.y) + 0.5, 'wood', 1)
      const id = poser(state, etageDuCorps === 0 ? BAS : HAUT, etageDuCorps)
      const pile = state.groundItems[0]!
      applyInventoryAction(state, id, { type: 'pick_up', pileId: pile.id })
      return state.groundItems.length === 0
    })
    expect(r.aTravers, 'témoin : au sol, on ramasse').toBe(true)
    expect(r.temoin, 'depuis le plateau : on ne ramasse pas').toBe(false)
  })
})

describe('E-A3 — la porte, et ce qui se relève', () => {
  it('LA PORTE ne s’ouvre pas depuis le plateau (le lot des dix sites de `village.ts`)', () => {
    const r = lesDeuxSens((etageDuCorps) => {
      const state = monde()
      const id = state.nextStructureId
      state.structures.push({
        id, type: 'door', tx: Math.floor(BAS.x), ty: Math.floor(BAS.y), hp: 100,
        villageId: null, ownerId: null, access: 'public',
      } as unknown as SimState['structures'][number])
      state.nextStructureId += 1
      const moi = poser(state, etageDuCorps === 0 ? BAS : HAUT, etageDuCorps)
      applyVillageAction(state, moi, { type: 'toggle_door', structureId: id } as never)
      return state.structures.find((k) => k.id === id)!.open === true
    })
    expect(r.aTravers, 'témoin : au sol, la porte s’ouvre').toBe(true)
    expect(r.temoin, 'depuis le plateau : elle ne s’ouvre pas').toBe(false)
  })

  it('ON SE RELÈVE SUR SON PLANCHER — le mort d’un plateau ne renaît pas dans la roche', () => {
    const state = monde()
    state.corpses.push({
      id: 1, x: HAUT.x, y: HAUT.y, etage: 1, inventory: [],
      decayAt: state.tick + COMBAT.CORPSE_TICKS, diedAt: state.tick,
      risesAt: state.tick, // il se lève à ce tick
    } as unknown as SimState['corpses'][number])
    state.nextCorpseId = 2
    advanceCendreux(state)
    const leve = state.monsters[0]
    expect(leve, 'la garde ne peut pas passer à vide : quelqu’un s’est bien levé').toBeDefined()
    const corps = state.entities.find((e) => e.id === leve!.entityId)!
    expect(corps.etage, 'il se relève à +1, pas dans la roche').toBe(1)
    void CENDREUX
  })
})

/* ══════════ E-R22 — CE QU'ON LÂCHE SUR LE PLATEAU Y RESTE ══════════
 *
 * Avant : une pile n'avait pas d'étage, elle vivait « au sol » — et lâchée depuis le chapeau,
 * ce sol était l'intérieur de la roche : E-R5 la disait « trop loin » à qui venait de la poser.
 * Le même patron que `Corpse.etage`, éprouvé des deux côtés : la pile d'en haut se reprend d'en
 * haut et pas d'en bas ; et la pile d'en bas (le test d'avant) reste hors de portée d'en haut.
 */
describe('E-R22 — ce qu’on lâche sur le plateau y reste', () => {
  /** Un corps posé avec son étage, une bûche en main. */
  function porteur(state: SimState, at: { x: number; y: number }, etage: number): number {
    const id = poser(state, at, etage)
    const e = state.entities.find((k) => k.id === id)!
    e.inventory[e.activeSlot] = { item: 'wood', count: 1 }
    return id
  }

  it('LA PILE lâchée sur le plateau porte son étage : elle se reprend de là-haut, pas du pied', () => {
    const state = monde()
    const haut = porteur(state, HAUT, 1)
    applyInventoryAction(state, haut, { type: 'drop_held' })
    const pile = state.groundItems[0]!
    expect(pile.etage, 'la pile gît sur le plancher de qui l’a lâchée').toBe(1)
    // Du pied, une tuile à l'ouest : douze mètres de roche entre la main et la pile.
    const bas = poser(state, BAS, 0)
    applyInventoryAction(state, bas, { type: 'pick_up', pileId: pile.id })
    expect(state.groundItems, 'd’en bas : rien à prendre').toHaveLength(1)
    applyInventoryAction(state, haut, { type: 'pick_up', pileId: pile.id })
    expect(state.groundItems, 'd’en haut : on la reprend').toHaveLength(0)
  })

  it('AU SOL, rien ne change : la pile lâchée au palier n’a pas de champ (les sauvegardes d’avant)', () => {
    const state = monde()
    const bas = porteur(state, BAS, 0)
    applyInventoryAction(state, bas, { type: 'drop_held' })
    expect(state.groundItems[0]!.etage).toBeUndefined()
    applyInventoryAction(state, bas, { type: 'pick_up', pileId: state.groundItems[0]!.id })
    expect(state.groundItems).toHaveLength(0)
  })

  it('DEUX PILES, pas une : ce qui gît au sol ne fusionne pas avec ce qui gît sur le plateau', () => {
    const state = monde()
    poserAuSol(state, HAUT.x, HAUT.y, 'wood', 1, 1)
    poserAuSol(state, HAUT.x, HAUT.y, 'wood', 1, 0)
    expect(state.groundItems).toHaveLength(2)
    poserAuSol(state, HAUT.x, HAUT.y, 'wood', 1, 1)
    expect(state.groundItems).toHaveLength(2)
    expect(state.groundItems.find((p) => p.etage === 1)?.count, 'le tas d’en haut se renouvelle').toBe(2)
  })

  it('L’APPÂT sur le plateau ne se flaire pas du pied — la bête ne marche pas dans la paroi', () => {
    const r = lesDeuxSens((etageDeLaBete) => {
      const state = monde()
      poserAuSol(state, HAUT.x, HAUT.y, 'berries', 1, 1)
      // Au sol : une tuile à l'ouest de l'appât, à portée de bouchée — sans la roche entre les deux.
      // Sur le plateau : deux tuiles à l'est, à portée de flair (`BAIT_SEEK`), le même sol.
      const at = etageDeLaBete === 0 ? BAS : { x: HAUT.x + 2, y: HAUT.y }
      const id = spawnMonster(state, 'rabbit', at.x, at.y)
      const m = state.monsters.find((mm) => mm.entityId === id)!
      delete m.burrowX
      delete m.burrowY
      if (etageDeLaBete !== 0) state.entities.find((e) => e.id === id)!.etage = etageDeLaBete
      for (let t = 0; t < 20 * BALANCE.TICK_RATE_HZ && m.baitUntil === undefined; t++) step(state, [])
      return m.baitUntil !== undefined
    })
    expect(r.temoin, 'témoin : sur le plateau, le lapin vient aux baies').toBe(true)
    expect(r.aTravers, 'du pied : il ne les flaire pas à travers la roche').toBe(false)
    void HUNT
  })

  it('LE SANG d’un blessé sur le plateau porte son étage', () => {
    const state = monde()
    const id = poser(state, HAUT, 1)
    state.entities.find((e) => e.id === id)!.wounds.bleeding = true
    for (let t = 0; t < HUNT.BLOOD_EVERY_TICKS + 1 && state.blood.length === 0; t++) step(state, [])
    expect(state.blood.length).toBeGreaterThan(0)
    expect(state.blood[0]!.etage).toBe(1)
  })
})
