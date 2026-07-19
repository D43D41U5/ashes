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
import { BALANCE, CARRY, COMBAT, HUNT, SLOTS, TERRAIN_GRASS, TICK_DT_S, type Strike } from './balance'
import { moveAvatar } from './collision'
import { advanceCombat, applyCombatAction, type CombatAction, type Corpse } from './combat'
import { advanceCendreux } from './cendreux'
import { applyDebugAction, isDebugAction, refreshGodMode, type DebugAction } from './debug'
import {
  advanceCraft,
  advanceEconomy,
  advanceSpoilage,
  applyEconomyAction,
  type CraftOrder,
  type EconomyAction,
  type ResourceNode,
} from './economy'
import { emitEvent, type SimEvent } from './events'
import { applyInventoryAction, isInventoryAction, type InventoryAction } from './inventory-actions'
import { carryRatio, carryTier, makeInventory, type Inventory, type ItemId, type SkillId } from './items'
import { createEmptyMap, type WorldMap } from './map'
import { advanceAlignment, type Aggression } from './alignment'
import { advanceMonsters, type Monster } from './monsters'
import { advanceWorldEvents, type Horde } from './worldevents'
import { rngNext } from './rng'
import { advanceNightHunt } from './nighthunt'
import { advanceNpcs, type Npc } from './npc'
import { advancePois } from './poi-discovery'
import { advanceDens } from './poi'
import { avancerLaCendre } from './cendre'
import { advanceTime, DAY_TICKS_PER_CYCLE, seasonDayAtTick, TICKS_PER_CYCLE } from './time'
import { advanceTemperature, coldSpeedFactor } from './temperature'
import { applyVillageAction, getVillageOf, type VillageAction, type Structure, type Village } from './village'

/**
 * L'union des actions possibles dans un tick (village + économie + combat +
 * inventaire).
 * `DebugAction` en fait partie pour transiter par le même canal (et donc être
 * capturée par le replay log), mais elle est INERTE hors sim de debug — voir
 * `debug.ts`, garde `state.debug`.
 */
export type PlayerAction = VillageAction | EconomyAction | CombatAction | InventoryAction | DebugAction

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
  /**
   * La case de CEINTURE tenue en main (spec inventaire R8). `-1` = mains nues.
   * C'est elle, et elle seule, qui décide de l'outil et de l'arme : la sim ne
   * fouille plus le sac à la place du joueur (R9). Une case active vide vaut
   * mains nues. L'usure, elle, vit dans la case (`Slot.wear`) — `Entity.wear`,
   * qui agrégeait par TYPE d'item (deux haches, un seul compteur), a disparu.
   */
  activeSlot: number
  /** Tick avant lequel une récolte est refusée (rythme borné). Le craft, lui, n'a
   *  plus de cooldown : il a une DURÉE, et une file (spec craft-file F2). */
  cooldownUntil: number
  /**
   * LA FILE DE CRAFT (spec craft-file F1) : le travail en cours, dans l'état de
   * sim. C'est ici que vit le temps de craft — jamais dans un timer du client,
   * qui divergerait. Seule la TÊTE travaille : un artisan fait une chose à la fois.
   */
  craftQueue: CraftOrder[]
  /** Combat (spec combat R1-R7). */
  hp: number
  stamina: number
  wounds: { leg?: true; arm?: true; bleeding?: true }
  facing: { x: number; y: number }
  blocking: boolean
  /** A bougé ce tick (module la régén d'endurance). */
  moved: boolean
  /**
   * L'ALLURE du tick (spec chasse C2) : c'est elle qui décide du BRUIT — ce que
   * la faune perçoit (immobile ≪ pas lent ≪ marche ≪ sprint, voir HUNT.NOISE_*).
   * Dans le snapshot exprès : en multi comme en Veillée, on doit VOIR l'autre
   * ramper — la posture est un télégraphe pour les joueurs autant qu'une entrée
   * pour les bêtes. Posée par le pas d'input ; les PNJ restent à `walk` (bruit 1).
   */
  gait: 'still' | 'sneak' | 'walk' | 'sprint'
  exhaustedUntil: number
  /**
   * LE COUP QUI S'ARME. Il porte SA FORME (`strike`) : c'est ce qui permet au
   * télégraphe de dessiner la zone RÉELLEMENT frappée — un pic de lance ne se lit
   * pas comme un tourbillon de hache, et un télégraphe qui montrerait le même arc
   * pour les deux apprendrait une règle qui n'existe pas (voir `attack-fx.ts`).
   * `side` : le pied qui part (les poings alternent). `charged` : le coup est lourd.
   */
  windup?: { dx: number; dy: number; ticksLeft: number; strike: Strike; side?: 1 | -1; charged?: true; structureId?: number }
  /**
   * LE CLIC MAINTENU (spec combat R4ter). La sim COMPTE — le client ne fait que
   * dire « j'appuie, et je vise par là ». À maturité (`WeaponProfile.chargeTicks`),
   * le relâchement sort le coup lourd. Dans le snapshot : en multi, on doit VOIR
   * l'autre armer son tourbillon, sinon la charge n'est un télégraphe pour personne.
   */
  charge?: { dx: number; dy: number; ticks: number }
  /** Le pied du prochain coup : +1 / −1 / +1… (les poings dansent, spec R4bis). */
  swingSide: 1 | -1
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
  /**
   * LES FONCTIONS ÉMERGENTES reconnues (spec construction R9-R10) — dérivé PUR des
   * structures, recalculé à chaque mutation (`refreshFunctions`). Dans le snapshot :
   * le tableau du village et l'overlay client le lisent au lieu de re-reconnaître.
   */
  functions: import('./construction').RecognizedFunction[]
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
  /** Hordes et convois armés ? (voir SimOptions.worldEvents) */
  worldEvents: boolean
  /** Le foyer, qui dessine les trois cercles (voir SimOptions.home). `null` = monde uniforme. */
  home: { x: number; y: number } | null
  /** Prochaine identité de harde à distribuer (spec faune R9). */
  nextHerdId: number
  /**
   * LA PRESSION DE CHASSE (spec faune R16). Les endroits où l'on vient d'abattre
   * du gibier : le peuplement ambiant n'y sème plus rien jusqu'à `until`. C'est
   * ce qui interdit de farmer sur place — le gibier déserte ce qu'on chasse.
   */
  faunaQuiet: { x: number; y: number; until: number }[]
  /**
   * LES COINS DE CHASSE (spec faune R17) : les lieux FIXES où le gibier vit —
   * un biome ouvert à portée d'eau, semé une fois pour la saison. Entre eux, la
   * vallée est vide. C'est une décision d'HÔTE, comme `faunaCap` et `dens` : une
   * liste VIDE rend l'ancien peuplement uniforme (les bancs de test n'ont pas
   * demandé de géographie).
   */
  grounds: { x: number; y: number }[]
  /**
   * LE SANG AU SOL (spec chasse C9). Les gouttes semées par ce qui saigne — bête
   * blessée comme avatar (le sang est le sang). C'est de l'ÉTAT, pas des
   * événements : haute fréquence ≠ domaine. Le client les dessine et les efface,
   * personne d'autre ne les consomme. Borné des deux côtés (TTL + plafond FIFO) :
   * le snapshot reste petit.
   */
  blood: { x: number; y: number; tick: number }[]
  /**
   * LE VENT (spec chasse C17), un des huit relèvements — il tourne lentement, au
   * PRNG de l'état. L'odeur DESCEND le vent : une menace au vent d'une bête la
   * trahit, quels que soient son allure, son couvert et le dos tourné. La parade
   * n'est pas un facteur de plus : c'est un CÔTÉ.
   */
  wind: { x: number; y: number }
  /**
   * LES PILES D'ITEMS AU SOL (spec chasse C18, décision utilisateur n°4). Ce
   * qu'on JETTE : appât pour le gibier, viande pour détourner une meute, charge
   * larguée en fuite. Périssables — le monde ne se jonche pas.
   */
  groundItems: { id: number; x: number; y: number; item: ItemId; count: number; expiresAt: number }[]
  nextGroundItemId: number
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
  /**
   * LES COINS DE CHASSE (spec faune R17) — typiquement `placeHuntingGrounds(map, seed)`.
   * Sans eux, le peuplement redevient uniforme : un banc de test n'a pas demandé
   * de géographie, et il ne doit pas en payer une.
   */
  grounds?: { x: number; y: number }[]
  /**
   * Ce monde connaît-il les ÉVÉNEMENTS DU MONDE (hordes, convois) ? Vrai par
   * défaut : une partie en a, évidemment. Un banc de test PNJ, lui, mesure une
   * ÉCONOMIE — il ne devrait pas voir son verdict décidé par une guerre qu'il n'a
   * pas demandée. Même raison que `faunaCap` ci-dessus, et même précédent.
   *
   * Trouvé en le mesurant (2026-07-12) : les hordes tombent sur un `roll` par
   * nuit, donc sur le FLUX du PRNG. Toute modification de comportement — le craft
   * qui prend du temps, par exemple — décale ce flux et rebat le tirage. Or à
   * ≥ 5 hordes un village PNJ est RASÉ, à ≤ 4 il tient : le critère « il survit
   * 10 jours » n'était pas une propriété du village, c'était le tirage du seed 11.
   */
  worldEvents?: boolean
  /**
   * LE FOYER : le point de départ du joueur. Décision d'HÔTE (comme `faunaCap` ou
   * la densité de nœuds) : c'est lui qui dessine LES TROIS CERCLES du GDD §8bis —
   * médiocre et sûr autour, riche et dangereux au loin. Absent = monde uniforme
   * (un banc de test ne veut pas d'une géographie qu'il n'a pas demandée).
   */
  home?: { x: number; y: number }
}

/** Intention d'un avatar pour un tick : déplacement, postures, au plus une action. */
export interface MoveInput {
  entityId: number
  dx: -1 | 0 | 1
  dy: -1 | 0 | 1
  sprint?: boolean
  /** LE PAS LENT (spec chasse C2) : discret pour la faune, et lent — c'est le prix. */
  sneak?: boolean
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
    functions: [],
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
    worldEvents: options.worldEvents ?? true,
    home: options.home ?? null,
    nextHerdId: 1,
    faunaQuiet: [],
    grounds: options.grounds ? options.grounds.map((g) => ({ x: g.x, y: g.y })) : [],
    dens: [],
    denRespawns: [],
    blood: [],
    // Le vent de départ : le premier des huit relèvements. Il tournera (C17).
    wind: { x: 1, y: 0 },
    groundItems: [],
    nextGroundItemId: 1,
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
    activeSlot: -1,
    cooldownUntil: 0,
    craftQueue: [],
    hp: 100,
    stamina: 100,
    wounds: {},
    facing: { x: 1, y: 0 },
    blocking: false,
    moved: false,
    // `walk` par défaut : les PNJ (qui ne passent pas par les inputs) sonnent
    // comme des marcheurs (spec chasse C2) ; l'avatar joué est re-posé chaque tick.
    gait: 'walk',
    exhaustedUntil: 0,
    swingSide: 1,
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
 * Retire un avatar joueur du monde (multi : déconnexion). Miroir PUR du chemin
 * mort-PNJ (`combat.ts`) : l'entité disparaît et le village qui l'employait est
 * nettoyé de sa référence. À la différence de la mort d'un joueur — qui RESPAWN
 * l'entité au Feu sans la retirer —, ici l'entité s'en va pour de bon.
 *
 * Ne consomme PAS de pas de PRNG (un départ n'est pas un tirage) et n'est pas
 * gardé par `debug` : c'est une opération d'hôte structurelle. Doit s'appliquer
 * EN TÊTE DE TICK, avant `step` — jamais au milieu d'une itération d'inputs, où
 * un `entities` qui rétrécit sauterait des avatars.
 */
export function despawnAvatar(state: SimState, id: number): void {
  const existed = state.entities.some((e) => e.id === id)
  if (!existed) return
  state.entities = state.entities.filter((e) => e.id !== id)
  for (const village of state.villages) {
    village.memberIds = village.memberIds.filter((m) => m !== id)
    for (const task of village.tasks) if (task.claimedBy === id) task.claimedBy = null
  }
  emitEvent(state, { type: 'entity_despawned', tick: state.tick, entityId: id })
}

/**
 * LA formule du modificateur de vitesse d'un avatar — partagée entre `step`
 * (autorité) et la prédiction du client. Toute condition ajoutée ici est
 * automatiquement prédite juste ; une copie divergente côté client serait
 * une misprédiction systématique (rubber-band).
 */
/**
 * LE PRIX DE LA CHARGE (spec portage.md P5) : 1 tant qu'on est sous le confort,
 * puis décroissance linéaire, plancher à `SPEED_FLOOR`.
 *
 * `+ − × ÷`, `min`, `max` : rien d'autre. Cette fonction entre dans la vitesse,
 * donc dans le replay ET dans la prédiction du client — une fonction Math
 * approximée (`pow`, `exp`) donnerait un résultat différent d'un moteur JS à
 * l'autre, et un replay enregistré au navigateur ne rejouerait pas sur Node
 * (invariant §2).
 */
export function carrySpeedFactor(ratio: number): number {
  const tier = carryTier(ratio)
  if (tier === 'light') return CARRY.SPEED_LIGHT
  if (tier === 'medium') return CARRY.SPEED_MEDIUM
  if (tier === 'heavy') return CARRY.SPEED_HEAVY
  // SURCHARGÉ, et là SEULEMENT : la peine grandit à chaque objet de plus. On part
  // du palier lourd et on descend, jusqu'au plancher (on rampe, mais on avance).
  const over = ratio - CARRY.HEAVY_MAX
  return Math.max(CARRY.SPEED_FLOOR, CARRY.SPEED_HEAVY - CARRY.OVERLOAD_MALUS_PER_RATIO * over)
}

/**
 * La vitesse, TOUT COMPRIS — et c'est la SEULE formule : la sim l'applique, et la
 * prédiction locale du client l'appelle littéralement (spec portage.md P10). Une
 * copie côté client divergerait au premier ajustement, et une divergence de vitesse
 * fait se téléporter l'avatar à chaque réconciliation.
 *
 * Le poids entre ICI, pas ailleurs. On ne SPRINTE PAS chargé (P6) : au-dessus de
 * `SPRINT_MAX`, le sprint n'est pas ralenti — il est REFUSÉ. C'est la première
 * chose que le joueur sent, avant même de regarder une jauge.
 */
export function speedScaleFor(
  entity: Pick<Entity, 'hunger' | 'wounds' | 'stamina' | 'temperature' | 'inventory'>,
  input: { sprint: boolean; block: boolean; moving: boolean; charging?: boolean; sneak?: boolean },
): { scale: number; sprinting: boolean; sneaking: boolean } {
  let scale = 1
  if (entity.hunger <= 0) scale *= BALANCE.HUNGER_SPEED_MALUS
  scale *= coldSpeedFactor(entity.temperature)
  if (entity.wounds.leg) scale *= COMBAT.LEG_WOUND_SPEED
  const ratio = carryRatio(entity.inventory)
  const tier = carryTier(ratio)
  scale *= carrySpeedFactor(ratio)
  // On ne sprinte plus dès le palier LOURD (spec P6) : refusé, pas ralenti.
  const canSprint = tier === 'light' || tier === 'medium'
  const blocking = input.block && entity.stamina > 0
  // ON NE CHARGE PAS EN COURANT (spec R4ter) : armer un coup lourd, c'est se planter
  // sur ses appuis. Le sprint est refusé, pas seulement ralenti — sans quoi la charge
  // serait une posture de fuite, et l'engagement qu'elle est censée coûter n'existerait pas.
  const charging = input.charging ?? false
  // LE PAS LENT (spec chasse C2). Il PRIME sur le sprint : on ne court pas
  // accroupi, et des deux touches tenues, c'est l'intention délibérée qui gagne.
  // Il se COMBINE à la charge (× les deux facteurs) : ramper lance armée est
  // exactement l'approche que la mise à mort propre récompense (C6).
  const sneaking = (input.sneak ?? false) && !blocking
  const sprinting = !blocking && !charging && !sneaking && input.sprint && entity.stamina > 0 && input.moving && canSprint
  if (blocking) scale *= COMBAT.BLOCK_MOVE_FACTOR
  else if (sprinting) scale *= COMBAT.SPRINT_FACTOR
  else if (sneaking) scale *= HUNT.SNEAK_SPEED_FACTOR
  if (charging) scale *= COMBAT.CHARGE_MOVE_FACTOR
  return { scale, sprinting, sneaking }
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
      } else if (isInventoryAction(action)) {
        applyInventoryAction(state, input.entityId, action)
      } else if (
        action.type === 'harvest' ||
        action.type === 'craft' ||
        action.type === 'cancel_craft' ||
        action.type === 'eat'
      ) {
        applyEconomyAction(state, input.entityId, action)
      } else if (
        action.type === 'attack' ||
        action.type === 'attack_charge' ||
        action.type === 'attack_release' ||
        action.type === 'bandage' ||
        action.type === 'loot_corpse'
      ) {
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
      entity.gait = 'still' // le wind-up immobilise : on frappe, on ne marche pas
      continue // le wind-up immobilise (spec R4)
    }
    const { scale: speedScale, sprinting, sneaking } = speedScaleFor(entity, {
      sprint: input.sprint ?? false,
      block: input.block ?? false,
      moving: input.dx !== 0 || input.dy !== 0,
      charging: entity.charge !== undefined,
      sneak: input.sneak ?? false,
    })
    // L'ALLURE du tick (spec chasse C2) — ce que la faune entendra de ce pas.
    const moving = input.dx !== 0 || input.dy !== 0
    entity.gait = !moving ? 'still' : sprinting ? 'sprint' : sneaking ? 'sneak' : 'walk'
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
  if (state.worldEvents) {
    advanceWorldEvents(state)
    // LA NUIT QUI CHASSE : c'est un ÉVÉNEMENT DU MONDE, il suit donc le même
    // interrupteur — un banc de test qui n'a pas demandé de guerre n'a pas non plus
    // demandé de loups.
    advanceNightHunt(state)
  }
  advanceNpcs(state)
  advanceMonsters(state)
  advanceCendreux(state)
  advanceCombat(state)
  advanceAlignment(state)
  advanceTime(state)
  // LA CENDRE AVANCE — après le temps, puisque c'est le temps qui la pousse. Elle ne fait quelque
  // chose qu'au BASCULEMENT d'un jour de saison : le reste des ticks, elle ne coûte qu'un test.
  if (seasonDayAtTick(state.tick, state.calendarScale) !== seasonDayAtTick(state.tick - 1, state.calendarScale)) {
    avancerLaCendre(state)
  }
  advanceCraft(state)
  advanceSpoilage(state)
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
