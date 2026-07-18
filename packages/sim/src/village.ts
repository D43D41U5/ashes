/**
 * Le village — Feu, structures, propriété, actions (spec village).
 *
 * « Des serrures, pas des lois » (GDD §5) : le serveur fait respecter la
 * propriété et les permissions, les humains font la politique. Toute action
 * est validée ici, entièrement côté sim (portée, coût, permissions) — c'est
 * le début de la validation de vraisemblance anti-cheat (GDD §11). Une
 * action refusée émet `action_rejected` (feedback client, testabilité) ;
 * une action validée émet son événement de domaine.
 */
import { isOutsider, recordAct, recordHostility, seasonActFactor } from './alignment'
import {
  ALIGNMENT,
  BALANCE,
  COMBAT,
  COMPONENTS,
  COMPONENT_TYPES,
  FOOD_VALUES,
  SLOTS,
  STRUCTURE_COSTS,
  STRUCTURE_HP,
  TERRAINS,
  VILLAGE_NAMES,
  WALL_MATERIAL_ORDER,
  WALL_TIERS,
  WORLD_EVENTS,
  type ComponentType,
  type WallMaterial,
} from './balance'
import { blocksNavigation, placementKeepsNavigable, refreshFunctions } from './construction'
import { emitEvent } from './events'
import { chebyshev, distSq } from './geometry'
import {
  addItems,
  addSlot,
  countOf,
  hasItems,
  inventoryOf,
  isEmpty,
  makeInventory,
  pourSlot,
  removeItems,
  type AccessLevel,
  type Inventory,
  type ItemBag,
  type ItemId,
  type StructureType,
} from './items'
import { heldSlot } from './inventory-actions'
import { terrainAt, zoneAt } from './map'
import type { SimState } from './sim'

/** Sentinelle « jamais » pour les champs en ticks (finie : JSON-sérialisable). */
export const TICK_NEVER = -999999

export interface Structure {
  id: number
  type: StructureType
  tx: number
  ty: number
  /**
   * Le village auquel appartient la structure. `0` = AUCUN — le cas d'un feu de
   * camp planté au sol (`place_campfire`), qui n'est qu'une source de chaleur et
   * une station tant qu'on ne l'a pas promu en foyer (`found_village`). Les vrais
   * villages commencent à 1 (`nextVillageId`), donc 0 ne collisionne avec aucun.
   */
  villageId: number
  /** Le bâtisseur. 0 = le village lui-même (le Feu). */
  ownerId: number
  access: AccessLevel
  /** PV (spec événements R1) — les hordes frappent ce qui bloque. */
  hp: number
  /**
   * LE PALIER DE MATÉRIAU (spec construction R8) — mur/porte seulement : bois →
   * pierre → métal. Absent = bois (défaut) ou pièce sans palier. Améliorable sur
   * place au marteau (`upgrade_structure`) ; chaque palier monte les PV.
   */
  material?: WallMaterial
  /** Contenu, pour les structures-conteneurs (coffre). */
  inventory?: Inventory
}

export type TaskKind = 'gather_berries' | 'gather_wood' | 'gather_fiber' | 'cook_stew' | 'repair'

/** Une tâche du tableau du village (spec pnj R5). */
export interface VillageTask {
  id: number
  kind: TaskKind
  priority: number
  claimedBy: number | null
  /** Cible, pour les tâches localisées (réparer telle structure). */
  structureId?: number
}

export interface Village {
  id: number
  /** Une chronique exige des noms (spec saison R5). */
  name: string
  chiefId: number
  memberIds: number[]
  fireTx: number
  fireTy: number
  /**
   * LE PALIER DU FEU (spec construction R6) : 1→3. Il fixe la taille du carré
   * (`FIRE_RADIUS_BY_TIER[tier−1]`, R2) et débloque des types de composants (R6).
   * Le carré est réservé à sa taille MAX dès la fondation (validation R1), mais ne
   * s'ouvre à la pose qu'au fil des paliers.
   */
  tier: number
  /** Le tableau du village — généré par seuils, consommé par les PNJ (et bientôt lu par les joueurs). */
  tasks: VillageTask[]
  nextTaskId: number
  /** Les PNJ d'accueil sont-ils déjà arrivés ? (spec pnj R9) */
  npcsArrived: boolean
  /** Dernière alarme (spec événements R4 : une par vague) — TICK_NEVER si jamais. */
  lastAlarmAt: number
  /** Le Feu : agrégat des membres, recalculé périodiquement (spec alignement R5). */
  warmth: number
  engagement: number
  archetype: 'foyer' | 'meute' | 'neutre'
}

export type VillageAction =
  | { type: 'light_fire' }
  /**
   * JE POSE LE FEU DE CAMP QUE JE TIENS (tuile visée). Il devient une structure
   * `fire` SANS village (villageId 0) : chaleur + cuisine, rien d'autre. Fonder un
   * foyer est un choix séparé (`found_village`), qu'on fait en s'approchant.
   */
  | { type: 'place_campfire'; tx: number; ty: number }
  /**
   * JE FONDE UN FOYER sur un feu de camp déjà planté (le mien, à portée). Le feu
   * cesse d'être « libre » : il devient le Feu du village, et j'en suis le Chef.
   * Aucun PNJ n'arrive (décision utilisateur : le spawn d'accueil est retiré).
   */
  | { type: 'found_village'; structureId: number }
  | { type: 'repair'; structureId: number }
  | { type: 'give'; targetEntityId: number; item: ItemId; count: number }
  /**
   * JE POSE UNE BARRIÈRE (mur/porte/sol/toit/coffre), marteau en main. `material`
   * ne vaut que pour mur/porte (défaut bois, R8). Pose INSTANTANÉE (R15), dans le
   * carré du Feu (R2), sous réserve de l'invariant de navigabilité (R7).
   */
  | { type: 'build'; structure: Exclude<StructureType, 'fire'>; tx: number; ty: number; material?: WallMaterial }
  /**
   * JE POSE UN COMPOSANT TENU (enclume, four…) sur la tuile visée (spec construction
   * R20, flux feu de camp). L'objet se consomme et DEVIENT la structure ; GROUPÉ à
   * d'autres, il fait émerger une fonction (R9). Instantané (R15).
   */
  | { type: 'place_component'; tx: number; ty: number }
  /** JE MONTE LE FEU D'UN PALIER (spec construction R6) : le carré grandit, de
   *  nouveaux composants se débloquent. Coût croissant, plafonné à 3. */
  | { type: 'upgrade_fire' }
  /** J'AMÉLIORE UN MUR/PORTE SUR PLACE au marteau (spec construction R8) : palier de
   *  matériau suivant (bois→pierre→métal), en payant la « différence ». Instantané. */
  | { type: 'upgrade_structure'; structureId: number }
  | { type: 'demolish'; structureId: number }
  | { type: 'deposit'; structureId: number; item: ItemId; count: number }
  | { type: 'withdraw'; structureId: number; item: ItemId; count: number }
  | { type: 'set_access'; structureId: number; access: AccessLevel }
  | { type: 'invite'; targetEntityId: number }
  | { type: 'banish'; targetEntityId: number }

/** Défauts d'accès (spec village R10) : le coffre est à moi, la porte au village. */
const DEFAULT_ACCESS: Record<StructureType, AccessLevel> = {
  fire: 'village',
  wall: 'village',
  door: 'village',
  floor: 'village',
  roof: 'village',
  chest: 'private',
  workshop: 'village',
  furnace: 'village',
  house: 'village',
  enclume: 'village',
  four_acier: 'village',
  tour_meca: 'village',
  atelier_lourd: 'village',
}

export function structureAt(structures: Structure[], tx: number, ty: number): Structure | undefined {
  return structures.find((s) => s.tx === tx && s.ty === ty)
}

export function getVillageOf(state: SimState, entityId: number): Village | undefined {
  return state.villages.find((v) => v.memberIds.includes(entityId))
}

/** Le rayon (Chebyshev) du carré du Feu à ce palier (spec construction R2). */
export function fireRadius(tier: number): number {
  const byTier = BALANCE.FIRE_RADIUS_BY_TIER
  return byTier[Math.min(Math.max(tier, 1), byTier.length) - 1]!
}

/** Le rayon MAX du carré (palier 3) — celui que la fondation réserve (R1-R2). */
function fireRadiusMax(): number {
  const byTier = BALANCE.FIRE_RADIUS_BY_TIER
  return byTier[byTier.length - 1]!
}

/**
 * Un POI-SPÉCIFIQUE (spec construction R1) tombe-t-il dans le carré à taille max
 * autour de (cx, cy) ? Un POI-spécifique = une zone dotée d'un `kind` (chokepoint,
 * gisement, eau, tanière, ruine…) ; les toponymes et zones-régions (`kind`
 * absent) ne comptent PAS — les landmarks restent des communs contestés, on
 * s'installe ENTRE eux. Test d'intersection de rectangles en tuiles.
 */
function poiSpecificInSquare(state: SimState, cx: number, cy: number): boolean {
  const r = fireRadiusMax()
  const sx0 = cx - r
  const sx1 = cx + r
  const sy0 = cy - r
  const sy1 = cy + r
  for (const z of state.map.zones) {
    if (z.kind === undefined) continue // toponyme / zone-région : jamais bloquant
    const zx1 = z.x + z.w - 1
    const zy1 = z.y + z.h - 1
    if (z.x <= sx1 && zx1 >= sx0 && z.y <= sy1 && zy1 >= sy0) return true
  }
  return false
}

/** Une structure bloque-t-elle ce déplaceur ? (spec village R8) */
export function structureBlocks(s: Structure, moverVillageId: number | null): boolean {
  // La MAISON, on en franchit le seuil (on y entre). Le FEU, lui, a désormais un
  // hitbox : un foyer de braises sous les pieds, ça se CONTOURNE (décision
  // utilisateur) — on cuisine et on se chauffe en se tenant à côté, pas dessus.
  if (s.type === 'house') return false
  // Pièces MOLLES (spec construction R14) : sol et toit ne bloquent JAMAIS —
  // seuls les murs comptent, ce qui garde l'invariant de navigabilité simple.
  if (s.type === 'floor' || s.type === 'roof') return false
  if (s.type === 'door') return s.villageId !== moverVillageId
  return true
}

/** A-t-on accès à une structure ? La propriété prime sur tout (spec R10-R12). */
export function hasAccess(state: SimState, entityId: number, s: Structure): boolean {
  if (s.ownerId === entityId) return true
  if (s.access === 'public') return true
  if (s.access === 'village') return getVillageOf(state, entityId)?.id === s.villageId
  return false
}

/**
 * Ce qu'aucun sac ne peut absorber ne s'évapore pas : ça tombe au sol, en un tas
 * (un `Corpse`, le seul conteneur volatil du jeu) sur la tuile. Le sac du tas est
 * assez grand pour tout tenir (spec inventaire R11).
 */
export function spillOnGround(state: SimState, x: number, y: number, items: ItemBag, slots: Inventory = []): void {
  const pile = inventoryOf(SLOTS.CORPSE, items)
  // Les CASES tombent entières : une hache usée qui roule d'un coffre détruit ne
  // se relève pas neuve (l'usure vit dans la case, spec inventaire R6).
  for (const slot of slots) if (slot !== null) addSlot(pile, slot)
  state.corpses.push({
    id: state.nextCorpseId,
    x,
    y,
    inventory: pile,
    decayAt: state.tick + COMBAT.CORPSE_TICKS,
    diedAt: state.tick,
  })
  state.nextCorpseId += 1
}

/**
 * Transfère au plus `count` unités de `item`, et SEULEMENT ce qui tient à
 * destination. Retourne ce qui a réellement bougé (0 = rien ne rentre).
 *
 * CASE PAR CASE, dans l'ordre : la règle du versement (pousser d'abord, ne retirer
 * que ce qui a atterri, l'usure voyageant avec la case) vit dans `pourSlot`, et
 * NULLE PART AILLEURS. Ici on ne fait qu'ajouter le filtre « cet item-là, cette
 * quantité-là » dont `deposit`/`withdraw`/`give` ont besoin.
 */
function transferItems(from: Inventory, to: Inventory, item: ItemId, count: number): number {
  let remaining = Math.min(count, countOf(from, item))
  let moved = 0
  for (let i = 0; i < from.length && remaining > 0; i++) {
    const slot = from[i]
    if (!slot || slot.item !== item) continue
    const put = pourSlot(from, i, to, remaining)
    if (put <= 0) {
      // Une case usée qui ne trouve pas de case vide reste chez elle : on passe à
      // la suivante. Un empilable qui ne passe plus, lui, ne passera plus du tout.
      if (slot.wear !== undefined) continue
      break
    }
    moved += put
    remaining -= put
  }
  return moved
}

/**
 * Déposer de la nourriture au grenier d'un AUTRE village est un don (spec
 * alignement R11). La règle vit ICI, en un seul endroit : `deposit` s'en sert, et
 * le `transfer` case-à-case (inventory-actions.ts, spec inventaire R16) aussi.
 *
 * `count` est ce qui a RÉELLEMENT été déposé : on ne se fait pas créditer d'un
 * don qui n'a pas eu lieu, et `gift_given` (chronique, réputation) dit vrai.
 */
export function creditForeignDeposit(
  state: SimState,
  actorId: number,
  s: Structure,
  item: ItemId,
  count: number,
): void {
  if (count <= 0 || s.access !== 'village') return
  const foodValue = FOOD_VALUES[item]
  if (foodValue === undefined) return
  if (getVillageOf(state, actorId)?.id === s.villageId) return
  recordAct(
    state,
    actorId,
    foodValue * count * ALIGNMENT.FOREIGN_DEPOSIT_WARMTH_PER_FOOD * seasonActFactor(state),
  )
  emitEvent(state, {
    type: 'gift_given',
    tick: state.tick,
    byEntityId: actorId,
    toVillageId: s.villageId,
    item,
    count,
  })
}

/** Endommage une structure ; à 0 elle disparaît (spec événements R1). */
export function applyStructureDamage(state: SimState, structureId: number, damage: number, byEntityId = 0): void {
  const s = state.structures.find((st) => st.id === structureId)
  if (!s) return
  s.hp -= damage
  // Saboter la structure d'autrui est une hostilité (premier sang par sabotage).
  // Un feu de camp LIBRE (villageId 0) n'appartient à personne : le casser ne fait
  // de tort à aucun village, donc n'ouvre aucune hostilité.
  if (byEntityId !== 0 && s.villageId !== 0 && !state.monsters.some((m) => m.entityId === byEntityId)) {
    const actorVillage = getVillageOf(state, byEntityId)
    if (actorVillage && actorVillage.id !== s.villageId) {
      recordHostility(state, byEntityId, s.villageId)
    }
  }
  if (s.hp <= 0) {
    state.structures = state.structures.filter((st) => st.id !== structureId)
    // Un conteneur détruit répand son contenu (spec alignement R13).
    if (s.inventory && !isEmpty(s.inventory)) {
      spillOnGround(state, s.tx + 0.5, s.ty + 0.5, {}, s.inventory)
    }
    if (byEntityId !== 0 && s.villageId !== 0 && !state.monsters.some((m) => m.entityId === byEntityId)) {
      const actorVillage = getVillageOf(state, byEntityId)
      if (actorVillage && actorVillage.id !== s.villageId) {
        recordAct(state, byEntityId, ALIGNMENT.DESTROY_STRUCTURE_WARMTH)
      }
    }
    emitEvent(state, { type: 'structure_destroyed', tick: state.tick, structureId })
    // Détruire un composant fait retomber sa fonction ; un mur/toit, l'enceinte (R10).
    refreshFunctions(state)
  }
}

/**
 * Dev/test uniquement — remplacé par la récolte en V4 (spec R3).
 * À appeler dans la phase de setup, qui est rejouée par le replay.
 */
export function grantItems(state: SimState, entityId: number, items: ItemBag): void {
  const entity = state.entities.find((e) => e.id === entityId)
  if (entity) addItems(entity.inventory, items)
}

/** Options de `createVillage` — le seul littéral `Village` de la sim. */
export interface CreateVillageOptions {
  /** 0 = pas de chef humain : le village s'appartient (villages PNJ). */
  chiefId: number
  tx: number
  ty: number
  /** true si l'appelant peuple lui-même — sinon les PNJ d'accueil arrivent (spec pnj R9). */
  npcsArrived: boolean
}

/**
 * Fonde un village : le pousse dans l'état et émet `village_founded`.
 * Partagé entre `light_fire` (Feu humain) et `foundNpcVillage` (peuplement).
 */
export function createVillage(state: SimState, opts: CreateVillageOptions): Village {
  const villageId = state.nextVillageId
  state.nextVillageId += 1
  const village: Village = {
    id: villageId,
    name: VILLAGE_NAMES[(villageId - 1) % VILLAGE_NAMES.length]!,
    chiefId: opts.chiefId,
    memberIds: opts.chiefId === 0 ? [] : [opts.chiefId],
    fireTx: opts.tx,
    fireTy: opts.ty,
    tier: 1,
    tasks: [],
    nextTaskId: 1,
    npcsArrived: opts.npcsArrived,
    lastAlarmAt: TICK_NEVER,
    warmth: 0,
    engagement: 0,
    archetype: 'neutre',
  }
  state.villages.push(village)
  emitEvent(state, {
    type: 'village_founded',
    tick: state.tick,
    villageId,
    chiefId: opts.chiefId,
    tx: opts.tx,
    ty: opts.ty,
  })
  return village
}

export function applyVillageAction(state: SimState, actorId: number, action: VillageAction): void {
  const actor = state.entities.find((e) => e.id === actorId)
  if (!actor) return
  const reject = (reason: string): void => {
    emitEvent(state, { type: 'action_rejected', tick: state.tick, entityId: actorId, reason })
  }

  switch (action.type) {
    /**
     * ALLUMER + FONDER d'un seul geste, à ses pieds, à partir de bois brut : le
     * RACCOURCI de test et de worldgen — le jumeau de `foundNpcVillage` (PNJ
     * d'accueil compris). Le JOUEUR, lui, ne passe PLUS par ici : la ceinture
     * fabrique l'OBJET feu de camp, qu'on POSE (`place_campfire` → un feu libre)
     * puis qu'on peut PROMOUVOIR en foyer (`found_village`, SANS PNJ). Le panneau
     * d'artisanat n'émet plus `light_fire` — il reste hors de portée du joueur.
     */
    case 'light_fire': {
      const tx = Math.floor(actor.x)
      const ty = Math.floor(actor.y)
      if (getVillageOf(state, actorId)) return reject('déjà membre d’un village')
      if (!hasItems(actor.inventory, STRUCTURE_COSTS.fire)) return reject('matériaux insuffisants')
      if (zoneAt(state.map, actor.x, actor.y)) return reject('les landmarks sont inconstructibles')
      if (!TERRAINS[terrainAt(state.map, tx, ty)]?.walkable) return reject('terrain inconstructible')
      if (structureAt(state.structures, tx, ty)) return reject('tuile occupée')
      const min = BALANCE.FIRE_MIN_DISTANCE
      if (state.villages.some((v) => chebyshev(v.fireTx, v.fireTy, tx, ty) < min)) {
        return reject('trop proche d’un autre Feu')
      }
      // NB : `light_fire` reste le RACCOURCI de test/worldgen — il ne joue PAS le
      // garde-fou R1 des POI-dans-le-carré (réservé au flux joueur `found_village`).
      removeItems(actor.inventory, STRUCTURE_COSTS.fire)
      const village = createVillage(state, { chiefId: actorId, tx, ty, npcsArrived: false })
      addStructure(state, 'fire', tx, ty, village.id, 0)
      return
    }

    /**
     * POSER LE FEU DE CAMP TENU sur la tuile visée : une structure `fire` LIBRE
     * (villageId 0), rien de plus — chaleur et cuisine. Pas de village, pas de PNJ.
     * L'objet tenu se consomme et DEVIENT la structure. Fonder un foyer est un choix
     * séparé, qu'on prend ensuite en s'approchant (`found_village`).
     */
    case 'place_campfire': {
      const { tx, ty } = action
      if (!Number.isInteger(tx) || !Number.isInteger(ty)) return reject('case invalide')
      const held = heldSlot(actor)
      if (held?.item !== 'campfire') return reject('il faut un feu de camp en main')
      // À portée de bras — pas à l'autre bout de la carte (vraisemblance, GDD §11).
      if (distSq(actor.x, actor.y, tx + 0.5, ty + 0.5) > BALANCE.BUILD_RANGE * BALANCE.BUILD_RANGE) {
        return reject('trop loin')
      }
      // Le Feu BLOQUE : le poser SOUS SES PIEDS, ce serait s'emmurer dans les
      // braises. On le plante devant soi, jamais dessous.
      if (Math.floor(actor.x) === tx && Math.floor(actor.y) === ty) return reject('pas sous ses pieds')
      if (zoneAt(state.map, tx + 0.5, ty + 0.5)) return reject('les landmarks sont inconstructibles')
      if (!TERRAINS[terrainAt(state.map, tx, ty)]?.walkable) return reject('terrain inconstructible') // eau, roche…
      // TUILE LIBRE, au sens LARGE (décision utilisateur) : ni structure, ni ressource
      // (arbre, filon, buisson…), ni personne (animal, PNJ, autre joueur) dessus. On ne
      // pose pas un foyer sur ce qui est déjà là.
      if (structureAt(state.structures, tx, ty)) return reject('tuile occupée')
      if (state.nodes.some((n) => n.tx === tx && n.ty === ty)) return reject('tuile occupée')
      if (state.entities.some((e) => e.id !== actorId && e.hp > 0 && Math.floor(e.x) === tx && Math.floor(e.y) === ty)) {
        return reject('tuile occupée')
      }
      // L'objet tenu se consomme (une unité) : il DEVIENT la structure.
      held.count -= 1
      if (held.count <= 0) actor.inventory[actor.activeSlot] = null
      // villageId 0 = feu libre ; le poseur en est propriétaire (il cuisine, il démolit).
      addStructure(state, 'fire', tx, ty, 0, actorId)
      return
    }

    /**
     * PROMOUVOIR un feu de camp libre en FOYER. Le feu (le mien, à portée) cesse
     * d'être libre : il prend le villageId du village qu'on fonde, dont je suis le
     * Chef. AUCUN PNJ d'accueil (`npcsArrived: true`) — décision utilisateur.
     */
    case 'found_village': {
      if (getVillageOf(state, actorId)) return reject('déjà un foyer')
      const s = state.structures.find((st) => st.id === action.structureId)
      if (!s || s.type !== 'fire') return reject('pas un feu')
      if (s.villageId !== 0) return reject('ce feu est déjà un foyer')
      if (s.ownerId !== actorId) return reject('ce n’est pas votre feu')
      const range = BALANCE.INTERACT_RANGE
      if (distSq(actor.x, actor.y, s.tx + 0.5, s.ty + 0.5) > range * range) return reject('trop loin')
      // Fondation R1 : ≥ 2·R_max (Chebyshev) d'un autre Feu — zéro chevauchement des carrés.
      const min = BALANCE.FIRE_MIN_DISTANCE
      if (state.villages.some((v) => chebyshev(v.fireTx, v.fireTy, s.tx, s.ty) < min)) {
        return reject('trop proche d’un autre Feu')
      }
      // …et aucun POI-spécifique dans le carré à taille max (les landmarks restent des communs).
      if (poiSpecificInSquare(state, s.tx, s.ty)) return reject('un landmark tombe dans le carré')
      const village = createVillage(state, { chiefId: actorId, tx: s.tx, ty: s.ty, npcsArrived: true })
      // Le feu libre DEVIENT le Feu du village : il change d'appartenance et passe
      // au village lui-même (ownerId 0 — un Feu n'a pas de maître privé, et ne se démolit pas).
      s.villageId = village.id
      s.ownerId = 0
      s.access = 'village'
      return
    }

    case 'build': {
      const village = getVillageOf(state, actorId)
      if (!village) return reject('sans village — allumer un Feu d’abord')
      // LE MARTEAU FAIT LE BÂTISSEUR (spec recolte.md G12, construction R19-R20).
      // L'outil doit être EN MAIN : bâtir est un métier qu'on s'équipe, et le clic
      // nu ne peut plus poser un mur par accident. (Les COMPOSANTS, eux, se posent
      // en tenant l'objet — flux feu de camp, tranche 2.)
      if (heldSlot(actor)?.item !== 'hammer') return reject('il faut le marteau de construction en main')
      const { tx, ty } = action
      if (!Number.isInteger(tx) || !Number.isInteger(ty)) return reject('case invalide')
      // LE CARRÉ ×PALIER (spec construction R2) : Chebyshev(tuile, Feu) ≤ R(palier).
      if (chebyshev(village.fireTx, village.fireTy, tx, ty) > fireRadius(village.tier)) {
        return reject('hors du carré du Feu')
      }
      // Vraisemblance (GDD §11) : on bâtit à portée de bras, pas à l'autre
      // bout de la carte — première pierre de l'anti-cheat LAN.
      if (distSq(actor.x, actor.y, tx + 0.5, ty + 0.5) > BALANCE.BUILD_RANGE * BALANCE.BUILD_RANGE) {
        return reject('trop loin')
      }
      if (!TERRAINS[terrainAt(state.map, tx, ty)]?.walkable) return reject('terrain inconstructible')
      if (structureAt(state.structures, tx, ty)) return reject('tuile occupée')
      // RÉCOLTER = DÉFRICHER (spec construction R5) : on ne bâtit que sur tuile
      // ouverte ; pour bâtir où pousse un nœud, on l'abat d'abord.
      if (state.nodes.some((n) => n.tx === tx && n.ty === ty)) return reject('un nœud occupe la tuile')
      // LE PALIER DE MATÉRIAU (R8) : mur/porte seulement, défaut bois. Le coût suit.
      const structure = action.structure
      const isWallLike = structure === 'wall' || structure === 'door'
      const material = isWallLike ? action.material : undefined
      const cost = material && isWallLike ? WALL_TIERS[material][structure].cost : STRUCTURE_COSTS[structure]
      // L'INVARIANT DE NAVIGABILITÉ (R7) : on refuse une pose qui muraille le Feu, isole
      // un composant ou piège un PNJ. Vérifié AVANT de débiter (un rejet ne coûte rien).
      if (blocksNavigation(structure)) {
        const ok = placementKeepsNavigable(
          state.map,
          state.structures,
          state.entities,
          actorId,
          { tx: village.fireTx, ty: village.fireTy },
          fireRadius(village.tier),
          { tx, ty, type: structure },
        )
        if (!ok) return reject('cela couperait le passage')
      }
      if (!removeItems(actor.inventory, cost)) return reject('matériaux insuffisants')
      addStructure(state, structure, tx, ty, village.id, actorId, DEFAULT_ACCESS[structure], material)
      return
    }

    /**
     * POSER LE COMPOSANT TENU (spec construction R20, flux feu de camp). L'objet en
     * main (enclume, four…) se consomme et DEVIENT la structure ; groupé, il fait
     * émerger une fonction (R9). Dans le carré du Feu (R2), sous le palier qui le
     * débloque (R6), sous réserve de navigabilité (R7). Instantané (R15).
     */
    case 'place_component': {
      const village = getVillageOf(state, actorId)
      if (!village) return reject('sans village — fonder un foyer d’abord')
      const held = heldSlot(actor)
      if (!held || !(COMPONENT_TYPES as readonly string[]).includes(held.item)) {
        return reject('il faut un composant en main')
      }
      const comp = held.item as ComponentType
      const { tx, ty } = action
      if (!Number.isInteger(tx) || !Number.isInteger(ty)) return reject('case invalide')
      // LE PALIER DU FEU débloque les composants (spec construction R6).
      if (COMPONENTS[comp].unlockTier > village.tier) return reject('composant verrouillé (palier du Feu)')
      if (chebyshev(village.fireTx, village.fireTy, tx, ty) > fireRadius(village.tier)) return reject('hors du carré du Feu')
      if (distSq(actor.x, actor.y, tx + 0.5, ty + 0.5) > BALANCE.BUILD_RANGE * BALANCE.BUILD_RANGE) return reject('trop loin')
      // Un composant BLOQUE : pas sous ses pieds (on s'y emmurerait), comme le Feu.
      if (Math.floor(actor.x) === tx && Math.floor(actor.y) === ty) return reject('pas sous ses pieds')
      if (!TERRAINS[terrainAt(state.map, tx, ty)]?.walkable) return reject('terrain inconstructible')
      if (structureAt(state.structures, tx, ty)) return reject('tuile occupée')
      if (state.nodes.some((n) => n.tx === tx && n.ty === ty)) return reject('un nœud occupe la tuile')
      // Invariant de navigabilité (R7) : un composant bloque, comme un mur.
      const ok = placementKeepsNavigable(
        state.map,
        state.structures,
        state.entities,
        actorId,
        { tx: village.fireTx, ty: village.fireTy },
        fireRadius(village.tier),
        { tx, ty, type: comp },
      )
      if (!ok) return reject('cela couperait le passage')
      // L'objet tenu se consomme (une unité) : il DEVIENT la structure.
      held.count -= 1
      if (held.count <= 0) actor.inventory[actor.activeSlot] = null
      addStructure(state, comp, tx, ty, village.id, actorId)
      return
    }

    /**
     * MONTER LE FEU D'UN PALIER (spec construction R6). Seul le Chef, à portée du
     * Feu, en payant le coût du palier visé. Le carré grandit (R2) et de nouveaux
     * types de composants se débloquent. Plafonné à 3.
     */
    case 'upgrade_fire': {
      const village = getVillageOf(state, actorId)
      if (!village || village.chiefId !== actorId) return reject('seul le Chef monte le Feu')
      if (village.tier >= BALANCE.FIRE_RADIUS_BY_TIER.length) return reject('palier maximal atteint')
      const range = BALANCE.INTERACT_RANGE
      if (distSq(actor.x, actor.y, village.fireTx + 0.5, village.fireTy + 0.5) > range * range) return reject('trop loin du Feu')
      const cost = BALANCE.FIRE_UPGRADE_COST[village.tier]
      if (cost === undefined) return reject('palier maximal atteint')
      if (!removeItems(actor.inventory, cost)) return reject('matériaux insuffisants')
      village.tier += 1
      emitEvent(state, { type: 'fire_upgraded', tick: state.tick, villageId: village.id, tier: village.tier })
      return
    }

    /**
     * AMÉLIORER UN MUR/PORTE SUR PLACE (spec construction R8) : palier de matériau
     * suivant (bois→pierre→métal), en payant la « différence » (`WALL_TIERS.upgrade`).
     * Instantané, marteau en main. Les PV montent au plafond du nouveau palier.
     */
    case 'upgrade_structure': {
      if (heldSlot(actor)?.item !== 'hammer') return reject('il faut le marteau de construction en main')
      const s = state.structures.find((st) => st.id === action.structureId)
      if (!s || (s.type !== 'wall' && s.type !== 'door')) return reject('rien à améliorer ici')
      if (s.ownerId !== actorId && getVillageOf(state, actorId)?.id !== s.villageId) return reject('pas votre village')
      const range = BALANCE.BUILD_RANGE
      if (distSq(actor.x, actor.y, s.tx + 0.5, s.ty + 0.5) > range * range) return reject('trop loin')
      const current = s.material ?? 'wood'
      const next = WALL_MATERIAL_ORDER[WALL_MATERIAL_ORDER.indexOf(current) + 1]
      if (next === undefined) return reject('palier de matériau maximal')
      if (!removeItems(actor.inventory, WALL_TIERS[next].upgrade)) return reject('matériaux insuffisants')
      const currentMax = current === 'wood' ? STRUCTURE_HP[s.type] : WALL_TIERS[current][s.type].hp
      const wasMax = s.hp >= currentMax
      s.material = next
      const newMax = WALL_TIERS[next][s.type].hp
      // Un mur intact monte à son nouveau plafond ; un mur entamé garde ses dégâts
      // (on renforce, on ne répare pas gratuitement).
      s.hp = wasMax ? newMax : Math.min(s.hp, newMax)
      emitEvent(state, { type: 'structure_upgraded', tick: state.tick, structureId: s.id, material: next })
      return
    }

    case 'repair': {
      if (state.tick < actor.cooldownUntil) return reject('trop tôt')
      const s = state.structures.find((st) => st.id === action.structureId)
      if (!s) return reject('structure inconnue')
      // Réparer exige d'en être : membre du village de la structure, OU son
      // PROPRIÉTAIRE — un feu de camp libre (villageId 0) n'a que son poseur.
      if (s.ownerId !== actorId && getVillageOf(state, actorId)?.id !== s.villageId) {
        return reject('pas votre village')
      }
      const max = STRUCTURE_HP[s.type]
      if (s.hp >= max) return reject('rien à réparer')
      const range = BALANCE.INTERACT_RANGE
      if (distSq(actor.x, actor.y, s.tx + 0.5, s.ty + 0.5) > range * range) return reject('trop loin')
      if (!removeItems(actor.inventory, { wood: WORLD_EVENTS.REPAIR_WOOD_COST })) return reject('il faut du bois')
      s.hp = Math.min(max, s.hp + WORLD_EVENTS.REPAIR_HP)
      actor.cooldownUntil = state.tick + BALANCE.GATHER_COOLDOWN_TICKS
      emitEvent(state, { type: 'structure_repaired', tick: state.tick, structureId: s.id, byEntityId: actorId })
      return
    }

    case 'demolish': {
      const s = state.structures.find((st) => st.id === action.structureId)
      if (!s) return reject('structure inconnue')
      // Le Feu D'UN VILLAGE ne s'éteint pas (défaire un foyer est un chantier à part).
      // Un feu de camp LIBRE (villageId 0), lui, se démonte comme le reste : son poseur
      // le récupère (à moitié) — c'est un objet de survie, pas un foyer.
      if (s.type === 'fire' && s.villageId !== 0) return reject('un Feu ne s’éteint pas')
      const village = state.villages.find((v) => v.id === s.villageId)
      if (s.ownerId !== actorId && village?.chiefId !== actorId) {
        return reject('ni propriétaire ni Chef')
      }
      if (distSq(actor.x, actor.y, s.tx + 0.5, s.ty + 0.5) > BALANCE.BUILD_RANGE * BALANCE.BUILD_RANGE) {
        return reject('trop loin')
      }
      const refund: ItemBag = {}
      // Un mur de pierre rembourse de la pierre, pas du bois : le coût suit le palier
      // de matériau réellement investi (spec construction R8).
      const cost =
        (s.type === 'wall' || s.type === 'door') && s.material
          ? WALL_TIERS[s.material][s.type].cost
          : STRUCTURE_COSTS[s.type]
      for (const item of Object.keys(cost) as ItemId[]) {
        const back = Math.floor((cost[item] ?? 0) * BALANCE.DEMOLISH_REFUND)
        if (back > 0) refund[item] = back
      }
      // Le remboursement va au PROPRIÉTAIRE (le Chef peut démolir, pas spolier).
      // Son sac est borné, et il peut même n'être pas là : ce qu'il ne prend pas
      // se répand sur la tuile démolie, comme le contenu d'un conteneur détruit.
      const owner = state.entities.find((e) => e.id === s.ownerId)
      const spill = addItems((owner ?? actor).inventory, refund)
      // Un conteneur DÉMOLI répand son contenu, exactement comme un conteneur
      // DÉTRUIT par les dégâts (applyStructureDamage) : c'est le même fait de jeu
      // — la structure s'en va — donc c'est la même règle. Le même tas au sol
      // reçoit le reliquat du remboursement et le contenu du coffre.
      const content = s.inventory ?? []
      if (Object.keys(spill).length > 0 || !isEmpty(content)) {
        spillOnGround(state, s.tx + 0.5, s.ty + 0.5, spill, content)
      }
      state.structures = state.structures.filter((st) => st.id !== s.id)
      emitEvent(state, { type: 'structure_removed', tick: state.tick, structureId: s.id })
      // Démolir un composant fait RETOMBER le palier de sa fonction (spec R10, R18).
      refreshFunctions(state)
      return
    }

    case 'deposit':
    case 'withdraw': {
      if (!Number.isInteger(action.count) || action.count <= 0) return reject('quantité invalide')
      const s = state.structures.find((st) => st.id === action.structureId)
      if (!s || s.inventory === undefined) return reject('pas un conteneur')
      const range = BALANCE.INTERACT_RANGE
      if (distSq(actor.x, actor.y, s.tx + 0.5, s.ty + 0.5) > range * range) return reject('trop loin')
      // Le dépôt est ouvert à tous (la boîte aux dons, spec alignement R11) ;
      // seul le RETRAIT exige l'accès.
      if (action.type === 'withdraw' && !hasAccess(state, actorId, s)) return reject('accès refusé')
      const [from, to] =
        action.type === 'deposit' ? [actor.inventory, s.inventory] : [s.inventory, actor.inventory]
      if (countOf(from, action.item) < action.count) return reject('stock insuffisant')
      // La destination est BORNÉE : on ne transfère que ce qui rentre, le reste
      // reste à la source. Si rien ne rentre, l'action n'a pas lieu — et le PNJ
      // qui la tentait doit le voir (sinon il la retenterait à chaque tick).
      const moved = transferItems(from, to, action.item, action.count)
      if (moved === 0) return reject('destination pleine')
      if (action.type === 'deposit') creditForeignDeposit(state, actorId, s, action.item, moved)
      return
    }

    case 'give': {
      if (!Number.isInteger(action.count) || action.count <= 0) return reject('quantité invalide')
      const target = state.entities.find((e) => e.id === action.targetEntityId)
      if (!target || target.id === actorId) return reject('cible inconnue')
      if (state.monsters.some((m) => m.entityId === target.id)) return reject('cible inconnue')
      const range = BALANCE.INTERACT_RANGE
      if (distSq(actor.x, actor.y, target.x, target.y) > range * range) return reject('trop loin')
      if (countOf(actor.inventory, action.item) < action.count) return reject('stock insuffisant')
      // Le sac de la cible est borné : on ne donne que ce qui rentre.
      const given = transferItems(actor.inventory, target.inventory, action.item, action.count)
      if (given === 0) return reject('le sac de la cible est plein')
      // L'acte chaud fondamental : pondéré par la faim UTILE du receveur (spec R2)
      // et par ce qui a VRAIMENT changé de mains.
      const foodValue = FOOD_VALUES[action.item]
      if (foodValue !== undefined && isOutsider(state, actorId, target.id)) {
        const useful = Math.min(foodValue * given, 100 - target.hunger)
        const need = target.hunger < 30 ? ALIGNMENT.NEED_FACTOR : 1
        recordAct(state, actorId, useful * ALIGNMENT.GIVE_WARMTH_PER_HUNGER * need * seasonActFactor(state))
        const toVillage = getVillageOf(state, target.id)
        emitEvent(state, {
          type: 'gift_given',
          tick: state.tick,
          byEntityId: actorId,
          toVillageId: toVillage?.id ?? 0,
          item: action.item,
          count: given,
        })
      }
      return
    }

    case 'set_access': {
      const s = state.structures.find((st) => st.id === action.structureId)
      if (!s) return reject('structure inconnue')
      if (s.ownerId !== actorId) return reject('pas le propriétaire')
      const range = BALANCE.INTERACT_RANGE
      if (distSq(actor.x, actor.y, s.tx + 0.5, s.ty + 0.5) > range * range) return reject('trop loin')
      if (s.access === action.access) return
      s.access = action.access
      // Changer une serrure est un fait de gouvernance (réputation, tribunal).
      emitEvent(state, {
        type: 'access_changed',
        tick: state.tick,
        structureId: s.id,
        access: action.access,
        byEntityId: actorId,
      })
      return
    }

    case 'invite': {
      const village = getVillageOf(state, actorId)
      if (!village || village.chiefId !== actorId) return reject('seul le Chef invite')
      const target = state.entities.find((e) => e.id === action.targetEntityId)
      if (!target) return reject('cible inconnue')
      if (getVillageOf(state, target.id)) return reject('déjà membre d’un village')
      const range = BALANCE.INTERACT_RANGE
      if (distSq(actor.x, actor.y, target.x, target.y) > range * range) return reject('trop loin')
      village.memberIds.push(target.id)
      emitEvent(state, { type: 'member_joined', tick: state.tick, villageId: village.id, entityId: target.id })
      return
    }

    case 'banish': {
      const village = getVillageOf(state, actorId)
      if (!village || village.chiefId !== actorId) return reject('seul le Chef bannit')
      if (action.targetEntityId === village.chiefId) return reject('le Chef ne se bannit pas')
      if (!village.memberIds.includes(action.targetEntityId)) return reject('pas un membre')
      village.memberIds = village.memberIds.filter((id) => id !== action.targetEntityId)
      emitEvent(state, {
        type: 'member_banished',
        tick: state.tick,
        villageId: village.id,
        entityId: action.targetEntityId,
      })
      return
    }
  }
}

/**
 * Bâtit une structure : la pousse dans l'état et émet `structure_built`.
 * `access` permet aux villages PNJ d'ouvrir leur grenier (`village` au lieu
 * du défaut `private` du coffre) — sinon DEFAULT_ACCESS (spec R10).
 */
export function addStructure(
  state: SimState,
  type: StructureType,
  tx: number,
  ty: number,
  villageId: number,
  ownerId: number,
  access: AccessLevel = DEFAULT_ACCESS[type],
  /** Palier de matériau (spec construction R8) — mur/porte seulement ; défaut bois. */
  material?: WallMaterial,
): Structure {
  const id = state.nextStructureId
  state.nextStructureId += 1
  // Le Foyer bâtit plus solide (spec alignement R8).
  const village = state.villages.find((v) => v.id === villageId)
  const hpBonus = village?.archetype === 'foyer' ? ALIGNMENT.FOYER_STRUCTURE_HP_BONUS : 1
  const isWallLike = type === 'wall' || type === 'door'
  const baseHp = material && isWallLike ? WALL_TIERS[material][type].hp : STRUCTURE_HP[type]
  const structure: Structure = {
    id,
    type,
    tx,
    ty,
    villageId,
    ownerId,
    access,
    hp: Math.floor(baseHp * hpBonus),
  }
  // On ne stocke le matériau que s'il n'est pas le défaut (bois) : snapshot léger,
  // et `s.material ?? 'wood'` fait foi partout (upgrade, démolition, PV).
  if (material && material !== 'wood' && isWallLike) structure.material = material
  if (type === 'chest') structure.inventory = makeInventory(SLOTS.CHEST)
  state.structures.push(structure)
  emitEvent(state, {
    type: 'structure_built',
    tick: state.tick,
    structureId: id,
    structure: type,
    villageId,
    ownerId,
    tx,
    ty,
  })
  // La pose peut faire ÉMERGER ou monter une fonction (composant), ou fermer une
  // enceinte (mur/toit) : on recalcule et on émet les changements (spec R9-R10).
  refreshFunctions(state)
  return structure
}
