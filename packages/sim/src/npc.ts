/**
 * Les PNJ — villageois simulés (spec pnj, GDD §10 RimWorld-light).
 *
 * Principe fondateur (R1) : un PNJ agit par le MÊME pipeline d'actions
 * validées qu'un joueur — son IA émet des intentions, jamais des résultats.
 * IA à deux étages (R3) : besoins critiques (npc-needs.ts), sinon le
 * tableau du village (village-board.ts). Des seuils et une file — pas de GOAP.
 * Tout est déterministe : égalités départagées par id, aucun aléa.
 *
 * Ce module garde l'orchestration (advanceNpcs), l'exécution des tâches
 * (récolter, cuisiner, réparer), la navigation (followPath/setPathTo), la
 * milice (handleDefense) et le peuplement (spawnNpcsAround). Les besoins,
 * les expéditions et le tableau vivent dans leurs modules.
 */
import { isThreatTo } from './alignment'
import {
  BALANCE,
  COMBAT,
  NODE_DEFS,
  OUTILS_PAR_FAMILLE,
  TOOL_RANK,
  FIRE_UPKEEP,
  NPC_AI,
  RECIPES,
  SLOTS,
  STRUCTURE_HP,
  TICK_DT_S,
  WEAPON_DAMAGE,
  isRangedWeapon,
  WORLD_EVENTS,
  type NodeType,
  type RecipeId,
  type ToolFamily,
} from './balance'
import { isBlockedAt, moveAvatar, type MoveWorld } from './collision'
import { engageRange, startAttack, weaponProfile } from './combat'
import { poseLibre } from './defriche'
import { applyEconomyAction, toolRank, type ResourceNode } from './economy'
import { sertExigence } from './pieces'
import { emitEvent } from './events'
import { floreGelee } from './gel'
import { distSq } from './geometry'
import { zoneIdAt } from './map'
import { countOf, freeRoomFor, moveSlotWithin, type ItemId } from './items'
import { handleCold, handleHunger, handleOrage, handleSleep, handleWounds } from './npc-needs'
import { assignErrands, handleErrand } from './npc-errands'
import { pathToward } from './pathfinding'
import { spawnEntity, type Entity, type SimState } from './sim'
import { getGameTime, TICKS_PER_CYCLE } from './time'
import { edgeBarrierAt, fullTileAt } from './construction'
import { applyVillageAction, floorAt, type BuildOrder, type TaskKind, type Village, type VillageAction } from './village'
import { granaries, refreshBoard } from './village-board'
import { orderCost } from './village-plan'

export interface NpcTaskState {
  id: number
  kind: TaskKind
  stage: 'work' | 'fetch' | 'craft' | 'store'
  nodeId: number | null
}

export interface Npc {
  entityId: number
  villageId: number
  homeId: number | null
  /** 0-100 — besoin de sommeil (spec R4). Sur le PNJ, pas sur l'Entity. */
  energy: number
  sleeping: boolean
  /** En cours de repli vers un feu à cause du froid (hystérésis, spec IA chaleur). */
  seekingWarmth: boolean
  task: NpcTaskState | null
  path: { tx: number; ty: number }[]
  stuck: number
  /** Ticks passés à ne PAS progresser vers une menace (bloqué contre un obstacle).
   *  Au-delà de `DEFENSE_GIVE_UP_TICKS`, on lâche la garde — sinon le PNJ monte
   *  la garde devant un rocher jusqu'à en mourir de faim (voir `handleDefense`). */
  defendStuck: number
  /** La plus courte distance (au carré) jamais atteinte vers la menace en cours.
   *  `-1` = pas d'engagement. C'est CE repère qui mesure le progrès : autour d'un
   *  obstacle, le PNJ ORBITE — sa distance monte et redescend, un simple « me
   *  suis-je rapproché ce tick ? » se remettrait à zéro sans fin. */
  defendBest: number
  /** Tick jusqu'auquel on IGNORE toute menace, après avoir renoncé. Sans ce répit,
   *  il repartirait à la charge au tick suivant, pour l'éternité. */
  defendIgnoreUntil: number
  /** Expédition en cours (spec alignement R13-R14) : raid de Meute ou don de Foyer. */
  errand: {
    kind: 'raid' | 'gift'
    targetVillageId: number
    stage: 'fetch' | 'go' | 'smash' | 'loot' | 'home'
  } | null
}

const TASK_DEFS: Record<
  Exclude<TaskKind, 'cook_stew' | 'repair' | 'feed_fire' | 'build'>,
  { nodeType: NodeType; item: ItemId; carry: number; portee?: number }
> = {
  gather_berries: { nodeType: 'berry_bush', item: 'berries', carry: BALANCE.NPC_CARRY_TARGETS.berries },
  gather_wood: { nodeType: 'tree', item: 'wood', carry: BALANCE.NPC_CARRY_TARGETS.wood },
  gather_fiber: { nodeType: 'fiber_plant', item: 'fiber', carry: BALANCE.NPC_CARRY_TARGETS.fiber },
  // Le chantier des villages PNJ (spec village-pnj-evolution R8) : la pierre à mains
  // nues (`rock`, minTool none) ; le bloc taillé à la carrière — pioche d'atelier requise
  // (minTool basic, garde DURE), que `ensurePickaxe` fournit avant de frapper.
  gather_stone: { nodeType: 'rock', item: 'stone', carry: BALANCE.NPC_CARRY_TARGETS.stone },
  gather_cut_stone: { nodeType: 'quarry', item: 'cut_stone', carry: BALANCE.NPC_CARRY_TARGETS.cut_stone },
  // LE GLANAGE (spec `glanage.md` G6) : la MÊME mécanique que les autres cueillettes — un type
  // de nœud, un objet, un quota — ce qui est tout l'intérêt de l'avoir fait avec de vrais nœuds.
  // Le quota est en NŒUDS (chacun porte 1), d'où `NPC_GLANAGE_CARRY` et pas la cible du bois.
  glaner_bois: { nodeType: 'branche_au_sol', item: 'wood', carry: BALANCE.NPC_GLANAGE_CARRY, portee: BALANCE.NPC_GLANAGE_PORTEE },
  glaner_pierre: { nodeType: 'pierre_au_sol', item: 'stone', carry: BALANCE.NPC_GLANAGE_CARRY, portee: BALANCE.NPC_GLANAGE_PORTEE },
}

const RANGE = BALANCE.INTERACT_RANGE - 0.2 // marge : on agit un peu en dedans de la portée
export const TICKS_PER_HOUR = TICKS_PER_CYCLE / 24

// ─── Aides ────────────────────────────────────────────────────────────────

function moveWorldFor(state: SimState, villageId: number): MoveWorld {
  // `opensDoors` — LES PNJ DU VILLAGE ACTIONNENT SES PORTES (spec construction R26).
  //
  // Depuis que la porte a un ÉTAT, une porte close ne laisse plus passer personne — pas même les
  // siens : c'est ce qui donne un sens à l'ouvrir. Sans cette capacité, fermer sa porte
  // ENFERMERAIT ses propres PNJ : leurs corvées s'arrêteraient (bois, baies, eau, feu) sans qu'un
  // seul message ne le dise, et le village s'éteindrait pendant qu'on croit l'avoir protégé.
  //
  // On ne simule pas le battant qu'ils poussent : ils ouvrent et referment derrière eux, et
  // l'état que le JOUEUR a réglé n'est jamais touché — sinon les villageois laisseraient la porte
  // ouverte et défairaient sa décision, la seule chose qu'une porte serve à exprimer.
  return { map: state.map, structures: state.structures, nodes: state.nodes, moverVillageId: villageId, opensDoors: true, etat: state }
}

/**
 * Le nœud vivant le plus proche — DANS LA ZONE DU PNJ, et c'est tout le correctif.
 *
 * Il choisissait le plus proche À VOL D'OISEAU, sans conscience des murs. Or les frontières de
 * zone sont des falaises (`murerLesAretes`) dont le seul passage est un seuil : un arbre à
 * trente tuiles, mais de l'autre côté d'une paroi, demande un détour de plusieurs centaines de
 * tuiles. L'A* brûlait alors tout son budget (4096 expansions) et rendait `null` — puis
 * recommençait au tick suivant, indéfiniment.
 *
 * MESURÉ avant/après (`tools/profil-tick.mts`) : **99 % des recherches de chemin échouaient**,
 * sur des cibles à 37 tuiles en moyenne — donc toutes proches, mais INATTEIGNABLES. Ce n'était
 * pas un problème de budget : c'était un problème de CIBLE. Autrement dit les PNJ ne récoltaient
 * quasiment jamais : le coût CPU n'était que la partie visible d'une IA qui tournait à vide.
 *
 * On filtre donc sur la zone du PNJ. `zoneIdAt` rend `-1` sur une carte sans zones (tests,
 * ancienne vallée) : le filtre est alors inerte et le comportement d'origine est conservé,
 * exactement.
 */
function nearestAliveNode(state: SimState, entity: Entity, type: NodeType, porteeMax = Infinity): ResourceNode | undefined {
  const maZone = zoneIdAt(state.map, Math.floor(entity.x), Math.floor(entity.y))
  let best: ResourceNode | undefined
  let bestD = Infinity
  // LE REPLI HORS ZONE, et pourquoi il n'est pas négociable.
  //
  // Le filtre de zone existe pour une raison mesurée : sans lui, un PNJ visait le nœud le plus
  // proche À VOL D'OISEAU sans voir les falaises qui séparent les zones, et 99 % des recherches
  // de chemin échouaient après avoir brûlé leurs 4096 expansions, à chaque tick.
  //
  // Mais **filtrer n'est pas interdire**, et la version stricte affamait des villages entiers.
  // Le monde distribue ses ressources PAR ZONE, délibérément : une zone peut ne porter aucun
  // buisson (mesuré : 0 sur 1177 pour la zone d'un village du banc). Le PNJ n'avait alors AUCUN
  // candidat, relâchait sa corvée, la reprenait au tick suivant — même priorité, même id, rien
  // n'a bougé — et restait épinglé sur une tâche impossible sans jamais descendre à celle,
  // accessible, qui la suivait au tableau. Deux villages sur trois mouraient en quatre jours,
  // grenier vide, pendant que celui qui PILLAIT survivait.
  //
  // On garde donc la préférence — elle porte tout le gain de perf, puisqu'une zone offre
  // presque toujours ce qu'on lui demande — et on n'abandonne le voisinage qu'à défaut. Le
  // repli ne coûte que là où il est la seule issue : voyager est ce que le jeu attend.
  let hors: ResourceNode | undefined
  let horsD = Infinity
  const porteeMax2 = porteeMax === Infinity ? Infinity : porteeMax * porteeMax
  for (const n of state.nodes) {
    if (n.type !== type || n.stock <= 0) continue
    const d = distSq(entity.x, entity.y, n.tx + 0.5, n.ty + 0.5)
    // LA PORTÉE MAXIMALE — MESURÉE, et elle n'existe que pour le GLANAGE (spec `glanage.md` G9).
    //
    // Un nœud de glanage porte UNE unité : là où un arbre coûte un A* pour dix bûches, une
    // branche en coûte un par bûche. Et comme le glanage se CONSOMME, le plus proche recule à
    // chaque ramassage — l'A* enfle, puis échoue (4096 expansions brûlées), puis recommence.
    // MESURÉ au profileur du banc (`tools/profil-banc.mts`, 8 joueurs, 1 jour, 6 tranches) :
    // sans plafond, le tick passe de 1,33 à **64,5 ms** sur la journée, et `findPath` pèse
    // 35 % du temps CPU. Avec, il reste plat. Un villageois ne traverse pas le pays pour une
    // brindille : s'il n'y en a pas dans son voisinage, la corvée quitte le tableau.
    if (d > porteeMax2) continue
    if (maZone >= 0 && zoneIdAt(state.map, n.tx, n.ty) !== maZone) {
      if (d < horsD || (d === horsD && hors && n.id < hors.id)) {
        hors = n
        horsD = d
      }
      continue
    }
    if (d < bestD || (d === bestD && best && n.id < best.id)) {
      best = n
      bestD = d
    }
  }
  return best ?? hors
}

/** Fait suivre le chemin au PNJ. Retourne true s'il marche encore. */
export function followPath(state: SimState, npc: Npc, entity: Entity): boolean {
  const waypoint = npc.path[0]
  if (!waypoint) return false
  const wx = waypoint.tx + 0.5
  const wy = waypoint.ty + 0.5
  const dx = wx - entity.x
  const dy = wy - entity.y
  // Waypoints intermédiaires : rayon large. Dernier waypoint : rayon précis.
  // Le POURQUOI (le rayon doit rester > pas par tick, sinon on orbite) vit avec les
  // constantes — il valait pour la faune et les Cendreux autant que pour les PNJ.
  const radius = npc.path.length > 1 ? BALANCE.WAYPOINT_RADIUS : BALANCE.WAYPOINT_RADIUS_LAST
  if (dx * dx + dy * dy < radius * radius) {
    npc.path.shift()
    return npc.path.length > 0
  }
  const zm = NPC_AI.STEP_DEADZONE
  const sx = (dx > zm ? 1 : dx < -zm ? -1 : 0) as -1 | 0 | 1
  const sy = (dy > zm ? 1 : dy < -zm ? -1 : 0) as -1 | 0 | 1
  const speedScale = entity.hunger <= 0 ? BALANCE.HUNGER_SPEED_MALUS : 1
  const moved = moveAvatar(moveWorldFor(state, npc.villageId), entity.x, entity.y, sx, sy, TICK_DT_S, speedScale)
  if (moved.x === entity.x && moved.y === entity.y) {
    npc.stuck += 1
    if (npc.stuck > 2 * BALANCE.TICK_RATE_HZ) {
      npc.path = [] // recalcul au prochain tick de décision
      npc.stuck = 0
    }
  } else {
    npc.stuck = 0
  }
  entity.moved = moved.x !== entity.x || moved.y !== entity.y
  entity.x = moved.x
  entity.y = moved.y
  return true
}

/** Calcule un chemin vers une tuile (ou une voisine marchable si elle bloque). */
export function setPathTo(state: SimState, npc: Npc, entity: Entity, tx: number, ty: number): boolean {
  const world = moveWorldFor(state, npc.villageId)
  // Cible bloquée (Feu à hitbox, mur…) → on se poste au voisin libre le plus
  // proche. Logique partagée avec la dérive du Cendreux (`pathToward`).
  const path = pathToward(world, entity.x, entity.y, tx, ty)
  npc.path = path ?? []
  return path !== null
}

export function near(entity: Entity, tx: number, ty: number, r = RANGE): boolean {
  return distSq(entity.x, entity.y, tx + 0.5, ty + 0.5) <= r * r
}

// ─── La main du PNJ (spec inventaire R8-R9) ───────────────────────────────
//
// L'objet TENU fait foi — pour tout le monde, PNJ compris : la sim ne fouille
// plus le sac. Mais un PNJ n'a pas de hotbar pour s'armer la main. Sans ces deux
// gardes il récolterait à mains nues sa hache dans le dos, et la milice
// affronterait les hordes au poing, sa lance de naissance (worldgen) au fond du
// sac : une économie et une défense qui s'effondrent EN SILENCE — aucun refus,
// aucun événement, juste des chiffres qui baissent. On ne change PAS la règle,
// on fait pour eux le geste que le joueur fait à la ceinture.

/**
 * Ramène une case dans la CEINTURE (seule région qui se tient en main, R7-R8) et
 * retourne son nouvel index. Sans ça, une hache tombée en case 20 du grand sac d'un
 * PNJ (40 cases) ne servirait jamais — il la porterait toute la saison sans pouvoir
 * s'en servir.
 *
 * C'est EXACTEMENT le geste que le joueur fait à la ceinture (`move_slot`, R14) :
 * on appelle donc sa primitive. Une deuxième copie de la règle d'échange finirait
 * par diverger de la première — et les outils sont des cases usées : la moindre
 * divergence les reconstruit NEUFS.
 */
function liftIntoBelt(entity: Entity, index: number): number {
  if (index < SLOTS.BELT) return index
  let dest = 0 // ceinture pleine : on troque, la case délogée part au sac
  for (let i = 0; i < SLOTS.BELT && i < entity.inventory.length; i++) {
    if (entity.inventory[i] === null) {
      dest = i
      break
    }
  }
  moveSlotWithin(entity.inventory, index, dest)
  return dest
}

/** Empoigne la meilleure case selon `score` (0 = inutile ici), sinon mains nues. */
function equipBest(entity: Entity, score: (item: ItemId) => number): void {
  let bestIndex = -1
  let bestScore = 0
  for (let i = 0; i < entity.inventory.length; i++) {
    const slot = entity.inventory[i]
    if (slot === null || slot === undefined) continue
    const s = score(slot.item)
    if (s > bestScore) {
      bestScore = s
      bestIndex = i // égalité : la première case gagne (déterminisme)
    }
  }
  entity.activeSlot = bestIndex < 0 ? -1 : liftIntoBelt(entity, bestIndex)
}

/**
 * Le meilleur outil PORTÉ pour cette famille — classé au RANG, pas au rendement
 * (spec craft-fortune C7). Le hachereau de fortune et la hache d'atelier rendent
 * tous deux ×2 : au rendement, le PNJ aurait pu empoigner le caillou ficelé et
 * laisser la vraie hache au sac — pour la casser cinq fois plus vite.
 */
export function equipBestTool(entity: Entity, family: ToolFamily | null): void {
  equipBest(entity, (item) => toolRank(item, family)) // 0 = ce n'est pas un outil d'ici
}

/**
 * L'arme la plus dangereuse PORTÉE (le barème vient de `WEAPON_DAMAGE`).
 *
 * ⚠ LES ARCS EN SONT EXCLUS, ET CE N'EST PAS UN CLASSEMENT — C'EST UNE GARDE
 * (spec `tir.md` T11). Depuis qu'un arc NE FRAPPE PAS (T2, décision d'Alexis), un PNJ
 * qui en empoignerait un n'aurait plus aucune réponse au contact : la milice de
 * `combat.md` R13 marcherait au Cendreux les mains vides. Et un mauvais rang n'y
 * suffirait pas — à 8, l'arc long passe déjà sous l'épieu taillé (10), donc un PNJ ne
 * le prendrait QUE s'il n'a rien d'autre, c'est-à-dire précisément dans le cas où le
 * prendre le désarme.
 *
 * C'est une règle d'IA, pas un privilège de camp : le pipeline de résolution continue
 * de ne connaître personne (« personne ne triche »). Elle tombe le jour où une IA sait
 * TIRER — ce qui demande une manœuvre de maintien de distance, l'inverse d'`engageRange`.
 */
export function equipBestWeapon(entity: Entity): void {
  equipBest(entity, (item) => (isRangedWeapon(item) ? 0 : (WEAPON_DAMAGE[item] ?? 0)))
}

// ─── Les transferts du PNJ, MESURÉS (spec inventaire R11) ─────────────────
//
// Sacs et greniers sont bornés : un dépôt (grenier plein) ou un retrait (sac
// plein) peut ne déplacer AUCUNE unité. Une corvée qui ne regarde pas ce que le
// transfert a réellement bougé se retente au tick suivant, à l'identique, pour
// toujours : c'est le livelock. Tout appelant DOIT lire ce retour et lâcher sa
// tâche quand il vaut 0.

function measured(state: SimState, entity: Entity, action: VillageAction, item: ItemId): number {
  const before = countOf(entity.inventory, item)
  applyVillageAction(state, entity.id, action)
  return Math.abs(countOf(entity.inventory, item) - before)
}

/** Dépose au conteneur ; retourne ce qui a VRAIMENT quitté le sac (0 = plein). */
export function deposit(
  state: SimState,
  entity: Entity,
  structureId: number,
  item: ItemId,
  count: number,
): number {
  return measured(state, entity, { type: 'deposit', structureId, item, count }, item)
}

/** Retire du conteneur ; retourne ce qui est VRAIMENT entré dans le sac (0 = plein). */
export function withdraw(
  state: SimState,
  entity: Entity,
  structureId: number,
  item: ItemId,
  count: number,
): number {
  return measured(state, entity, { type: 'withdraw', structureId, item, count }, item)
}

// ─── Réclamer/rendre les tâches du tableau (spec R5) ─────────────────────

/**
 * Ce que la corvée doit pouvoir FAIRE ENTRER dans le sac : la récolte y met sa
 * récolte, la cuisine y met ses ingrédients ET son ragoût, la réparation son bois.
 *
 * Sans place pour ça, la corvée est impossible — et un PNJ qui la réclame quand
 * même la rendrait au premier transfert à vide… pour la re-réclamer au tick suivant
 * (même priorité, même id, rien n'a bougé dans le monde) : une boucle sèche à
 * 20 Hz. Les gardes des exécutants libèrent la tâche POUR LES AUTRES ; celle-ci
 * empêche CE PNJ de la reprendre. Il faut les deux.
 *
 * `stew` est dans la liste parce que le piège ne se ferme pas qu'au `fetch` : un
 * PNJ peut atteindre le feu ses ingrédients en poche et n'avoir aucune case pour
 * le ragoût — le craft refuse alors à chaque tick, sans jamais poser de cooldown.
 */
const TASK_INTAKE: Record<TaskKind, ItemId[]> = {
  gather_berries: ['berries'],
  gather_wood: ['wood'],
  gather_fiber: ['fiber'],
  gather_stone: ['stone'],
  gather_cut_stone: ['cut_stone'],
  glaner_bois: ['wood'],
  glaner_pierre: ['stone'],
  cook_stew: ['berries', 'fiber', 'stew'],
  repair: ['wood'],
  feed_fire: ['wood'],
  // Le chantier fait entrer le marteau ET le coût de la pièce (retirés du grenier).
  build: ['hammer', 'wood', 'stone', 'cut_stone', 'fiber'],
}

/** Le sac peut-il recevoir ce que cette corvée va y mettre ? (conservateur : tout ou rien) */
function canTakeInFor(entity: Entity, kind: TaskKind): boolean {
  return TASK_INTAKE[kind].every((item) => freeRoomFor(entity.inventory, item) > 0)
}

function claimTask(village: Village, npc: Npc, entity: Entity): void {
  const free = village.tasks
    .filter((t) => t.claimedBy === null && canTakeInFor(entity, t.kind))
    .sort((a, b) => b.priority - a.priority || a.id - b.id)[0]
  if (!free) return
  free.claimedBy = npc.entityId
  const fetchFirst =
    free.kind === 'cook_stew' || free.kind === 'repair' || free.kind === 'feed_fire' || free.kind === 'build'
  npc.task = { id: free.id, kind: free.kind, stage: fetchFirst ? 'fetch' : 'work', nodeId: null }
  npc.path = []
}

/**
 * Le PNJ rend sa corvée. `clearFromBoard` dit ce qu'il advient de la TÂCHE, pas si
 * le travail a été fait :
 *   - `false` → elle retourne au tableau, libre. Pour un empêchement PROPRE À CE
 *     PNJ (sac fermé, cible inatteignable) : un autre la prendra, et TASK_INTAKE
 *     interdit à celui-ci de la re-réclamer au tick suivant.
 *   - `true`  → elle QUITTE le tableau. Pour un empêchement qui vaudrait pour
 *     n'importe qui (grenier plein) : la relâcher, ce serait la voir re-réclamée au
 *     tick suivant par le même PNJ, à l'identique, à 20 Hz. La retirer est le SEUL
 *     temps mort dont on dispose — `refreshBoard` la reposte au prochain
 *     rafraîchissement si le besoin du village tient toujours.
 */
export function dropTask(village: Village, npc: Npc, clearFromBoard: boolean): void {
  if (npc.task) {
    if (clearFromBoard) village.tasks = village.tasks.filter((t) => t.id !== npc.task!.id)
    else {
      const t = village.tasks.find((task) => task.id === npc.task!.id)
      if (t) t.claimedBy = null
    }
  }
  npc.task = null
  npc.path = []
}

// ─── Exécution des tâches ─────────────────────────────────────────────────

function canAct(state: SimState, entity: Entity): boolean {
  return state.tick >= entity.cooldownUntil
}

function executeGather(state: SimState, village: Village, npc: Npc, entity: Entity): void {
  const task = npc.task!
  const def = TASK_DEFS[task.kind as Exclude<TaskKind, 'cook_stew' | 'repair' | 'feed_fire' | 'build'>]

  if (task.stage === 'work') {
    // L'OUTIL AVANT LE NŒUD (spec `glanage.md` G5). La carrière exigeait déjà la pioche
    // d'atelier ; depuis G1, l'ARBRE et le ROCHER exigent au moins l'outil de fortune. Sans
    // cette marche, chaque coup serait refusé à 20 Hz et le village s'éteindrait en silence,
    // ses PNJ plantés devant un tronc. La table du nœud décide — pas une liste de `task.kind`,
    // qui aurait dérivé au premier nœud ajouté.
    //
    // ⚠ **DANS le stade `work`, ET C'EST NÉCESSAIRE.** Placé avant l'aiguillage des stades, il
    // frappait aussi le retour au grenier : une hache qui casse pendant que le PNJ RENTRE, huit
    // bûches sur le dos, lui faisait perdre sa corvée — et sa charge n'arrivait jamais. On ne
    // demande pas son outil à qui a fini de couper.
    //
    // ⚠ **L'ÉCHEC QUITTE LE TABLEAU (`true`), pas « libre ».** C'est la doctrine du coût déjà
    // écrite pour le marteau du chantier : « le village ne peut pas fournir de hache » vaut
    // pour N'IMPORTE QUI. Rendue libre, la corvée — en tête de tableau par priorité — était
    // re-réclamée par le MÊME PNJ au tick suivant (`canTakeInFor` ne juge que la place au sac,
    // jamais l'outil) : réclame→échoue→lâche à 20 Hz, et aucune corvée de rang inférieur ne
    // passait. `refreshBoard` la repostera quand le village pourra la tenir.
    const besoin = outilPourNoeud(def.nodeType)
    if (besoin !== null) {
      const r = ensureOutil(state, village, npc, entity, besoin.acceptes, besoin.repli)
      if (r === 'failed') return dropTask(village, npc, true)
      if (r !== 'ready') return
    }

    if (countOf(entity.inventory, def.item) >= def.carry) {
      task.stage = 'store'
      npc.path = []
      return
    }
    // LA TRAVERSÉE : le sac s'est fermé PENDANT la corvée. TASK_INTAKE ne s'évalue
    // qu'à la réclamation — entre elle et le nœud, la faim a pu voler la dernière
    // case au grenier, ou un joueur gaver le PNJ. Sans cette garde il récolte quand
    // même : la récolte n'a nulle part où aller, le nœud se vide dans le vide, et
    // la chronique reçoit des `resource_harvested` qui mentent (demain, quand la
    // récolte refusera honnêtement, ce sera un livelock sec à 20 Hz).
    if (freeRoomFor(entity.inventory, def.item) === 0) {
      if (countOf(entity.inventory, def.item) > 0) {
        task.stage = 'store' // ce qu'il porte déjà part au grenier : ça libère des cases
        npc.path = []
        return
      }
      return dropTask(village, npc, false) // TASK_INTAKE l'empêchera de la reprendre
    }
    let node = task.nodeId !== null ? state.nodes.find((n) => n.id === task.nodeId) : undefined
    if (!node || node.stock <= 0) {
      node = nearestAliveNode(state, entity, def.nodeType, def.portee ?? Infinity)
      if (!node) {
        // Rien à récolter dans le monde : si on porte déjà quelque chose, on le range.
        if (countOf(entity.inventory, def.item) > 0) task.stage = 'store'
        // …sinon la corvée QUITTE LE TABLEAU (et non « retour au tableau, libre »).
        //
        // « Il n'existe aucun nœud de ce type » n'est PAS un empêchement propre à ce PNJ : ses
        // voisins sont dans la même zone, devant les mêmes falaises, et échoueront à l'identique.
        // La relâcher libre, c'est la voir reprise au tick suivant — même priorité, même id, rien
        // n'a bougé dans le monde — par le même PNJ, pour l'éternité. Et comme la cueillette prime
        // sur le bois, il ne DESCEND JAMAIS jusqu'à la corvée qu'il pourrait faire.
        //
        // Ce n'est pas théorique : c'est ce qui affamait deux villages sur trois en quatre jours
        // sur la carte de production (mesuré — zone du village : 0 buisson sur les 1177 du monde,
        // dix PNJ sans tâche pendant une journée entière, faim de 88 à 4). Le seul survivant était
        // celui qui PILLE. `refreshBoard` la repostera dans cinq minutes de jeu si le besoin tient.
        else dropTask(village, npc, true)
        return
      }
      task.nodeId = node.id
      npc.path = []
    }
    // LE GEL N'EST PAS UN EMPÊCHEMENT PROPRE À CE PNJ (spec `flore-froid.md` F3) — c'est
    // EXACTEMENT le raisonnement du « rien à récolter dans le monde » ci-dessus, et il faut
    // le tenir ici aussi, sinon le remède d'à côté ne sert à rien.
    //
    // Sans cette garde, `applyEconomyAction` REFUSE (« la plante est gelée ») et le PNJ
    // repart pour un tour : le nœud a encore du stock, donc on ne cherche pas ailleurs, la
    // corvée n'est pas relâchée — **il reste planté devant le buisson**. Une nuit d'acte II,
    // c'est une nuit perdue ; en acte III, où plus rien ne dégèle, c'est POUR TOUJOURS : le
    // PNJ ne mange plus, ne descend jamais jusqu'au bois qu'il pourrait couper, et le village
    // s'éteint avec lui. La même famine que celle épinglée plus haut, par une autre porte.
    //
    // Donc : on range ce qu'on porte, ou la corvée QUITTE LE TABLEAU — le voisin gèlerait
    // pareil. `refreshBoard` la reposte au dégel, et la vallée entière dégèle chaque matin
    // jusqu'à l'acte III. On teste AVANT la marche : traverser la carte pour un buisson gelé
    // est un trajet perdu.
    if (NODE_DEFS[node.type].gelif && floreGelee(state, node.tx, node.ty)) {
      if (countOf(entity.inventory, def.item) > 0) task.stage = 'store'
      else dropTask(village, npc, true)
      return
    }
    if (near(entity, node.tx, node.ty)) {
      if (canAct(state, entity)) {
        // La main d'abord : sans outil EN MAIN, la récolte tombe à ×1 (R9).
        equipBestTool(entity, NODE_DEFS[node.type].tool)
        applyEconomyAction(state, entity.id, { type: 'harvest', nodeId: node.id })
      }
      return
    }
    if (npc.path.length === 0 && !setPathTo(state, npc, entity, node.tx, node.ty)) {
      // INACCESSIBLE — et là encore, la corvée QUITTE le tableau. Un nœud qu'aucune route ne
      // rejoint depuis le village n'est pas plus atteignable pour le voisin. Relâchée libre, elle
      // était reprise au tick suivant et **chaque reprise brûle une recherche de chemin complète**
      // (4096 expansions) : mesuré, le tick passait de 1,56 à 26 ms — ×17 — sans que personne ne
      // récolte quoi que ce soit. Retirée du tableau, la tentative ne coûte plus qu'une fois par
      // rafraîchissement, et le PNJ passe à la corvée suivante.
      dropTask(village, npc, true)
      return
    }
    followPath(state, npc, entity)
    return
  }

  // stage 'store' : déposer au grenier (en gardant de quoi manger, spec R6).
  const chest = granaries(state, village.id)[0]
  if (!chest) {
    dropTask(village, npc, false)
    return
  }
  if (near(entity, chest.tx, chest.ty)) {
    const keep = def.item === 'berries' ? NPC_AI.FOOD_KEEP : 0
    const count = countOf(entity.inventory, def.item) - keep
    if (count > 0) deposit(state, entity, chest.id, def.item, count)
    // Grenier plein (dépôt à 0) : le PNJ GARDE sa récolte — rien ne se détruit —
    // et la corvée quitte le tableau quand même. Ce n'est pas « accompli » : c'est
    // le seul temps mort disponible (cf. dropTask). La relâcher libre, ce serait
    // la re-réclamer au tick suivant, ici même, pour l'éternité.
    dropTask(village, npc, true)
    return
  }
  if (npc.path.length === 0 && !setPathTo(state, npc, entity, chest.tx, chest.ty)) {
    dropTask(village, npc, false)
    return
  }
  followPath(state, npc, entity)
}

// ─── Le chantier (spec village-pnj-evolution R4-R5) ───────────────────────

/** Empoigne une case précise par item (le marteau, le composant à poser). */
function equipItem(entity: Entity, item: ItemId): boolean {
  for (let i = 0; i < entity.inventory.length; i++) {
    const slot = entity.inventory[i]
    if (slot && slot.item === item) {
      entity.activeSlot = liftIntoBelt(entity, i)
      return true
    }
  }
  return false
}

type CraftProgress = 'ready' | 'busy' | 'failed'

/**
 * FAIT AVANCER un artisanat d'une recette : intrants retirés du grenier, enfilage à
 * la station du VILLAGE (le Feu, l'établi), attente SUR PLACE — s'éloigner mettrait
 * la file en pause (spec craft-file F7). 'ready' = l'objet est dans le sac ;
 * 'busy' = le geste a consommé le tick ; 'failed' = impossible ici et maintenant
 * (station absente, grenier à sec, sac plein) — l'appelant lâche sa corvée.
 */
function progressCraft(state: SimState, village: Village, npc: Npc, entity: Entity, recipeId: RecipeId): CraftProgress {
  const recipe = RECIPES[recipeId]
  if (countOf(entity.inventory, recipe.output) > 0) return 'ready'
  // LA STATION DU VILLAGE qui sert l'exigence de la recette (2026-08-01) : on ne cherche
  // plus un TYPE d'objet mais une CAPACITÉ, donc un four d'acier fait aussi bien qu'un four.
  const besoin = recipe.requiert
  const station =
    besoin === null ? undefined : state.structures.find((s) => sertExigence(s.type, besoin) && s.villageId === village.id)
  if (besoin !== null && station === undefined) return 'failed'
  if (entity.craftQueue.some((o) => o.recipeId === recipeId)) {
    // La file travaille : on reste à portée de la station, on ne fait rien d'autre.
    if (station && !near(entity, station.tx, station.ty)) {
      if (npc.path.length === 0 && !setPathTo(state, npc, entity, station.tx, station.ty)) return 'failed'
      followPath(state, npc, entity)
    }
    return 'busy'
  }
  if (freeRoomFor(entity.inventory, recipe.output) === 0) return 'failed'
  // Les intrants manquants, du grenier vers le sac — un aller par coffre.
  for (const item of Object.keys(recipe.inputs) as ItemId[]) {
    const need = (recipe.inputs[item] ?? 0) - countOf(entity.inventory, item)
    if (need <= 0) continue
    const chest = granaries(state, village.id).find((c) => countOf(c.inventory ?? [], item) > 0)
    if (!chest) return 'failed'
    if (near(entity, chest.tx, chest.ty)) {
      if (withdraw(state, entity, chest.id, item, Math.min(need, countOf(chest.inventory ?? [], item))) === 0) {
        return 'failed'
      }
      return 'busy'
    }
    if (npc.path.length === 0 && !setPathTo(state, npc, entity, chest.tx, chest.ty)) return 'failed'
    followPath(state, npc, entity)
    return 'busy'
  }
  // Tout est en poche : à la station, et on enfile.
  if (station && !near(entity, station.tx, station.ty)) {
    if (npc.path.length === 0 && !setPathTo(state, npc, entity, station.tx, station.ty)) return 'failed'
    followPath(state, npc, entity)
    return 'busy'
  }
  applyEconomyAction(state, entity.id, { type: 'craft', recipeId })
  return entity.craftQueue.some((o) => o.recipeId === recipeId) ? 'busy' : 'failed'
}

/** Le marteau du chantier : en poche, sinon au grenier, sinon FORGÉ au Feu (R5). */
function ensureHammer(state: SimState, village: Village, npc: Npc, entity: Entity): CraftProgress {
  if (countOf(entity.inventory, 'hammer') > 0) return 'ready'
  const chest = granaries(state, village.id).find((c) => countOf(c.inventory ?? [], 'hammer') > 0)
  if (chest) {
    if (near(entity, chest.tx, chest.ty)) {
      return withdraw(state, entity, chest.id, 'hammer', 1) > 0 ? 'busy' : 'failed'
    }
    if (npc.path.length === 0 && !setPathTo(state, npc, entity, chest.tx, chest.ty)) return 'failed'
    followPath(state, npc, entity)
    return 'busy'
  }
  return progressCraft(state, village, npc, entity, 'hammer')
}

/**
 * ═══ L'OUTIL QUE LE VILLAGE FOURNIT (spec `glanage.md` G5) ═══
 *
 * En poche → au grenier → sinon on le FAÇONNE. Trois marches, dans cet ordre, et c'est le
 * patron qu'`ensurePickaxe` tenait déjà pour la carrière ; depuis que le bois et la pierre
 * exigent un outil (G1), la hache et la pioche de fortune passent par le même chemin — sans
 * quoi un village neuf n'aurait plus AUCUN moyen de couper un arbre.
 *
 * `acceptes` est ordonné du plus MODESTE au plus riche : on sort le hachereau du grenier avant
 * la hache de fer. Ce n'est pas de l'avarice, c'est ce qui laisse l'outil de métier à qui en
 * fera quelque chose — et `equipBestTool` reclasse de toute façon au moment de frapper.
 */
function ensureOutil(
  state: SimState,
  village: Village,
  npc: Npc,
  entity: Entity,
  acceptes: readonly ItemId[],
  repli: RecipeId,
): CraftProgress {
  if (acceptes.some((p) => countOf(entity.inventory, p) > 0)) return 'ready'
  for (const p of acceptes) {
    const chest = granaries(state, village.id).find((c) => countOf(c.inventory ?? [], p) > 0)
    if (!chest) continue
    if (near(entity, chest.tx, chest.ty)) {
      return withdraw(state, entity, chest.id, p, 1) > 0 ? 'busy' : 'failed'
    }
    if (npc.path.length === 0 && !setPathTo(state, npc, entity, chest.tx, chest.ty)) return 'failed'
    followPath(state, npc, entity)
    return 'busy'
  }
  // LA CORDE D'ABORD, ET C'EST LE MAILLON QU'ON OUBLIE. Tout outil de fortune en coûte une
  // (`craft-fortune` C8 : la corde est le goulot volontaire de la couche 1), or `progressCraft`
  // ne sait que RETIRER des intrants du grenier — il ne sait pas en fabriquer. Sans cette
  // marche, un village qui a la fibre et pas la corde échouait en boucle sur `crude_axe`.
  const rope = RECIPES[repli].inputs.rope ?? 0
  if (
    rope > 0 &&
    countOf(entity.inventory, 'rope') < rope &&
    !granaries(state, village.id).some((c) => countOf(c.inventory ?? [], 'rope') > 0)
  ) {
    const r = progressCraft(state, village, npc, entity, 'rope')
    if (r !== 'ready') return r
  }
  return progressCraft(state, village, npc, entity, repli)
}

/** La pioche de la carrière (minTool basic, garde dure) : portée, au grenier, ou
 *  façonnée à l'ÉTABLI du village — c'est pour ça que l'établi précède la pierre. */
const QUARRY_PICKS: readonly ItemId[] = ['pickaxe', 'iron_pickaxe', 'steel_pickaxe']

/** L'outil qu'exige ce nœud, ou `null` s'il se prend à la main (la cueillette, le glanage). */
function outilPourNoeud(type: NodeType): { acceptes: readonly ItemId[]; repli: RecipeId } | null {
  const def = NODE_DEFS[type]
  if (TOOL_RANK[def.minTool] === 0) return null // rien à tenir : le geste est nu
  if (def.tool === 'axe') return { acceptes: OUTILS_PAR_FAMILLE.axe, repli: 'crude_axe' }
  if (def.tool === 'pickaxe') {
    // Le palier `basic` (filon, carrière, gravats) n'accepte PAS la fortune : trois pierres
    // ficelées ne valent pas une forge (`craft-fortune` C5). La liste porte cette règle.
    return TOOL_RANK[def.minTool] > 1
      ? { acceptes: QUARRY_PICKS, repli: 'pickaxe' }
      : { acceptes: OUTILS_PAR_FAMILLE.pickaxe, repli: 'crude_pickaxe' }
  }
  return null // la canne et le couteau ont leurs propres chemins (pêche, dépeçage)
}

/** La pièce de cet ordre est-elle déjà dans le monde ? (le verdict d'accompli) */
function orderDone(state: SimState, order: BuildOrder): boolean {
  // DÉFRICHÉ = `poseLibre`, jamais « le nœud a disparu ». Un nœud récolté RESTE dans
  // `state.nodes` à stock 0 (voir `defriche.ts` : le retirer ferait dessiner un arbre fantôme
  // au client, qui ne reçoit les nœuds qu'une fois). Le verdict doit donc lire le MÊME
  // prédicat que la pose — sinon la corvée se croirait éternellement inachevée.
  if (order.action === 'defriche') return poseLibre(state.villages, state.nodes, order.tx, order.ty)
  if (order.action === 'pose') {
    if (order.structure === 'floor') return floorAt(state.structures, order.tx, order.ty) !== undefined
    if (order.edges !== undefined) return edgeBarrierAt(state.structures, order.tx, order.ty, order.edges) !== undefined
    return fullTileAt(state.structures, order.tx, order.ty) !== undefined
  }
  if (order.action === 'place') return fullTileAt(state.structures, order.tx, order.ty)?.type === order.component
  const s = state.structures.find((st) => st.id === order.structureId)
  return s === undefined || (s.material ?? 'wood') !== 'wood' // tombée ou déjà montée : accompli
}

/**
 * BÂTIR (spec village-pnj-evolution R4) : fetch (marteau/composant + coût, retirés
 * du grenier) → le site → LE GESTE, par le pipeline joueur (`applyVillageAction`,
 * pnj R1). Un refus de pose ne se retente pas à 20 Hz : la corvée QUITTE le tableau
 * — le rafraîchissement la repostera si le plan la veut toujours.
 */
function executeBuild(state: SimState, village: Village, npc: Npc, entity: Entity): void {
  const task = npc.task!
  const order = village.tasks.find((t) => t.id === task.id)?.build
  if (!order) return dropTask(village, npc, true)
  if (orderDone(state, order)) return dropTask(village, npc, true) // un autre a fini, ou le monde a bougé

  if (task.stage !== 'work') {
    // 1. L'OUTIL : le marteau pour poser/monter — un composant se pose à la main.
    //
    // L'ÉCHEC QUITTE LE TABLEAU (drop TRUE) — la doctrine du coût (étape 3) : ne pas
    // pouvoir forger le marteau (pas de pierre au grenier) vaut pour N'IMPORTE QUI.
    // Rendue LIBRE (drop false), la tâche — tête de tableau par priorité — était
    // re-réclamée par le MÊME PNJ au tick suivant : réclame→échoue→lâche à 20 Hz,
    // AUCUNE corvée de rang inférieur ne passait, le village entier s'affamait.
    // MESURÉ (graine 7, R15 : l'anneau en tête AVANT l'économie de pierre) : 122
    // récoltes en 6 jours contre 436, Foyer mort au j3 — et 67 % d'oisiveté sur le
    // monde d'AVANT R15 : la boucle mordait déjà, R15 l'a rendue fatale. Le repost
    // attend la PROCHAINE FENÊTRE de cadence (240 s enceinte / 420 s hameau) — c'est
    // le prix d'une fenêtre, assumé : entre-temps, on cueille (dont la pierre qui
    // manquait). Grain perdu assumé aussi : un échec PROPRE AU PNJ (sac plein au
    // retrait du marteau) retire la tâche pareil — borné à une fenêtre, strictement
    // mieux que le livelock ; un CraftProgress qui porte sa cause serait le fin mot.
    // ON N'ABAT PAS UN ARBRE AU MARTEAU. `defriche` passait par cette branche — donc le
    // villageois exigeait un marteau pour aller couper du bois, et lâchait la corvée quand le
    // village n'avait pas la pierre pour le forger. Résultat mesuré : l'arbre restait debout
    // indéfiniment. Sa hache, il l'équipe au moment de frapper (`equipBestTool`), comme le
    // bûcheron ordinaire.
    if (order.action !== 'place' && order.action !== 'defriche') {
      const r = ensureHammer(state, village, npc, entity)
      if (r === 'failed') return dropTask(village, npc, true)
      if (r !== 'ready') return
    }
    // 2. LE COMPOSANT à poser s'assemble au Feu (recette existante, coût du grenier).
    if (order.action === 'place') {
      const r = progressCraft(state, village, npc, entity, order.component)
      if (r === 'failed') return dropTask(village, npc, true)
      if (r !== 'ready') return
    }
    // 3. LE COÛT de la pose/montée, retiré du grenier. (`defriche` ne coûte rien — il RAPPORTE.)
    if (order.action !== 'place' && order.action !== 'defriche') {
      const cost = orderCost(order)
      for (const item of Object.keys(cost) as ItemId[]) {
        const need = (cost[item] ?? 0) - countOf(entity.inventory, item)
        if (need <= 0) continue
        const chest = granaries(state, village.id).find((c) => countOf(c.inventory ?? [], item) > 0)
        // Le grenier s'est vidé depuis que le tableau a jugé le coût couvert : empêchement
        // de VILLAGE, pas de PNJ — la corvée quitte le tableau, il la repostera garni.
        if (!chest) return dropTask(village, npc, true)
        if (near(entity, chest.tx, chest.ty)) {
          if (withdraw(state, entity, chest.id, item, Math.min(need, countOf(chest.inventory ?? [], item))) === 0) {
            return dropTask(village, npc, false) // sac plein : propre à CE PNJ
          }
          return
        }
        if (npc.path.length === 0 && !setPathTo(state, npc, entity, chest.tx, chest.ty)) {
          return dropTask(village, npc, false)
        }
        followPath(state, npc, entity)
        return
      }
    }
    task.stage = 'work'
    npc.path = []
  }

  // ── Le site, puis le geste. ──
  const target = order.action === 'upgrade' ? state.structures.find((s) => s.id === order.structureId) : undefined
  const tx = order.action === 'upgrade' ? target!.tx : order.tx // orderDone garantit la cible
  const ty = order.action === 'upgrade' ? target!.ty : order.ty
  // ═══ ON N'ABAT PAS UN ARBRE À CINQ TUILES ═══
  //
  // `BUILD_RANGE` vaut 6 et `INTERACT_RANGE` 1,5 : un bâtisseur pose une pièce de loin, un
  // bûcheron doit toucher son arbre. Le défrichement empruntait la portée du BÂTISSEUR, donc
  // le villageois s'arrêtait à 5,5 tuiles et envoyait un `harvest` que l'économie refusait —
  // à chaque tick, indéfiniment. MESURÉ : l'arbre restait à 10 de stock après une fenêtre de
  // chantier entière (8 400 ticks), la corvée dûment servie et réclamée. Le geste décide de
  // la portée, jamais la corvée qui le porte.
  const portee = order.action === 'defriche' ? RANGE : BALANCE.BUILD_RANGE - 0.5
  // DÉFRICHER, C'EST ABATTRE (spec `glanage.md` G5) : le geste est un `harvest`, donc il tombe
  // sous le même verrou d'outil que la corvée de bois. Sans cette marche, un village neuf
  // s'arrêtait à son premier arbre de cour — et le défrichement est déjà le poste le plus
  // tendu du chantier (une fenêtre par arbre). L'outil s'assure AVANT la marche : traverser la
  // cour pour se faire refuser le coup est un trajet perdu, exactement comme pour le gel.
  if (order.action === 'defriche') {
    const n = state.nodes.find((x) => x.tx === order.tx && x.ty === order.ty && x.stock > 0)
    const besoin = n === undefined ? null : outilPourNoeud(n.type)
    if (besoin !== null) {
      const r = ensureOutil(state, village, npc, entity, besoin.acceptes, besoin.repli)
      // ÉCHEC = LA CORVÉE QUITTE LE TABLEAU (drop TRUE), la doctrine du coût de cette fonction :
      // « le village ne peut pas fournir de hache » vaut pour n'importe qui, et une corvée
      // relâchée libre en tête de tableau est re-réclamée par le même PNJ à 20 Hz.
      if (r === 'failed') return dropTask(village, npc, true)
      if (r !== 'ready') return
    }
  }
  if (near(entity, tx, ty, portee)) {
    // Un composant BLOQUE et refuse « pas sous ses pieds » : on s'écarte d'un pas.
    if (order.action === 'place' && Math.floor(entity.x) === tx && Math.floor(entity.y) === ty) {
      const sx = (village.fireTx + 0.5 > entity.x ? 1 : -1) as -1 | 1
      const moved = moveAvatar(moveWorldFor(state, npc.villageId), entity.x, entity.y, sx, 0, TICK_DT_S)
      entity.moved = moved.x !== entity.x || moved.y !== entity.y
      entity.x = moved.x
      entity.y = moved.y
      return
    }
    // Le marteau ne sert qu'à POSER et à MONTER : le défrichement équipe sa hache plus bas
    // (`equipBestTool`), et lui coller un marteau en main l'aurait fait cogner avec.
    if (order.action !== 'defriche') equipItem(entity, order.action === 'place' ? order.component : 'hammer')
    if (order.action === 'pose') {
      applyVillageAction(state, entity.id, {
        type: 'build',
        structure: order.structure,
        tx: order.tx,
        ty: order.ty,
        ...(order.material !== undefined ? { material: order.material } : {}),
        ...(order.edges !== undefined ? { edges: order.edges } : {}),
      })
    } else if (order.action === 'place') {
      applyVillageAction(state, entity.id, { type: 'place_component', tx: order.tx, ty: order.ty })
    } else if (order.action === 'defriche') {
      // LE MÊME GESTE QUE LE BÛCHERON, pas un raccourci : on équipe le meilleur outil pour ce
      // nœud puis on frappe par le pipeline d'économie (`harvest`), comme `executeGather`. Le
      // bois tombe donc dans le sac du villageois et repart au grenier par le circuit normal —
      // défricher sa cour APPROVISIONNE le village au lieu de faire disparaître un arbre.
      //
      // ═══ ON RESTE JUSQU'À CE QUE L'ARBRE TOMBE — un bûcheron ne part pas après UN coup ═══
      //
      // Premier jet : un coup, puis `dropTask`, et le tableau repostait l'ordre à la fenêtre
      // suivante. MESURÉ sur le vrai worldgen (`construireMondeDuBanc`), c'était FATAL : un
      // arbre porte 10 de stock, une fenêtre de chantier dure 8 400 ticks, et le pire village
      // du banc a 51 arbres (550 de stock) dans sa cour — **80 cycles de défrichement pour une
      // saison qui en compte 6**. Le village n'aurait jamais posé un seul sol. Même en se
      // limitant aux logis (231 de stock), c'était 34 cycles : ce n'était donc pas la PORTÉE
      // qui était en cause, c'était l'exécution.
      //
      // On garde donc la corvée tant que le nœud n'est pas vidé — exactement ce que fait
      // `executeGather`, qui reste sur son nœud jusqu'à sa charge. Une fenêtre par ARBRE au
      // lieu d'une par coup : 7,4 cycles pour le pire village, 0,6 et 1,2 pour les deux
      // autres. Le `dropTask` final n'a pas lieu : on rend la main sans lâcher la tâche.
      const node = state.nodes.find((n) => n.tx === order.tx && n.ty === order.ty && n.stock > 0)
      if (node) {
        if (canAct(state, entity)) {
          equipBestTool(entity, NODE_DEFS[node.type].tool)
          applyEconomyAction(state, entity.id, { type: 'harvest', nodeId: node.id })
        }
        return // ON GARDE LA CORVÉE : l'arbre n'est pas tombé.
      }
    } else {
      applyVillageAction(state, entity.id, { type: 'upgrade_structure', structureId: order.structureId })
    }
    // Accompli ou refusé : la corvée quitte le tableau dans les deux cas — un refus
    // retenté à 20 Hz serait un livelock sec, et le tableau SAIT reposer.
    return dropTask(village, npc, true)
  }
  // ═══ ON NE MARCHE PAS SUR L'ARBRE QU'ON VIENT ABATTRE ═══
  //
  // Un nœud vivant BLOQUE sa tuile (`collision.ts` teste `stock > 0`). Viser cette tuile fait
  // échouer la recherche de chemin, et un chemin qui échoue LÂCHE la corvée — TRACÉ : le
  // villageois entrait bien dans `executeBuild`, franchissait la phase de fourniture, puis
  // rendait son ordre au premier pas. L'arbre restait debout pour toujours, corvée servie et
  // réclamée. On vise donc la VOISINE la plus proche de nous qui soit libre : de là, la portée
  // d'interaction porte jusqu'au tronc. (Poser et monter n'ont jamais eu ce problème : on bâtit
  // sur une tuile qu'on peut occuper.)
  let cx = tx
  let cy = ty
  if (order.action === 'defriche') {
    let best = Infinity
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = tx + dx
      const ny = ty + dy
      if (nx < 0 || ny < 0 || nx >= state.map.width || ny >= state.map.height) continue
      if (isBlockedAt(moveWorldFor(state, npc.villageId), nx, ny)) continue
      const d = distSq(entity.x, entity.y, nx + 0.5, ny + 0.5)
      if (d < best) { best = d; cx = nx; cy = ny }
    }
    // Aucune voisine libre : l'arbre est enclavé, la corvée n'a rien à faire là.
    if (best === Infinity) return dropTask(village, npc, true)
  }
  if (npc.path.length === 0 && !setPathTo(state, npc, entity, cx, cy)) return dropTask(village, npc, true)
  followPath(state, npc, entity)
}

function executeCook(state: SimState, village: Village, npc: Npc, entity: Entity): void {
  const task = npc.task!
  const chest = granaries(state, village.id)[0]
  if (!chest) return dropTask(village, npc, false)

  if (task.stage === 'fetch') {
    const needBerries = 4 - countOf(entity.inventory, 'berries')
    const needFiber = 1 - countOf(entity.inventory, 'fiber')
    if (needBerries <= 0 && needFiber <= 0) {
      task.stage = 'craft'
      npc.path = []
      return
    }
    if (near(entity, chest.tx, chest.ty)) {
      const inv = chest.inventory ?? []
      // Un retrait qui ne rapporte rien (sac plein) : on lâche la tâche — elle
      // retourne au tableau, pour un PNJ qui a de la place. Celui-ci ne la
      // reprendra pas : TASK_INTAKE le rend inéligible tant que son sac est plein.
      if (needBerries > 0 && countOf(inv, 'berries') >= needBerries) {
        if (withdraw(state, entity, chest.id, 'berries', needBerries) === 0) dropTask(village, npc, false)
      } else if (needFiber > 0 && countOf(inv, 'fiber') >= needFiber) {
        if (withdraw(state, entity, chest.id, 'fiber', needFiber) === 0) dropTask(village, npc, false)
      } else {
        dropTask(village, npc, false) // le grenier s'est vidé entre-temps
      }
      return
    }
    if (npc.path.length === 0 && !setPathTo(state, npc, entity, chest.tx, chest.ty)) return dropTask(village, npc, false)
    followPath(state, npc, entity)
    return
  }

  if (task.stage === 'craft') {
    if (countOf(entity.inventory, 'stew') > 0) {
      task.stage = 'store'
      npc.path = []
      return
    }
    const fire = state.structures.find((s) => s.type === 'fire' && s.villageId === village.id)
    if (!fire) return dropTask(village, npc, false)
    if (near(entity, fire.tx, fire.ty)) {
      // LE RAGOÛT MIJOTE (spec craft-file F17) : depuis la file, le craft n'est
      // plus instantané. Le PNJ ATTEND au Feu — et il y reste, car s'en éloigner
      // METTRAIT LA FILE EN PAUSE (F7). Sans cette garde, il réenfilerait une
      // marmite par tick : 20 ragoûts par seconde, et le grenier vidé.
      if (entity.craftQueue.some((o) => o.recipeId === 'stew')) return
      // ON N'ENFILE PAS CE QU'ON NE POURRA PAS RANGER. La file ATTEND quand le sac
      // est plein (F10) : c'est bon pour un joueur, qui voit sa file bouchée et
      // fait de la place — c'est un LIVELOCK pour un PNJ, qui resterait planté au
      // Feu avec sa marmite prête, sa corvée sur le dos, pour l'éternité. Il lâche
      // la corvée (elle retourne au tableau, pour un PNJ qui a de la place) — et
      // ses ingrédients ne sont même pas consommés.
      if (freeRoomFor(entity.inventory, 'stew') <= 0) return dropTask(village, npc, false)
      if (canAct(state, entity)) {
        applyEconomyAction(state, entity.id, { type: 'craft', recipeId: 'stew' })
        // L'enfilage a échoué (ingrédients manquants, file pleine) : on lâche la
        // corvée plutôt que de la retenter 20 fois par seconde — un refus ne pose
        // aucun cooldown. TASK_INTAKE interdit de la re-réclamer sans place.
        if (!entity.craftQueue.some((o) => o.recipeId === 'stew')) return dropTask(village, npc, false)
      }
      return
    }
    if (npc.path.length === 0 && !setPathTo(state, npc, entity, fire.tx, fire.ty)) return dropTask(village, npc, false)
    followPath(state, npc, entity)
    return
  }

  // stage 'store' — grenier plein : le PNJ garde le ragoût et lâche la corvée.
  if (near(entity, chest.tx, chest.ty)) {
    const count = countOf(entity.inventory, 'stew')
    if (count > 0) deposit(state, entity, chest.id, 'stew', count)
    dropTask(village, npc, true)
    return
  }
  if (npc.path.length === 0 && !setPathTo(state, npc, entity, chest.tx, chest.ty)) return dropTask(village, npc, false)
  followPath(state, npc, entity)
}

/** Réparer : chercher du bois au grenier si besoin, puis marteler (spec événements R2). */
function executeRepair(state: SimState, village: Village, npc: Npc, entity: Entity): void {
  const task = npc.task!
  const target = state.structures.find((s) => s.id === village.tasks.find((t) => t.id === task.id)?.structureId)
  if (!target || target.hp >= STRUCTURE_HP[target.type]) return dropTask(village, npc, true)

  // « Assez de bois pour UN coup de marteau », pas « du bois » : avec un seul bois
  // et un coût à 2, `repair` refuserait à chaque tick (un refus ne pose pas de
  // cooldown) sans jamais renvoyer au grenier. On lit le coût, on ne le redit pas.
  const enoughWood = (): boolean => countOf(entity.inventory, 'wood') >= WORLD_EVENTS.REPAIR_WOOD_COST

  if (task.stage === 'fetch' && !enoughWood()) {
    const chest = granaries(state, village.id).find((c) => countOf(c.inventory ?? [], 'wood') > 0)
    if (!chest) return dropTask(village, npc, false) // pas de bois : on abandonne
    if (near(entity, chest.tx, chest.ty)) {
      const got = withdraw(
        state,
        entity,
        chest.id,
        'wood',
        Math.min(NPC_AI.REPAIR_WOOD_WITHDRAW, countOf(chest.inventory ?? [], 'wood')),
      )
      // Sac plein : sans bois, l'étape 'work' renverrait aussitôt vers 'fetch' —
      // un aller-retour perpétuel entre le grenier et la structure. On lâche : la
      // tâche retourne au tableau (un autre PNJ la prendra), et TASK_INTAKE
      // interdit à CELUI-CI de la re-réclamer au tick suivant.
      if (got === 0) return dropTask(village, npc, false)
      task.stage = 'work'
      return
    }
    if (npc.path.length === 0 && !setPathTo(state, npc, entity, chest.tx, chest.ty)) return dropTask(village, npc, false)
    followPath(state, npc, entity)
    return
  }
  task.stage = 'work'

  if (near(entity, target.tx, target.ty)) {
    if (state.tick >= entity.cooldownUntil) {
      applyVillageAction(state, entity.id, { type: 'repair', structureId: target.id })
      if (!enoughWood()) task.stage = 'fetch'
    }
    return
  }
  if (npc.path.length === 0 && !setPathTo(state, npc, entity, target.tx, target.ty)) return dropTask(village, npc, false)
  followPath(state, npc, entity)
}

/** Nourrir le Feu (spec construction R16) : chercher du bois au grenier si besoin,
 *  puis le donner au Feu. La tâche communautaire zéro — sans elle, le village tombe. */
function executeFeedFire(state: SimState, village: Village, npc: Npc, entity: Entity): void {
  const task = npc.task!
  // Feu au plein → tâche finie (refreshBoard la purgera de toute façon).
  if (village.fuel >= FIRE_UPKEEP.CAPACITY) return dropTask(village, npc, true)
  const hasWood = (): boolean => countOf(entity.inventory, 'wood') > 0

  if (task.stage === 'fetch' && !hasWood()) {
    const chest = granaries(state, village.id).find((c) => countOf(c.inventory ?? [], 'wood') > 0)
    if (!chest) return dropTask(village, npc, false) // pas de bois au grenier : on abandonne
    if (near(entity, chest.tx, chest.ty)) {
      const got = withdraw(state, entity, chest.id, 'wood', Math.min(NPC_AI.REPAIR_WOOD_WITHDRAW, countOf(chest.inventory ?? [], 'wood')))
      if (got === 0) return dropTask(village, npc, false)
      task.stage = 'work'
      return
    }
    if (npc.path.length === 0 && !setPathTo(state, npc, entity, chest.tx, chest.ty)) return dropTask(village, npc, false)
    followPath(state, npc, entity)
    return
  }
  task.stage = 'work'

  if (near(entity, village.fireTx, village.fireTy)) {
    if (state.tick >= entity.cooldownUntil) {
      applyVillageAction(state, entity.id, { type: 'feed_fire' })
      if (!hasWood()) task.stage = 'fetch'
    }
    return
  }
  if (npc.path.length === 0 && !setPathTo(state, npc, entity, village.fireTx, village.fireTy)) return dropTask(village, npc, false)
  followPath(state, npc, entity)
}

// ─── La milice émergente (spec combat R13) ────────────────────────────────

/** Une menace (monstre ou raider agresseur) près du Feu ? Tout PNJ la combat. */
function handleDefense(state: SimState, village: Village, npc: Npc, entity: Entity): boolean {
  let threat: Entity | undefined
  let bestD = COMBAT.DEFEND_RADIUS * COMBAT.DEFEND_RADIUS
  for (const e of state.entities) {
    if (e.id === entity.id || e.hp <= 0 || !isThreatTo(state, e.id, village)) continue
    const d = distSq(e.x, e.y, village.fireTx + 0.5, village.fireTy + 0.5)
    if (d < bestD) {
      threat = e
      bestD = d
    }
  }
  if (!threat) {
    npc.defendStuck = 0
    npc.defendBest = -1
    return false
  }
  // On a renoncé à cette menace il y a peu : on la laisse tranquille (elle est
  // inatteignable) et on vit — manger, dormir, travailler.
  if (state.tick < npc.defendIgnoreUntil) return false

  npc.sleeping = false // l'alarme silencieuse : on se lève
  if (entity.windup) return true
  // ON TIRE SON ARME AVANT DE MESURER SA PORTÉE. La lance en main, pas dans le dos
  // (spec inventaire R9) — et c'est un préalable, pas une coquetterie : la distance
  // d'engagement DÉCOULE de ce qu'on tient (`engageRange`). Un milicien qui n'aurait
  // pas encore dégainé s'approcherait à distance de poing pour frapper à la lance.
  equipBestWeapon(entity)
  const reach = engageRange(entity)
  const d2 = distSq(entity.x, entity.y, threat.x, threat.y)
  if (d2 <= reach * reach) {
    npc.defendStuck = 0 // au contact : on se bat (la faim critique, elle, décroche)
    npc.defendBest = -1
    if (state.tick >= entity.cooldownUntil && entity.stamina >= weaponProfile(entity).light.stamina) {
      if (startAttack(state, entity, threat.x - entity.x, threat.y - entity.y)) {
        entity.cooldownUntil = state.tick + COMBAT.ATTACK_COOLDOWN_TICKS
      }
    }
    return true
  }
  // Marche GLOUTONNE vers la menace — sans pathfinding. Le commentaire d'origine
  // disait « le village est un terrain ouvert » : la vallée, elle, ne l'est pas.
  const zm = NPC_AI.STEP_DEADZONE_COARSE
  const sx = (threat.x - entity.x > zm ? 1 : threat.x - entity.x < -zm ? -1 : 0) as -1 | 0 | 1
  const sy = (threat.y - entity.y > zm ? 1 : threat.y - entity.y < -zm ? -1 : 0) as -1 | 0 | 1
  const moved = moveAvatar(moveWorldFor(state, npc.villageId), entity.x, entity.y, sx, sy, TICK_DT_S)
  entity.moved = moved.x !== entity.x || moved.y !== entity.y
  entity.x = moved.x
  entity.y = moved.y

  /*
   * ANTI-LIVELOCK (même doctrine que handleCold/handleHunger/handleSleep) : une
   * menace qu'on n'ATTEINT PAS ne doit pas manger toutes les décisions de ce PNJ
   * jusqu'à sa mort de faim.
   *
   * On mesure le PROGRÈS, pas le mouvement — et la nuance est tout le correctif :
   * contre un rocher, `moveAvatar` fait GLISSER le long de l'obstacle. Le PNJ
   * bouge donc à chaque tick, sans jamais se rapprocher d'un pouce. Un compteur
   * de « je n'ai pas bougé » ne se déclenchait jamais. Un compteur de « je ne me
   * rapproche pas » attrape le rocher — et, en prime, la bête qui fuit plus vite
   * qu'on ne court : on ne poursuit pas un cerf jusqu'à en mourir.
   */
  const after = distSq(entity.x, entity.y, threat.x, threat.y)
  if (npc.defendBest < 0 || after < npc.defendBest) {
    npc.defendBest = after // un vrai progrès : on n'a jamais été aussi près
    npc.defendStuck = 0
  } else {
    npc.defendStuck += 1
  }
  if (npc.defendStuck < NPC_AI.DEFENSE_GIVE_UP_TICKS) return true

  // On renonce, et on l'oublie un moment : la menace est hors d'atteinte.
  npc.defendIgnoreUntil = state.tick + NPC_AI.DEFENSE_IGNORE_TICKS
  npc.defendStuck = 0
  npc.defendBest = -1
  return false
}

// ─── La passe PNJ du tick ─────────────────────────────────────────────────

export function advanceNpcs(state: SimState): void {
  // Arrivée des PNJ d'accueil (spec R9) + rafraîchissement des tableaux.
  for (const village of state.villages) {
    if (!village.npcsArrived) {
      village.npcsArrived = true
      spawnNpcsAround(state, village, BALANCE.NPC_PER_VILLAGE)
    }
    if (state.tick % BALANCE.BOARD_REFRESH_TICKS === 0) refreshBoard(state, village)
  }
  assignErrands(state)

  for (const npc of state.npcs) {
    const entity = state.entities.find((e) => e.id === npc.entityId)
    const village = state.villages.find((v) => v.id === npc.villageId)
    if (!entity || !village) continue

    if (!npc.sleeping) {
      npc.energy = Math.max(0, npc.energy - BALANCE.ENERGY_AWAKE_PER_CYCLE_HOUR / TICKS_PER_HOUR)
    }
    // Assignation du domicile : première maison OU paillasse libre du village
    // (spec R7 ; village-pnj-evolution R2 — le campement loge sur des paillasses).
    if (npc.homeId === null) {
      const taken = new Set(state.npcs.map((n) => n.homeId))
      const home = state.structures.find(
        (s) => (s.type === 'house' || s.type === 'paillasse') && s.villageId === village.id && !taken.has(s.id),
      )
      if (home) npc.homeId = home.id
    }

    // La défense du village prime sur tout (spec combat R13) — SAUF sur la survie
    // de celui qui défend : sous `DEFENSE_YIELD_HUNGER`, manger passe devant. Un
    // défenseur mort de faim ne défend rien, et manger prend UN tick (il a des
    // baies en poche, ou le grenier à trois pas). Sans cette porte, un zombie
    // posté hors d'atteinte affamait tout le village, grenier plein.
    const starving = entity.hunger <= NPC_AI.DEFENSE_YIELD_HUNGER
    // LE SANG CÈDE LA DÉFENSE, comme la faim (même doctrine que DEFENSE_YIELD_HUNGER) :
    // un défenseur qui se vide (1,5 PV/s) ne défend rien — il se panse d'abord (R13).
    // …MAIS SEULEMENT SI UN BANDAGE EXISTE. Céder sans fibre nulle part n'est pas un
    // repli de soin, c'est une désertion : MESURÉ au banc (graine 2026, grenier de
    // fondation à 2 fibres pour un coût de 3) — la milice blessée quittait le front
    // sans pouvoir se panser, 10 morts aux j6-12 greniers pleins. Sans bandage
    // possible, on se bat en saignant — la mort au front vaut mieux que la mort en
    // errant, et la fibre récoltée demain rouvrira le repli de soin.
    const bleeding =
      entity.wounds.bleeding === true &&
      (countOf(entity.inventory, 'fiber') >= COMBAT.BANDAGE_FIBER_COST ||
        granaries(state, village.id).some((c) => countOf(c.inventory ?? [], 'fiber') >= COMBAT.BANDAGE_FIBER_COST))
    if (!starving && !bleeding && handleDefense(state, village, npc, entity)) continue
    // LE SANG AVANT TOUT LE RESTE (R13) : l'expédition, le sommeil et la faim attendent —
    // aucun n'est aussi pressé qu'une hémorragie.
    if (handleWounds(state, village, npc, entity)) continue
    // Puis l'expédition en cours (raid ou don, spec alignement R13-R14).
    if (handleErrand(state, village, npc, entity)) continue
    if (handleSleep(state, npc, entity)) continue
    if (handleCold(state, village, npc, entity)) continue
    // R8 — L'ORAGE POUSSE À L'ABRI (spec meteo.md) : sous l'empreinte d'un orage, on
    // rejoint la tuile abritée du village (la foudre n'y frappe pas), à défaut le Feu.
    if (handleOrage(state, village, npc, entity)) continue
    if (handleHunger(state, village, npc, entity)) continue

    if (!npc.task) {
      claimTask(village, npc, entity)
      if (!npc.task) {
        // LA NUIT RASSEMBLE (spec village-pnj-evolution R14) : un oisif de nuit ne traîne
        // pas loin du Feu — l'autopsie du banc de saison l'a mesuré cueilli seul à 7-8
        // tuiles pendant les sièges. Il se replie près du Feu, où la milice se concentre.
        // Anti-livelock (patron handleSleep) : Feu inatteignable → oisif sur place.
        const dFeu = Math.max(Math.abs(entity.x - (village.fireTx + 0.5)), Math.abs(entity.y - (village.fireTy + 0.5)))
        if (getGameTime(state).isNight && dFeu > NPC_AI.NIGHT_RALLY_TILES) {
          if (npc.path.length > 0 || setPathTo(state, npc, entity, village.fireTx, village.fireTy)) {
            followPath(state, npc, entity)
          }
        } else {
          // UN OISIF NE GARDE PAS DE CHEMIN. Le reliquat du repli (arrivé au Feu, ou le
          // jour revenu) serait suivi par la PROCHAINE corvée AVANT son propre trajet —
          // tous les exécuteurs commencent par `path.length === 0`. MESURÉ (graine 7) :
          // le Foyer entier marchait au Feu au lieu de ses buissons — 11 cueillettes en
          // six jours contre 92, mort de faim au j3. On lâche le chemin, toujours.
          npc.path = []
        }
        continue // rien à faire (ou plus une case pour le faire) : oisif
      }
    }
    if (npc.task.kind === 'cook_stew') executeCook(state, village, npc, entity)
    else if (npc.task.kind === 'repair') executeRepair(state, village, npc, entity)
    else if (npc.task.kind === 'feed_fire') executeFeedFire(state, village, npc, entity)
    else if (npc.task.kind === 'build') executeBuild(state, village, npc, entity)
    else executeGather(state, village, npc, entity)
  }
}

// ─── Peuplement ───────────────────────────────────────────────────────────

/** Anneau de tuiles autour du Feu où poser les PNJ d'accueil (spec R9). */
export const RING_OFFSETS = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [2, 0],
  [-2, 0],
  [0, 2],
  [0, -2],
  [2, 2],
  [-2, -2],
] as const

export function spawnNpcsAround(state: SimState, village: Village, count: number): void {
  const world = moveWorldFor(state, village.id)
  let spawned = 0
  for (const [dx, dy] of RING_OFFSETS) {
    if (spawned >= count) break
    const tx = village.fireTx + dx
    const ty = village.fireTy + dy
    if (isBlockedAt(world, tx, ty)) continue
    // Le grand sac du PNJ (spec inventaire R7) : il porte une journée de corvées
    // sans jamais buter sur sa borne. Quand il bute quand même (un raider chargé
    // de butin, un joueur qui le gave), les corvées le VOIENT — TASK_INTAKE — et
    // il devient oisif, pas figé.
    const id = spawnEntity(state, tx + 0.5, ty + 0.5, SLOTS.NPC)
    village.memberIds.push(id)
    emitEvent(state, { type: 'member_joined', tick: state.tick, villageId: village.id, entityId: id })
    state.npcs.push({
      entityId: id,
      villageId: village.id,
      homeId: null,
      energy: 100,
      sleeping: false,
      seekingWarmth: false,
      task: null,
      path: [],
      stuck: 0,
      defendStuck: 0,
      defendBest: -1,
      defendIgnoreUntil: 0,
      errand: null,
    })
    spawned += 1
  }
}
