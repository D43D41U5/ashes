/**
 * Noyau de la simulation : état + boucle de tick à pas fixe.
 *
 * Contrat de déterminisme : `step(state, inputs)` est une fonction pure du
 * point de vue de l'extérieur — même état + mêmes inputs = même état suivant,
 * sur n'importe quelle machine. Tout le multi, le replay log et les tests
 * headless reposent sur ce contrat.
 *
 * L'état est un objet JSON-sérialisable (pas de classes, pas de Map) pour
 * que snapshot = JSON.stringify et que le transport Worker/réseau soit
 * trivial.
 */
import { BALANCE, COMBAT, SLOTS, TERRAIN_GRASS, TICK_DT_S } from './balance'
import { moveAvatar } from './collision'
import { advanceCombat, applyCombatAction, type CombatAction, type Corpse } from './combat'
import { advanceCendreux } from './cendreux'
import { applyDebugAction, isDebugAction, refreshGodMode, type DebugAction } from './debug'
import { advanceEconomy, applyEconomyAction, type EconomyAction, type ResourceNode } from './economy'
import { emitEvent, type SimEvent } from './events'
import { makeInventory, type Inventory, type ItemId, type SkillId } from './items'
import { createEmptyMap, type WorldMap } from './map'
import { advanceAlignment, type Aggression } from './alignment'
import { advanceMonsters, type Monster } from './monsters'
import { advanceWorldEvents, type Horde } from './worldevents'
import { rngNext } from './rng'
import { advanceNpcs, type Npc } from './npc'
import { advancePois } from './poi-discovery'
import { advanceDens } from './poi'
import { advanceTime, DAY_TICKS_PER_CYCLE, TICKS_PER_CYCLE } from './time'
import { advanceTemperature, coldSpeedFactor } from './temperature'
import { applyVillageAction, getVillageOf, type VillageAction, type Structure, type Village } from './village'

/**
 * L'union des actions possibles dans un tick (village + économie + combat).
 * `DebugAction` en fait partie pour transiter par le même canal (et donc être
 * capturée par le replay log), mais elle est INERTE hors sim de debug — voir
 * `debug.ts`, garde `state.debug`.
 */
export type PlayerAction = VillageAction | EconomyAction | CombatAction | DebugAction

export interface Entity {
  id: number
  /** Position du centre, en tuiles (déplacement continu, spec monde R5). */
  x: number
  y: number
  inventory: Inventory
  /** Jauge 0-100. À 0 : vitesse ÷2 (spec économie R7-R8). */
  hunger: number
  /** Jauge 0-100 (spec température). 100 = au chaud, 0 = gelé (hypothermie). */
  temperature: number
  /** XP par métier (niveau dérivé — voir skillLevel). */
  skills: Partial<Record<SkillId, number>>
  /** Usure agrégée par type d'outil (spec économie R6). */
  wear: Partial<Record<ItemId, number>>
  /** Tick avant lequel récolte/craft sont refusés (rythme borné). */
  cooldownUntil: number
  /** Combat (spec combat R1-R7). */
  hp: number
  stamina: number
  wounds: { leg?: true; arm?: true; bleeding?: true }
  facing: { x: number; y: number }
  blocking: boolean
  /** A bougé ce tick (module la régén d'endurance). */
  moved: boolean
  exhaustedUntil: number
  windup?: { dx: number; dy: number; ticksLeft: number; damage?: number; structureId?: number }
  /** Point de respawn hors village (position d'apparition). */
  homeX: number
  homeY: number
  /** Alignement personnel (GDD §3) : chaleur −100..+100, engagement 0..100. */
  warmth: number
  engagement: number
  /** DEV seulement : invulnérable, jauges gelées (voir debug.ts). */
  god?: true
  /**
   * Les lieux connus de ce joueur (spec lieux R3) — index dans `map.zones`.
   * Un tableau, pas un `Set` : l'état de sim reste JSON-sérialisable.
   * Présent sur toutes les entités (forme uniforme = snapshot stable), mais
   * SEULS LES JOUEURS l'alimentent : les PNJ n'ont pas de carte.
   */
  knownPois: number[]
  /**
   * Les lieux ATTEINTS (foulés) par ce joueur. Distinct de `knownPois` : depuis
   * que la découverte se fait à VUE, on connaît un lieu avant d'y avoir mis les
   * pieds — `knownPois` ne peut donc plus servir de garde à la charge. Ce qu'on
   * a vu ≠ ce qu'on a atteint, et seul l'atteindre paye.
   */
  reachedPois: number[]
}

export interface SimState {
  /** Numéro de tick — l'unique notion de temps dans /sim. */
  tick: number
  /** Seed d'origine, conservée pour l'en-tête du replay log. */
  seed: number
  /** État courant du PRNG (avance à chaque tirage). */
  rngState: number
  /** Jours de saison écoulés par jour réel (1 en multi, libre en Veillée/test). */
  calendarScale: number
  /**
   * Décalage de PHASE du cycle jour/nuit, en ticks (0 = le cycle démarre à
   * l'aube). N'affecte QUE le cycle diégétique, jamais le calendrier de saison —
   * permet de commencer une partie à une heure donnée (ex. minuit pour tester la
   * nuit). Voir `cycleOffsetForStartHour` (time.ts).
   */
  cycleOffset: number
  map: WorldMap
  nextEntityId: number
  entities: Entity[]
  villages: Village[]
  structures: Structure[]
  nodes: ResourceNode[]
  npcs: Npc[]
  monsters: Monster[]
  corpses: Corpse[]
  nextCorpseId: number
  hordes: Horde[]
  nextHordeId: number
  lastConvoyDay: number
  /** Mémoire d'agression entre villages (premier sang, spec alignement R4). */
  aggressions: Aggression[]
  /** La saison (spec saison) : méga-horde tirée, évacuation ouverte, fin émise. */
  megaHordeSpawned: boolean
  evacuation: { tx: number; ty: number } | null
  /** Lieux déjà atteints par un joueur, tous joueurs confondus (spec lieux R12).
   *  Global : il n'y a qu'un premier — en multi, c'est une course. */
  visitedPois: number[]
  seasonEnded: boolean
  nextVillageId: number
  nextStructureId: number
  /** Buffer d'événements de domaine, drainé par l'hôte (voir events.ts). */
  events: SimEvent[]
  /** Outils de dev armés ? Faux partout sauf hôte de développement (voir debug.ts). */
  debug: boolean
  /** Plafond de faune ambiante de ce monde (0 = aucune ; spec faune R1). */
  faunaCap: number
  /** Prochaine identité de harde à distribuer (spec faune R9). */
  nextHerdId: number
  /**
   * LA PRESSION DE CHASSE (spec faune R16). Les endroits où l'on vient d'abattre
   * du gibier : le peuplement ambiant n'y sème plus rien jusqu'à `until`. C'est
   * ce qui interdit de farmer sur place — le gibier déserte ce qu'on chasse.
   */
  faunaQuiet: { x: number; y: number; until: number }[]
  /**
   * Les LIEUX que l'hôte a peuplés d'une bête (index de `map.zones`). Le
   * peuplement reste une décision d'hôte, exactement comme `faunaCap` : sans
   * cette liste, `advanceDens` prendrait « ce lieu n'a pas de bête » pour « sa
   * bête est morte » et sèmerait des sangliers dans des mondes qui n'en voulaient
   * pas — jusque dans les bancs de test headless, dont il a tué les villageois.
   */
  dens: number[]
  /**
   * Les tanières dont la bête est tombée, et le tick où elle reviendra (spec
   * faune R16). Sans ça, un lieu tué une fois reste vide pour la saison.
   */
  denRespawns: { zone: number; at: number }[]
}

export interface SimOptions {
  map?: WorldMap
  calendarScale?: number
  /** Nœuds de ressources — typiquement `generateNodes(map, seed)`. */
  nodes?: ResourceNode[]
  /** Décalage de phase du cycle (ticks) — voir `cycleOffsetForStartHour`. */
  cycleOffset?: number
  /** Arme les `DebugAction` (TP, heure, invulnérabilité). Jamais en production. */
  debug?: boolean
  /**
   * Combien de bêtes ambiantes ce monde porte-t-il (spec faune R1) ? C'est une
   * décision d'HÔTE, comme la densité de nœuds ou l'échelle du calendrier :
   * une carte de jeu grouille (`FAUNA.CAP`), un banc de test est vierge (0, le
   * défaut) — sinon chaque scénario headless traînerait trente lapins et un
   * flux de PRNG qu'il n'a pas demandé.
   */
  faunaCap?: number
}

/** Intention d'un avatar pour un tick : déplacement, postures, au plus une action. */
export interface MoveInput {
  entityId: number
  dx: -1 | 0 | 1
  dy: -1 | 0 | 1
  sprint?: boolean
  block?: boolean
  action?: PlayerAction
}

export function createSim(seed: number, options: SimOptions = {}): SimState {
  const state: SimState = {
    tick: 0,
    seed,
    rngState: seed >>> 0,
    calendarScale: options.calendarScale ?? BALANCE.DEFAULT_CALENDAR_SCALE,
    cycleOffset: ((options.cycleOffset ?? 0) % TICKS_PER_CYCLE + TICKS_PER_CYCLE) % TICKS_PER_CYCLE,
    // Copies profondes (JSON — l'état est JSON-sérialisable par design) :
    // les options sont des ENTRÉES immuables. Les partager par référence
    // corromprait le replay log (bug attrapé par le test A7 — la sim live
    // mutait les nœuds du log, le replay partait d'arbres vides).
    map: options.map ? (JSON.parse(JSON.stringify(options.map)) as WorldMap) : createEmptyMap(64, 64, TERRAIN_GRASS),
    nextEntityId: 1,
    entities: [],
    villages: [],
    structures: [],
    nodes: options.nodes ? (JSON.parse(JSON.stringify(options.nodes)) as ResourceNode[]) : [],
    npcs: [],
    monsters: [],
    corpses: [],
    nextCorpseId: 1,
    hordes: [],
    nextHordeId: 1,
    lastConvoyDay: 0,
    aggressions: [],
    megaHordeSpawned: false,
    evacuation: null,
    visitedPois: [],
    seasonEnded: false,
    nextVillageId: 1,
    nextStructureId: 1,
    events: [],
    debug: options.debug ?? false,
    faunaCap: options.faunaCap ?? 0,
    nextHerdId: 1,
    faunaQuiet: [],
    dens: [],
    denRespawns: [],
  }
  // Le tick 0 débute le jour 1 et l'acte I ; la phase du cycle dépend de
  // cycleOffset (0 = aube), donc on émet le bon franchissement jour/nuit.
  const startsAtNight = state.cycleOffset >= DAY_TICKS_PER_CYCLE
  emitEvent(state, { type: 'season_day_started', tick: 0, day: 1 })
  emitEvent(state, { type: 'act_started', tick: 0, act: 1 })
  emitEvent(state, startsAtNight ? { type: 'night_started', tick: 0 } : { type: 'day_started', tick: 0 })
  return state
}

/**
 * Fait naître une entité. `slots` = la taille de son sac : la capacité se donne
 * À LA NAISSANCE (spec inventaire R1, R7) — les PNJ et les bêtes en reçoivent un
 * grand (`SLOTS.NPC`), le joueur celui de sa ceinture + son sac.
 */
export function spawnEntity(state: SimState, x: number, y: number, slots: number = SLOTS.PLAYER): number {
  const id = state.nextEntityId
  state.nextEntityId += 1
  state.entities.push({
    id,
    x,
    y,
    inventory: makeInventory(slots),
    hunger: 100,
    temperature: 100,
    skills: {},
    wear: {},
    cooldownUntil: 0,
    hp: 100,
    stamina: 100,
    wounds: {},
    facing: { x: 1, y: 0 },
    blocking: false,
    moved: false,
    exhaustedUntil: 0,
    homeX: x,
    homeY: y,
    warmth: 0,
    engagement: 0,
    knownPois: [],
    reachedPois: [],
  })
  // Consomme un pas de PRNG : le spawn fait partie de l'histoire déterministe.
  state.rngState = rngNext(state.rngState)
  emitEvent(state, { type: 'entity_spawned', tick: state.tick, entityId: id, x, y })
  return id
}

/**
 * LA formule du modificateur de vitesse d'un avatar — partagée entre `step`
 * (autorité) et la prédiction du client. Toute condition ajoutée ici est
 * automatiquement prédite juste ; une copie divergente côté client serait
 * une misprédiction systématique (rubber-band).
 */
export function speedScaleFor(
  entity: Pick<Entity, 'hunger' | 'wounds' | 'stamina' | 'temperature'>,
  input: { sprint: boolean; block: boolean; moving: boolean },
): { scale: number; sprinting: boolean } {
  let scale = 1
  if (entity.hunger <= 0) scale *= BALANCE.HUNGER_SPEED_MALUS
  scale *= coldSpeedFactor(entity.temperature)
  if (entity.wounds.leg) scale *= COMBAT.LEG_WOUND_SPEED
  const blocking = input.block && entity.stamina > 0
  const sprinting = !blocking && input.sprint && entity.stamina > 0 && input.moving
  if (blocking) scale *= COMBAT.BLOCK_MOVE_FACTOR
  else if (sprinting) scale *= COMBAT.SPRINT_FACTOR
  return { scale, sprinting }
}

/** Avance la simulation d'exactement un tick. Mute `state` en place. */
export function step(state: SimState, inputs: MoveInput[]): void {
  // `moved` décrit CE tick : remis à zéro ici, levé par chaque système de
  // déplacement (inputs, PNJ, monstres). Sans ce reset, une entité sans
  // input garderait la valeur d'un tick passé — et la régén d'endurance
  // (qui en dépend) mentirait.
  for (const entity of state.entities) entity.moved = false
  for (const input of inputs) {
    const entity = state.entities.find((e) => e.id === input.entityId)
    if (!entity) continue
    // L'action d'abord (un mur bâti ce tick bloque dès ce tick), le pas ensuite.
    const action = input.action
    if (action) {
      if (isDebugAction(action)) {
        applyDebugAction(state, input.entityId, action)
      } else if (action.type === 'harvest' || action.type === 'craft' || action.type === 'eat') {
        applyEconomyAction(state, input.entityId, action)
      } else if (action.type === 'attack' || action.type === 'bandage' || action.type === 'loot_corpse') {
        applyCombatAction(state, input.entityId, action)
      } else {
        applyVillageAction(state, input.entityId, action)
      }
    }

    // Postures (spec combat) : bloquer, viser, sprinter.
    entity.blocking = (input.block ?? false) && entity.stamina > 0
    if (input.dx !== 0 || input.dy !== 0) {
      const len = Math.sqrt(input.dx * input.dx + input.dy * input.dy)
      entity.facing = { x: input.dx / len, y: input.dy / len }
    }

    if (entity.windup) {
      entity.moved = false
      continue // le wind-up immobilise (spec R4)
    }
    const { scale: speedScale, sprinting } = speedScaleFor(entity, {
      sprint: input.sprint ?? false,
      block: input.block ?? false,
      moving: input.dx !== 0 || input.dy !== 0,
    })
    if (sprinting) {
      entity.stamina = Math.max(0, entity.stamina - COMBAT.SPRINT_STAMINA_PER_S / BALANCE.TICK_RATE_HZ)
    }
    const world = {
      map: state.map,
      structures: state.structures,
      nodes: state.nodes,
      moverVillageId: getVillageOf(state, input.entityId)?.id ?? null,
    }
    const moved = moveAvatar(world, entity.x, entity.y, input.dx, input.dy, TICK_DT_S, speedScale)
    entity.moved = moved.x !== entity.x || moved.y !== entity.y
    entity.x = moved.x
    entity.y = moved.y
  }
  // La découverte est la conséquence du pas qu'on vient de faire (spec lieux R6).
  advancePois(state)
  // Les tanières vidées se repeuplent (spec faune R16) — hors de vue, et jamais vite.
  advanceDens(state, state.seed)
  // Le monde d'abord (spawns/alarmes), puis PNJ, monstres, résolution.
  advanceWorldEvents(state)
  advanceNpcs(state)
  advanceMonsters(state)
  advanceCendreux(state)
  advanceCombat(state)
  advanceAlignment(state)
  advanceTime(state)
  advanceEconomy(state)
  advanceTemperature(state)
  // En DERNIER : les invulnérables retrouvent leurs jauges pleines, quoi qu'il
  // se soit passé pendant le tick (faim, froid, saignement). No-op hors debug.
  refreshGodMode(state)
}

/** Snapshot canonique — sert d'égalité d'état dans les tests et le replay. */
export function snapshot(state: SimState): string {
  return JSON.stringify(state)
}
