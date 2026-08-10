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
import { feedRefugees, recruitRefugees, robRefugees } from './refugees'
import {
  AGRICULTURE,
  ALIGNMENT,
  BALANCE,
  COMBAT,
  COMPONENTS,
  COMPONENT_TYPES,
  FIRE,
  FIRE_UPKEEP,
  FOOD_VALUES,
  SLOTS,
  STRUCTURE_COSTS,
  STRUCTURE_HP,
  VILLAGE_NAMES,
  WALL_MATERIAL_ORDER,
  WALL_TIERS,
  WORLD_EVENTS,
  type ComponentType,
  type WallMaterial,
} from './balance'
import { isCropMature, isPlot } from './agriculture'
import { poseLibre, rayonEmprise } from './defriche'
import {
  blocksNavigation,
  doorPairs,
  edgeBarrierAt,
  fullTileAt,
  placementKeepsNavigable,
  refreshFunctions,
  terrainConstructible,
} from './construction'
import { emitEvent } from './events'
import { chebyshev, distSq, isSingleEdge } from './geometry'
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
  type BarrierType,
  type Inventory,
  type ItemBag,
  type ItemId,
  type StructureType,
} from './items'
import { heldSlot } from './inventory-actions'
import { matiereChiffre, matieresDe, parPiece, piece } from './pieces'
import { terrainAt, zoneAt } from './map'
import { actForDay, seasonDayAtTick } from './time'
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
   * LES ARÊTES OCCUPÉES — un masque de 4 bits (N=1, E=2, S=4, O=8), et le pivot du modèle
   * de mur MINCE (décision d'Alexis).
   *
   * Un mur ne prend plus sa tuile entière : il vit sur une ou plusieurs de ses ARÊTES. La salle
   * qu'il borde garde donc 100 % de son dallage, et une pièce de 6×4 s'écrit 6×4 au lieu de
   * réclamer 8×6. Un ANGLE est un mur à deux arêtes — pas deux murs : `structureAt` (appelé à
   * 35 endroits) survit intact, et l'autotuilage cesse d'être DEVINÉ du voisinage puisque la
   * forme est portée ici.
   *
   * **ABSENT = COMPORTEMENT HISTORIQUE**, et c'est la clé de la migration : un mur sans `edges`
   * bloque sa tuile entière, exactement comme avant. Les villages déjà bâtis, les tests seedés
   * et les parties sauvegardées ne bougent pas d'un pixel ; seul ce qui déclare des arêtes
   * emprunte le nouveau chemin.
   */
  edges?: number
  /**
   * L'ORIENTATION d'une pièce de mobilier (0=N, 1=E, 2=S, 3=O). COSMÉTIQUE — la sim ne la lit
   * jamais : ni la reconnaissance de fonction, ni l'accès n'en dépendent. Elle voyage dans
   * l'ACTION (donc le rejeu la reproduit) et sert au seul rendu : une étagère tourne le dos au
   * mur, un âtre ouvre sa gueule vers la pièce.
   */
  facing?: number
  /**
   * LE PALIER DE MATÉRIAU (spec construction R8) — mur/porte seulement : bois →
   * pierre → métal. Absent = bois (défaut) ou pièce sans palier. Améliorable sur
   * place au marteau (`upgrade_structure`) ; chaque palier monte les PV.
   */
  material?: WallMaterial
  /**
   * ═══ LA PORTE EST OUVERTE OU CLOSE (spec construction R26, décision d'Alexis 2026-07-30) ═══
   *
   * `true` = elle est OUVERTE et **tout le monde passe**, ami comme pillard. Absent ou `false` =
   * elle est CLOSE et **plus personne ne passe** — pas même son propriétaire, qui doit la pousser
   * (touche d'interaction, `toggle_door`). C'est cette symétrie qui donne un sens à l'ouvrir : une
   * porte qui laisserait toujours passer les siens n'aurait aucune raison d'être ouverte, et le
   * geste serait décoratif.
   *
   * ELLE NE BOUGE JAMAIS SEULE (choix d'Alexis contre une refermeture automatique) : l'état
   * survit au snapshot, au rejeu et à la sauvegarde. Fermer le soir est un geste ; l'oublier
   * ouverte a un prix — un pillard entre sans rien casser.
   *
   * ⚠ MIGRATION NON SILENCIEUSE, ET C'EST VOULU : `undefined` vaut CLOSE, donc les portes des
   * parties déjà sauvegardées se retrouvent fermées à la reprise. C'est le seul défaut acceptable
   * (on les rouvre d'une touche) ; l'inverse — `undefined` = ouverte — laisserait une base
   * grande ouverte sans que le joueur l'ait décidé, et ça ne se répare pas après un raid.
   */
  open?: boolean
  /** Contenu, pour les structures-conteneurs (coffre). */
  inventory?: Inventory
  /** LE TICK DE MISE EN TERRE (agriculture voie A, spec `agriculture.md`) — parcelles SEULES.
   *  Absent = parcelle vide. La maturité se DÉRIVE par arithmétique (`tick − plantedAt`), sans
   *  entité ni PRNG (voir `agriculture.ts`). `number` → JSON-sérialisable comme le reste. */
  plantedAt?: number
  /** COMBUSTIBLE d'un feu LIBRE (spec feu-station) — un inventaire de BÛCHES (3 cases), géré comme
   *  un coffre : dépôt/retrait/déplacement libres (`transfer` zone `fuel`). Le feu en brûle UNE à la
   *  fois, tirée de la case `burnSlot` (`burnAt` = tick d'allumage). Feu libre (villageId 0)
   *  UNIQUEMENT ; le Foyer reste sur `village.fuel` (migration différée S16). Bois total > 0 = allumé. */
  fuel?: Inventory
  /** Le tick où la bûche EN COURS s'est allumée : sa consommation court sur `FIRE.BURN_TICKS` depuis
   *  là (c'est l'indicateur de consommation). Absent = rien ne brûle (braises / éteint / hors modèle). */
  burnAt?: number
  /** La CASE de `fuel` d'où la bûche en cours est tirée — l'ancre du verrou : cette case ne peut pas
   *  descendre sous 1 bûche tant qu'elle brûle. Va de pair avec `burnAt` (posé/effacé ensemble). */
  burnSlot?: number
  /** Tick de fin de la fenêtre de BRAISES (S2) : posé quand le bois tombe à 0, effacé au
   *  rallumage. Feu libre uniquement. */
  emberUntil?: number
  /** LES ENTRÉES DE CUISSON (spec feu-station) — un inventaire de STACKS d'aliments crus (3 cases),
   *  géré comme un coffre (dépôt/retrait/déplacement libres). Chaque case cuit sa pile UNE unité à la
   *  fois ; le compteur de l'unité en cours vit dans `cookRemaining` (parallèle, MÊME index). L'unité
   *  en cours de cuisson est VERROUILLÉE (ne quitte pas la case). Lazy. JSON-sérialisable. */
  cookIn?: Inventory
  /** Le compteur de cuisson de l'unité EN COURS de chaque ENTRÉE (parallèle à `cookIn`, même index).
   *  `null` = aucune unité engagée (rien ne cuit → rien de verrouillé). Descend au tick tant que le feu
   *  brûle ; se FIGE en braises (pause). C'est aussi le drapeau du verrou de consommation de l'entrée. */
  cookRemaining?: (number | null)[]
  /** LES SORTIES (spec feu-station) — un inventaire des cuits (+ sous-produits), 3 cases. Dépôt/retrait
   *  libres (filtré aux produits cuits). Aucune consommation ici : rien n'y est jamais verrouillé. */
  cookOut?: Inventory
}

export type TaskKind =
  | 'gather_berries'
  | 'gather_wood'
  | 'gather_fiber'
  | 'gather_stone'
  | 'gather_cut_stone'
  | 'cook_stew'
  | 'repair'
  | 'feed_fire'
  | 'build'

/**
 * UN ORDRE DE CONSTRUCTION (spec `village-pnj-evolution.md` R3-R4) — la charge d'une
 * tâche `build`. Trois gestes, chacun rejoué par le PIPELINE JOUEUR (pnj R1) :
 *   · `pose`    → `build` au marteau (mur/porte/sol, arête ou tuile) ;
 *   · `place`   → l'objet-composant, assemblé au Feu puis posé (`place_component`) ;
 *   · `upgrade` → `upgrade_structure` au marteau (bois → pierre).
 * JSON-plat : il voyage dans la tâche, le snapshot et la sauvegarde.
 */
export type BuildOrder =
  | { action: 'pose'; structure: BarrierType; tx: number; ty: number; edges?: number; material?: WallMaterial }
  | { action: 'place'; component: ComponentType; tx: number; ty: number }
  | { action: 'upgrade'; structureId: number }

/** Une tâche du tableau du village (spec pnj R5). */
export interface VillageTask {
  id: number
  kind: TaskKind
  priority: number
  claimedBy: number | null
  /** Cible, pour les tâches localisées (réparer telle structure). */
  structureId?: number
  /** L'ordre de construction, pour les tâches `build` (spec village-pnj-evolution R3). */
  build?: BuildOrder
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
  /** LE COMBUSTIBLE DU FEU (spec construction R16) — le seul évier permanent. Décroît
   *  chaque tick (`advanceUpkeep`) ; à SEC (0), les murs de la zone se dégradent. On le
   *  nourrit en y déposant du bois (`feed_fire`). Braises dormantes : jamais d'extinction. */
  fuel: number
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
  /**
   * LE PALIER DE BÂTI d'un village PNJ (spec `village-pnj-evolution.md`) : 1 le
   * campement → 2 le hameau de bois → 3 le bourg de pierre. DISTINCT du palier du
   * Feu (`tier`, actions joueur) : le palier 3 du Feu exige la chaîne du fer, hors
   * de portée d'une IA de corvées. Monte à l'aube, au surplus (décision n°2).
   * Absent (parties sauvées d'avant) = 1. Ne bouge jamais sur un village à chef
   * humain.
   */
  buildTier?: number
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
  /** SEMER (agriculture voie A, spec `agriculture.md`) : une graine en main + une parcelle VIDE
   *  de mon village, à portée. RÉCOLTER : une parcelle MÛRE. La pousse se dérive du tick (pur). */
  | { type: 'plant'; structureId: number }
  | { type: 'harvest_crop'; structureId: number }
  | { type: 'give'; targetEntityId: number; item: ItemId; count: number }
  /** LES RÉFUGIÉS (V2-25, GDD §520) — à portée d'un groupe : le RECRUTER (ils rejoignent mon
   *  village en PNJ ; il faut que j'aie un village), les NOURRIR (des vivres, chaleur) ou les
   *  DÉPOUILLER (prendre leur bien, prédation). Refouler = ne rien faire, ils repartent seuls. */
  | { type: 'recruit_refugees'; groupId: number }
  | { type: 'feed_refugees'; groupId: number }
  | { type: 'rob_refugees'; groupId: number }
  /**
   * JE POSE UNE PIÈCE STRUCTURELLE (mur/porte/sol/toit), marteau en main — et RIEN
   * d'autre (décision d'Alexis : le four, l'établi, le coffre se posent en objet
   * tenu, `place_component`). `material` ne vaut que pour mur/porte (défaut bois, R8).
   * Pose INSTANTANÉE (R15), dans le carré du Feu (R2), sous réserve de navigabilité (R7).
   *
   * `edges` — L'ARÊTE VISÉE (spec construction R23, décision d'Alexis 2026-07-30) : mur et porte
   * ne prennent plus une TUILE, ils se posent sur une des quatre ARÊTES de la tuile visée, que
   * le joueur choisit au clavier (`A`/`E` font tourner le fantôme). UN SEUL bit — un clic pose
   * un segment, et le coin d'une pièce en porte donc deux (deux structures, deux fois les PV :
   * un pillard qui casse le coin ouvre UN côté). Absent = pose PLEINE TUILE, le comportement
   * historique, que sol et toit gardent pour toujours.
   */
  | { type: 'build'; structure: BarrierType; tx: number; ty: number; material?: WallMaterial; edges?: number }
  /**
   * JE POSE UN COMPOSANT TENU (enclume, four…) sur la tuile visée (spec construction
   * R20, flux feu de camp). L'objet se consomme et DEVIENT la structure ; GROUPÉ à
   * d'autres, il fait émerger une fonction (R9). Instantané (R15).
   */
  | { type: 'place_component'; tx: number; ty: number }
  /**
   * JE POUSSE UNE PORTE (spec construction R26, décision d'Alexis) — la touche d'interaction, à
   * portée de bras. Bascule : close → ouverte, ouverte → close. Il faut y AVOIR DROIT
   * (`hasAccess` : propriétaire, village, ou publique) — un pillard, lui, doit la casser. Aucun
   * outil en main n'est requis : on ouvre une porte les mains vides.
   */
  | { type: 'toggle_door'; structureId: number }
  /** JE MONTE LE FEU D'UN PALIER (spec construction R6) : le carré grandit, de
   *  nouveaux composants se débloquent. Coût croissant, plafonné à 3. */
  | { type: 'upgrade_fire' }
  /** NOURRIR LE FEU (spec construction R16) : je dépose le bois que je porte dans le
   *  Feu de mon village (à portée), qui le convertit en combustible. Le seul geste qui
   *  tient l'upkeep — sans lui, le village finit en ruine. */
  | { type: 'feed_fire'; structureId?: number }
  // CUISINE : les cases du feu (COMBUSTIBLE/ENTRÉES/SORTIES) sont de vrais conteneurs — on y dépose,
  // retire et déplace via l'action `transfer` (zone `fuel`/`cookIn`/`cookOut`, voir inventory-actions.ts).
  // Les anciennes actions `cook_put`/`cook_take_in`/`cook_take_out` sont retirées (spec feu-station).
  /** J'AMÉLIORE UN MUR/PORTE SUR PLACE au marteau (spec construction R8) : palier de
   *  matériau suivant (bois→pierre→métal), en payant la « différence ». Instantané. */
  | { type: 'upgrade_structure'; structureId: number }
  | { type: 'demolish'; structureId: number }
  | { type: 'deposit'; structureId: number; item: ItemId; count: number }
  | { type: 'withdraw'; structureId: number; item: ItemId; count: number }
  | { type: 'set_access'; structureId: number; access: AccessLevel }
  | { type: 'invite'; targetEntityId: number }
  | { type: 'banish'; targetEntityId: number }

/** Défauts d'accès (spec village R10) : le coffre est à moi, la porte au village.
 *  VUE DÉRIVÉE du registre — le défaut d'une pièce se déclare avec elle. */
const DEFAULT_ACCESS: Record<StructureType, AccessLevel> = parPiece((t) => piece(t).acces)

/** Les CONTENEURS (spec construction §4bis) : coffre + les conteneurs du Grenier.
 *  VUE DÉRIVÉE : la capacité est une propriété de la pièce (`capacite`). */
const CONTAINER_TYPES: Record<StructureType, number | undefined> = parPiece((t) => piece(t).capacite)

export function structureAt(structures: readonly Structure[], tx: number, ty: number): Structure | undefined {
  return structures.find((s) => s.tx === tx && s.ty === ty)
}

/**
 * LES TROIS COUCHES d'une tuile (décision d'Alexis 2026-07-18) : un SOL et un TOIT
 * se superposent à ce qui est dessous. `solidAt` = la structure qui OCCUPE le sol
 * (mur, porte, coffre, composant, Feu…) — tout SAUF les pièces molles ; c'est elle
 * que la collision et l'occupation regardent. `floorAt`/`roofAt` = les couches
 * molles, une de chaque au plus par tuile. Sol au ras du sol, toit au-dessus.
 */
// Les trois couches se LISENT AU REGISTRE (`occupe`) depuis l'étage 2 du vocabulaire
// (2026-08-10) : le `roc` est un second SOL — écrit en toutes lettres, il aurait été compté
// SOLIDE par `solidAt` et invisible à `floorAt`, et un dallage se serait empilé dessus.
export function solidAt(structures: readonly Structure[], tx: number, ty: number): Structure | undefined {
  return structures.find((s) => s.tx === tx && s.ty === ty && piece(s.type).occupe === 'tuile')
}

export function floorAt(structures: readonly Structure[], tx: number, ty: number): Structure | undefined {
  return structures.find((s) => s.tx === tx && s.ty === ty && piece(s.type).occupe === 'sol')
}

export function roofAt(structures: readonly Structure[], tx: number, ty: number): Structure | undefined {
  return structures.find((s) => s.tx === tx && s.ty === ty && piece(s.type).occupe === 'toit')
}

export function getVillageOf(state: SimState, entityId: number): Village | undefined {
  return state.villages.find((v) => v.memberIds.includes(entityId))
}

/** Le rayon (Chebyshev) du carré du Feu à ce palier (spec construction R2). */
export function fireRadius(tier: number): number {
  const byTier = BALANCE.FIRE_RADIUS_BY_TIER
  return byTier[Math.min(Math.max(tier, 1), byTier.length) - 1]!
}

// Le rayon MAX du carré (palier 3) — celui que la fondation réserve (R1-R2) — s'appelle
// `rayonEmprise` et vit dans `defriche.ts` : c'est le MÊME nombre que celui du défrichement,
// et c'est voulu (on défriche ce que la fondation a retenu). Une seconde dérivation ici
// aurait fait deux vérités pour un seul carré.

/** Pourquoi une pose au marteau est refusée (spec construction R2/R5/R7). */
export type BuildReject =
  | 'no_village'
  | 'no_hammer'
  | 'bad_tile'
  | 'out_of_square'
  | 'too_far'
  | 'unbuildable'
  | 'occupied'
  | 'node'
  | 'blocks_nav'
  | 'unaffordable'
  /** Cette ARÊTE porte déjà un mur — vu des deux côtés (spec construction R23). */
  | 'edge_taken'
  /** Sol et toit ne se posent PAS sur une arête : ils sont mous et prennent la tuile. */
  | 'no_edge'
  /** La palissade vit SUR l'arête, toujours : née après R23, elle n'a aucune forme
   *  pleine-tuile historique à honorer — et le rendu n'en connaît aucune. */
  | 'edge_required'

/** Le verdict d'une pose au marteau. `cost` est TOUJOURS renseigné (palier appliqué),
 *  même sur refus de placement — le panneau affiche le coût quoi qu'il arrive. */
export interface BuildEval {
  ok: boolean
  reason?: BuildReject
  cost: ItemBag
  material?: WallMaterial
}

/** Le placement est-il géométriquement valide, coût mis à part ? — le « vert » du
 *  fantôme (maquette Turn 4A) : un manque de matériaux n'éteint pas le fantôme. */
export function buildPlacementValid(e: BuildEval): boolean {
  return e.ok || e.reason === 'unaffordable'
}

/**
 * PEUT-ON BÂTIR ICI ? (spec construction R2/R5/R7). Extrait PUR du handler `build`,
 * pour que le FANTÔME de placement du client et le serveur partagent UNE SEULE vérité
 * — au lieu de réimplémenter (et faire diverger) les gardes. `ok` couvre placement ET
 * coût ; le handler mappe `reason` vers son message et débite. Déterministe (§7).
 *
 * `edges` — L'ARÊTE VISÉE (R23) : un seul bit, mur/porte seulement. Ce qu'il change au verdict
 * tient en trois lignes, et chacune découle du fait qu'une arête n'occupe PAS la tuile :
 *   • l'OCCUPATION se lit sur l'arête (des deux côtés), plus sur la tuile — sans quoi le coin
 *     d'une pièce, qui en porte deux, serait impossible à fermer ;
 *   • un NŒUD sur la tuile ne s'y oppose plus : on longe une haie de buissons sans défricher
 *     (le mur est sur le trait, pas sur le buisson) ;
 *   • la NAVIGABILITÉ reçoit l'arête et juge donc des FRANCHISSEMENTS — c'est elle qui refuse
 *     encore la dernière arête qui scellerait le Feu.
 */
export function evaluateBuild(
  state: SimState,
  actorId: number,
  structure: BarrierType,
  tx: number,
  ty: number,
  material?: WallMaterial,
  edges?: number,
): BuildEval {
  // Le coût ne dépend que de la pièce et du palier (mur/porte seulement, R8) : calculé
  // d'emblée et renvoyé dans TOUS les cas, y compris les refus de placement.
  // LA MATIÈRE CHANGE-T-ELLE LES CHIFFRES ? La PIÈCE le dit (D3, registre) — plus une
  // condition écrite ici, qu'une pièce structurelle neuve aurait dû venir rejoindre.
  const chiffree = matiereChiffre(structure)
  const mat = chiffree ? material : undefined
  const cost = mat !== undefined && estPalierMur(structure) ? WALL_TIERS[mat][structure].cost : STRUCTURE_COSTS[structure]
  // `exactOptionalPropertyTypes` : on n'AJOUTE `material` que s'il est défini (mur/porte).
  const make = (ok: boolean, reason?: BuildReject): BuildEval => {
    const r: BuildEval = { ok, cost }
    if (reason !== undefined) r.reason = reason
    if (mat !== undefined) r.material = mat
    return r
  }
  const fail = (reason: BuildReject): BuildEval => make(false, reason)

  const actor = state.entities.find((e) => e.id === actorId)
  if (!actor) return fail('no_village') // sans acteur : rien à bâtir (le handler garantit sa présence)
  const village = getVillageOf(state, actorId)
  if (!village) return fail('no_village')
  if (heldSlot(actor)?.item !== 'hammer') return fail('no_hammer')
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) return fail('bad_tile')
  if (chebyshev(village.fireTx, village.fireTy, tx, ty) > fireRadius(village.tier)) return fail('out_of_square')
  if (distSq(actor.x, actor.y, tx + 0.5, ty + 0.5) > BALANCE.BUILD_RANGE * BALANCE.BUILD_RANGE) return fail('too_far')
  // Le terrain juge PAR PIÈCE depuis que l'eau peu profonde refuse tout sauf le sol
  // (`terrainConstructible`) : le gué porte des planches, pas un mur ni une porte.
  if (!terrainConstructible(terrainAt(state.map, tx, ty), structure)) return fail('unbuildable')
  // L'ARÊTE VISÉE (R23), et c'est LA PIÈCE qui dit ce qu'elle en fait (`arete`, registre) :
  // `possible` pour le mur et la porte, `requise` pour la palissade (née après R23, elle n'a
  // aucune forme pleine-tuile historique à honorer), `interdite` pour le sol et le toit, MOUS —
  // leur donner une arête les rendrait invisibles à `floorAt`/`roofAt`, qui ne lisent pas `edges`.
  const arete = piece(structure).arete
  const surArete = edges !== undefined
  if (surArete && arete === 'interdite') return fail('no_edge')
  if (!surArete && arete === 'requise') return fail('edge_required')
  if (surArete && !isSingleEdge(edges)) return fail('bad_tile')
  // Occupation PAR COUCHE : seul un doublon de la MÊME couche (sol/toit/solide/arête) refuse.
  // La couche, elle aussi, est une propriété déclarée (`occupe`).
  const couche = piece(structure).occupe
  const occupant = surArete
    ? edgeBarrierAt(state.structures, tx, ty, edges)
    : couche === 'sol'
      ? floorAt(state.structures, tx, ty)
      : couche === 'toit'
        ? roofAt(state.structures, tx, ty)
        : fullTileAt(state.structures, tx, ty)
  if (occupant) return fail(surArete ? 'edge_taken' : 'occupied')
  // Récolter = défricher (R5) : pas de mur/porte PLEINE TUILE sur un nœud (le sol/toit mou, si ;
  // et l'ARÊTE aussi — elle court sur le trait, elle ne prend pas le buisson). Un nœud
  // DÉFRICHÉ, lui, ne compte plus (`poseLibre`) : il n'en reste qu'une souche, et récolter
  // POUR bâtir là est tout le sens de la règle — la tuile doit se libérer pour de bon.
  if (!surArete && couche === 'tuile' && !poseLibre(state.villages, state.nodes, tx, ty)) {
    return fail('node')
  }
  // Invariant de navigabilité (R7), AVANT le coût : un rejet ne débite rien. L'arête part au
  // verdict telle quelle — c'est ce qui fait juger des FRANCHISSEMENTS et non des tuiles, donc
  // ce qui refuse encore le dernier segment qui scellerait le Feu.
  if (blocksNavigation(structure)) {
    const okNav = placementKeepsNavigable(
      state.map,
      state.structures,
      state.entities,
      actorId,
      { tx: village.fireTx, ty: village.fireTy },
      fireRadius(village.tier),
      surArete ? { tx, ty, type: structure, edges } : { tx, ty, type: structure },
    )
    if (!okNav) return fail('blocks_nav')
  }
  if (!hasItems(actor.inventory, cost)) return fail('unaffordable')
  return make(true)
}

/** Le message de refus, mappé depuis le code — les chaînes exactes qu'attendent les tests. */
const BUILD_REJECT_REASON: Record<BuildReject, string> = {
  no_village: 'sans village — allumer un Feu d’abord',
  no_hammer: 'il faut le marteau de construction en main',
  bad_tile: 'case invalide',
  out_of_square: 'hors du carré du Feu',
  too_far: 'trop loin',
  unbuildable: 'terrain inconstructible',
  occupied: 'tuile occupée',
  node: 'un nœud occupe la tuile',
  blocks_nav: 'cela couperait le passage',
  unaffordable: 'matériaux insuffisants',
  edge_taken: 'cette arête porte déjà un mur',
  no_edge: 'cette pièce prend la tuile, pas une arête',
  edge_required: 'la palissade se pose sur une arête',
}

/**
 * Un POI-SPÉCIFIQUE (spec construction R1) tombe-t-il dans le carré à taille max
 * autour de (cx, cy) ? Un POI-spécifique = une zone dotée d'un `kind` (chokepoint,
 * gisement, eau, tanière, ruine…) ; les toponymes et zones-régions (`kind`
 * absent) ne comptent PAS — les landmarks restent des communs contestés, on
 * s'installe ENTRE eux. Test d'intersection de rectangles en tuiles.
 */
function poiSpecificInSquare(state: SimState, cx: number, cy: number): boolean {
  const r = rayonEmprise()
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

/**
 * Une structure bloque-t-elle ce déplaceur ? (spec village R8)
 *
 * `opensDoors` — CE DÉPLACEUR ACTIONNE-T-IL LES PORTES DE SON VILLAGE ? (spec construction R26)
 *
 * Le paramètre est REQUIS, sans valeur par défaut, et c'est délibéré : un défaut à `false` aurait
 * laissé le compilateur muet sur chaque site d'appel oublié, alors qu'ici un oubli enferme des
 * PNJ chez eux ou laisse un monstre traverser une porte close — deux défauts qui ne lèvent rien
 * et ne se voient qu'en partie. En le rendant obligatoire, `tsc` énumère les appelants à ma place
 * (la leçon de `enumerer-une-union-par-le-compilateur`). Le défaut, lui, vit à la frontière :
 * `MoveWorld.opensDoors`, absent = ne les actionne pas.
 *
 * QUI L'A : les PNJ du village (`npc.ts`) — ils ouvrent et referment derrière eux, et on ne
 * simule pas le battant. QUI NE L'A PAS : le JOUEUR (c'est tout le propos — il pousse la porte
 * lui-même), les monstres, et les membres d'un autre village.
 */
export function structureBlocks(s: Structure, moverVillageId: number | null, opensDoors: boolean): boolean {
  // CE QU'ELLE FAIT AU PASSAGE est une PROPRIÉTÉ DE LA PIÈCE, déclarée au registre
  // (`pieces.ts`, champ `bloque`) — plus une chaîne de `if` dont le défaut, silencieux,
  // était « ça bloque ». Une pièce neuve qu'on oubliait ici devenait un mur.
  switch (piece(s.type).bloque) {
    // Pièces MOLLES (R14) : le sol et le toit ne s'opposent à rien. La MAISON aussi (on en
    // franchit le seuil), et les pièces BASSES du monde bâti : on les ENJAMBE. Une ruine dont
    // chaque débris bloque devient un labyrinthe où l'on se coince, pas un lieu où l'on entre.
    case 'non':
    case 'enjambe':
      return false
    case 'porte':
      // OUVERTE : tout le monde passe — ami comme pillard. C'est le prix de l'avoir laissée ouverte.
      if (s.open === true) return false
      // CLOSE : plus personne, SAUF qui l'actionne — et seulement sur les portes de SON village.
      // Sans la seconde condition, un PNJ franchirait les portes closes d'un village rival.
      return !(opensDoors && s.villageId === moverVillageId)
    default:
      // Le FEU a un hitbox : un foyer de braises sous les pieds, ça se CONTOURNE (décision
      // utilisateur) — on cuisine et on se chauffe en se tenant à côté, pas dessus.
      return true
  }
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
  // LE FEU EST TUABLE SEULEMENT À SEC (V1-12) : nourri (`fuel > 0`), il ignore tout
  // dégât — un totem inviolable. C'est l'upkeep (R16) qui ouvre l'endgame : un Feu
  // qu'on alimente ne tombe jamais ; un Feu abandonné, si.
  if (s.type === 'fire') {
    const v = state.villages.find((vg) => vg.id === s.villageId)
    if (v && v.fuel > 0) return
  }
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
    // LE FEU ABATTU = LE VILLAGE TOMBE EN RUINE (V1-12/V2-20) — avant refreshFunctions,
    // pour que les structures orphelines soient réévaluées sans propriétaire.
    if (s.type === 'fire' && s.villageId !== 0) fallToRuin(state, s.villageId)
    // Détruire un composant fait retomber sa fonction ; un mur/toit, l'enceinte (R10).
    refreshFunctions(state)
  }
}

/**
 * LE VILLAGE TOMBE EN RUINE (V1-12/V2-20) — son Feu abattu (à sec). On en fait une
 * COQUILLE PILLABLE : les structures survivantes perdent leur propriétaire et s'ouvrent
 * (accès public, villageId 0), et le village quitte l'état — plus d'agrégation
 * d'alignement, plus de milice, plus de tableau. Les membres perdent leur foyer : le
 * respawn du joueur retombe sur `homeX/homeY` (déjà géré, combat.ts). Refondation-sur-
 * ruine et mémoire de carte : DÉFÉRÉES en Vallée (spec construction).
 */
function fallToRuin(state: SimState, villageId: number): void {
  const village = state.villages.find((v) => v.id === villageId)
  if (!village) return
  emitEvent(state, { type: 'village_fell', tick: state.tick, villageId, name: village.name })
  for (const s of state.structures) {
    if (s.villageId !== villageId) continue
    s.villageId = 0
    s.ownerId = 0
    s.access = 'public' // la ruine se pille : ses murs, ses coffres s'ouvrent à tous
  }
  state.villages = state.villages.filter((v) => v.id !== villageId)
}

/**
 * L'UPKEEP DU FEU au tick (spec construction R16-R17) — le seul évier PERMANENT.
 * Chaque village brûle du combustible (×acte : le Grand Froid mord) ; à SEC, ses
 * MURS/BARRIÈRES se dégradent (jamais les composants, R17) et le Feu passe en braises
 * dormantes — il ne s'éteint PAS (la chaleur tient, seule l'architecture cède). Le
 * plein tient ~3,5 cycles d'abandon ; un village vivant, lui, nourrit son Feu (tâche
 * `feed_fire`) et ne se dégrade jamais. Déterministe : aucun tirage, mêmes opérations.
 */
export function advanceUpkeep(state: SimState): void {
  const act = actForDay(seasonDayAtTick(state.tick, state.calendarScale))
  const drain = FIRE_UPKEEP.DRAIN_PER_TICK * FIRE_UPKEEP.ACT_FACTOR[act - 1]!
  for (const village of state.villages) {
    const before = village.fuel
    village.fuel = Math.max(0, village.fuel - drain)
    // Au PASSAGE à sec (une fois) : la chronique le raconte, la milice n'a pas à réagir.
    if (before > 0 && village.fuel <= 0) {
      emitEvent(state, { type: 'fire_starved', tick: state.tick, villageId: village.id })
    }
    if (village.fuel > 0) continue
    // À sec : les murs/barrières cèdent — la palissade avec eux (c'est l'enceinte,
    // exactement ce que l'upkeep protège). On COLLECTE d'abord — `applyStructureDamage`
    // filtre `state.structures` à la destruction, on ne l'itère donc pas en le mutant.
    const walls = state.structures.filter(
      (s) => s.villageId === village.id && (s.type === 'wall' || s.type === 'door' || s.type === 'palissade'),
    )
    for (const w of walls) applyStructureDamage(state, w.id, FIRE_UPKEEP.WALL_DECAY_PER_TICK, 0)
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
    fuel: FIRE_UPKEEP.START, // un Feu neuf naît à demi-plein (spec R16, une grâce)
    tasks: [],
    nextTaskId: 1,
    npcsArrived: opts.npcsArrived,
    lastAlarmAt: TICK_NEVER,
    warmth: 0,
    engagement: 0,
    archetype: 'neutre',
    buildTier: 1,
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

/**
 * NOURRIR un feu LIBRE : son combustible vit sur la structure (spec feu-station S12/S15).
 * Rend le motif de rejet (sac vide, feu plein), ou `null` en cas de succès. Rallume s'il était éteint.
 */
function feedFreeFire(state: SimState, actor: SimState['entities'][number], s: Structure): string | null {
  const have = countOf(actor.inventory, 'wood')
  if (have <= 0) return 'il faut du bois pour nourrir le feu'
  if (!s.fuel) s.fuel = makeInventory(FIRE.FUEL_SLOTS)
  const before = countOf(s.fuel, 'wood')
  const leftover = addItems(s.fuel, { wood: have }) // on remplit ce qui tient dans les slots
  const added = have - (leftover.wood ?? 0)
  if (added <= 0) return 'le feu est déjà plein'
  removeItems(actor.inventory, { wood: added })
  if (before <= 0) {
    s.burnAt = state.tick // rallumage : la première bûche s'allume
    s.burnSlot = s.fuel.findIndex((sl) => sl !== null && sl.count > 0) // la case où le bois vient d'atterrir
    delete s.emberUntil
    emitEvent(state, { type: 'fire_relit', tick: state.tick, structureId: s.id })
  }
  return null
}

/** NOURRIR le Foyer d'un village : son combustible vit encore sur le village (upkeep, migration S16). */
function feedVillageFire(state: SimState, actor: SimState['entities'][number], actorId: number, v: Village): string | null {
  const room = FIRE_UPKEEP.CAPACITY - v.fuel
  if (room <= 0) return 'le Feu est déjà plein'
  const have = countOf(actor.inventory, 'wood')
  if (have <= 0) return 'il faut du bois pour nourrir le Feu'
  const give = Math.min(have, Math.ceil(room / FIRE_UPKEEP.FEED_PER_WOOD))
  if (!removeItems(actor.inventory, { wood: give })) return 'il faut du bois pour nourrir le Feu'
  v.fuel = Math.min(FIRE_UPKEEP.CAPACITY, v.fuel + give * FIRE_UPKEEP.FEED_PER_WOOD)
  emitEvent(state, { type: 'fire_fed', tick: state.tick, villageId: v.id, entityId: actorId, wood: give, fuel: v.fuel })
  return null
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
      if (!terrainConstructible(terrainAt(state.map, tx, ty), 'fire')) return reject('terrain inconstructible')
      if (structureAt(state.structures, tx, ty)) return reject('tuile occupée')
      const min = BALANCE.FIRE_MIN_DISTANCE
      if (state.villages.some((v) => chebyshev(v.fireTx, v.fireTy, tx, ty) < min)) {
        return reject('trop proche d’un autre Feu')
      }
      // Fondation R1 (décision d'Alexis) : AUCUN POI-spécifique dans le carré à taille
      // max d'un village — light_fire fonde AUSSI un village, il joue donc le garde-fou.
      if (poiSpecificInSquare(state, tx, ty)) return reject('un landmark tombe dans le carré')
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
      // Roche, falaise, eau — le gué compris : on ne plante pas son feu dans la rivière.
      if (!terrainConstructible(terrainAt(state.map, tx, ty), 'fire')) return reject('terrain inconstructible')
      // TUILE LIBRE, au sens LARGE (décision utilisateur) : ni structure, ni ressource
      // (arbre, filon, buisson…), ni personne (animal, PNJ, autre joueur) dessus. On ne
      // pose pas un foyer sur ce qui est déjà là. « Prise ENTIÈRE », depuis R23 : un mur
      // d'arête borde la tuile sans l'occuper — on plante son feu contre sa clôture.
      if (fullTileAt(state.structures, tx, ty)) return reject('tuile occupée')
      if (!poseLibre(state.villages, state.nodes, tx, ty)) return reject('tuile occupée')
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
      // LE MARTEAU FAIT LE BÂTISSEUR (spec construction R2/R5/R7/R19-R20) : tout le
      // gant de vérifs (village, marteau en main, carré du Feu, portée, terrain,
      // occupation par couche, nœud, navigabilité, coût) vit dans `evaluateBuild` —
      // PUR et partagé avec le fantôme du client (source unique, pas de divergence).
      const structure = action.structure
      const ev = evaluateBuild(state, actorId, structure, action.tx, action.ty, action.material, action.edges)
      if (!ev.ok) return reject(BUILD_REJECT_REASON[ev.reason!])
      // Placement ET coût validés (evaluateBuild a fait `hasItems`) : le débit passe.
      const village = getVillageOf(state, actorId)!
      removeItems(actor.inventory, ev.cost)
      addStructure(state, structure, action.tx, action.ty, village.id, actorId, DEFAULT_ACCESS[structure], ev.material, action.edges)
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
      // Les OBJETS TENUS-ET-POSÉS (décision d'Alexis) : les composants ET le coffre —
      // le four, l'établi (des composants) et le coffre ne se posent PAS au marteau.
      const item = held?.item
      const isComp = item !== undefined && (COMPONENT_TYPES as readonly string[]).includes(item)
      if (!held || !(isComp || item === 'chest')) return reject('il faut un composant ou un coffre en main')
      const placeType = item as StructureType // 'chest' ou une ComponentType (mêmes noms)
      const { tx, ty } = action
      if (!Number.isInteger(tx) || !Number.isInteger(ty)) return reject('case invalide')
      // LE PALIER DU FEU débloque les composants (spec construction R6) ; le coffre est libre.
      const unlockTier = isComp ? COMPONENTS[item as ComponentType].unlockTier : 1
      if (unlockTier > village.tier) return reject('composant verrouillé (palier du Feu)')
      if (chebyshev(village.fireTx, village.fireTy, tx, ty) > fireRadius(village.tier)) return reject('hors du carré du Feu')
      if (distSq(actor.x, actor.y, tx + 0.5, ty + 0.5) > BALANCE.BUILD_RANGE * BALANCE.BUILD_RANGE) return reject('trop loin')
      // Un composant/coffre BLOQUE : pas sous ses pieds (on s'y emmurerait), comme le Feu.
      if (Math.floor(actor.x) === tx && Math.floor(actor.y) === ty) return reject('pas sous ses pieds')
      if (!terrainConstructible(terrainAt(state.map, tx, ty), placeType)) return reject('terrain inconstructible')
      // « Prise ENTIÈRE » (R23) : un mur d'arête borde la tuile sans l'occuper — on ADOSSE
      // donc son four à son propre mur, ce que `solidAt` refusait dès la première arête posée.
      if (fullTileAt(state.structures, tx, ty)) return reject('tuile occupée')
      if (!poseLibre(state.villages, state.nodes, tx, ty)) return reject('un nœud occupe la tuile')
      // Invariant de navigabilité (R7) : un composant/coffre bloque, comme un mur.
      const ok = placementKeepsNavigable(
        state.map,
        state.structures,
        state.entities,
        actorId,
        { tx: village.fireTx, ty: village.fireTy },
        fireRadius(village.tier),
        { tx, ty, type: placeType },
      )
      if (!ok) return reject('cela couperait le passage')
      // L'objet tenu se consomme (une unité) : il DEVIENT la structure.
      held.count -= 1
      if (held.count <= 0) actor.inventory[actor.activeSlot] = null
      addStructure(state, placeType, tx, ty, village.id, actorId)
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
     * NOURRIR LE FEU (spec construction R16) : le bois porté devient du combustible.
     * N'importe quel membre (pas seulement le Chef) — c'est la tâche communautaire zéro.
     * On donne juste ce qu'il faut pour faire le plein (pas de gaspillage au-delà de la
     * capacité). À portée du Feu. Le seul geste qui tient l'upkeep.
     */
    case 'feed_fire': {
      const range = BALANCE.INTERACT_RANGE
      // CIBLE EXPLICITE (le modal du feu, spec S15) : on nourrit CE feu à portée — libre ou Foyer.
      if (action.structureId !== undefined) {
        const s = state.structures.find((st) => st.id === action.structureId && st.type === 'fire')
        if (!s) return reject('pas un feu')
        if (distSq(actor.x, actor.y, s.tx + 0.5, s.ty + 0.5) > range * range) return reject('trop loin du feu')
        if (s.villageId === 0) {
          const r = feedFreeFire(state, actor, s)
          if (r) return reject(r)
          return
        }
        const v = state.villages.find((vg) => vg.id === s.villageId)
        if (!v) return reject('pas de foyer')
        const r = feedVillageFire(state, actor, actorId, v)
        if (r) return reject(r)
        return
      }
      // SANS cible (quick-feed historique, S15) : mon Foyer, sinon mon feu libre le plus proche.
      const village = getVillageOf(state, actorId)
      if (village) {
        if (distSq(actor.x, actor.y, village.fireTx + 0.5, village.fireTy + 0.5) > range * range) return reject('trop loin du Feu')
        const r = feedVillageFire(state, actor, actorId, village)
        if (r) return reject(r)
        return
      }
      let fire: Structure | undefined
      let bestD = range * range
      for (const s of state.structures) {
        if (s.type !== 'fire' || s.villageId !== 0 || s.ownerId !== actorId) continue
        const d = distSq(actor.x, actor.y, s.tx + 0.5, s.ty + 0.5)
        if (d <= bestD) {
          bestD = d
          fire = s
        }
      }
      if (!fire) return reject('pas de feu à nourrir')
      const r = feedFreeFire(state, actor, fire)
      if (r) return reject(r)
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

    /**
     * POUSSER UNE PORTE (spec construction R26, décision d'Alexis 2026-07-30).
     *
     * Une bascule, à portée de BRAS, et rien de plus : pas d'outil, pas de coût, pas de délai. Ce
     * qu'on vérifie, c'est le DROIT (`hasAccess` — propriétaire, village, ou publique) : un
     * pillard n'ouvre pas la porte d'un autre, il la casse. Et la portée, parce qu'une porte
     * qu'on ouvrirait de loin serait un interrupteur, pas une porte.
     */
    case 'toggle_door': {
      const s = state.structures.find((st) => st.id === action.structureId)
      if (!s || s.type !== 'door') return reject('ce n’est pas une porte')
      if (!hasAccess(state, actorId, s)) return reject('cette porte n’est pas à vous')
      const range = BALANCE.INTERACT_RANGE
      if (distSq(actor.x, actor.y, s.tx + 0.5, s.ty + 0.5) > range * range) return reject('trop loin')
      // `open` reste ABSENT quand elle se referme : `undefined` EST « close » (voir `Structure`),
      // et un `false` explicite alourdirait chaque snapshot d'un champ qui ne dit rien de neuf.
      const ouverte = s.open !== true
      // LA PORTE DOUBLE (R27) : le vantail apparié SUIT — on applique l'état RÉSULTANT du visé
      // aux deux (une synchronisation, pas une double bascule : deux battants désaccordés se
      // réalignent), si l'acteur a aussi le droit sur l'apparié. La portée ne se revérifie pas
      // sur lui : le cadre est un seul objet, on ne pousse pas ses deux battants à deux endroits.
      const apparie = doorPairs(state.structures).get(s.id)?.pair
      const battants = apparie !== undefined && hasAccess(state, actorId, apparie) ? [s, apparie] : [s]
      for (const b of battants) {
        // Un événement par battant qui CHANGE : un fait par fait — l'apparié déjà dans l'état
        // visé ne bouge pas, donc ne dit rien.
        if ((b.open === true) === ouverte) continue
        if (ouverte) b.open = true
        else delete b.open
        emitEvent(state, { type: 'door_toggled', tick: state.tick, structureId: b.id, open: ouverte, byEntityId: actorId })
      }
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

    /**
     * SEMER (agriculture voie A, spec `agriculture.md`) : une graine en main + une PARCELLE
     * vide de son village, à portée → on la met en terre. La pousse se dérive ensuite du tick
     * (pur, `agriculture.ts`) — aucune entité, aucun PRNG.
     */
    case 'plant': {
      const s = state.structures.find((st) => st.id === action.structureId)
      if (!s || !isPlot(s.type)) return reject('pas une parcelle')
      if (s.ownerId !== actorId && getVillageOf(state, actorId)?.id !== s.villageId) return reject('pas votre village')
      if (s.plantedAt !== undefined) return reject('déjà semé')
      // LE FROID GÈLE LA TERRE À CIEL OUVERT (acte III, spec agriculture) : seule la SERRE
      // (cultures d'hiver, GDD §8 « poussent quand le froid tue le reste ») laisse encore semer
      // quand tout gèle dehors. Le payoff stratégique : bâtir des serres AVANT l'hiver, ou ne
      // plus rien planter. (Seuil « acte III » = ordre de grandeur à calibrer.)
      if (s.type === 'parcelle' && actForDay(seasonDayAtTick(state.tick, state.calendarScale)) >= 3) {
        return reject('la terre est gelée — il faut une serre')
      }
      const range = BALANCE.INTERACT_RANGE
      if (distSq(actor.x, actor.y, s.tx + 0.5, s.ty + 0.5) > range * range) return reject('trop loin')
      if (!removeItems(actor.inventory, { graine: 1 })) return reject('il faut une graine')
      s.plantedAt = state.tick
      emitEvent(state, { type: 'crop_planted', tick: state.tick, structureId: s.id, byEntityId: actorId })
      return
    }

    /**
     * RÉCOLTER (agriculture voie A) : une parcelle MÛRE (dérivée du tick) de son village, à
     * portée → verse `AGRICULTURE.YIELD` légumes et efface `plantedAt` (replantable).
     */
    case 'harvest_crop': {
      if (state.tick < actor.cooldownUntil) return reject('trop tôt')
      const s = state.structures.find((st) => st.id === action.structureId)
      if (!s || !isPlot(s.type)) return reject('pas une parcelle')
      if (s.ownerId !== actorId && getVillageOf(state, actorId)?.id !== s.villageId) return reject('pas votre village')
      const range = BALANCE.INTERACT_RANGE
      if (distSq(actor.x, actor.y, s.tx + 0.5, s.ty + 0.5) > range * range) return reject('trop loin')
      if (!isCropMature(s, state.tick)) return reject('pas encore mûr')
      // Le TERROIR (meilleur palier) rend plus que la parcelle/serre.
      const gain = s.type === 'terroir' ? AGRICULTURE.YIELD_TERROIR : AGRICULTURE.YIELD
      addItems(actor.inventory, { legume: gain })
      delete s.plantedAt // parcelle de nouveau vide (replantable)
      actor.cooldownUntil = state.tick + BALANCE.GATHER_COOLDOWN_TICKS
      emitEvent(state, { type: 'crop_harvested', tick: state.tick, structureId: s.id, byEntityId: actorId, yield: gain })
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
        const need = target.hunger < ALIGNMENT.NEED_HUNGER ? ALIGNMENT.NEED_FACTOR : 1
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

    case 'recruit_refugees':
    case 'feed_refugees':
    case 'rob_refugees': {
      const group = state.refugeeGroups.find((g) => g.id === action.groupId)
      if (!group) return reject('plus personne ici')
      const range = BALANCE.INTERACT_RANGE
      if (distSq(actor.x, actor.y, group.tx + 0.5, group.ty + 0.5) > range * range) return reject('trop loin')
      if (action.type === 'recruit_refugees') {
        const village = getVillageOf(state, actorId)
        if (!village) return reject('il faut un Feu pour les accueillir')
        recruitRefugees(state, actor, group, village)
      } else if (action.type === 'feed_refugees') {
        if (!feedRefugees(state, actor, group)) return reject('des vivres à offrir manquent')
      } else {
        robRefugees(state, actor, group)
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
/**
 * CETTE PIÈCE A-T-ELLE UNE ENTRÉE DANS `WALL_TIERS` ? Le régime chiffré (D3) dit QUE la
 * matière compte ; ce barème-là dit COMBIEN, et il ne couvre aujourd'hui que le mur et la
 * porte. Les deux questions sont distinctes : une pièce structurelle peut déclarer son
 * régime avant que son barème n'existe, et elle retombe alors sur son coût de base au
 * lieu de déréférencer `undefined`.
 */
function estPalierMur(type: StructureType): type is 'wall' | 'door' {
  return type === 'wall' || type === 'door'
}

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
  /** LES ARÊTES PORTÉES (R23) — mur mince. Absent = la structure prend sa tuile entière,
   *  et c'est ce qui rend la migration SILENCIEUSE : tout ce qui existait est inchangé. */
  edges?: number,
): Structure {
  const id = state.nextStructureId
  state.nextStructureId += 1
  // Le Foyer bâtit plus solide (spec alignement R8).
  const village = state.villages.find((v) => v.id === villageId)
  const hpBonus = village?.archetype === 'foyer' ? ALIGNMENT.FOYER_STRUCTURE_HP_BONUS : 1
  const chiffree = matiereChiffre(type)
  const baseHp = material !== undefined && estPalierMur(type) ? WALL_TIERS[material][type].hp : STRUCTURE_HP[type]
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
  // On ne stocke le matériau que s'il n'est pas le défaut (bois) ET que la pièce en
  // accepte un : snapshot léger, et `s.material ?? 'wood'` fait foi partout.
  if (material !== undefined && material !== 'wood' && (chiffree || matieresDe(type).includes(material))) {
    structure.material = material
  }
  // On n'écrit `edges` que s'il y en a : `undefined` EST le comportement historique, et un
  // `edges: 0` posé par mégarde ferait un mur qui ne bloque plus rien nulle part.
  if (edges !== undefined && edges !== 0) structure.edges = edges
  const containerSlots = CONTAINER_TYPES[type]
  if (containerSlots !== undefined) structure.inventory = makeInventory(containerSlots)
  // LE FEU LIBRE naît avec 10 bois dans son slot combustible, la première allumée maintenant.
  // Le Foyer (villageId ≠ 0) n'a pas de combustible de structure — il tourne sur `village.fuel`.
  if (type === 'fire' && villageId === 0) {
    structure.fuel = makeInventory(FIRE.FUEL_SLOTS)
    addItems(structure.fuel, { wood: FIRE.FUEL_START_WOOD })
    structure.burnAt = state.tick
    structure.burnSlot = 0 // le bois de départ atterrit dans la 1re case : c'est elle qui brûle
  }
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
