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
import { BALANCE, FAUNA, HUNT, MONSTER_DEFS, TERRAIN_GRASS, TERRAIN_ROCK, TERRAIN_SCREE, WEAPON_PROFILES } from './balance'
import { createEmptyMap, type WorldMap } from './map'
import { type EtageCreux, niveauDuCorps, palierDuSol } from './etages'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { nearestPrey, spawnMonster } from './monsters'
import { prowlerNear } from './nighthunt'
import { advanceDecouverte } from './decouverte'
import { advanceCoinsConnus } from './faune'
import { butcherRejection, castRejection } from './economy'
import { near } from './npc'
import { advanceUpkeep, applyVillageAction, createVillage, evaluateBuild, grantItems } from './village'
import { advanceCendreux, nearestWarmth, willRiseAsCendreux } from './cendreux'
import { applyDamage } from './combat'
import { CENDREUX, COMBAT, FIRE } from './balance'
import { addItems, makeInventory } from './items'
import { applyInventoryAction, poserAuSol } from './inventory-actions'
import { advancePois } from './poi-discovery'
import { advanceWorldEvents } from './worldevents'
import { advanceFire, fireState } from './fire'
import { foundNpcVillage } from './worldgen'
import { POI, SEASON } from './balance'

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
      // Le témoin se tient SUR le plateau, à une tuile de l'autre côté : un corps « à l'étage 1 »
      // posé sur le pré serait en l'air, et l'élan du coup (`poussee.ts`) le reposerait au sol.
      const surLePlateau = etageDuBas !== 0
      const frappeur = poser(state, surLePlateau ? { x: HAUT.x + 1, y: HAUT.y } : BAS, etageDuBas)
      const cible = poser(state, HAUT, 1)
      const avant = state.entities.find((k) => k.id === cible)!.hp
      // Le wind-up puis sa résolution : une phase seule ne résout aucun coup.
      for (let t = 0; t < 40; t++) {
        // Le geste réel : une frappe est DIRIGÉE (`combat.test.ts`) — vers la cible.
        step(state, [{ entityId: frappeur, dx: 0, dy: 0, action: { type: 'attack', dx: surLePlateau ? -1 : 1, dy: 0 } }])
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

/* ══════════ LA GROTTE DE LABORATOIRE — un plancher au-dessus, un mur autour ══════════
 *
 * Le chapeau de la mesa reste (roche au sol), et une CAVE à −1 vit dessous, sur les mêmes
 * tuiles. Sa paroi ouest est la tuile 9 : à −1 elle n'existe pas (un mur) ; au sol c'est du pré,
 * marchable. C'est exactement le piège rapporté par Alexis le 2026-09-06 (« lorsque je fais une
 * attaque lourde dans le mur d'une grotte, je monte d'un étage ») : une poussée résolue SANS
 * l'étage du corps voit le pré, traverse la paroi, et le pas suivant — ne trouvant plus de sol à
 * −1 — retombe au palier du sol, c'est-à-dire À LA SURFACE.
 */
function grotteDeLabo(): WorldMap {
  const map = mesaDeLabo()
  const tuiles: number[] = []
  for (let dy = 0; dy < CAP_N; dy++) for (let dx = 0; dx < CAP_N; dx++) tuiles.push((CAP_Y0 + dy) * map.width + CAP_X0 + dx)
  const cave: EtageCreux = {
    niveau: -1, idx: tuiles, terrain: tuiles.map(() => TERRAIN_SCREE),
    x0: CAP_X0, y0: CAP_Y0, x1: CAP_X0 + CAP_N, y1: CAP_Y0 + CAP_N,
  }
  map.etages = [...map.etages!, cave]
  return map
}

function grotte(): SimState {
  return createSim(1, { map: grotteDeLabo(), worldEvents: false, faunaCap: 0, meteoActive: false, nightHunt: false })
}

/** Collé à la paroi ouest de la cave, le bord du corps à un cheveu de la tuile 9. */
const CONTRE_LA_PAROI = { x: CAP_X0 + BALANCE.AVATAR_HITBOX_TILES / 2 + 0.025, y: CAP_Y0 + 2.5 }

/** Le corps est-il encore dans la cave, à son étage ? (le pas idle qui suit relit l'étage) */
function toujoursDansLaCave(state: SimState, id: number): { tuile: number; etage: number } {
  step(state, [{ entityId: id, dx: 0, dy: 0 }])
  const e = state.entities.find((k) => k.id === id)!
  return { tuile: Math.floor(e.x - BALANCE.AVATAR_HITBOX_TILES / 2), etage: niveauDuCorps(state.map, e) }
}

/** Le vrai geste du coup lourd : maintenir, relâcher vers l'ouest, laisser le coup se résoudre. */
function chargeVersLOuest(state: SimState, id: number): void {
  step(state, [{ entityId: id, dx: 0, dy: 0, action: { type: 'attack_charge', dx: -1, dy: 0 } }])
  for (let t = 0; t < WEAPON_PROFILES.unarmed.chargeTicks + 1; t++) step(state, [])
  step(state, [{ entityId: id, dx: 0, dy: 0, action: { type: 'attack_release', dx: -1, dy: 0 } }])
  for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) step(state, [])
}

describe('E-A3 — un corps POUSSÉ reste à son étage (charge, recul, séparation)', () => {
  it('LA CHARGE dans la paroi de la grotte : on cogne le mur, on ne remonte pas à la surface', () => {
    const state = grotte()
    const id = poser(state, CONTRE_LA_PAROI, -1)
    chargeVersLOuest(state, id)
    expect(toujoursDansLaCave(state, id)).toEqual({ tuile: CAP_X0, etage: -1 })
  })

  it('LE RECUL d’un coup lourd reçu contre la paroi : le mur l’arrête', () => {
    const state = grotte()
    const cible = poser(state, CONTRE_LA_PAROI, -1)
    const frappeur = poser(state, { x: CONTRE_LA_PAROI.x + 0.9, y: CONTRE_LA_PAROI.y }, -1)
    chargeVersLOuest(state, frappeur)
    expect(state.entities.find((k) => k.id === cible)!.hp).toBeLessThan(100)
    expect(toujoursDansLaCave(state, cible)).toEqual({ tuile: CAP_X0, etage: -1 })
  })

  it('LA SÉPARATION de deux corps confondus contre la paroi : celui du mur n’y entre pas', () => {
    const state = grotte()
    const contre = poser(state, CONTRE_LA_PAROI, -1)
    poser(state, { x: CONTRE_LA_PAROI.x + 0.2, y: CONTRE_LA_PAROI.y }, -1)
    step(state, [])
    expect(toujoursDansLaCave(state, contre)).toEqual({ tuile: CAP_X0, etage: -1 })
  })

  it('LA SÉPARATION ne traverse pas un plancher : le pied et le plateau ne se bousculent pas', () => {
    const state = monde()
    const pied = poser(state, { x: HAUT.x - 0.6, y: HAUT.y }, 0)
    const plateau = poser(state, HAUT, 1)
    const avant = state.entities.filter((k) => k.id === pied || k.id === plateau).map((k) => k.x)
    step(state, [])
    const apres = state.entities.filter((k) => k.id === pied || k.id === plateau).map((k) => k.x)
    expect(apres).toEqual(avant)
  })
})

describe('E-A3 — les sites de PORTÉE repris le 2026-09-07', () => {
  /* ══════════ LA PASSE DU 2026-09-07 — les sites de PORTÉE qui ignoraient encore l'étage ══════
   *
   * *Alexis : « et bien traite la gestion d'une carte par niveau ».* MESURÉ le 2026-09-07 : 64
   * calculs de distance dans 31 fichiers de `/sim`, dont **25 seulement** passaient par
   * l'accesseur — E-A3 promettait les 67. Les sites repris ici sont ceux où **un corps perçoit
   * ou subit quelque chose d'autre** ; les anneaux de choix de tuile, les waypoints de son
   * PROPRE chemin et les tests d'appartenance de zone n'ont pas de second corps et restent
   * hors de la règle (ils sont nommés dans `docs/decisions.md`).
   * ═══════════════════════════════════════════════════════════════════════════════════════ */

  it('VOIR UN LIEU : on ne découvre pas à vue ce qu’un plancher cache', () => {
    // Le pendant ATTEINDRE (`poisAt`) connaissait déjà l'étage ; la VUE portait à travers la
    // roche — on lisait le fond d'un karst depuis la terrasse qui le coiffe.
    const r = lesDeuxSens((etageDuRegard) => {
      const state = monde()
      state.map.zones = [{ name: 'la Salle', kind: 'grotte', x: CAP_X0, y: CAP_Y0, w: 1, h: 1, etage: 1 }]
      const id = poser(state, BAS, etageDuRegard)
      advancePois(state)
      return state.entities.find((k) => k.id === id)!.knownPois.includes(0)
    })
    // Le témoin est le regard AU MÊME ÉTAGE que le lieu (1) ; l'autre sens est le sol (0).
    expect(r.temoin, 'témoin : au même étage, et à moins de SIGHT_TILES, le lieu se voit').toBe(true)
    expect(r.aTravers, 'à travers le plancher : il ne se voit pas').toBe(false)
    // Et la prémisse du témoin : les deux corps SONT à portée de vue (sinon la garde est vide).
    expect(Math.abs(BAS.x - CAP_X0)).toBeLessThan(POI.SIGHT_TILES)
  })

  it('L’ALARME D’UN VILLAGE : ce qui rôde SOUS lui ne la déclenche pas', () => {
    const r = lesDeuxSens((etageDeLaMenace) => {
      const state = monde()
      // Le feu au SOL, à l'ouest de la mesa ; la menace sur le plateau, dans DEFEND_RADIUS.
      foundNpcVillage(state, 5, 10, 2)
      const village = state.villages[0]!
      village.lastAlarmAt = -1_000_000 // le délai de garde ne doit pas masquer le cas
      const bete = spawnMonster(state, 'cendreux', HAUT.x, HAUT.y)
      const corps = state.entities.find((k) => k.id === bete)!
      if (etageDeLaMenace !== 0) corps.etage = etageDeLaMenace
      const avant = state.events.length
      advanceWorldEvents(state)
      return state.events.slice(avant).some((e) => e.type === 'alarm_raised')
    })
    // Ici le TÉMOIN est la menace au sol (0) — celle qui doit bien sonner ; le sens « à travers »
    // est la menace sur le plateau (1).
    expect(r.aTravers, 'témoin : au sol, la bête déclenche l’alarme').toBe(true)
    expect(r.temoin, 'sur le plateau, un plancher entre les deux : pas d’alarme').toBe(false)
  })

  it('L’ARCHE : on n’embarque pas depuis l’étage d’en dessous', () => {
    const r = lesDeuxSens((etageDuPassager) => {
      const state = monde()
      // Le quai sur le PLATEAU, le passager au sol juste à côté — dans EVAC_RADIUS.
      // L'Arche n'existe QUE dans une saison qui finit (`finDeSaison`, saison-sans-fin T4), et
      // son jour se compte DEPUIS la fin. On pose donc les deux, et le jour de départ.
      state.finDeSaison = BALANCE.SEASON_DAYS
      const jourEvac = state.finDeSaison - (BALANCE.SEASON_DAYS - SEASON.EVAC_DAY)
      state.jourDeDepart = jourEvac + SEASON.EVAC_DEPART_DAYS
      state.evacuation = { tx: CAP_X0, ty: CAP_Y0 }
      state.arkDeparted = false
      state.evacuatedIds = []
      const id = poser(state, BAS, etageDuPassager)
      advanceWorldEvents(state)
      return state.evacuatedIds.includes(id)
    })
    // Le quai est au SOL (le chapeau est un ÉTAGE, pas un palier : `palierDuSol` y vaut 0),
    // donc c'est le passager du sol qui est le TÉMOIN, et celui du plateau le cas de la règle.
    expect(r.aTravers, 'témoin : au même étage que le quai, on embarque').toBe(true)
    expect(r.temoin, 'depuis le plateau, un plancher entre les deux : on reste').toBe(false)
  })
  /**
   * LE FEU (R13) — repris parce que l'excuse qui l'avait différé était fausse. §20 disait ces
   * deux sites « impossibles à mettre en scène : il y faudrait un envol ou un camp allumé sur la
   * mesa ». Un camp allumé n'est qu'une STRUCTURE : `fireStateAt` rend `'lit'` à tout feu libre
   * sans slot combustible — « un feu forgé à la main dans un test ». L'excuse ne valait que pour
   * l'envol, qui la garde.
   *
   * Le montage : le feu SUR LE PLATEAU (étage 1), la proie et le loup ENSEMBLE — soit au feu,
   * soit dans la cave qui passe dessous. Même tuile, même distance au feu, seul l'étage change.
   *
   * QUATRE JAMBES — deux cas, chacun avec SON témoin sans feu. Un seul témoin ne suffirait pas :
   * il prouverait que le loup élit sur le PLATEAU, jamais qu'il élit dans la CAVE. Le jour où
   * une régression casserait la chasse sous la roche, la jambe « dans la cave, avec feu »
   * tomberait et accuserait le feu — le mauvais coupable, exactement.
   */
  it('LE FEU n’écarte le loup que de SON étage — la salle du dessous n’est pas interdite', () => {
    const essai = (etageDuCouple: number, avecFeu: boolean): boolean => {
      const state = grotte()
      const FEU = { tx: CAP_X0 + 1, ty: CAP_Y0 + 1 }
      const PROIE = { x: CAP_X0 + 1.5, y: CAP_Y0 + 1.5 }
      const LOUP = { x: CAP_X0 + 2.5, y: CAP_Y0 + 2.5 }
      if (avecFeu) {
        // Feu libre SANS `fuel` = ALLUMÉ (`fireStateAt`) ; son `etage` est celui du plateau.
        const feu = { id: 9300, type: 'fire', ...FEU, villageId: 0, hp: 100, etage: 1 } as never
        state.structures.push(feu)
        expect(fireState(state, feu), 'la prémisse : le feu BRÛLE').toBe('lit')
        // …et la proie est DANS son cercle — mesuré sur les positions POSÉES, pas sur des
        // constantes recopiées : bouger la mesa doit faire tomber la prémisse, pas la masquer.
        const dx = FEU.tx + 0.5 - PROIE.x
        const dy = FEU.ty + 0.5 - PROIE.y
        expect(dx * dx + dy * dy, 'la proie est dans le cercle du feu').toBeLessThan(FAUNA.FIRE_WARD * FAUNA.FIRE_WARD)
      }
      const proie = poser(state, PROIE, etageDuCouple)
      const loup = spawnMonster(state, 'wolf', LOUP.x, LOUP.y)
      state.entities.find((k) => k.id === loup)!.etage = etageDuCouple
      // Et le loup la voit même ASSOUPI : `wolfVigor` ne descend jamais sous `WOLF_DAY_FLOOR`,
      // donc l'acquisition porte au pire à `aggroRange × FLOOR`. Sans cette prémisse, la garde
      // dépendrait de l'heure que le banc tire, et rougirait un jour sans rien avoir à dire.
      const ex = LOUP.x - PROIE.x
      const ey = LOUP.y - PROIE.y
      expect(Math.sqrt(ex * ex + ey * ey), 'la proie est à portée d’acquisition à TOUTE heure')
        .toBeLessThan(MONSTER_DEFS.wolf.aggroRange * FAUNA.WOLF_DAY_FLOOR)
      step(state, [])
      return state.monsters.find((m) => m.entityId === loup)!.targetId === proie
    }
    expect(essai(1, false), 'témoin du plateau : sans feu, le loup choisit la proie').toBe(true)
    expect(essai(1, true), 'au même étage que le feu, la proie est intouchable').toBe(false)
    expect(essai(-1, false), 'témoin de la cave : le loup y élit aussi bien qu’ailleurs').toBe(true)
    expect(essai(-1, true), 'et le feu du dessus n’y change RIEN — la salle n’est pas interdite').toBe(true)
  })
})

describe('E-A3 — les huit décisions d’Alexis du 2026-09-07 (Q1..Q7)', () => {
  /** Un feu ALLUMÉ posé à l'étage voulu, au cœur du chapeau. Un feu sans `fuel` brûle
   *  (`fireStateAt`) : c'est le camp le moins cher qu'on puisse mettre debout. */
  function feuA(state: SimState, etage: number, id = 9400): { tx: number; ty: number } {
    const tx = CAP_X0 + 1
    const ty = CAP_Y0 + 1
    const feu = { id, type: 'fire', tx, ty, villageId: 0, hp: 100, etage } as never
    state.structures.push(feu)
    expect(fireState(state, feu), 'la prémisse : le feu BRÛLE').toBe('lit')
    return { tx, ty }
  }

  // ─── Q1 · le feu s'arrête au plancher ────────────────────────────────────────
  it('Q1 — le feu de la terrasse n’empêche pas une levée dans la salle du dessous', () => {
    const essai = (etageDuMort: number, avecFeu: boolean): boolean => {
      const state = grotte()
      // Le corps meurt À UNE TUILE du feu — bien à l'intérieur du ward de 12.
      const MORT = { x: CAP_X0 + 1.5, y: CAP_Y0 + 2.5 }
      if (avecFeu) {
        const f = feuA(state, 1)
        const dx = f.tx + 0.5 - MORT.x
        const dy = f.ty + 0.5 - MORT.y
        expect(dx * dx + dy * dy, 'le mort est DANS le ward du feu')
          .toBeLessThan(CENDREUX.HEARTH_WARD_RADIUS * CENDREUX.HEARTH_WARD_RADIUS)
      }
      const id = poser(state, MORT, etageDuMort)
      const e = state.entities.find((k) => k.id === id)!
      return willRiseAsCendreux(state, e)
    }
    expect(essai(1, false), 'témoin du plateau : sans feu, la vallée relève').toBe(true)
    expect(essai(1, true), 'au même étage que le feu, la veille annule la levée').toBe(false)
    expect(essai(-1, false), 'témoin de la cave : elle relève aussi bien').toBe(true)
    expect(essai(-1, true), 'et le feu du DESSUS ne veille rien dessous — Q1').toBe(true)
  })

  // ─── Q2 · le feu n'est un phare que pour qui peut le rejoindre ───────────────
  it('Q2 — le feu allumé du dessus n’appelle pas le Cendreux de la salle', () => {
    const essai = (etageDuCendreux: number): boolean => {
      const state = grotte()
      const f = feuA(state, 1)
      const OU = { x: CAP_X0 + 2.5, y: CAP_Y0 + 3.5 }
      const id = poser(state, OU, etageDuCendreux)
      const e = state.entities.find((k) => k.id === id)!
      const dx = f.tx + 0.5 - OU.x
      const dy = f.ty + 0.5 - OU.y
      expect(Math.sqrt(dx * dx + dy * dy), 'le feu est dans la portée de quête de chaleur')
        .toBeLessThan(CENDREUX.WARMTH_SEEK_RANGE)
      const chaud = nearestWarmth(state, e, CENDREUX.WARMTH_SEEK_RANGE)
      return chaud !== undefined && chaud.x === f.tx + 0.5 && chaud.y === f.ty + 0.5
    }
    expect(essai(1), 'témoin : au même étage, le feu EST le phare').toBe(true)
    expect(essai(-1), 'sous la roche, il n’appelle rien — Q2').toBe(false)
  })

  // ─── Q3 · un plancher coupe le groupe ───────────────────────────────────────
  it('Q3 — le cri de mort ne lève pas la sœur restée de l’autre côté du plancher', () => {
    const essai = (etageDeLaSoeur: number): boolean => {
      const state = grotte()
      // Deux biches de la MÊME harde, à une tuile l'une de l'autre. La frappée reste au
      // plateau ; la sœur descend (ou non) dans la salle.
      const a = spawnMonster(state, 'deer', CAP_X0 + 1.5, CAP_Y0 + 1.5)
      const b = spawnMonster(state, 'deer', CAP_X0 + 2.5, CAP_Y0 + 1.5)
      const ma = state.monsters.find((m) => m.entityId === a)!
      const mb = state.monsters.find((m) => m.entityId === b)!
      mb.herdId = ma.herdId = 1
      const ea = state.entities.find((k) => k.id === a)!
      const eb = state.entities.find((k) => k.id === b)!
      ea.etage = 1
      eb.etage = etageDeLaSoeur
      const dx = ea.x - eb.x
      const dy = ea.y - eb.y
      expect(Math.sqrt(dx * dx + dy * dy), 'la sœur est DANS le rayon d’alarme')
        .toBeLessThan(FAUNA.HERD_ALARM_RADIUS)
      expect(mb.suspicion ?? 0, 'la prémisse : elle ne se méfie de rien').toBeLessThan(1)
      const chasseur = poser(state, { x: CAP_X0 + 1.5, y: CAP_Y0 + 2.5 }, 1)
      applyDamage(state, ea, 1, chasseur)
      return (mb.suspicion ?? 0) >= 1
    }
    expect(essai(1), 'témoin : au même étage, le cri la lève').toBe(true)
    expect(essai(-1), 'un plancher coupe le groupe — Q3').toBe(false)
  })

  it('Q3 — tuer un louveteau sous terre ne fait plus hurler le clan resté dehors', () => {
    const essai = (etageDuClan: number): boolean => {
      const state = grotte()
      const petit = spawnMonster(state, 'wolf', CAP_X0 + 1.5, CAP_Y0 + 1.5)
      const adulte = spawnMonster(state, 'wolf', CAP_X0 + 2.5, CAP_Y0 + 1.5)
      const mp = state.monsters.find((m) => m.entityId === petit)!
      const ma = state.monsters.find((m) => m.entityId === adulte)!
      mp.herdId = ma.herdId = 2
      mp.petit = true
      const ep = state.entities.find((k) => k.id === petit)!
      const ea = state.entities.find((k) => k.id === adulte)!
      ep.etage = -1
      ea.etage = etageDuClan
      // LE TUEUR est dans la salle avec le petit : c'est la meute du DESSUS qu'on éprouve.
      const tueur = poser(state, { x: CAP_X0 + 1.5, y: CAP_Y0 + 2.5 }, -1)
      const et = state.entities.find((k) => k.id === tueur)!
      const dx = ea.x - et.x
      const dy = ea.y - et.y
      expect(Math.sqrt(dx * dx + dy * dy), 'le tueur est dans la portée de rage du clan')
        .toBeLessThan(FAUNA.PURSUIT_RANGE_RAGE)
      const avant = state.events.length
      applyDamage(state, ep, 9999, tueur)
      expect(ep.hp, 'la prémisse : le petit est bien mort').toBeLessThanOrEqual(0)
      return state.events.slice(avant).some((ev) => ev.type === 'wolf_howl')
    }
    expect(essai(-1), 'témoin : dans la salle avec lui, le clan hurle').toBe(true)
    expect(essai(1), 'resté dehors, il n’apprend rien — Q3, et c’est un moment de jeu en moins').toBe(false)
  })

  // ─── Q4 · l'odorat s'arrête au plancher, le CHAMP du sang non ───────────────
  it('Q4 — la charogne de la salle n’attire pas le charognard du plateau', () => {
    const essai = (etageDuRenard: number): boolean => {
      const state = grotte()
      const CADAVRE = { x: CAP_X0 + 1.5, y: CAP_Y0 + 1.5 }
      const proie = spawnMonster(state, 'deer', CADAVRE.x, CADAVRE.y)
      const ep = state.entities.find((k) => k.id === proie)!
      ep.etage = -1
      const tueur = poser(state, { x: CADAVRE.x, y: CADAVRE.y + 1 }, -1)
      applyDamage(state, ep, 9999, tueur)
      const corpse = state.corpses.find((c) => c.x === CADAVRE.x && c.y === CADAVRE.y)
      expect(corpse, 'la prémisse : le cadavre est là, dans la salle').toBeDefined()
      expect(corpse!.etage, 'et il porte l’étage de sa mort').toBe(-1)
      // Un LOUP affamé, à portée de gueule de la charogne (`EAT_RANGE`) : c'est le seul
      // état où l'élection se LIT sur le monstre (`mealCorpseId`) plutôt qu'en marche.
      const loup = spawnMonster(state, 'wolf', CADAVRE.x + 1, CADAVRE.y)
      const ml = state.monsters.find((m) => m.entityId === loup)!
      const el = state.entities.find((k) => k.id === loup)!
      el.etage = etageDuRenard
      ml.faim = 1
      const dx = el.x - CADAVRE.x
      const dy = el.y - CADAVRE.y
      expect(Math.sqrt(dx * dx + dy * dy), 'la charogne est sous sa gueule')
        .toBeLessThan(FAUNA.EAT_RANGE)
      expect(state.tick - corpse!.diedAt, 'et elle est FRAÎCHE').toBeLessThan(HUNT.CARCASS_FRESH_TICKS)
      step(state, [])
      return state.monsters.find((m) => m.entityId === loup)!.mealCorpseId === corpse!.id
    }
    expect(essai(-1), 'témoin : dans la salle, il va au repas').toBe(true)
    expect(essai(1), 'd’un étage plus haut, il ne la sent pas — Q4').toBe(false)
  })

  // ─── Q6 · on ne boit pas un feu qu'on ne peut pas toucher ────────────────────
  it('Q6 — le Cendreux de la salle ne boit pas le feu libre de la terrasse', () => {
    const essai = (etageDuCendreux: number): number => {
      const state = grotte()
      const tx = CAP_X0 + 1
      const ty = CAP_Y0 + 1
      const fuel = makeInventory(FIRE.FUEL_SLOTS)
      addItems(fuel, { wood: 3 })
      const feu = { id: 9420, type: 'fire', tx, ty, villageId: 0, hp: 100, etage: 1, fuel, burnAt: state.tick, burnSlot: 0 }
      state.structures.push(feu as never)
      expect(fireState(state, feu as never), 'la prémisse : le feu BRÛLE').toBe('lit')
      const id = spawnMonster(state, 'cendreux', tx + 0.5, ty + 0.5)
      const corps = state.entities.find((k) => k.id === id)!
      corps.etage = etageDuCendreux
      const m = state.monsters.find((k) => k.entityId === id)!
      m.satiete = 0
      const dx = corps.x - (tx + 0.5)
      const dy = corps.y - (ty + 0.5)
      expect(dx * dx + dy * dy, 'la prémisse : il est DANS le contact')
        .toBeLessThan(CENDREUX.BOIRE.CONTACT * CENDREUX.BOIRE.CONTACT)
      advanceFire(state)
      return m.satiete ?? 0
    }
    expect(essai(1), 'témoin de la terrasse : au contact du feu, il boit').toBeGreaterThan(0)
    expect(essai(-1), 'sous le plancher, le feu du dessus ne se boit pas — Q6').toBe(0)
  })

  it('Q6 — la horde qui passe SOUS le Foyer n’en draine pas le stock', () => {
    const essai = (etageDuCendreux: number | null): number => {
      const state = grotte()
      const tx = CAP_X0 + 1
      const ty = CAP_Y0 + 1
      // ⚠ LE FOYER N'A PAS D'ÉTAGE (`Village` n'en porte pas) : il se tient au SOL de sa tuile,
      // et le sol de la mésa de labo est le palier 0 — la plaine SOUS le chapeau. Le témoin est
      // donc le buveur de la plaine, et le scellé celui de la salle (niveau −1, sans connecteur).
      const v = createVillage(state, { chiefId: 0, tx, ty, npcsArrived: true })
      expect(v.fuel, 'la prémisse : le Foyer a de quoi être bu').toBeGreaterThan(CENDREUX.BOIRE.FOYER_PLANCHER)
      expect(palierDuSol(state.map, tx, ty), 'la prémisse : le Foyer est au sol de la plaine').toBe(0)
      if (etageDuCendreux !== null) {
        const id = spawnMonster(state, 'cendreux', tx + 0.5, ty + 0.5)
        const corps = state.entities.find((k) => k.id === id)!
        if (etageDuCendreux !== 0) corps.etage = etageDuCendreux
        expect(niveauDuCorps(state.map, corps), 'la prémisse : le buveur est bien où on le veut').toBe(etageDuCendreux)
      }
      advanceUpkeep(state)
      return v.fuel
    }
    const sansPersonne = essai(null)
    expect(essai(0), 'témoin de la plaine : au contact du Foyer, la bouche draine').toBeLessThan(sansPersonne)
    expect(essai(-1), 'de la salle du dessous, elle ne draine rien — Q6').toBe(sansPersonne)
    expect(essai(1), 'et du chapeau au-dessus non plus — Q6').toBe(sansPersonne)
  })

  // ─── Q5 · l'interaction à portée : les neuf sites, en bloc ───────────────────
  it('Q5 — `near`, LE prédicat des PNJ : le coffre du pied ne se manipule pas du plateau', () => {
    const essai = (etageDuCorps: number): boolean => {
      const state = monde()
      const tx = Math.floor(BAS.x)
      const ty = Math.floor(BAS.y)
      const coffre = { id: 9500, type: 'chest', tx, ty, hp: 100, villageId: null, ownerId: null, access: 'public' }
      state.structures.push(coffre as never)
      const id = poser(state, etageDuCorps === 0 ? BAS : HAUT, etageDuCorps)
      const corps = state.entities.find((k) => k.id === id)!
      return near(state.map, corps, tx, ty, undefined)
    }
    expect(essai(0), 'témoin : au pied, le coffre est à portée').toBe(true)
    expect(essai(1), 'du plateau, la même tuile ne se manipule plus — Q5').toBe(false)
  })

  it('Q5 — la LIGNE ne se lance pas d’un étage à l’autre, et le DÉPEÇAGE ne s’y fait pas', () => {
    const ligne = (etageDuCorps: number): string | null => {
      const state = monde()
      const id = poser(state, etageDuCorps === 0 ? BAS : HAUT, etageDuCorps)
      grantItems(state, id, { crude_rod: 1 })
      const corps = state.entities.find((k) => k.id === id)!
      corps.activeSlot = corps.inventory.findIndex((sl) => sl !== null && sl.item === 'crude_rod')
      expect(corps.activeSlot, 'la prémisse : la canne est EN MAIN').toBeGreaterThanOrEqual(0)
      return castRejection(state, corps, Math.floor(BAS.x), Math.floor(BAS.y))
    }
    expect(ligne(0), 'témoin : au pied, la portée ne refuse rien').not.toBe('trop loin')
    expect(ligne(1), 'du plateau, l’eau du dessous est « trop loin » — Q5').toBe('trop loin')

    const depecage = (etageDuCorps: number): string | null => {
      const state = monde()
      const id = poser(state, etageDuCorps === 0 ? BAS : HAUT, etageDuCorps)
      const corps = state.entities.find((k) => k.id === id)!
      const carcasse = {
        id: 9501, x: BAS.x, y: BAS.y, inventory: [{ item: 'raw_meat', count: 2 }],
        decayAt: state.tick + COMBAT.CORPSE_TICKS, diedAt: state.tick, carcass: 'deer',
      }
      state.corpses.push(carcasse as never)
      return butcherRejection(state, corps, state.corpses.find((c) => c.id === 9501))
    }
    expect(depecage(0), 'témoin : au pied, la portée ne refuse rien').not.toBe('trop loin')
    expect(depecage(1), 'du plateau, la carcasse du dessous est hors d’atteinte — Q5').toBe('trop loin')
  })

  it('Q5 — un coin de chasse s’APPREND en le voyant, pas à travers un plancher', () => {
    const essai = (etageDuCorps: number): number => {
      const state = monde()
      state.grounds.push({ x: Math.floor(BAS.x), y: Math.floor(BAS.y) })
      const id = poser(state, etageDuCorps === 0 ? BAS : HAUT, etageDuCorps)
      const corps = state.entities.find((k) => k.id === id)!
      const dx = corps.x - state.grounds[0]!.x
      const dy = corps.y - state.grounds[0]!.y
      expect(dx * dx + dy * dy, 'la prémisse : le coin est DANS la vue de sol')
        .toBeLessThan(FAUNA.GROUND_SIGHT * FAUNA.GROUND_SIGHT)
      advanceCoinsConnus(state, [corps])
      return corps.knownGrounds?.length ?? 0
    }
    expect(essai(0), 'témoin : au pied, le coin s’apprend').toBe(1)
    expect(essai(1), 'du plateau, la clairière du dessous ne s’apprend pas — Q5').toBe(0)
  })

  it('Q5 — on ne BÂTIT pas quatre tuiles plus bas depuis le plateau', () => {
    const essai = (etageDuCorps: number): string | undefined => {
      const state = monde()
      const id = poser(state, etageDuCorps === 0 ? BAS : HAUT, etageDuCorps)
      const corps = state.entities.find((k) => k.id === id)!
      createVillage(state, { chiefId: id, tx: Math.floor(BAS.x), ty: Math.floor(BAS.y), npcsArrived: true })
      grantItems(state, id, { hammer: 1, wood: 20 })
      corps.activeSlot = corps.inventory.findIndex((sl) => sl !== null && sl.item === 'hammer')
      expect(corps.activeSlot, 'la prémisse : le marteau est EN MAIN').toBeGreaterThanOrEqual(0)
      const tx = Math.floor(BAS.x)
      const ty = Math.floor(BAS.y) + 1
      const dx = corps.x - (tx + 0.5)
      const dy = corps.y - (ty + 0.5)
      expect(dx * dx + dy * dy, 'la prémisse : la tuile est DANS `BUILD_RANGE`')
        .toBeLessThan(BALANCE.BUILD_RANGE * BALANCE.BUILD_RANGE)
      return evaluateBuild(state, id, 'wall', tx, ty).reason
    }
    expect(essai(0), 'témoin : au pied, la portée ne refuse rien').not.toBe('too_far')
    expect(essai(1), 'du plateau, la tuile du dessous est « too_far » — Q5').toBe('too_far')
  })
})
