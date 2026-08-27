/**
 * Les monstres — aiguillage d'IA par espèce, et les outils que toutes partagent
 * (`moveToward`, `nearestPrey`, le champ de flux des hordes, le coup porté à ce qui barre).
 *
 * Le CENDREUX est l'école de guerre : lent, télégraphié long, on apprend à lire les wind-ups
 * contre lui — et depuis qu'il a absorbé le zombie (spec `cendreux.md` R1), c'est le seul
 * mort-vivant du monde ; son IA vit dans `cendreux.ts`. Le sanglier est la chasse : neutre,
 * fuit, charge parfois blessé. Le gibier et le loup vivent dans `faune.ts`. IA dans /sim,
 * aléa via le PRNG de la sim.
 */
import { BALANCE, CENDREUX, COMBAT, FAUNA, HUNT, MONSTER_DEFS, NODE_DEFS, TICK_DT_S, WORLD_EVENTS, type MonsterType } from './balance'
import { estIncassable } from './pieces'
// Type seul : `economy` importe `monsters`, un import de valeur fermerait le cycle.
import type { ResourceNode } from './economy'
import { startAttack } from './combat'
import { moveAvatar } from './collision'
import { separationPush } from './ecart'
import { distSq } from './geometry'
import { spawnEntity, type Entity, type SimState } from './sim'
import { computeFlowField, computeFlowFieldMulti, solidesEternels } from './pathfinding'
import { fireStateAt } from './fire'
import { structureBlocks } from './village'
import { crossingBlocker } from './construction'
import { cendreuxStep } from './cendreux'
import { meteoVisionFactor } from './meteo'
import { eveilCendreuxAt } from './temperature'
import { advanceFauna, avatarDetectability, avatarThreat, coverAt, faunaStep, isPredator, isPrey, wolfStep, type Threat } from './faune'
import { effetsDuJour } from './modificateur'
import { actForDay, getGameTime, jourDeSaison, seasonRamp } from './time'

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
  /**
   * POUR QUI il a été envoyé (spec `cendreux.md` R11). Distinct de `targetId`, qui est la
   * cible VOLATILE que l'IA se redonne à chaque tick de décision : le Cendreux, lui, réécrit
   * la sienne toutes les demi-secondes (une proie en vue, sinon un feu), si bien que compter
   * les rôdeurs d'une proie sur `targetId` aurait rendu un nombre qui clignote — et un
   * plafond qui ne plafonne rien. Posé à la naissance, jamais retouché.
   */
  huntTargetId?: number
  /**
   * LA CHALEUR BUE (spec 2026-08-21, décisions ⑯⑰) — 0..`CENDREUX.BOIRE.SATIETE_MAX`.
   * Elle se gagne au feu et au coup porté, se perd en continu, et RÉCHAUFFE son porteur :
   * l'éveil la déduit comme des degrés portés sur soi — rassasié, il s'affaisse sur les
   * braises qu'il vient d'éteindre. C'est ce qui fait du feu abandonné un LEURRE.
   */
  satiete?: number
  /**
   * LE DERNIER LIEU OÙ IL VOUS A VU (décision ⑨) — pas la personne : il y va, n'y trouve
   * rien, et reprend sa marche. Deux nombres, aucune traque surnaturelle — et la fuite
   * devient un geste : rompre le contact ET s'éloigner.
   */
  lastSeenX?: number
  lastSeenY?: number
  /** LA DIRECTION RETENUE (spec R28) : le tick de la dernière vue et le déplacement de la
   *  proie entre les deux dernières (tuiles/tick) — consommés UNE fois, à la première pensée
   *  sans elle, pour extrapoler le lieu à vérifier. Absents d'un monstre qui n'a rien vu. */
  lastSeenAt?: number
  lastSeenVx?: number
  lastSeenVy?: number
  /**
   * LE RAMPANT (spec R26) : sorti du sol sans ses jambes, à vie. Allure × `RAMPANT.ALLURE`,
   * vue × `RAMPANT.VUE`, pas de siège — même morsure. Posé à l'émergence d'un RÉVEIL et nulle
   * part ailleurs ; absent du snapshot pour tous les autres (un marcheur n'en porte pas un
   * octet).
   */
  rampant?: true
  /** Prochain tick où ce cendreux a le droit de CRIER (décisions ④⑤ — cooldown du cri). */
  criAt?: number
  /** Réveils restant à planter dans la SALVE du cri en cours — un par tick de décision,
   *  jamais K d'un coup (le pire cas mesuré d'un site coûte 33 ms, on l'étale). */
  criRestants?: number
  /** Le point du cri en cours (là où il a VU — la salve plante autour de ce lieu). */
  criX?: number
  criY?: number
  /** Pour QUI la salve lève le sol (recopié sur les réveils plantés). */
  criPreyId?: number
  /**
   * RELIQUE DE HORDE (décision ⑮) : l'aube ne l'efface plus, elle la FIGE — le jour chaud
   * l'endort, le joueur nettoie au matin, et le balayage `expiresAt` la reprend hors regard.
   * Le drapeau distingue la relique du garde de convoi (même `expiresAt`, autre histoire)
   * pour le recensement ET pour le plafond global, qui compte l'une et pas l'autre.
   */
  hordeRelic?: boolean
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

  /* ── L'ENVOL du tétras (spec faune R21) ─────────────────────────────────── */
  /**
   * ELLE EST EN L'AIR — le tick où elle se posera. Absent = au sol.
   *
   * C'est LE drapeau que lit le reste du jeu : `combat.ts` refuse la mêlée sur
   * une bête en vol (seul le trait l'atteint), et le client en tire sa silhouette
   * et sa hauteur. Un seul champ pour dire un état, parce qu'il porte AUSSI sa
   * fin : rien à purger si le tick passe, la comparaison suffit.
   */
  volUntil?: number
  /** Le tick du DÉCOLLAGE — l'autre borne du bond : elle donne la fraction parcourue. */
  volDepuis?: number
  /** D'où il est parti, et où il se posera : le bond est une DROITE, tirée une fois. */
  volFromX?: number
  volFromY?: number
  volX?: number
  volY?: number

  /* ── Le terrier du lapin (spec chasse C16) ──────────────────────────────── */
  /** Sa tuile de naissance : levé, il fuit VERS elle — et il y disparaît. */
  burrowX?: number
  burrowY?: number

  /* ── L'appât (spec chasse C18) ──────────────────────────────────────────── */
  /** Tick jusqu'auquel elle MANGE la pile posée par le chasseur — tête baissée. */
  baitUntil?: number
  /** La pile qu'elle mange (`state.groundItems`). */
  baitId?: number

  /** LA COULÉE DE LA HARDE (forêts-vivantes §4 R5quater) : l'offset du DÉBUT de « sa »
   *  coulée dans `map.coulees` (−1 : aucune à portée de son coin) — mémorisé une fois,
   *  pure fonction du coin et de la carte. */
  couleeDebut?: number
  /** Le pas courant le long du chemin (index absolu dans la liste) ; −1 : elle a bu, la
   *  descente est faite pour cette fenêtre. Purgé à la sortie du crépuscule. */
  couleePas?: number
  /** Elle BOIT : tête baissée (la fenêtre du chasseur, ouverte par la géographie). */
  drinkUntil?: number

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
   * ELLE VOUS A REPÉRÉ (verrou de `SUSPICION_CURIOUS`). L'état « curieuse » ne se
   * relit PAS de la jauge : la jauge suit son stimulus tick par tick et rase le
   * seuil, or trois choses en dépendent — le GEL (elle s'arrête et regarde), la
   * POSTURE (tête haute) et la TEINTE. Comparées au seuil nu, les trois battaient
   * à quinze fois par seconde (mesuré 2026-08-01). Levé à `SUSPICION_CURIOUS`, il
   * ne lâche qu'à `SUSPICION_CALM` — et c'est LUI que le client lit.
   */
  wary?: true
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
   * ELLE REGAGNE SON CANTON (R17) — sortie de son coin de chasse, elle y retourne
   * au trot, et elle ne lâche qu'une fois BIEN dedans (`GROUND_COMFORT`). Sans ce
   * verrou, elle dansait sur la frontière : un pas de trot dedans, deux pas de
   * broutage dehors, à trois ticks de période (mesuré 2026-08-01).
   */
  ranging?: true
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

  /* ── LE BOND du loup (spec faune R19) ───────────────────────────────────── */
  /**
   * Tick jusqu'auquel il BONDIT, cap verrouillé (absent = non).
   *
   * Des champs À LUI, et non `chargeUntil` réutilisé : le client peint `chargeUntil`
   * en `spr-boar-charge` (beast-posture) — un loup qui bondirait sur les champs du
   * sanglier serait DESSINÉ en sanglier. Le `windedUntil` de la retombée, lui, est
   * bien partagé : c'est le même fait (« la bête souffle, offerte ») et la teinte
   * qu'il donne est exactement le signal qu'on veut rendre au joueur.
   */
  leapUntil?: number
  /** La direction du bond — prise au départ, jamais corrigée : c'est ce qui l'esquive. */
  leapDx?: number
  leapDy?: number
  /** A-t-il déjà touché pendant CE bond ? (Un coup par bond, quoi qu'il traverse.) */
  leapHit?: boolean

  /* ── LE PASSAGE (spec faune R20) — un A* par MEUTE, pas par loup ─────────── */
  /**
   * Depuis quel tick il n'a plus GAGNÉ DE TERRAIN sur sa proie (absent = il progresse).
   * C'est le seul déclencheur d'une recherche de chemin : un loup ne cherche pas un
   * itinéraire, il se cogne — puis il cherche. La seconde qu'il passe à pousser contre
   * l'obstacle N'EST PAS un défaut, c'est ce qui le fait lire comme une bête.
   *
   * « GAGNER DU TERRAIN », et non « avoir bougé » : MESURÉ, un loup qui bute sur un mur
   * GLISSE le long (la collision sépare les axes), donc `Entity.moved` reste vrai et il
   * ne se serait jamais cru coincé — la meute longeait la roche indéfiniment.
   */
  stuckSince?: number
  /** Sa distance à la proie à l'ouverture de la fenêtre — la référence du progrès. */
  stuckD?: number
  /**
   * Tick de la dernière recherche PAYÉE — écrit sur TOUTE la meute, pas sur le seul
   * chercheur. C'est ce qui fait qu'une meute coûte un A* et non quatre : les autres
   * ne cherchent pas, ils COPIENT le chemin trouvé (décision d'Alexis : « si l'un
   * d'entre eux trouve un chemin, il peut le communiquer aux autres »).
   */
  pathAt?: number

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
  /**
   * ELLE N'A PLUS DE RAISON D'ÊTRE LÀ après ce tick (absent = elle reste).
   *
   * Posé sur les gardes d'une carcasse de convoi, qui n'appartiennent pas au monde mais à
   * un ÉVÉNEMENT : la carcasse décante au bout de `CONVOY_DECAY_TICKS`, ses gardes doivent
   * partir avec elle. Sans ça c'était une fuite pure — `spawnConvoy` posait deux gardes tous
   * les deux jours de saison et **rien ne les retirait jamais** : MESURÉ, la vallée passait
   * de 5 à 39 Cendreux au jour 36, puis 75 en fin de saison, par ce seul canal.
   *
   * Le retrait n'a jamais lieu SOUS LES YEUX de quelqu'un (`DEN_SPAWN_CLEARANCE`) : une bête
   * qui s'évapore devant vous, c'est le décor qui avoue — la règle exacte que `advanceDens`
   * applique déjà au sens inverse (on ne fait pas non plus naître une bête devant témoin).
   */
  expiresAt?: number
  /**
   * IL EST NÉ D'UN CADAVRE (spec `cendreux.md` R8). Seuls ces Cendreux-là comptent dans
   * `CENDREUX.MAX_ALIVE` : le plafond existe pour borner la CONTAGION, pas pour recompter des
   * populations que leurs propres systèmes bornent déjà (les Repaires ont leur `cap`, les
   * hordes leur `HORDE_SIZE` et leur dissipation à l'aube).
   *
   * MESURÉ sans cette distinction : la vallée comptait 24 Cendreux dès le jour 21 — le
   * plafond — rien qu'avec les Repaires et les gardes de convoi, et la levée qu'on venait
   * d'ouvrir se refermait pour les deux tiers de la saison.
   */
  risen?: true
}

export function spawnMonster(
  state: SimState,
  type: MonsterType,
  x: number,
  y: number,
  /**
   * Sac EXCEPTIONNEL, en cases. Un seul appelant s'en sert : la levée (`cendreux.ts`), pour
   * le Cendreux qui hérite du butin d'un cadavre entier. Tous les autres — repaires, hordes,
   * carcasses de convoi — naissent avec le sac de leur espèce, c'est-à-dire ZÉRO.
   */
  sacOverride?: number,
): number {
  // LE SAC EST DÉCLARÉ PAR ESPÈCE (`MONSTER_DEFS[type].sac`), et il vaut ZÉRO pour cinq
  // espèces sur six. Toutes naissaient avec le sac d'un PNJ (40 cases) pour une seule
  // raison, vraie mais pour UNE bête : le Cendreux levé hérite du butin d'un cadavre
  // entier et ne doit pas en perdre une miette. Les autres ne portent rien — leur butin
  // vient de `MONSTER_DEFS[type].loot`, versé dans le cadavre à la mort (`combat.ts`).
  // Depuis que le Cendreux fait aussi les HORDES (spec `cendreux.md` R1-R2), « une bête »
  // ne suffit plus à décrire l'exception : une horde d'acte III en lève 12, la méga-horde 16,
  // et AUCUN de ces morts-là n'hérite d'un cadavre. Le sac de l'espèce est donc revenu à
  // ZÉRO, et c'est la levée seule qui demande ses 40 cases (`sacOverride`).
  // MESURÉ, ce détail coûtait cher : un lapin pesait 574 octets de JSON dont 201 pour son
  // sac vide — plus gros que celui d'un humain —, répété pour ~600 bêtes, dans le snapshot
  // de chaque client, vingt fois par seconde.
  const id = spawnEntity(state, x, y, sacOverride ?? MONSTER_DEFS[type].sac)
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

/**
 * Les proies : avatars (joueurs et PNJ), pas les autres monstres.
 *
 * LA MÉTÉO VOILE LA VUE (spec meteo.md R7) : la portée se multiplie par
 * `meteoVisionFactor` AU POINT DE LA CIBLE — on se cache dans la pluie, on
 * n'aveugle pas l'observateur au soleil. Dans la LOI, une fois : tous les
 * consommateurs (l'aggro du Cendreux, le vivant qui prime dans `nearestWarmth`)
 * en héritent. Sans front, le facteur vaut 1 : bit-identique à avant.
 *
 * LES SENS HONNÊTES (spec cendreux R24-R24bis) entrent par `opts`, et par lui seul —
 * sans `opts`, la fonction est bit-identique à avant pour tous ses autres consommateurs.
 * `stimulusOf` REMPLACE le facteur météo par ce que LA PROIE offre, et reçoit ce facteur en
 * second argument : c'est au stimulus de dire quel canal la météo voile (la vue) et lequel
 * elle ne touche pas (la vibration du sol) — la météo entre toujours UNE fois, ici, dans la
 * loi. `plancher` est la garantie de CONTACT, appliquée APRÈS tout le reste — marcher sur
 * une carcasse la réveille toujours, même immobile sous la pluie.
 */
export function nearestPrey(
  state: SimState,
  entity: Entity,
  range: number,
  opts?: { stimulusOf?: (e: Entity, meteo: number) => number; plancher?: number },
): Entity | undefined {
  const monsterIds = new Set(state.monsters.map((m) => m.entityId))
  let best: Entity | undefined
  let bestD = Infinity
  for (const e of state.entities) {
    if (e.id === entity.id || monsterIds.has(e.id) || e.hp <= 0) continue
    const meteo = meteoVisionFactor(state, e.x, e.y)
    let reach = range * (opts?.stimulusOf !== undefined ? opts.stimulusOf(e, meteo) : meteo)
    if (opts?.plancher !== undefined && reach < opts.plancher) reach = opts.plancher
    const d = distSq(entity.x, entity.y, e.x, e.y)
    if (d >= reach * reach) continue
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
  const scale = gait * (def.speed / BALANCE.WALK_SPEED_TILES_PER_S) * (entity.wounds.leg ? COMBAT.LEG_WOUND_SPEED : 1)

  // ═══ ELLE NE PEUT PAS ÊTRE PLUS ÉTROITE QUE LE PAS QU'ELLE AMORTIT ═══
  //
  // `ZONE_MORTE` se dérive du CORPS (marge d'alignement dans un couloir). C'est
  // juste, et insuffisant : une zone morte plus étroite que le déport latéral d'UN
  // PAS ne peut pas empêcher l'oscillation qu'elle vise — la bête corrige, DÉPASSE,
  // et corrige en sens inverse au tick suivant.
  //
  // MESURÉ (2026-08-01, `tools/diag-loup.mts`, 4 graines) : le pas latéral d'un loup
  // lancé vaut 0,17 tuile contre 0,10 de zone morte. Une meute en chasse alternait
  // donc nord-est / nord-ouest à chaque tick — VINGT retournements de sprite dans la
  // pire seconde, sur quatre bancs ; avec la zone morte dérivée du pas, UN.
  //
  // Ce qu'on a CHERCHÉ et NON trouvé, faute de quoi on l'affirmerait : la perte de
  // vitesse utile qu'on attendait du pas diagonal normalisé (×0,707) ne se mesure
  // PAS — un loup seul lancé sur un promeneur rend 4,80 / 4,75 / 4,68 tuiles/s selon
  // son déport initial, avec ou sans ce correctif, et le temps jusqu'à la première
  // morsure d'une meute ne bouge pas (22,2 s dans les deux cas). Le défaut est un
  // FRÉTILLEMENT, pas un frein : c'est un correctif de lisibilité.
  //
  // La zone morte prend donc le plus large des deux : la marge du corps, ou le
  // déport d'un pas. Une bête lente garde son alignement fin (la chicane du
  // zombie, mesurée en son temps) ; une bête lancée cesse de scier son cap.
  const pasLateral = BALANCE.WALK_SPEED_TILES_PER_S * TICK_DT_S * scale * Math.SQRT1_2
  const zone = Math.max(ZONE_MORTE, pasLateral)
  const sx = (dx > zone ? 1 : dx < -zone ? -1 : 0) as -1 | 0 | 1
  const sy = (dy > zone ? 1 : dy < -zone ? -1 : 0) as -1 | 0 | 1
  // Le pas ORIENTE la bête (spec chasse C4) : sa perception est directionnelle,
  // il faut donc que son regard suive sa marche — sans quoi « dans le dos » ne
  // voudrait rien dire pour une bête née face à l'est et jamais tournée.
  if (sx !== 0 || sy !== 0) {
    const len = Math.sqrt(sx * sx + sy * sy)
    entity.facing = { x: sx / len, y: sy / len }
  }
  const moved = moveAvatar(
    { map: state.map, structures: state.structures, nodes: state.nodes, moverVillageId: null, etat: state },
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

export interface CacheFlux {
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
 * ═══ LE PLAFOND GLOBAL (spec 2026-08-21 ; hypothèse de travail — la question ⑳ reste à
 * Alexis) ═══ Combien de Cendreux de PRESSION marchent — et combien la vallée en tolère.
 *
 * Le compte EXCLUT les populations déjà bornées par leur propre système : les résidents de
 * Repaire (`homePoi`, cap du lieu) et les gardes de convoi (`expiresAt` sans `hordeRelic`,
 * balayés avec leur carcasse). Les compter aurait tué la réserve avant qu'elle serve —
 * MESURÉ (R8bis) : 24 vivants au jour 21 par ces seuls canaux. « Un plafond compte ce qu'il
 * borne. » Restent : les levés, les rôdeurs de la nuit, les émergences du cri, les membres
 * de horde et leurs reliques figées.
 */
export function cendreuxSousPression(state: SimState): number {
  let n = 0
  const byId = new Map<number, Entity>()
  for (const e of state.entities) byId.set(e.id, e)
  for (const m of state.monsters) {
    if (m.type !== 'cendreux') continue
    if (m.homePoi !== undefined) continue // résident : borné par le cap de son lieu
    if (m.expiresAt !== undefined && m.hordeRelic !== true) continue // garde d'événement : borné par son balayage
    const e = byId.get(m.entityId)
    if (e && e.hp > 0) n += 1
  }
  return n
}

/** Le toit du jour J — il MONTE avec la saison (12 → 60), clampé au jour 60. */
export function plafondGlobal(state: SimState): number {
  const jour = jourDeSaison(state)
  // LA DISETTE (S18) rabat le plafond de moitié : le gibier a manqué, et c'est l'hiver qui
  // punit l'automne. Elle multiplie le toit de la saison, elle ne le remplace pas.
  const facteur = effetsDuJour(jour).faunePlafond ?? 1
  return Math.round(seasonRamp(CENDREUX.GLOBAL.DEBUT, CENDREUX.GLOBAL.FIN, jour) * facteur)
}

/** Vrai s'il reste une place sous le plafond global — TOUTE source de pression le demande. */
export function placeSousPlafondGlobal(state: SimState): boolean {
  return cendreuxSousPression(state) < plafondGlobal(state)
}

/* ── LE CHAMP DES FEUX — la longue marche des solitaires (décision ①, 2026-08-21) ────────── */

interface CacheChampDesFeux {
  /** Les Foyers de VILLAGE allumés + l'acte, pliés en un entier — l'ensemble STABLE. */
  sigVillages: number
  champVillages: Int32Array | null
  /** Les feux LIBRES allumés + l'acte — l'ensemble VOLATIL (on les allume, on les boit). */
  sigLibres: number
  champLibres: Int32Array | null
  /** min(villages, libres) par tuile — ce que les marcheurs lisent. */
  fusion: Int32Array | null
}

const CHAMPS_DES_FEUX = new WeakMap<SimState, CacheChampDesFeux>()

/** Portée du champ des feux LIBRES — bornée pour que l'invalidation fréquente reste sous le
 *  budget du tick. MESURÉ sur la carte jouée (1581×852, acte III) : le champ PLEIN coûtait
 *  170-187 ms par recalcul — or un feu libre naît et meurt sans cesse (on les allume, les
 *  cendreux les BOIVENT). À 150 tuiles de marche (~2 min de traîne à 1,3 t/s), le recalcul
 *  tient sous le tick, et les Foyers de village portent seuls la convergence à l'échelle de
 *  la vallée (décision ① intacte : leur ensemble ne change presque jamais). */
const CONVERGE_FEU_LIBRE = 150

/**
 * LES DISTANCES DE MARCHE AU FEU ALLUMÉ LE PLUS PROCHE — un seul tableau lu par les marcheurs,
 * FUSION de deux champs multi-sources (min par tuile) :
 *
 *  - LE CHAMP DES FOYERS DE VILLAGE : la vallée entière (borne `CENDREUX.CONVERGE_TILES` de
 *    l'acte). Son ensemble de sources est STABLE (un village fonde, tombe — quelques fois par
 *    saison) : le BFS plein (~170 ms mesurés en acte III) se paie presque jamais.
 *  - LE CHAMP DES FEUX LIBRES : borné à `CONVERGE_FEU_LIBRE`. Son ensemble est VOLATIL, et
 *    c'est précisément pour ça qu'il est borné — chaque flambée ou extinction le repaie.
 *
 * DEUX DIFFÉRENCES avec le champ de horde, toutes deux du panel de revue : TERRAIN + SOLIDES
 * ÉTERNELS SEULS, sans les nœuds (un cache signé par les arbres sautait toutes les ~2,5 min —
 * 1 192 ms de BFS à chaque fois) ; et SANS l'état (donc sans le gel) : la longue marche ne
 * compte jamais sur la glace, l'A* local si. Mémo PUR : chaque champ est une fonction de
 * (carte, solides éternels, son ensemble de feux, acte) — identique quel que soit le moment
 * où on le calcule, la reprise d'une sauvegarde rend exactement la partie ininterrompue.
 */
export function champDesFeux(state: SimState): Int32Array | null {
  const acte = actForDay(jourDeSaison(state))
  const width = state.map.width
  let sigVillages: number = acte
  let sigLibres: number = acte
  for (const s of state.structures) {
    if (s.type !== 'fire') continue
    if (fireStateAt(state.tick, s) !== 'lit') continue
    const key = s.ty * width + s.tx + 1
    if (s.villageId !== 0) sigVillages = (Math.imul(sigVillages, 31) + key) | 0
    else sigLibres = (Math.imul(sigLibres, 31) + key) | 0
  }
  let cache = CHAMPS_DES_FEUX.get(state)
  if (!cache) {
    cache = { sigVillages: 0, champVillages: null, sigLibres: 0, champLibres: null, fusion: null }
    CHAMPS_DES_FEUX.set(state, cache)
  }
  let refondre = false
  if (cache.sigVillages !== sigVillages || cache.fusion === null) {
    const sources: { tx: number; ty: number }[] = []
    for (const s of state.structures) {
      if (s.type !== 'fire' || s.villageId === 0) continue
      if (fireStateAt(state.tick, s) !== 'lit') continue
      sources.push({ tx: s.tx, ty: s.ty })
    }
    cache.champVillages = sources.length === 0
      ? null
      : computeFlowFieldMulti(state.map, [], solidesEternels(state.structures), sources, undefined, CENDREUX.CONVERGE_TILES(acte))
    cache.sigVillages = sigVillages
    refondre = true
  }
  if (cache.sigLibres !== sigLibres || cache.fusion === null) {
    const sources: { tx: number; ty: number }[] = []
    for (const s of state.structures) {
      if (s.type !== 'fire' || s.villageId !== 0) continue
      if (fireStateAt(state.tick, s) !== 'lit') continue
      sources.push({ tx: s.tx, ty: s.ty })
    }
    const portee = Math.min(CENDREUX.CONVERGE_TILES(acte), CONVERGE_FEU_LIBRE)
    cache.champLibres = sources.length === 0
      ? null
      : computeFlowFieldMulti(state.map, [], solidesEternels(state.structures), sources, undefined, portee)
    cache.sigLibres = sigLibres
    refondre = true
  }
  if (refondre) {
    const a = cache.champVillages
    const b = cache.champLibres
    if (a === null) cache.fusion = b
    else if (b === null) cache.fusion = a
    else {
      // min par tuile, -1 = hors champ. La copie (~1,3 M tuiles) coûte quelques ms — payée
      // seulement quand un des deux ensembles a changé, jamais par tick.
      const fusion = new Int32Array(a.length)
      for (let i = 0; i < a.length; i++) {
        const da = a[i]!
        const db = b[i]!
        fusion[i] = da === -1 ? db : db === -1 ? da : da < db ? da : db
      }
      cache.fusion = fusion
    }
  }
  return cache.fusion
}

/**
 * Descente de gradient vers le Feu ciblé (spec événements R3). Si la
 * meilleure tuile est bouchée par une structure, on la frappe. Retourne
 * true si le monstre appartient à une horde (et a donc agi).
 */
/** `gait` : l'allure du cadran de température (voir `cendreuxStep`) — une horde d'acte I
 *  marche lentement dans une nuit tiède, une horde d'acte III court le froid à plein. */
export function hordeStep(state: SimState, monster: Monster, entity: Entity, flux: CacheFlux | null, byId: Map<number, Entity>, gait = 1): boolean {
  const horde = state.hordes.find((h) => h.memberEntityIds.includes(monster.entityId))
  if (!horde) return false
  if (flux === null) return true

  // Indexé par la TUILE DU FEU visé (décision ⑬ : la horde ne connaît qu'une braise —
  // village ou camp, elle porte sa cible elle-même) : deux hordes sur le même feu
  // partagent le champ.
  const cleDuFoyer = horde.fireTy * state.map.width + horde.fireTx
  let field = flux.champs.get(cleDuFoyer)
  if (!field) {
    field = computeFlowField(state.map, state.nodes, solidesEternels(state.structures), horde.fireTx, horde.fireTy, state)
    flux.champs.set(cleDuFoyer, field)
  }

  descendreLeChamp(state, monster, entity, field, byId, gait, horde.memberEntityIds)
  return true
}

/**
 * UN PAS DE DESCENTE DE GRADIENT — le cœur commun de la HORDE et du SOLITAIRE en longue
 * marche (décision ① : « le levé marche »). Élire la tuile voisine la plus proche du feu,
 * frapper le franchissement qui la barre, s'écarter des congénères (horde seulement — un
 * solitaire n'a pas de rang à tenir), avancer. Rend false si le champ ne mène nulle part
 * d'ici (au but, ou hors champ) — l'appelant décide de ce que ce silence veut dire.
 */
export function descendreLeChamp(
  state: SimState,
  monster: Monster,
  entity: Entity,
  field: Int32Array,
  byId: Map<number, Entity>,
  gait: number,
  hordeIds: number[] | null,
): boolean {
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
  if (bestTx === tx && bestTy === ty) return false // au but ou coincé hors champ

  // LE PASSAGE vers la tuile du gradient est-il barré ? On frappe ce qui le barre.
  //
  // On demandait « qu'y a-t-il SUR la tuile où je veux aller ? » (`solidAt`). Avec des murs
  // pleins c'était la même question ; avec un mur d'ARÊTE (R23), non — le mur qui me barre la
  // route est souvent déclaré sur MA tuile, bit tourné vers la destination, et la destination
  // est vide. La bête ne trouvait alors rien à frapper, avançait, butait sur la bande et
  // **restait là** : une enceinte de murs minces aurait été une défense que les pillards
  // ignorent. `crossingBlocker` regarde les deux côtés de l'arête, comme la collision.
  // L'INCASSABLE N'EST PAS UNE CIBLE (2026-08-11) : le massif d'un antre est de la roche —
  // le flow field le contourne déjà comme la falaise, et une bête qui le frapperait
  // mâcherait l'éternité. On ne désigne que ce qui peut tomber.
  const blocker = crossingBlocker(state.structures, tx, ty, bestTx - tx, bestTy - ty, (s) => structureBlocks(s, null, false) && !estIncassable(s.type))
  if (blocker) {
    // UN RAMPANT N'ASSIÈGE PAS (spec cendreux R26bis) : barré, il attend devant — la clearance
    // des réveils (`ambient`) l'enfouira quand plus personne ne le regardera.
    if (monster.rampant !== true && !entity.windup && state.tick >= entity.cooldownUntil) {
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

  // ═══ ELLES S'ÉCARTENT (décision d'Alexis, 2026-08-20) ═══
  //
  // « Les Cendreux ne doivent pas se superposer de la sorte, ils doivent se comporter comme
  // dans Project Zomboid lorsqu'on parle de horde. » Jusqu'ici, `hordeStep` était une pure
  // descente de gradient sur un champ de flux PARTAGÉ : seize membres au même endroit du
  // champ élisent la même tuile suivante et marchent en file, l'un DANS l'autre. Relevé à
  // l'écran : treize goules en vue selon la sim, deux silhouettes sur l'image.
  //
  // On emprunte l'écart du GIBIER — la même somme de répulsions, le même module (`ecart.ts`),
  // la même hystérésis à deux seuils. UN seul écart dans le jeu, pas deux.
  //
  // MAIS IL BIAISE LA MARCHE, IL NE L'ARRÊTE PAS, et c'est la seule différence avec la bête
  // qui broute. Le gibier serré entre deux congénères s'immobilise et attend qu'on lui fasse
  // de la place ; une goule qui ferait ça briserait l'assaut — la horde se figerait à trente
  // tuiles du village. On ajoute donc la poussée à la CIBLE du pas au lieu de s'y substituer :
  // elles continuent de descendre le gradient, en s'ouvrant en front.
  //
  // AUCUN TIRAGE : la poussée est une fonction pure des positions, et l'égalité parfaite se
  // tranche sur l'ordre des `entityId`. Le replay reste au bit près.
  let cx = bestTx + 0.5
  let cy = bestTy + 0.5

  // ═══ LA DIAGONALE EST UN CAP, PAS UNE TUILE (Alexis, 2026-08-25) ═══
  //
  // *« Les Cendreux ne semblent pas avoir la possibilité de naviguer en diagonale. »* Exact, et
  // c'était mécanique : le champ de flux est 4-CONNEXE (`VOISINS4`), donc la tuile élue est
  // toujours un voisin orthogonal, donc l'un des deux écarts vaut zéro — et `moveToward` a une
  // ZONE MORTE qui annule tout axe sous le déport d'un pas. Une goule ne pouvait littéralement
  // pas prendre un cap oblique : elle montait l'escalier, une marche à la fois.
  //
  // ⚠ ON NE TOUCHE PAS AU CHAMP, ET C'EST TOUT LE POINT. Rendre `VOISINS4` diagonal changerait
  //   la distance de CHAQUE tuile de la carte, donc chaque chemin, chaque date d'arrivée, chaque
  //   ordre d'événement — le replay et le banc d'équilibrage avec. Ici, le gradient élit
  //   toujours la même TUILE (`bestTx/bestTy` : c'est elle qui porte le test de franchissement et
  //   le siège, inchangés) ; on ne corrige que le CAP qu'on donne au pas.
  //
  // LA RÈGLE, CONSERVATRICE : on n'oblique que vers une tuile qui est SUR le champ et pas plus
  // loin du but que celle qu'on vient d'élire. Une diagonale ne peut donc jamais éloigner ni
  // faire sortir du champ ; au pire elle ne se prend pas. Et si un mur barre l'un des deux axes,
  // c'est la collision qui le refuse — elle résout déjà axe par axe.
  //
  // ⚠ ET ELLE CÈDE LE PAS À L'ÉCART DE HORDE, ce que la garde `worldevents` a exigé en rougissant
  //   (graine 88 : douze tuiles occupées la moitié du temps, puis dix). LA RAISON EST GÉOMÉTRIQUE
  //   et vaut d'être sue : la poussée de séparation s'AJOUTE à la cible, et `moveToward` quantifie
  //   ensuite en huit directions avec une zone morte. Tant que la cible était orthogonale, l'axe
  //   perpendiculaire valait ~0 et la poussée en DÉCIDAIT à elle seule. Une cible déjà oblique
  //   sature les deux axes : la poussée ne peut plus en retourner aucun, et la horde se retasse.
  //   Une goule au coude à coude a mieux à faire qu'un beau cap — elle s'écarte d'abord.
  //   (`separating` est une hystérésis persistée : on la lit d'avant la mise à jour de ce tick,
  //   ce qui coûte une image de retard sur un drapeau qui vit déjà des dizaines de ticks.)
  const serre = monster.separating === true
  const axeX = bestTy === ty
  const perp: readonly (readonly [number, number])[] = axeX ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]]
  for (const [dx, dy] of serre ? [] : perp) {
    const nx = bestTx + dx
    const ny = bestTy + dy
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
    const d = field[ny * width + nx]
    if (d === undefined || d === -1 || d > bestD) continue
    cx = nx + 0.5
    cy = ny + 0.5
    break
  }

  if (hordeIds !== null) {
    const radius = monster.separating ? WORLD_EVENTS.HORDE_SEPARATION_COMFORT : WORLD_EVENTS.HORDE_SEPARATION
    // PAR INDEX ET PAR L'INDEX DU TICK : `hordeIds` se lit sans fabriquer d'objets, et
    // `byId` (déjà construit par `advanceMonsters`) évite un `find` sur `state.entities` par
    // voisine. Le premier jet faisait les deux — seize objets et seize balayages complets par
    // goule et par tick, soit 256 balayages par tick de nuit d'assaut : le moment le plus
    // chargé du jeu, et précisément celui que le scénario smoke `horde` existe pour mesurer.
    const { push, nearestSq } = separationPush(
      hordeIds.length, (i) => hordeIds[i]!,
      monster.entityId, entity.x, entity.y,
      (id) => byId.get(id),
      radius, FAUNA.SEPARATION_DEADBAND,
    )
    if (!monster.separating && nearestSq < WORLD_EVENTS.HORDE_SEPARATION * WORLD_EVENTS.HORDE_SEPARATION) {
      monster.separating = true
    } else if (monster.separating && nearestSq >= WORLD_EVENTS.HORDE_SEPARATION_COMFORT * WORLD_EVENTS.HORDE_SEPARATION_COMFORT) {
      delete monster.separating
    }
    if (monster.separating && push) {
      cx += push.x
      cy += push.y
    }
  }

  moveToward(state, monster, entity, cx, cy, false, gait)
  return true
}

/** Frappe la structure qui bloque la direction de chasse, s'il y en a une. */
export function attackBlockingStructure(state: SimState, monster: Monster, entity: Entity, tx: number, ty: number): void {
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
    // Même loi qu'au gradient : l'incassable n'est jamais désigné — on ne mâche pas la roche.
    const s = crossingBlocker(state.structures, ex, ey, cx - ex, cy - ey, (st) => structureBlocks(st, null, false) && !estIncassable(st.type))
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
    } else if (m.type === 'cendreux') {
      // LE GIBIER LE CRAINT — QUAND IL EST ÉVEILLÉ (décision ⑩, 2026-08-21). Un cendreux
      // amorphe de jour n'effraie personne : le cerf broute à côté d'une carcasse — c'est
      // l'éveil qui fait la menace, et il ne fait AUCUN bruit (noise 0 : un mort ne respire
      // pas, il n'a pas de canal sourd). Là où les morts s'accumulent, le gibier DÉSERTE :
      // la faim et les morts racontent enfin la même histoire.
      const eveil = eveilCendreuxAt(state, e.x, e.y, state.tick)
      if (eveil > 0.25) threats.push({ e, vision: eveil * coverAt(state, e.x, e.y), noise: 0 })
    } else if (isPrey(m.type)) quarry.push(e)
  }

  for (const monster of [...state.monsters]) {
    const entity = byId.get(monster.entityId)
    if (!entity) continue
    if (entity.windup) continue // en train de frapper : immobile

    if (monster.type === 'cendreux') {
      // Le champ de flux lui est passé : depuis R1/R2 c'est LUI qui fait les hordes, et la
      // convergence de masse se paie en BFS partagé, jamais en A* par bête (spec R5).
      cendreuxStep(state, monster, entity, flux, byId)
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

  }
}

