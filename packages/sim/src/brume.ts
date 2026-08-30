/**
 * LA BRUME (spec `brume.md`, décisions Alexis 2026-08-18) — le froid mobile qui sort de la
 * Cendrière, dénie sa zone un jour durant, et PAIE ceux qui la suivent : à son retrait, un
 * filon minier riche et temporaire affleure, gardé par des traînards.
 *
 * ═══ ZÉRO TIRAGE SUR LE PRNG D'ÉTAT ═══
 *
 * Occurrence, corridor, type du filon : tout se dérive du JOUR DE SAISON par `hash2` (patron
 * convois) — activer la Brume ne décale aucun tirage existant, donc ne casse aucun test de
 * déterminisme sans rapport (leçon RNG connue). Les deux seuls pas de PRNG consommés sont les
 * pas DÉLIBÉRÉS de `spawnEntity` pour les traînards, au retrait — exactement comme les gardes
 * de convoi.
 *
 * ═══ LA GÉOMÉTRIE EST CALCULÉE, JAMAIS STOCKÉE ═══
 *
 * L'état ne porte que le CORRIDOR élu à l'annonce (deux points, une phase, deux échéances) ;
 * la position de la nappe à un tick donné est une fonction pure (`brumeCentre`) — patron du
 * front de Cendre. Le client rendra la nappe en recalculant du tick, sans un octet de plus
 * dans le snapshot.
 *
 * Une carte SANS champ de Cendre (bancs de test, cartes d'avant) n'a jamais de Brume : la
 * Cendrière est son origine, pas un décor.
 */
import { BRUME, type NodeType } from './balance'
import { avanceesDepuisAges, foyersDeLaCarte, tuileCendree } from './cendre'
import { toutesLesFumerolles } from './fumerolle'
import { emitEvent } from './events'
import { distSq } from './geometry'
import { isBlockingTile } from './map'
import { spawnMonster } from './monsters'
import { hash2 } from './noise'
import type { SimState } from './sim'
import { actForDay, dayTicksAt, estCrepuscule, jourDeSaison, TICKS_PER_CYCLE } from './time'
import { structureAt } from './village'

const BRUME_SALT = 0x51a7b3d9

/**
 * L'ESPACE D'IDS DES FILONS DE BRUME — dérivé du JOUR de la nappe, jamais de `max(id)+1`.
 *
 * L'axiome `PART_DU_NOEUD` (node-baseline) veut un id FIXE : or `max+1` RÉUTILISAIT l'id de
 * l'ancien filon dès qu'il portait le max (le cas normal), avec un autre type et une autre
 * position — le `nodeById` du client aurait vu un nœud muter. Le jour est unique par nappe
 * (une par jour au plus, `lastBrumeDay`) et croissant : l'id ne se réutilise jamais. La base
 * laisse ~8× la marge au worldgen (~126 k nœuds mesurés).
 */
const FILON_ID_BASE = 1_000_000

/** Le filon d'un retrait passé se vérifie à la seconde, pas au tick : son échéance est un
 *  JOUR, et `nodes.find` en fin de tableau balaierait ~126 k nœuds vingt fois par seconde
 *  pendant trois jours (patron `ROLL_EVERY` de nighthunt — cadence technique, pas réglage). */
const FILON_CHECK_EVERY = 20

/** La nappe en cours — annoncée au crépuscule, levée de l'aube au crépuscule suivant. */
export interface Brume {
  phase: 'annoncee' | 'nappe'
  /** Le jour de saison de l'annonce — la graine de tous les `hash2` de cette nappe. */
  day: number
  /** L'aube où la nappe se lève, et le crépuscule où elle se retire. */
  riseTick: number
  retreatTick: number
  /** Le corridor : entrée (sur le bord de la Cendrière) → point profond (où naîtra le filon). */
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Le jour tire-t-il une Brume ? Pur (`hash2`) — exposé pour les tests et les bancs. */
export function brumeJourEligible(day: number): boolean {
  return hash2(day, 0, BRUME_SALT) < BRUME.CHANCE_PER_DAY(actForDay(day))
}

/**
 * Le CENTRE de la nappe au tick donné — aller pendant la première moitié de la fenêtre,
 * retour pendant la seconde. `null` hors de la fenêtre ou avant la levée. Fonction pure,
 * partagée avec le client (patron `frontActuel`).
 */
export function brumeCentre(brume: Brume, tick: number): { x: number; y: number } | null {
  if (brume.phase !== 'nappe' || tick < brume.riseTick || tick >= brume.retreatTick) return null
  const u = (tick - brume.riseTick) / (brume.retreatTick - brume.riseTick)
  const s = u < 0.5 ? u * 2 : (1 - u) * 2
  return { x: brume.x0 + (brume.x1 - brume.x0) * s, y: brume.y0 + (brume.y1 - brume.y0) * s }
}

/** Ce point est-il sous la nappe, maintenant ? */
export function dansLaBrume(state: SimState, x: number, y: number): boolean {
  return dansLaBrumeAu(state, x, y, state.tick)
}

/** Le même point, à un tick quelconque — pour l'hystérésis du dégel (spec `gel.md` G8), qui
 *  relit la température du passé proche. `brumeCentre` est déjà une fonction pure du tick :
 *  il n'y a rien à inventer, seulement à ne pas figer l'horloge sur `state.tick`. */
export function dansLaBrumeAu(state: SimState, x: number, y: number, tick: number): boolean {
  const brume = state.brume
  if (!brume) return false
  const c = brumeCentre(brume, tick)
  if (!c) return false
  return distSq(x, y, c.x, c.y) <= BRUME.RAYON * BRUME.RAYON
}

/**
 * Le froid de la nappe en (x, y) — 0 hors de la Brume. C'est une EXPOSITION (spec R4) :
 * `temperature.ts` l'amortit sous un abri et la PLANCHE au feu et à la tenue — le déni de
 * zone tombe des lois vitales existantes, pas d'une mécanique neuve.
 */
export function brumeCold(state: SimState, x: number, y: number): number {
  return dansLaBrume(state, x, y) ? BRUME.COLD_MALUS : 0
}

/** Le même froid, à un tick quelconque (spec `gel.md` G8 — voir `dansLaBrumeAu`). */
export function brumeColdAt(state: SimState, x: number, y: number, tick: number): number {
  return dansLaBrumeAu(state, x, y, tick) ? BRUME.COLD_MALUS : 0
}

/** Distance² d'un point au segment [A,B] — la garde des Feux balaie tout le trajet de la nappe. */
function distSqPointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax
  const aby = by - ay
  const ab2 = abx * abx + aby * aby
  const t = ab2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / ab2))
  return distSq(px, py, ax + abx * t, ay + aby * t)
}

/**
 * ÉLIT LE CORRIDOR du jour : une entrée sur le bord du front de Cendre (bande juste dehors),
 * un point profond à `PROFONDEUR` tuiles — le plus PROCHE de l'entrée, c'est le chemin que le
 * champ de Cendre dessine. Le point profond doit pouvoir porter le filon (tuile marchable,
 * vierge de nœud et de structure), et AUCUN Feu de village ne doit passer sous la nappe
 * (R3 : la Brume est un déni de zone sauvage, pas un tueur de villages). `null` si aucun
 * des `ESSAIS` candidats ne convient — ce jour-là, la Brume renonce.
 */
function elireCorridor(state: SimState, day: number): { x0: number; y0: number; x1: number; y1: number } | null {
  /**
   * ═══ LA BRUME SORT D'UNE FUMEROLLE (décision d'Alexis, 2026-08-24) ═══
   *
   * Elle était ancrée sur le FRONT : son corridor s'élisait sur la bande qui le précédait. Le
   * front retiré, `elireCorridor` rendait `null` chaque jour éligible et **la Brume ne se levait
   * plus** — un système entier mort par effet de bord.
   *
   * Sa propre spec disait pourtant l'ancre à voix haute : *« une nappe de froid létal SORT DE LA
   * CENDRIÈRE, roule sur T0 pendant un jour, puis se retire »*. Les fumerolles sont littéralement
   * les trous par où elle sort. Le corridor part donc d'une bouche et **roule vers le VIVANT** —
   * ce qui est le sens du mécanisme : un déni de zone SUR le pays qu'on habite, pas sur une terre
   * déjà morte que personne ne traverse.
   *
   * ⚠ …MAIS LA FUMEROLLE DIT OÙ, JAMAIS SI. Les bouches ne s'ouvrent qu'au cœur de la cendre,
   *   donc pas avant l'acte IV : ancrée sur elles SEULES, la Brume redevenait muette pendant
   *   trois actes — le même mort-par-effet-de-bord que le front, à peine déplacé. Le CHARNIER est
   *   donc l'ancre de repli, et c'est la bonne : c'est de lui que sortira plus tard la cendre, et
   *   de la cendre les bouches. Le froid remonte la même généalogie, en avance.
   */
  const avancees = avanceesDepuisAges(state.cendreAge, state.cendreAge.length)
  const bouches = toutesLesFumerolles(state.map, avancees, state.seed)
  const ancres: readonly { tx: number; ty: number }[] =
    bouches.length > 0 ? bouches : foyersDeLaCarte(state.map)
  if (ancres.length === 0) return null

  const { width } = state.map
  const occupes = new Set<number>()
  for (const n of state.nodes) occupes.add(n.ty * width + n.tx)

  const garde = BRUME.RAYON + BRUME.GARDE_FEU
  for (let essai = 0; essai < BRUME.ESSAIS; essai++) {
    const b = ancres[Math.floor(hash2(day, essai + 1, BRUME_SALT) * ancres.length)]!
    const x0 = b.tx + 0.5
    const y0 = b.ty + 0.5

    // LE POINT PROFOND : à `PROFONDEUR` tuiles de la bouche, sur une tuile VIVANTE (hors cendre) —
    // c'est là que le filon se découvrira au retrait, et un filon dans la cendre ne se visite pas.
    // On échantillonne huit directions, dans un ordre décidé par le jour : aucun tirage consommé.
    let x1 = x0
    let y1 = y0
    let trouve = false
    for (let k = 0; k < 8 && !trouve; k++) {
      const tour = (k + Math.floor(hash2(day, essai + 9, BRUME_SALT) * 8)) % 8
      // Huit directions ÉCRITES À LA MAIN : `cos`/`sin` sont interdits dans /sim (invariant n°2,
      // ils ne sont pas exacts d'un moteur JS à l'autre). La diagonale porte sa normalisation.
      const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
      const d = dirs[tour]!
      const norme = d[0] !== 0 && d[1] !== 0 ? 0.7071 : 1
      const px = Math.floor(x0 + d[0]! * norme * BRUME.PROFONDEUR)
      const py = Math.floor(y0 + d[1]! * norme * BRUME.PROFONDEUR)
      if (px < 0 || py < 0 || px >= width || py >= state.map.height) continue
      if (isBlockingTile(state.map, px, py)) continue
      if (occupes.has(py * width + px)) continue
      if (structureAt(state.structures, px, py)) continue
      if (tuileCendree(state, px, py)) continue // elle doit ROULER SUR LE VIVANT
      x1 = px + 0.5
      y1 = py + 0.5
      trouve = true
    }
    if (!trouve) continue

    const ok = state.villages.every(
      (v) => distSqPointSegment(v.fireTx + 0.5, v.fireTy + 0.5, x0, y0, x1, y1) >= garde * garde,
    )
    if (ok) return { x0, y0, x1, y1 }
  }
  return null
}

/**
 * LE RETRAIT PAIE (R7-R8) : au crépuscule, la nappe dépose un filon riche SANS repousse
 * (un événement, pas un gisement — `advanceBrume` le retire vidé ou périmé) et deux
 * traînards qui appartiennent à l'événement, pas au monde (patron carcasse : `expiresAt`,
 * dissipés par `advanceWorldEvents`, jamais sous les yeux).
 */
function retirerLaBrume(state: SimState): void {
  const brume = state.brume!
  const tx = Math.floor(brume.x1)
  const ty = Math.floor(brume.y1)
  emitEvent(state, { type: 'brume_retiree', tick: state.tick, tx, ty })

  // Un filon d'une Brume précédente encore debout : le nouveau le remplace — on n'en suit
  // qu'un à la fois, et un nœud d'événement sans échéance serait un gisement de plus.
  if (state.brumeFilon) retirerLeFilon(state, state.brumeFilon.nodeId, true)

  // Le canal 100 est DÉCORRÉLÉ des essais de corridor (canaux 1..ESSAIS) : le type du filon
  // ne doit pas dériver du même tirage que l'entrée élue au 2e essai.
  const type: NodeType = hash2(brume.day, 100, BRUME_SALT) < BRUME.FILON_PART_CHARBON ? 'coal_seam' : 'iron_vein'
  const id = FILON_ID_BASE + brume.day
  state.nodes.push({ id, type, tx, ty, stock: BRUME.FILON_STOCK, regrowAt: 0 })
  state.brumeFilon = { nodeId: id, expiresDay: jourDeSaison(state) + BRUME.FILON_JOURS }
  emitEvent(state, { type: 'filon_decouvert', tick: state.tick, nodeId: id, nodeType: type, tx, ty })

  const expiresAt = state.tick + BRUME.TRAINARD_TTL
  for (let i = 0; i < BRUME.TRAINARDS; i++) {
    // La place du garde se contrôle au SPAWN, pas à l'élection : un jour et demi a passé
    // depuis, et le voisinage du point profond n'a été vérifié que pour LUI. Une tuile
    // bloquante (paroi, mur bâti entre-temps) replie le garde sur le point profond — le
    // patron du bloc de naissance des hordes.
    let gx = Math.max(1, Math.min(state.map.width - 2, tx + (i === 0 ? 1 : -1))) + 0.5
    let gy = Math.max(1, Math.min(state.map.height - 2, ty + 1)) + 0.5
    if (isBlockingTile(state.map, Math.floor(gx), Math.floor(gy))) {
      gx = tx + 0.5
      gy = ty + 0.5
    }
    const gid = spawnMonster(state, 'cendreux', gx, gy)
    const garde = state.monsters.find((m) => m.entityId === gid)
    if (garde) garde.expiresAt = expiresAt
  }
  state.brume = null
}

/** Retire le nœud du filon et, si `dire`, l'annonce (`filon_retire`). Le client matérialise
 *  le filon depuis `filon_decouvert` ; sans ce fait-ci, un filon périmé, remplacé ou mangé
 *  par la Cendre resterait un nœud FANTÔME à l'écran (le retrait du tableau ne produit aucun
 *  delta). Le filon VIDÉ, lui, se retire en silence : `node_depleted` a parlé au coup final. */
function retirerLeFilon(state: SimState, nodeId: number, dire: boolean): void {
  state.nodes = state.nodes.filter((n) => n.id !== nodeId)
  if (dire) emitEvent(state, { type: 'filon_retire', tick: state.tick, nodeId })
  state.brumeFilon = null
}

/**
 * L'ordonnanceur de la Brume — appelé chaque tick par `step()`, derrière `state.worldEvents`
 * (un banc qui n'a pas demandé de guerre n'a pas non plus demandé de brume). L'annonce tombe
 * au crépuscule (le même bord de cycle que la horde), la levée à l'aube suivante, le retrait
 * au crépuscule d'après — et le filon vit ses `FILON_JOURS`, sauf à être vidé (ou mangé par
 * la Cendre, qui ne l'épargne pas plus qu'un autre nœud).
 */
export function advanceBrume(state: SimState): void {
  const filon = state.brumeFilon
  if (filon && state.tick % FILON_CHECK_EVERY === 0) {
    const node = state.nodes.find((n) => n.id === filon.nodeId)
    if (!node) {
      retirerLeFilon(state, filon.nodeId, true) // la Cendre l'a mangé — que le client le sache
    } else if (node.stock <= 0) {
      retirerLeFilon(state, filon.nodeId, false) // vidé : node_depleted a déjà parlé
    } else if (jourDeSaison(state) > filon.expiresDay) {
      retirerLeFilon(state, filon.nodeId, true) // périmé : la fenêtre s'est refermée
    }
  }

  const brume = state.brume
  if (brume) {
    if (brume.phase === 'annoncee' && state.tick >= brume.riseTick) {
      brume.phase = 'nappe'
      emitEvent(state, { type: 'brume_levee', tick: state.tick, tx: Math.floor(brume.x1), ty: Math.floor(brume.y1) })
    }
    if (brume.phase === 'nappe' && state.tick >= brume.retreatTick) retirerLaBrume(state)
    return // une nappe à la fois : pas d'annonce tant qu'elle vit
  }

  // `estCrepuscule` est l'écrivain unique du crépuscule (S6) : saisonnier, ET conscient de
  // `cycleOffset` — le modulo brut d'avant tombait à minuit dans une Veillée démarrée à 9 h.
  if (!estCrepuscule(state, state.tick)) return
  // ⚠ IL Y AVAIT ICI `if (!state.map.cendre) return` — une garde sur le champ de FRONT, qui
  //   n'existe plus sur le monde joué depuis son retrait (2026-08-24). Elle rendait l'annonce
  //   IMPOSSIBLE dans toute partie réelle, en silence, et seul le banc restait vert parce qu'il
  //   se fabriquait le champ à la main. On ne remplace par RIEN : la seule vraie condition est
  //   qu'il existe une ancre, et `elireCorridor` la vérifie déjà en rendant `null`.
  const day = jourDeSaison(state)
  if (state.lastBrumeDay === day) return
  if (BRUME.CHANCE_PER_DAY(actForDay(day)) <= 0) return
  state.lastBrumeDay = day
  if (!brumeJourEligible(day)) return
  const corridor = elireCorridor(state, day)
  if (corridor === null) return

  const riseTick = state.tick + (TICKS_PER_CYCLE - dayTicksAt(state, state.tick))
  // Le retrait tombe au crépuscule SUIVANT — la longueur du jour de CE jour-là, pas de celui-ci
  // (une nappe de fin d'automne se retire plus tôt que celle qui l'a précédée).
  const retreatTick = riseTick + dayTicksAt(state, riseTick)
  state.brume = { phase: 'annoncee', day, riseTick, retreatTick, ...corridor }
  // R6 — LE GIBIER SE TAIT sur le corridor dès l'annonce : le silence EST le signe lisible
  // in-world (QUIET_RADIUS couvre largement le segment avec trois points).
  state.faunaQuiet.push(
    { x: corridor.x0, y: corridor.y0, until: state.brume.retreatTick },
    { x: (corridor.x0 + corridor.x1) / 2, y: (corridor.y0 + corridor.y1) / 2, until: state.brume.retreatTick },
    { x: corridor.x1, y: corridor.y1, until: state.brume.retreatTick },
  )
  emitEvent(state, { type: 'brume_annonce', tick: state.tick, tx: Math.floor(corridor.x1), ty: Math.floor(corridor.y1) })
}
