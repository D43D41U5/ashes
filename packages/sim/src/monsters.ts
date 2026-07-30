/**
 * Les monstres — zombie et sanglier (spec combat R11-R12).
 *
 * Le zombie est l'école de guerre : lent, télégraphié long, on apprend à
 * lire les wind-ups contre lui. Le sanglier est la chasse : neutre, fuit,
 * charge parfois blessé. IA dans /sim, aléa via le PRNG de la sim.
 */
import { BALANCE, COMBAT, FAUNA, HUNT, MONSTER_DEFS, NODE_DEFS, TICK_DT_S, type MonsterType } from './balance'
// Type seul : `economy` importe `monsters`, un import de valeur fermerait le cycle.
import type { ResourceNode } from './economy'
import { startAttack } from './combat'
import { moveAvatar } from './collision'
import { distSq } from './geometry'
import { rngRoll } from './rng'
import { spawnEntity, type Entity, type SimState } from './sim'
import { computeFlowField } from './pathfinding'
import { structureBlocks } from './village'
import { crossingBlocker } from './construction'
import { cendreuxStep } from './cendreux'
import { advanceFauna, avatarDetectability, avatarThreat, coverAt, faunaStep, isPredator, isPrey, wolfStep, type Threat } from './faune'
import { getGameTime } from './time'

export interface Monster {
  entityId: number
  type: MonsterType
  targetId: number | null
  /** Prochain tick de décision (l'IA pense à 2 Hz, agit à BALANCE.TICK_RATE_HZ). */
  thinkAt: number
  wanderDx: -1 | 0 | 1
  wanderDy: -1 | 0 | 1
  fleeing: boolean
  lastAttackerId: number | null
  path?: { tx: number; ty: number }[]
  /**
   * Bête du peuplement ambiant (spec faune R1) : elle se dissipe quand plus
   * personne n'est là pour la voir. Les bêtes de lieu (tanière) ne le sont pas —
   * elles appartiennent à leur lieu et restent.
   */
  ambient?: boolean
  /**
   * LA NUIT QUI CHASSE — ce loup est venu POUR vous (spec `nighthunt`, GDD §9bis).
   *
   * Il est exempté du COURAGE, et c'est tout le correctif d'un bug qui tuait une règle entière :
   * le courage exige `PACK_COURAGE` congénères proches, `packNearby` s'excluant lui-même — or la
   * nuit n'en lève que `MAX_ALIVE = 2` au total, sans meute. Aucun des deux ne pouvait donc
   * JAMAIS être brave face à un homme : ils rôdaient à trois tuiles jusqu'à l'aube sans mordre
   * une seule fois, et « loin d'un Feu, on est chassé » n'était pas tenu.
   *
   * Le courage garde tout son sens là où il a été écrit : un loup AMBIANT, croisé au hasard, pèse
   * un homme et n'engage qu'en nombre — une meute décimée renonce, et le joueur SENT qu'il a
   * brisé quelque chose. Un rôdeur de nuit, lui, n'a pas été croisé : il a été ENVOYÉ.
   */
  nightHunter?: boolean
  /** Tick où la fuite a commencé — cadence les à-coups (-1 = ne fuit pas). */
  fleeSince: number
  /**
   * LE POINT DE PEUR (spec faune R6) : d'où est venue l'alerte — la menace vue,
   * le lieu du cri de mort, ou celui transmis par la contagion. La bête fuit
   * jusqu'à en être à FLEE_GOAL, et toute la harde partage le même : c'est ce
   * qui la fait fuir ENSEMBLE, dans le même cône (R9bis).
   */
  fleeFromX?: number
  fleeFromY?: number

  /* ── LE SANG (spec chasse C8-C11) ───────────────────────────────────────── */
  /**
   * LA PLAIE MORTELLE : le coup l'a fait passer sous `MORTAL_BELOW` de ses PV.
   * Elle saigne JUSQU'À LA MORT — elle est à vous, si vous la retrouvez.
   * Une plaie LÉGÈRE (au-dessus du seuil), elle, se referme à `bleedUntil`.
   */
  bleedMortal?: true
  /** Tick où le saignement s'arrête (plaie légère). Absent = pas de saignement. */
  bleedUntil?: number
  /** Prochain tick où une goutte tombe (cadence bornée : `BLOOD_EVERY_TICKS`). */
  bleedDropAt?: number
  /** À bout, non pressée : elle s'est TAPIE dans un couvert (C11) — on la retrouve au sang. */
  bedded?: true
  /** Tick depuis lequel plus aucune menace n'est perçue — décide du couché (C11). */
  calmSince?: number

  /* ── Le terrier du lapin (spec chasse C16) ──────────────────────────────── */
  /** Sa tuile de naissance : levé, il fuit VERS elle — et il y disparaît. */
  burrowX?: number
  burrowY?: number

  /* ── L'appât (spec chasse C18) ──────────────────────────────────────────── */
  /** Tick jusqu'auquel elle MANGE la pile posée par le chasseur — tête baissée. */
  baitUntil?: number
  /** La pile qu'elle mange (`state.groundItems`). */
  baitId?: number

  /** LE CROCHET (spec chasse C15) : le cap tiré pour ce burst — il tient jusqu'au suivant. */
  jinkDx?: number
  jinkDy?: number

  /* ── Le coin de chasse (spec faune R17) ─────────────────────────────────── */
  /**
   * SON TERRITOIRE : le coin de chasse dont cette bête est. Elle y est née, elle
   * y broute, et sa dérive vise un but À L'INTÉRIEUR — elle traverse sa
   * clairière, elle ne quitte pas le canton. Absent = bête sans géographie (banc
   * de test, bête de tanière).
   */
  groundX?: number
  groundY?: number

  /* ── La méfiance (spec chasse C1) ───────────────────────────────────────── */
  /**
   * LA JAUGE, 0-1. Elle POURSUIT le stimulus (distance perçue) : vite en montée,
   * lentement en descente. Trois seuils lisibles : CURIEUSE (elle regarde),
   * ALERTÉE (tendue — un coup n'est plus propre), 1 (levée : machine de fuite).
   * La bête EST la jauge : le client en dérive sa posture, rien d'autre à ajouter
   * au protocole. Les prédateurs ne s'en servent pas (ils ne fuient pas l'homme) —
   * leur état « alerté » vit dans `alertSince` seul.
   */
  suspicion: number
  /**
   * LA NERVOSITÉ : multiplie la LENTEUR de la décrue (absent = 1, plafonné). Une
   * bête qui a déjà donné l'alerte ne se rassure plus aussi vite — on ne refait
   * pas indéfiniment la même approche ratée sur la même bête.
   */
  nervous?: number
  /**
   * Tick du DERNIER franchissement du seuil d'alerte (absent = sous le seuil).
   * C'est LUI que la mise à mort propre interroge (C6) : un coup est propre si la
   * bête n'était pas alertée AU DÉPART du wind-up — pas à l'arrivée. Pour un
   * prédateur : posé quand il prend une cible ou décroche, effacé au retour à la
   * patrouille.
   */
  alertSince?: number
  /**
   * Le dernier coup reçu était PROPRE (C6) — drapeau transitoire lu par `die()`
   * pour `monster_slain.clean`. Posé/effacé à chaque coup ; sans conséquence sur
   * une bête qui survit.
   */
  slainClean?: true
  /** La harde à laquelle cette bête appartient (spec faune R9). Absent = solitaire. */
  herdId?: number
  /**
   * ELLE RECOLLE AU GROUPE (spec faune R9). Le rappel est COLLANT : levé à
   * `HERD_SPREAD`, il ne lâche qu'à `HERD_COMFORT`. Sans cette hystérésis, la
   * bête oscillait autour du seuil — deux à trois fois par seconde. Elle
   * TREMBLAIT (playtest).
   */
  regrouping?: true
  /** ELLE S'ÉCARTE d'une voisine (R9bis) — collant, comme le rappel. */
  separating?: true
  /** ELLE RENTRE CHEZ ELLE (hors habitat) — et elle s'engage jusqu'au cœur de sa tuile. */
  homing?: true
  /**
   * Le loup RAMPE vers son poste d'encerclement (spec faune R11). Tant que c'est
   * vrai, la proie ne le repère que de bien plus près — et le client peut le
   * montrer tapi. Faux dès qu'il se rue : la traque et la course sont deux choses.
   */
  stalking?: boolean
  /** LE MÂLE ALPHA de la meute (spec faune R12) : plus gros, plus fort, VISIBLE. */
  alpha?: boolean
  /**
   * L'entité de l'alpha de MA meute. Chaque loup la porte — c'est ainsi qu'il
   * sait, sans registre ni recherche, que son chef est tombé. Le jour où l'alpha
   * ne répond plus, la meute se disperse.
   */
  alphaId?: number
  /**
   * EN DÉROUTE (spec faune R12) : l'alpha est mort, la meute a éclaté. Ce loup ne
   * chasse plus, n'engage plus, ne répond plus à personne — il fuit.
   */
  routed?: boolean
  /**
   * La proie pour laquelle cette meute a déjà hurlé (spec faune R13). On ne hurle
   * qu'UNE fois par homme choisi : un avertissement qui se répète n'avertit plus.
   */
  howledAt?: number

  /* ── Le sanglier (spec faune R14) ───────────────────────────────────────── */
  /** Tick jusqu'auquel il FOUGE, groin au sol — donc distrait (absent = non). */
  rootUntil?: number
  /** Tick où il a commencé à MENACER, planté face à l'intrus (absent = non). */
  threatSince?: number
  /** Tick jusqu'auquel il CHARGE, dans une direction verrouillée (absent = non). */
  chargeUntil?: number
  /** La direction de la charge — verrouillée au départ : il ne tourne pas. */
  chargeDx?: number
  chargeDy?: number
  /** A-t-il déjà encorné quelqu'un pendant CETTE charge ? (Un coup par charge.) */
  chargeHit?: boolean
  /** Tick jusqu'auquel il souffle après sa charge — immobile, offert (absent = non). */
  windedUntil?: number

  /* ── La satiété du prédateur (spec faune R15) ───────────────────────────── */
  /** Tick jusqu'auquel il est REPU : il ne chasse plus (mais il se défend). */
  satedUntil?: number
  /** Tick jusqu'auquel il MANGE, planté sur la carcasse. */
  eatingUntil?: number
  /** La carcasse qu'il est en train de manger. */
  mealCorpseId?: number

  /**
   * Le LIEU dont cette bête est la résidente (index de `map.zones`, spec faune
   * R16). Elle ne se dissipe pas avec la faune ambiante — et quand elle tombe,
   * son lieu la fait revenir. Absent = bête ambiante ou posée à la main.
   */
  homePoi?: number
}

export function spawnMonster(state: SimState, type: MonsterType, x: number, y: number): number {
  // LE SAC EST DÉCLARÉ PAR ESPÈCE (`MONSTER_DEFS[type].sac`), et il vaut ZÉRO pour cinq
  // espèces sur six. Toutes naissaient avec le sac d'un PNJ (40 cases) pour une seule
  // raison, vraie mais pour UNE bête : le Cendreux levé hérite du butin d'un cadavre
  // entier et ne doit pas en perdre une miette. Les autres ne portent rien — leur butin
  // vient de `MONSTER_DEFS[type].loot`, versé dans le cadavre à la mort (`combat.ts`).
  // MESURÉ, ce détail coûtait cher : un lapin pesait 574 octets de JSON dont 201 pour son
  // sac vide — plus gros que celui d'un humain —, répété pour ~600 bêtes, dans le snapshot
  // de chaque client, vingt fois par seconde.
  const id = spawnEntity(state, x, y, MONSTER_DEFS[type].sac)
  const entity = state.entities.find((e) => e.id === id)!
  entity.hp = MONSTER_DEFS[type].hp
  state.monsters.push({
    entityId: id,
    type,
    targetId: null,
    thinkAt: 0,
    wanderDx: 0,
    wanderDy: 0,
    fleeing: false,
    lastAttackerId: null,
    fleeSince: -1,
    suspicion: 0,
  })
  return id
}

function roll(state: SimState): number {
  const { value, next } = rngRoll(state.rngState)
  state.rngState = next
  return value
}

/** Les proies : avatars (joueurs et PNJ), pas les autres monstres. */
export function nearestPrey(state: SimState, entity: Entity, range: number): Entity | undefined {
  const monsterIds = new Set(state.monsters.map((m) => m.entityId))
  let best: Entity | undefined
  let bestD = range * range
  for (const e of state.entities) {
    if (e.id === entity.id || monsterIds.has(e.id) || e.hp <= 0) continue
    const d = distSq(entity.x, entity.y, e.x, e.y)
    if (d < bestD || (d === bestD && best && e.id < best.id)) {
      best = e
      bestD = d
    }
  }
  return best
}

/**
 * LA ZONE MORTE DU PAS — en deçà, on ne corrige pas son alignement, et c'est ce qui évite de
 * frétiller sur place quand on est déjà en face.
 *
 * ELLE SE DÉRIVE DU CORPS, elle ne se choisit pas. Un corps de `AVATAR_HITBOX_TILES` de large a
 * `(1 − largeur)/2` de jeu de chaque côté dans un couloir d'une tuile : c'est sa marge
 * d'alignement. Une zone morte PLUS LARGE que cette marge est un piège — la bête se croit en
 * face, son corps déborde sur la tuile voisine, et elle pousse contre l'obstacle pour toujours.
 * MESURÉ avant la correction : un zombie remontant une chicane s'immobilisait en (4,64 ; 13,19)
 * pour les 3 000 pas du test, à quatorze centièmes de tuile de son couloir. On prend la MOITIÉ
 * de la marge : assez fin pour se replacer, assez large pour ne pas osciller.
 */
const ZONE_MORTE = (1 - BALANCE.AVATAR_HITBOX_TILES) / 4

export function moveToward(
  state: SimState,
  monster: Monster,
  entity: Entity,
  tx: number,
  ty: number,
  flee: boolean,
  /** Fraction d'allure : 1 = plein régime, FAUNA.GRAZE_SPEED = en flânant. */
  gait = 1,
): void {
  const def = MONSTER_DEFS[monster.type]
  let dx = tx - entity.x
  let dy = ty - entity.y
  if (flee) {
    dx = -dx
    dy = -dy
  }
  const sx = (dx > ZONE_MORTE ? 1 : dx < -ZONE_MORTE ? -1 : 0) as -1 | 0 | 1
  const sy = (dy > ZONE_MORTE ? 1 : dy < -ZONE_MORTE ? -1 : 0) as -1 | 0 | 1
  // Le pas ORIENTE la bête (spec chasse C4) : sa perception est directionnelle,
  // il faut donc que son regard suive sa marche — sans quoi « dans le dos » ne
  // voudrait rien dire pour une bête née face à l'est et jamais tournée.
  if (sx !== 0 || sy !== 0) {
    const len = Math.sqrt(sx * sx + sy * sy)
    entity.facing = { x: sx / len, y: sy / len }
  }
  const scale = gait * (def.speed / BALANCE.WALK_SPEED_TILES_PER_S) * (entity.wounds.leg ? COMBAT.LEG_WOUND_SPEED : 1)
  const moved = moveAvatar(
    { map: state.map, structures: state.structures, nodes: state.nodes, moverVillageId: null },
    entity.x,
    entity.y,
    sx,
    sy,
    TICK_DT_S,
    scale,
  )
  entity.moved = moved.x !== entity.x || moved.y !== entity.y
  entity.x = moved.x
  entity.y = moved.y
}

/**
 * ═══ LES CHAMPS DE FLUX — le cache SURVIT AUX TICKS, et c'est tout le sujet ═══
 *
 * Le champ de flux est un BFS sur TOUTE la carte. Il vivait le temps d'un `advanceMonsters` :
 * une horde vivante le faisait donc refaire vingt fois par seconde. MESURÉ, seed 2026 :
 *
 *   · banc (450 k tuiles) : 0,33 ms/tick avant la horde → **77 ms/tick** dès l'apparition de
 *     quatre monstres, et ça ne redescend plus. C'est un facteur 250, et c'est ce qui faisait
 *     durer 43 minutes un banc d'un jour.
 *   · carte de PRODUCTION (3,75 M tuiles, 125 686 nœuds) : **1192 ms par champ**. Une seule
 *     horde et le tick coûte 1,2 s, contre un budget de 50 ms à 20 Hz — le jeu ne ralentit pas,
 *     il s'arrête.
 *
 * ═══ POURQUOI ON PEUT LE GARDER, ET À QUELLE CONDITION EXACTE ═══
 *
 * Le champ ne dépend que de trois choses : le TERRAIN (statique — rien dans `/sim` n'écrit dans
 * `map.terrain` après la génération), les NŒUDS, et la tuile du Feu visé. Les structures sont
 * explicitement ignorées (le gradient traverse les murs : c'est le siège naturel).
 *
 * Les nœuds, eux, bougent vraiment : `stock` franchit zéro dans les deux sens (récolte, repousse),
 * il en naît (`economy.ts`), et il en DÉPLACE (`economy.ts:212`). On garde donc une SIGNATURE —
 * pour chaque nœud, sa tuile et son caractère bloquant — et le moindre écart vide le cache. Une
 * signature qui change pour rien ne coûte qu'un recalcul ; c'est l'inverse qui serait grave, d'où
 * une signature volontairement large plutôt qu'un compteur de version à semer dans le code.
 *
 * Elle est relue UNE FOIS PAR TICK, en tête d'`advanceMonsters`. C'est exact parce que rien ne
 * touche aux nœuds pendant ce tick-là : `advanceMonsters` n'appelle que `advanceFauna`, et la
 * faune ne les modifie jamais (la récolte et la repousse vivent dans `advanceEconomy`).
 *
 * ═══ OÙ IL VIT — la réponse à la crainte que cette note portait avant ═══
 *
 * *« Un cache au niveau module servirait le champ d'une autre partie dès que deux sims cohabitent
 * dans le même processus (rooms LAN). »* — c'était juste, et c'est précisément pourquoi il est
 * dans une `WeakMap` CLÉE PAR LE `SimState` : chaque partie a le sien, et il disparaît avec elle.
 * Il n'est PAS dans le `SimState` (un `Int32Array` et une `Map` n'y ont pas leur place, et il ne
 * doit ni se sérialiser ni se transporter) : c'est un dérivé pur, reconstruit à l'identique après
 * un snapshot ou dans un replay.
 *
 * UNE SEULE DIFFÉRENCE VISIBLE, et elle est bénigne : les champs sont désormais indexés par la
 * TUILE DU FEU visé, non par l'id de horde. Deux hordes qui marchent sur le même village
 * calculaient deux champs identiques ; elles en partagent un. Le champ étant le même, le pas de
 * chaque monstre l'est aussi.
 */
/**
 * Les quatre voisins — est, ouest, sud, nord, et l'ORDRE COMPTE : la descente de gradient garde
 * le PREMIER minimum (comparaison stricte), donc changer l'ordre changerait la tuile choisie à
 * égalité de distance. Écrit ici plutôt qu'en littéral dans la boucle, où il s'allouait à chaque
 * pas de chaque monstre de horde.
 */
const VOISINS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

interface CacheFlux {
  /** Un entier par nœud : sa tuile et son caractère bloquant. Voir `signerLesNoeuds`. */
  signature: Int32Array
  /** Le nombre de nœuds au moment de la signature — un ajout ou un retrait invalide. */
  taille: number
  /** Les champs, par tuile de Feu visé. */
  champs: Map<number, Int32Array>
}

const CACHES_DE_FLUX = new WeakMap<SimState, CacheFlux>()

/**
 * La signature d'un nœud : `tuile × 2 + bloquant`.
 *
 * BORNE : `tuile` vaut au plus `width × height − 1`, soit 3 749 999 sur la carte de production —
 * le double tient très au large dans un `Int32Array`. Une carte de plus de ~1 milliard de tuiles
 * déborderait et rendrait une signature fausse mais plausible : c'est la seule façon dont ce
 * cache pourrait mentir, et elle est hors d'atteinte de deux ordres de grandeur.
 */
function signerLeNoeud(node: ResourceNode, width: number): number {
  const bloquant = node.stock > 0 && NODE_DEFS[node.type].blockHalfSub > 0
  return (node.ty * width + node.tx) * 2 + (bloquant ? 1 : 0)
}

/**
 * Rend le cache de la partie, VIDÉ si les nœuds ont bougé. Un seul parcours : on compare tant
 * que ça colle, on ne réalloue qu'en cas d'écart.
 */
function cacheDeFlux(state: SimState): CacheFlux {
  const nodes = state.nodes
  const n = nodes.length
  const width = state.map.width
  const courant = CACHES_DE_FLUX.get(state)

  if (courant !== undefined && courant.taille === n) {
    let identique = true
    for (let i = 0; i < n; i++) {
      if (courant.signature[i] !== signerLeNoeud(nodes[i]!, width)) {
        identique = false
        break
      }
    }
    if (identique) return courant
  }

  const signature = new Int32Array(n)
  for (let i = 0; i < n; i++) signature[i] = signerLeNoeud(nodes[i]!, width)
  const neuf: CacheFlux = { signature, taille: n, champs: new Map() }
  CACHES_DE_FLUX.set(state, neuf)
  return neuf
}

/**
 * Descente de gradient vers le Feu ciblé (spec événements R3). Si la
 * meilleure tuile est bouchée par une structure, on la frappe. Retourne
 * true si le monstre appartient à une horde (et a donc agi).
 */
function hordeStep(state: SimState, monster: Monster, entity: Entity, flux: CacheFlux | null): boolean {
  const horde = state.hordes.find((h) => h.memberEntityIds.includes(monster.entityId))
  if (!horde) return false
  const village = state.villages.find((v) => v.id === horde.targetVillageId)
  if (!village || flux === null) return true

  // Indexé par la TUILE DU FEU visé : deux hordes sur le même village partagent le champ.
  const cleDuFoyer = village.fireTy * state.map.width + village.fireTx
  let field = flux.champs.get(cleDuFoyer)
  if (!field) {
    field = computeFlowField(state.map, state.nodes, village.fireTx, village.fireTy)
    flux.champs.set(cleDuFoyer, field)
  }

  const width = state.map.width
  const height = state.map.height
  const tx = Math.floor(entity.x)
  const ty = Math.floor(entity.y)
  let bestTx = tx
  let bestTy = ty
  let bestD = field[ty * width + tx] ?? -1
  if (bestD === -1) bestD = Infinity
  for (const [dx, dy] of VOISINS4) {
    const nx = tx + dx
    const ny = ty + dy
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
    const d = field[ny * width + nx]
    if (d !== undefined && d !== -1 && d < bestD) {
      bestD = d
      bestTx = nx
      bestTy = ny
    }
  }
  if (bestTx === tx && bestTy === ty) return true // au but ou coincé hors champ

  // LE PASSAGE vers la tuile du gradient est-il barré ? On frappe ce qui le barre.
  //
  // On demandait « qu'y a-t-il SUR la tuile où je veux aller ? » (`solidAt`). Avec des murs
  // pleins c'était la même question ; avec un mur d'ARÊTE (R23), non — le mur qui me barre la
  // route est souvent déclaré sur MA tuile, bit tourné vers la destination, et la destination
  // est vide. La bête ne trouvait alors rien à frapper, avançait, butait sur la bande et
  // **restait là** : une enceinte de murs minces aurait été une défense que les pillards
  // ignorent. `crossingBlocker` regarde les deux côtés de l'arête, comme la collision.
  const blocker = crossingBlocker(state.structures, tx, ty, bestTx - tx, bestTy - ty, (s) => structureBlocks(s, null, false))
  if (blocker) {
    if (!entity.windup && state.tick >= entity.cooldownUntil) {
      const def = MONSTER_DEFS[monster.type]
      const started = startAttack(state, entity, bestTx + 0.5 - entity.x, bestTy + 0.5 - entity.y, {
        windupTicks: def.windupTicks,
        damage: def.damage,
        structureId: blocker.id,
      })
      // Un coup refusé (endurance…) ne consomme pas le cooldown.
      if (started) entity.cooldownUntil = state.tick + def.attackCooldownTicks
    }
    return true
  }

  moveToward(state, monster, entity, bestTx + 0.5, bestTy + 0.5, false)
  return true
}

/** Frappe la structure qui bloque la direction de chasse, s'il y en a une. */
function attackBlockingStructure(state: SimState, monster: Monster, entity: Entity, tx: number, ty: number): void {
  const ex = Math.floor(entity.x)
  const ey = Math.floor(entity.y)
  const dx = tx - entity.x
  const dy = ty - entity.y
  // Voisines dans l'ordre de l'axe dominant.
  const candidates: [number, number][] =
    Math.abs(dx) >= Math.abs(dy)
      ? [
          [ex + Math.sign(dx), ey],
          [ex, ey + Math.sign(dy)],
        ]
      : [
          [ex, ey + Math.sign(dy)],
          [ex + Math.sign(dx), ey],
        ]
  for (const [cx, cy] of candidates) {
    // Le FRANCHISSEMENT, pas la tuile (R23) — même correction qu'au gradient : un mur d'arête
    // qui me barre la route peut être déclaré chez moi. `Math.sign` rend 0 quand l'axe est
    // aligné : ce « voisin » est ma propre tuile, il n'y a pas d'arête à franchir.
    if (cx === ex && cy === ey) continue
    const s = crossingBlocker(state.structures, ex, ey, cx - ex, cy - ey, (st) => structureBlocks(st, null, false))
    if (s) {
      const def = MONSTER_DEFS[monster.type]
      if (startAttack(state, entity, cx + 0.5 - entity.x, cy + 0.5 - entity.y, { windupTicks: def.windupTicks, damage: def.damage, structureId: s.id })) {
        entity.cooldownUntil = state.tick + def.attackCooldownTicks
      }
      return
    }
  }
}

export function advanceMonsters(state: SimState): void {
  // Le cache des champs de flux, relu UNE FOIS pour tout le tick — et seulement s'il y a une
  // horde, sinon on ne paie même pas la signature. Voir la note de `CacheFlux`.
  const flux = state.hordes.length > 0 ? cacheDeFlux(state) : null

  // Les avatars (tout ce qui n'est pas un monstre) sont la liste des menaces :
  // la faune n'a peur que d'eux, et ils sont peu nombreux.
  const monsterIds = new Set(state.monsters.map((m) => m.entityId))
  const avatars = state.entities.filter((e) => !monsterIds.has(e.id) && e.hp > 0)

  // Index du tick. Sans lui, chaque monstre résolvait son entité par un `find`
  // sur toute la liste — O(n²), tenable à 10 monstres, plus du tout avec une faune.
  let byId = new Map<number, Entity>()
  for (const e of state.entities) byId.set(e.id, e)

  // Le peuplement d'abord : les bêtes nées ce tick jouent dès ce tick, celles que
  // plus personne ne regarde ne coûtent pas un pas de plus, et une meute dont
  // l'alpha est tombé se disperse avant d'avoir pu mordre une fois de plus.
  advanceFauna(state, avatars, byId)

  // Le peuplement a pu créer et retirer des entités : on réindexe.
  byId = new Map<number, Entity>()
  for (const e of state.entities) byId.set(e.id, e)

  // Les hardes et les meutes du tick (spec faune R9/R11) — dérivé pur,
  // reconstruit chaque tick, jamais sérialisé : seul `herdId` vit dans l'état.
  const herds = new Map<number, Monster[]>()
  for (const m of state.monsters) {
    if (m.herdId === undefined) continue
    const members = herds.get(m.herdId)
    if (members) members.push(m)
    else herds.set(m.herdId, [m])
  }

  // L'ÉCOSYSTÈME (spec faune R11). Deux listes, et elles se croisent :
  //  — ce que le gibier CRAINT : les hommes ET les loups. Un cerf fuit le loup
  //    exactement comme il fuit le chasseur. Chaque menace porte sa FURTIVITÉ :
  //    un loup qui rampe vers son poste ne se repère que de tout près.
  //  — ce que le loup CHASSE : les hommes ET le gibier. La vallée n'a pas deux
  //    étages, elle en a un seul, et le joueur y est une pièce parmi d'autres.
  const hour = getGameTime(state).hourOfCycle
  const isAvatar = (id: number): boolean => !monsterIds.has(id)
  const monsterByEntity = new Map<number, Monster>()
  for (const m of state.monsters) monsterByEntity.set(m.entityId, m)

  // LA FURTIVITÉ, entrée UNE fois (spec chasse C5) : deux canaux par menace —
  // la VUE (allure × couvert, que le regard de chaque bête modulera encore) et
  // l'OUÏE (le bruit, omnidirectionnel). L'angle (C4) dépend du REGARD de chaque
  // percepteur : il s'applique dans `nearestThreat`, pas ici.
  const detectById = new Map<number, number>()
  for (const a of avatars) detectById.set(a.id, avatarDetectability(state, a))
  const stealthOf = (e: Entity): number => detectById.get(e.id) ?? 1

  const threats: Threat[] = avatars.map((e) => avatarThreat(state, e))
  const quarry: Entity[] = [...avatars]
  for (const m of state.monsters) {
    const e = byId.get(m.entityId)
    if (!e || e.hp <= 0) continue
    // Le couvert cache le loup comme il cache l'homme (C3) : mêmes règles pour
    // tous. Et un loup est quasi silencieux — c'est tout le sens de sa traque.
    if (isPredator(m.type)) {
      const vision = (m.stalking ? FAUNA.STALK_STEALTH : 1) * coverAt(state, e.x, e.y)
      threats.push({ e, vision, noise: vision * HUNT.PREDATOR_NOISE })
    } else if (isPrey(m.type)) quarry.push(e)
  }

  for (const monster of [...state.monsters]) {
    const entity = byId.get(monster.entityId)
    if (!entity) continue
    const def = MONSTER_DEFS[monster.type]
    if (entity.windup) continue // en train de frapper : immobile

    if (monster.type === 'cendreux') {
      cendreuxStep(state, monster, entity)
      continue
    }

    if (isPredator(monster.type)) {
      wolfStep(state, monster, entity, quarry, byId, monsterByEntity, herds, hour, isAvatar, stealthOf)
      continue
    }

    if (isPrey(monster.type)) {
      faunaStep(state, monster, entity, threats, byId, herds, hour)
      continue
    }

    if (monster.type === 'zombie') {
      if (state.tick >= monster.thinkAt) {
        monster.thinkAt = state.tick + def.thinkEveryTicks
        const prey = nearestPrey(state, entity, def.aggroRange)
        monster.targetId = prey?.id ?? null
        if (!prey && roll(state) < def.wanderChance) {
          monster.wanderDx = (Math.floor(roll(state) * 3) - 1) as -1 | 0 | 1
          monster.wanderDy = (Math.floor(roll(state) * 3) - 1) as -1 | 0 | 1
        }
      }
      const target = monster.targetId !== null ? state.entities.find((e) => e.id === monster.targetId) : undefined
      if (target) {
        const d2 = distSq(entity.x, entity.y, target.x, target.y)
        if (d2 <= COMBAT.MELEE_ENGAGE_RANGE * COMBAT.MELEE_ENGAGE_RANGE) {
          if (startAttack(state, entity, target.x - entity.x, target.y - entity.y, { windupTicks: def.windupTicks, damage: def.damage })) {
            entity.cooldownUntil = state.tick + def.attackCooldownTicks
          }
        } else {
          moveToward(state, monster, entity, target.x, target.y, false)
          // Bloqué en chasse par une structure (mur, porte) : on la frappe.
          if (!entity.moved && !entity.windup && state.tick >= entity.cooldownUntil) {
            attackBlockingStructure(state, monster, entity, target.x, target.y)
          }
        }
      } else if (hordeStep(state, monster, entity, flux)) {
        // membre de horde sans proie : il coule vers le Feu (flow field)
      } else if (monster.wanderDx !== 0 || monster.wanderDy !== 0) {
        moveToward(state, monster, entity, entity.x + monster.wanderDx, entity.y + monster.wanderDy, false)
      }
      continue
    }
  }
}

