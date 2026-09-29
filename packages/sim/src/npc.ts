/**
 * LE CORPS QUI MARCHE — navigation, pas, main armée.
 *
 * ⚠ **CE FICHIER S'APPELAIT « LES PNJ », ET L'IA VILLAGEOISE EN EST PARTIE LE 2026-09-29**
 * (tranche 2b du retrait des villages PNJ, pivot de la braise du 28/09). Ce qui est parti :
 * l'orchestration (`advanceNpcs`), le tableau du village et ses corvées (`claimTask`,
 * `dropTask`, les six exécuteurs), les besoins (`npc-needs.ts`), la milice (`handleDefense`)
 * et le peuplement (`spawnNpcsAround`). Ce qui reste est ce que d'AUTRES systèmes appellent.
 *
 * ⚠ **ET IL FAUT LE DIRE FRANCHEMENT : `followPath` et `setPathTo` N'ONT PLUS D'APPELANT
 * RUNTIME.** Le primitif que la faune et le Cendreux partagent est `pathToward`
 * (`pathfinding.ts`), pas ces deux-ci : leur seul appelant était l'IA qui vient de partir, et
 * leurs seuls appelants restants sont les HUIT gardes d'étanchéité E-R5 §23/§24
 * (`etages-etancheite.test.ts`), dont cinq les appellent vraiment — les deux « PRÉMISSE » ne
 * bâtissent que le marcheur, et « LE DÉFAUT D'AVANT » appelle `pathToward` nu. (Compté sur
 * l'arbre du jour, pas rappelé : c'était « neuf » avant que la coupe du même jour emporte le
 * bloc du glanage.) On les GARDE quand même, et c'est un choix assumé — ces huit
 * gardes éprouvent que **la roche est étanche** et que le chemin ne traverse pas une paroi,
 * une loi qui compte plus que jamais pour l'Ascension, et les réexprimer contre `pathToward`
 * nu les affaiblirait. Le jour où un corps non-joueur remarche (compagnon de coop, siège
 * cendreux), c'est ici qu'il reprend. D'ici là : du code éprouvé sans appelant de jeu.
 *
 * `Npc` n'est plus qu'un MARCHEUR : l'identité du corps, son village (pour les portes) et
 * l'état de sa navigation. ⚠ **ET IL N'EST PLUS UN CHAMP DE L'ÉTAT** : `SimState.npcs` est
 * parti le 2026-09-29 (tranche 3), avec ses quatorze lecteurs, le snapshot et la clé de
 * sauvegarde. Ce type ne vit donc plus que dans la main de qui le construit — les gardes
 * E-R5 ci-dessus, et le corps non-joueur du jour où il y en aura un.
 */
import {
  BALANCE,
  NPC_AI,
  SLOTS,
  TICK_DT_S,
  WEAPON_DAMAGE,
  isRangedWeapon,
  type ToolFamily,
} from './balance'
import { moveAvatar, type MoveWorld } from './collision'
import { atteintLeSol, etageApresLePas, etagesDuPas, niveauDuCorps, palierDuSol, poserLEtageDuCorps } from './etages'
import type { WorldMap } from './map'
import { toolRank } from './economy'
import { distSq } from './geometry'
import { moveSlotWithin, type ItemId } from './items'
import { pathToward } from './pathfinding'
import type { Entity, SimState } from './sim'

/** Un corps qui marche : son identité, son village (les portes) et sa navigation. */
export interface Npc {
  entityId: number
  villageId: number
  /**
   * Les jalons. **`etage` est ADDITIF** (`findPath` : « un pas au sol reste `{tx, ty}` ») : le
   * champ n'apparaît que sur un jalon hors du sol, donc une sauvegarde d'avant ne gagne pas un
   * octet et le runtime ne change pas d'un bit — l'A* posait déjà ce champ, seul le TYPE
   * l'ignorait. Le déclarer, c'est rendre lisible ce que le chemin sait déjà : `followPath`,
   * lui, ne le lit pas encore (spec `etages.md` §23).
   */
  path: { tx: number; ty: number; etage?: number }[]
  stuck: number
  /**
   * LE REFUS MÉMORISÉ — « aucune route vers CETTE tuile, DEPUIS celle-ci, jusqu'à CE tick ».
   *
   * Un A* qui échoue est le calcul le plus cher du jeu : il épuise son budget entier (4096
   * expansions, ×4 quand `pathToward` essaie les voisins d'une cible bloquée) pour ne rien
   * rendre. Sans mémoire, un marcheur coupé de sa cible le repaie À CHAQUE TICK. Mesuré sur
   * la carte doublée (banc 6 joueurs) : 6 appels par tick, 100 % d'échecs, le tick à 89 ms ;
   * avec ce refus gardé `NPC_AI.SANS_CHEMIN_TICKS`, 0,12 appel par tick et le tick à 8,9 ms.
   *
   * La clé porte la CIBLE *et* la tuile d'où l'on a refusé : un corps qui a bougé d'une seule
   * tuile reprend son droit de chercher — il peut avoir franchi la rampe qui manquait. Le
   * délai, lui, borne ce que le mémo ignore : une porte qu'on ouvre, un mur qu'on abat.
   *
   * ⚠ PLUSIEURS CASES, ET C'EST LE CŒUR DE LA LOI. Avec une seule case, deux appelants qui
   * visent des tuiles différentes s'évincent l'un l'autre à chaque tick, et AUCUN des deux ne
   * retrouve jamais son propre refus : le mémo est alors plein en permanence et ne sert à rien.
   * MESURÉ le 2026-09-21 sur le banc 6 joueurs, quand l'IA villageoise vivait encore : deux
   * appelants (la maison et le Feu) coupés de leurs cibles repayaient DEUX A* complets par
   * tick, chacun ×4 voisins autour d'une cible à hitbox — le tick du banc à 267 ms, treize
   * fois son régime de jour. Le nombre de cases se lit sur l'ENSEMBLE des appelants :
   * `NPC_AI.SANS_CHEMIN_CASES`. Au-delà du plafond, la plus ancienne cède — cet appelant-là
   * repaie son A* une fois, puis se réinscrit. Borné, jamais pathologique. Chaque case garde
   * SA péremption : un tableau qui expirerait en bloc jetterait un refus tout frais parce
   * qu'un autre a vieilli.
   */
  sansChemin: { cible: number; depuis: number; niveau: number; etageCible: number; jusqua: number }[]
}

const RANGE = BALANCE.INTERACT_RANGE - 0.2 // marge : on agit un peu en dedans de la portée

// ─── Aides ────────────────────────────────────────────────────────────────

function moveWorldFor(state: SimState, villageId: number, etages?: readonly number[]): MoveWorld {
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
  //
  // `etages` — LES ÉTAGES QUE LE PAS PEUT OCCUPER (spec `etages.md` E-R1). Absent pour tout ce
  // qui n'est pas un PAS : l'A* de `setPathTo` reçoit son étage par argument, pas par le monde.
  return { map: state.map, structures: state.structures, nodes: state.nodes, moverVillageId: villageId, opensDoors: true, ...(etages !== undefined ? { etages } : {}), etat: state }
}

/**
 * ═══ LE PAS DU VILLAGEOIS — ÉTAGE COMPRIS ═══
 *
 * *« L'avatar et la bête franchissent les rampes et entrent dans les grottes. Veux-tu que les PNJ
 * en fassent autant ? » — « Oui. »* (Alexis, 2026-09-11.)
 *
 * C'est le patron de l'avatar (`sim.ts`) et de la bête (`monsters.ts`), mot pour mot : on lit
 * l'étage AVANT, on demande au pas quels étages il peut occuper, on le passe au monde de
 * collision, et on écrit l'étage APRÈS. Aucune des trois pièces n'est optionnelle —
 *
 *  - sans `etages` dans le monde, la paroi d'une terrasse N'EXISTE PAS pour le villageois :
 *    `terrainBloque` retombe sur `map.terrain`, que les terrasses ne repeignent jamais (T-R2).
 *    Il traversait donc les falaises à pied sec, et aucune rampe ne servait à rien ;
 *  - sans `poserLEtageDuCorps`, un étage EXPLICITE hérité de la position d'avant survit au pas.
 *    `niveauDuCorps` répond alors faux, `near` refuse le geste, et on retrouve exactement le
 *    villageois figé que le §23 vient de réparer côté approche.
 *
 * LES TROIS SITES QUI DÉPLACENT UN PNJ passent par ici — la marche du chemin, l'écart d'un pas
 * pour poser un composant, et la marche gloutonne vers une menace. Un quatrième qui écrirait
 * `entity.x` à la main rouvrirait la deuxième panne, en silence : c'est pour ça qu'il y a une
 * fonction et pas trois copies.
 *
 * Écrit `entity.moved`, `entity.x`, `entity.y` et l'étage ; rend la position obtenue, pour qui
 * veut savoir s'il a bougé (l'anti-blocage de `followPath`).
 */
function pasDuVillageois(
  state: SimState, npc: Npc, entity: Entity, sx: -1 | 0 | 1, sy: -1 | 0 | 1, speedScale = 1,
): { x: number; y: number } {
  const etageAvant = niveauDuCorps(state.map, entity)
  const etages = etagesDuPas(state.map, etageAvant, Math.floor(entity.x), Math.floor(entity.y))
  const moved = moveAvatar(moveWorldFor(state, npc.villageId, etages), entity.x, entity.y, sx, sy, TICK_DT_S, speedScale)
  entity.moved = moved.x !== entity.x || moved.y !== entity.y
  entity.x = moved.x
  entity.y = moved.y
  poserLEtageDuCorps(state.map, entity, etageApresLePas(state.map, etages, etageAvant, Math.floor(moved.x), Math.floor(moved.y)))
  return moved
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
  const avantX = entity.x
  const avantY = entity.y
  const moved = pasDuVillageois(state, npc, entity, sx, sy, speedScale)
  if (moved.x === avantX && moved.y === avantY) {
    npc.stuck += 1
    if (npc.stuck > 2 * BALANCE.TICK_RATE_HZ) {
      npc.path = [] // recalcul au prochain tick de décision
      npc.stuck = 0
    }
  } else {
    npc.stuck = 0
  }
  return true
}

/**
 * Calcule un chemin vers une tuile (ou une voisine marchable si elle bloque).
 *
 * ═══ `etage` EST POSITIONNEL ET OBLIGATOIRE, comme pour `near` (spec `etages.md` §23) ═══
 *
 * L'APPROCHE DOIT VISER CE QUE L'INTERACTION EXIGE. Les deux vont par paire dans tout ce
 * fichier — `near(map, entity, X.tx, X.ty, X.etage)` garde le geste, `setPathTo(…, X.etage)`
 * fait la marche —, et tant que la seconde ignorait l'étage de la première, elles pouvaient
 * parler de deux endroits différents. Le cas mesuré (`etages-etancheite.test.ts`, jambe du
 * creux) : vers un coffre d'une salle sous la roche, `pathToward` repartait au palier du SOL,
 * trouvait un vrai chemin d'une trentaine de jalons, et le PNJ venait se planter **sur le toit
 * de la salle, à 0,05 tuile** de sa cible. Il y restait pour toujours : `near` refusait le
 * geste, et le garde-fou qui relâche la corvée ne se déclenche QUE si aucun chemin n'existe.
 * Désormais l'A* vise l'étage réel : il rend `null`, la corvée est relâchée, le PNJ fait autre
 * chose. Un refus franc au lieu d'un villageois figé.
 *
 * `undefined` = LE SOL DE LA TUILE, et c'est la bonne réponse pour presque tout : un Foyer de
 * village n'a pas d'étage, et une structure bâtie debout non plus (`village.ts` : « au sol
 * (niveau ≥ 0), la structure naît sans `etage` »). Le champ n'est renseigné que sous la roche.
 * Le monde d'aujourd'hui est donc rendu jalon pour jalon — `etage ?? palierDuSol(tx, ty)` EST
 * le défaut qu'avait `pathToward`, et `niveauDuCorps` sur un corps sans étage est le palier de
 * sa tuile, c'est-à-dire l'autre défaut. Ce qui change, c'est ce qui était faux.
 *
 * Obligatoire, donc : un site qui l'oublierait retomberait en silence sur le palier du sol, et
 * `tsc` doit le refuser plutôt que le jeu s'en accommoder.
 */
export function setPathTo(
  state: SimState, npc: Npc, entity: Entity, tx: number, ty: number, etage: number | undefined,
): boolean {
  // LE REFUS MÉMORISÉ (cf. `Npc.sansChemin`) : même cible, même tuile de départ, répit non
  // écoulé → on redit non SANS relancer l'A*. Un échec coûte son budget ENTIER ; le répéter
  // soixante fois par seconde pour un villageois qu'un mur sépare de sa cible, c'est le tick
  // qui passe de 9 à 89 ms. La garde est au-dessus de `pathToward`, donc elle couvre aussi les
  // quatre essais que celui-ci fait autour d'une cible bloquée.
  const W = state.map.width
  const cible = ty * W + tx
  const ici = Math.floor(entity.y) * W + Math.floor(entity.x)
  // ⚠ LES DEUX NIVEAUX FONT PARTIE DE LA CLÉ. L'A* les reçoit tous les deux — le niveau du
  // CORPS et le palier de la CIBLE — or la première version de ce mémo ne les encodait pas :
  // deux requêtes de mêmes tuiles à des étages différents s'aliasaient, et le mémo disait non
  // là où la route existait. Un mémo ne doit jamais être plus grossier que le calcul qu'il
  // remplace. On les hisse au-dessus du test : deux lectures de carte sur le chemin rapide,
  // sans commune mesure avec l'A* qu'elles évitent.
  const niveau = niveauDuCorps(state.map, entity)
  const etageCible = etage ?? palierDuSol(state.map, tx, ty)
  const refus = npc.sansChemin
  for (const m of refus) {
    if (m.cible === cible && m.depuis === ici && m.niveau === niveau && m.etageCible === etageCible && state.tick < m.jusqua) {
      npc.path = []
      return false
    }
  }
  const world = moveWorldFor(state, npc.villageId)
  // Cible bloquée (Feu à hitbox, mur…) → on se poste au voisin libre le plus
  // proche. Logique partagée avec la dérive du Cendreux (`pathToward`).
  const path = pathToward(
    world, entity.x, entity.y, tx, ty,
    NPC_AI.PATH_EXPLORE, // ce qu'un villageois connaît de son pays (V-R11) — pas un défaut de signature
    niveau,
    etageCible,
  )
  npc.path = path ?? []
  if (path === null) {
    // On REMPLACE la case de cette cible si elle existe (sa péremption vient de s'écouler),
    // sinon on ajoute — APRÈS AVOIR BALAYÉ LES MORTES. Sans ce balayage, une cible qu'on cesse
    // de demander garde sa place pour toujours : MESURÉ le 2026-09-21, une case à
    // `reste = −16 406` squattait un quart du mémo seize mille ticks après sa péremption, et
    // c'est une case VIVE que le `shift()` aurait fini par évincer à sa place. On ne balaie
    // qu'au moment d'AJOUTER : le chemin du succès et celui du mémo touché restent gratuits,
    // et l'ordre du tableau reste déterministe (parcours arrière, `splice` par index).
    // ⚠ LE BALAYAGE EST EN TÊTE, ET C'EST TOUT L'ENJEU. Placé dans la branche d'AJOUT, il ne
    // s'exécutait JAMAIS : un PNJ enclavé redemande toujours une cible déjà mémorisée, donc
    // `findIndex` la trouve, on remplace en place, et la branche d'ajout reste morte — la case
    // à `reste = −16 406` a survécu intacte à ce premier correctif. Une garde ne vaut que si
    // le cas réel passe par le chemin qui la porte.
    for (let k = refus.length - 1; k >= 0; k--) {
      const mort = refus[k]
      if (mort !== undefined && state.tick >= mort.jusqua) refus.splice(k, 1)
    }
    const neuf = { cible, depuis: ici, niveau, etageCible, jusqua: state.tick + NPC_AI.SANS_CHEMIN_TICKS }
    const i = refus.findIndex((m) => m.cible === cible && m.niveau === niveau && m.etageCible === etageCible)
    if (i >= 0) refus[i] = neuf
    else {
      refus.push(neuf)
      if (refus.length > NPC_AI.SANS_CHEMIN_CASES) refus.shift()
    }
  } else if (refus.length > 0) {
    // ⚠ ON NE RETIRE QUE LA CASE DE **CETTE** CIBLE. Vider tout le tableau au premier succès
    // reproduisait le défaut de la case unique sous une autre forme : en régime MIXTE (une
    // cible joignable, une autre non), le succès vers X effaçait le refus de Y, qui repayait
    // son A* au tick suivant — et ainsi à chaque tick. Une route trouvée vers X ne prouve
    // rien sur Y ; c'est la péremption par case qui répond au monde qui change.
    const j = refus.findIndex((m) => m.cible === cible && m.niveau === niveau && m.etageCible === etageCible)
    if (j >= 0) refus.splice(j, 1)
  }
  return path !== null
}

export function near(map: WorldMap, entity: Entity, tx: number, ty: number, etage: number | undefined, r = RANGE): boolean {
  // E-R5, Q5 tranchée par Alexis (2026-09-07) : « sceller les 9 en bloc ». C'EST LE PRÉDICAT
  // D'INTERACTION DES PNJ — vingt-cinq appels en dépendent, et un plancher ne se manipule pas
  // plus qu'il ne se voit. `etage` est POSITIONNEL ET OBLIGATOIRE, avant `r` : un site qui
  // l'oublierait retomberait en silence sur le palier du sol, et `tsc` doit le refuser plutôt
  // que le jeu s'en accommoder. Ce qu'on vise porte son étage (`Structure.etage`,
  // `ResourceNode.etage`) ; `undefined` = le SOL de la tuile, et c'est la bonne réponse pour
  // un Foyer de village, qui n'a pas d'étage.
  if (distSq(entity.x, entity.y, tx + 0.5, ty + 0.5) > r * r) return false
  return atteintLeSol(map, entity, tx, ty, etage)
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

// ─── Peuplement ───────────────────────────────────────────────────────────

/**
 * L'anneau de tuiles autour du Feu. **Il ne pose plus personne** — `spawnNpcsAround` est parti
 * avec l'IA le 2026-09-29 — mais `foundNpcVillage` continue d'en RÉSERVER le début
 * (`RING_OFFSETS.slice(0, count + 2)`) : ce sont les tuiles que le semis de décor laisse nues
 * autour d'un Feu. Le retirer déplacerait des nœuds sur toute la carte.
 */
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
