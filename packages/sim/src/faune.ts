/**
 * La faune — le monde est habité (spec faune).
 *
 * Trois choses vivent ici : le PEUPLEMENT (les bêtes naissent dans un anneau
 * autour des avatars et se dissipent derrière eux — la population est bornée,
 * jamais fonction de la taille de la carte, et l'HEURE décide qui naît) ; le
 * COMPORTEMENT DU GIBIER (brouter, s'alerter, détaler en à-coups, se coucher hors
 * de ses heures, et pour le sanglier : charger) ; et LA MEUTE (le loup chasse, il
 * appelle les siens, il rompt quand il saigne, et seul il n'ose pas).
 *
 * Le gibier fuit le loup comme il fuit le chasseur : c'est un écosystème, pas
 * deux jeux superposés.
 *
 * Déterminisme : tous les tirages passent par le PRNG du SimState, et aucune
 * trigonométrie — l'anneau est échantillonné par rejet dans un carré, ce qui
 * n'emploie que `+ - * /` et des comparaisons (invariant 2).
 */
import { BALANCE, COMBAT, FAUNA, MONSTER_DEFS, TERRAINS, type MonsterType } from './balance'
import { isBlockedAt } from './collision'
import { applyDamage, startAttack } from './combat'
import { emitEvent } from './events'
import { distSq } from './geometry'
import { countOf, removeItems } from './items'
import { terrainAt } from './map'
import { moveToward, spawnMonster, type Monster } from './monsters'
import { rngRoll } from './rng'
import { getGameTime } from './time'
import type { Entity, SimState } from './sim'

/** Les espèces sauvages : celles qui ont un habitat (spec faune R2). */
const WILD_TYPES = (Object.keys(MONSTER_DEFS) as MonsterType[]).filter((t) => (MONSTER_DEFS[t].habitat?.length ?? 0) > 0)

/** Cette bête est-elle sauvage (elle vit dans un biome) plutôt qu'un mort-vivant ? */
export function isWild(type: MonsterType): boolean {
  return (MONSTER_DEFS[type].habitat?.length ?? 0) > 0
}

/** Du gibier : ça broute et ça fuit (par opposition au prédateur, qui chasse). */
export function isPrey(type: MonsterType): boolean {
  return isWild(type) && !MONSTER_DEFS[type].predator
}

/** Un prédateur : ça chasse — le gibier ET l'homme (spec faune R11). */
export function isPredator(type: MonsterType): boolean {
  return isWild(type) && MONSTER_DEFS[type].predator === true
}

/**
 * LA VIGUEUR d'une espèce à une heure donnée, dans [0, 1] (spec faune R10).
 *
 * Des rampes linéaires, pas des sinusoïdes : `Math.sin` n'est pas garanti au bit
 * près d'un moteur JS à l'autre, et cette valeur décide de qui naît — elle est
 * donc dans le flux déterministe (invariant 2). Trois profils :
 *
 *   diurne      ▁▁▁▃▇███▇▃▁▁▁    plein éveil 9h-17h
 *   nocturne    ██▇▃▁▁▁▁▁▃▇██    plein éveil 22h-4h
 *   crépuscule  ▁▃█▇▃▁▁▁▃▇█▃▁    deux bosses : 5h-8h et 18h-21h
 */
export function activityAt(type: MonsterType, hour: number): number {
  const profile = MONSTER_DEFS[type].activity
  if (!profile) return 1 // sans rythme déclaré : toujours d'attaque (zombie, cendreux)

  if (profile === 'diurnal') return ramp(hour, 6, 9, 17, 20)
  if (profile === 'nocturnal') {
    // La nuit enjambe minuit : on la lit sur deux rampes, et on garde la plus forte.
    return Math.max(ramp(hour, 19, 22, 28, 31) /* 19h→7h du lendemain */, ramp(hour + 24, 19, 22, 28, 31))
  }
  // Crépusculaire : deux bosses, l'aube et le soir.
  return Math.max(ramp(hour, 4, 5.5, 8, 9.5), ramp(hour, 17, 18.5, 21, 22.5))
}

/**
 * Un trapèze : 0 avant `up0`, monte jusqu'à 1 en `up1`, tient jusqu'à `down0`,
 * retombe à 0 en `down1`. Arithmétique pure — rien qui puisse diverger.
 */
function ramp(x: number, up0: number, up1: number, down0: number, down1: number): number {
  if (x <= up0 || x >= down1) return 0
  if (x < up1) return (x - up0) / (up1 - up0)
  if (x <= down0) return 1
  return (down1 - x) / (down1 - down0)
}

/** La bête dort-elle à cette heure ? (Elle reste réveillable — voir R10.) */
function isResting(type: MonsterType, hour: number): boolean {
  return activityAt(type, hour) < FAUNA.REST_BELOW
}

function roll(state: SimState): number {
  const { value, next } = rngRoll(state.rngState)
  state.rngState = next
  return value
}

function inHabitat(state: SimState, type: MonsterType, tx: number, ty: number): boolean {
  const habitat = MONSTER_DEFS[type].habitat
  if (!habitat) return false
  const terrain = terrainAt(state.map, tx, ty)
  return habitat.includes(terrain)
}

/**
 * Une menace, telle que le gibier la PERÇOIT. `stealth` (dans ]0, 1]) est ce qui
 * reste des portées de détection face à elle : 1 pour un homme qui marche, 0,42
 * pour un loup qui rampe. On ne diminue pas les sens de la proie — on rend le
 * prédateur discret, ce qui n'est pas la même chose et se lit dans le code.
 */
export interface Threat {
  e: Entity
  stealth: number
}

/**
 * La plus proche MENACE, à la PERCEPTION. Pour du gibier, ce n'est plus seulement
 * l'homme : un loup en est une aussi — c'est ce qui fait de la vallée un
 * écosystème et non deux jeux superposés. Le cerf fuit le loup comme il fuit le
 * chasseur… mais il ne voit pas le loup qui rampe.
 *
 * On rend une distance EFFECTIVE (d / stealth) : un loup en traque à 4 tuiles
 * « pèse » comme un homme à 9. Toutes les comparaisons en aval (alertRange,
 * flightRange, SAFE_RANGE) restent alors écrites en clair, sans un seul facteur
 * de furtivité qui traîne — la furtivité est entrée UNE fois, ici.
 */
function nearestThreat(threats: Threat[], entity: Entity, range: number): { e: Entity; effSq: number } | undefined {
  let best: Entity | undefined
  let bestD = range * range
  for (const t of threats) {
    const a = t.e
    if (a.id === entity.id || a.hp <= 0) continue
    const effSq = distSq(entity.x, entity.y, a.x, a.y) / (t.stealth * t.stealth)
    if (effSq < bestD || (effSq === bestD && best && a.id < best.id)) {
      best = a
      bestD = effSq
    }
  }
  return best ? { e: best, effSq: bestD } : undefined
}

/* ── Le peuplement ────────────────────────────────────────────────────────── */

/**
 * Une bête ambiante que plus personne ne regarde s'efface — elle et son entité.
 * Les bêtes de lieu (tanière) sont résidentes : elles ne se dissipent jamais.
 */
function despawnUnwatched(state: SimState, avatars: Entity[]): void {
  const doomed = new Set<number>()
  for (const m of state.monsters) {
    if (!m.ambient) continue
    const entity = state.entities.find((e) => e.id === m.entityId)
    if (!entity) continue
    let watched = false
    for (const a of avatars) {
      if (distSq(entity.x, entity.y, a.x, a.y) <= FAUNA.DESPAWN_RADIUS * FAUNA.DESPAWN_RADIUS) {
        watched = true
        break
      }
    }
    if (!watched) doomed.add(m.entityId)
  }
  if (doomed.size === 0) return
  state.monsters = state.monsters.filter((m) => !doomed.has(m.entityId))
  state.entities = state.entities.filter((e) => !doomed.has(e.id))
}

/**
 * Une tentative de naissance par cadence, tant que le plafond n'est pas atteint.
 *
 * L'anneau est échantillonné PAR REJET dans le carré [-MAX, MAX] : on tire une
 * tuile, on la garde si sa distance tombe dans l'anneau, si elle est marchable,
 * libre, et si une espèce y a son habitat. Pas de `cos`/`sin` — la spec du
 * langage ne garantit pas leur résultat d'un moteur à l'autre (invariant 2).
 */
function trySpawn(state: SimState, avatars: Entity[]): void {
  if (state.tick % FAUNA.SPAWN_EVERY_TICKS !== 0) return
  if (avatars.length === 0) return

  let ambient = 0
  for (const m of state.monsters) if (m.ambient) ambient++
  if (ambient >= state.faunaCap) return

  const hour = getGameTime(state).hourOfCycle
  const host = avatars[Math.min(avatars.length - 1, Math.floor(roll(state) * avatars.length))]!
  const span = FAUNA.SPAWN_RING_MAX * 2 + 1
  const minSq = FAUNA.SPAWN_RING_MIN * FAUNA.SPAWN_RING_MIN
  const maxSq = FAUNA.SPAWN_RING_MAX * FAUNA.SPAWN_RING_MAX

  for (let attempt = 0; attempt < FAUNA.SPAWN_TRIES; attempt++) {
    const ox = Math.floor(roll(state) * span) - FAUNA.SPAWN_RING_MAX
    const oy = Math.floor(roll(state) * span) - FAUNA.SPAWN_RING_MAX
    const dSq = ox * ox + oy * oy
    if (dSq < minSq || dSq > maxSq) continue

    const tx = Math.floor(host.x) + ox
    const ty = Math.floor(host.y) + oy
    if (tx < 0 || ty < 0 || tx >= state.map.width || ty >= state.map.height) continue
    if (!TERRAINS[terrainAt(state.map, tx, ty)]?.walkable) continue
    if (isBlockedAt({ map: state.map, structures: state.structures, nodes: state.nodes }, tx, ty)) continue
    // LA PRESSION DE CHASSE (R16) : le gibier a déserté ce qu'on vient de chasser.
    // Rien ne naît ici tant que les bois n'ont pas retrouvé leur calme — c'est ce
    // qui force à lever le camp au lieu de récolter sur place.
    if (isQuiet(state, tx + 0.5, ty + 0.5)) continue

    // Le biome choisit l'espèce — et L'HEURE la pondère (R10). À 3h du matin, la
    // forêt donne des loups et des sangliers ; à midi, des cerfs. Le plancher
    // (SPAWN_FLOOR) laisse subsister une chance pour les endormis : le monde ne
    // se recompose pas d'un coup au coucher du soleil.
    const candidates = WILD_TYPES.filter((t) => inHabitat(state, t, tx, ty))
    if (candidates.length === 0) continue

    const weights = candidates.map((t) => FAUNA.SPAWN_FLOOR + (1 - FAUNA.SPAWN_FLOOR) * activityAt(t, hour))
    let total = 0
    for (const w of weights) total += w
    let pick = roll(state) * total
    let type = candidates[candidates.length - 1]!
    for (let c = 0; c < candidates.length; c++) {
      pick -= weights[c]!
      if (pick <= 0) {
        type = candidates[c]!
        break
      }
    }

    const id = spawnMonster(state, type, tx + 0.5, ty + 0.5)
    const born = state.monsters.find((m) => m.entityId === id)!
    born.ambient = true

    // Le grégarisme (R9) : un cerf ne naît jamais seul. Ses congénères se posent
    // autour de lui, et partagent son identité de harde.
    const size = MONSTER_DEFS[type].herdSize
    if (size) {
      const herdId = state.nextHerdId
      state.nextHerdId += 1
      born.herdId = herdId

      // L'ALPHA (R12). Une MEUTE a un chef ; une harde de cerfs n'en a pas — le
      // premier-né d'une meute de prédateurs est l'alpha, et toute la meute
      // retient son nom. C'est ce qui permet à chaque loup de savoir, plus tard,
      // que le chef est tombé — sans registre, sans recherche.
      if (MONSTER_DEFS[type].predator) {
        born.alpha = true
        born.alphaId = id
        promoteToAlpha(state, id, type)
      }

      const [lo, hi] = size
      const total = lo + Math.floor(roll(state) * (hi - lo + 1))
      for (let n = 1; n < total && ambient + n < state.faunaCap; n++) {
        const spot = herdSpot(state, type, tx, ty, host)
        if (!spot) continue
        const mateId = spawnMonster(state, type, spot.tx + 0.5, spot.ty + 0.5)
        const mate = state.monsters.find((m) => m.entityId === mateId)!
        mate.ambient = true
        mate.herdId = herdId
        if (born.alphaId !== undefined) mate.alphaId = born.alphaId
      }
    }
    return
  }
}

/** Les PV maximaux d'une bête — l'alpha en porte davantage (R12). */
export function maxHpOf(monster: Monster): number {
  return MONSTER_DEFS[monster.type].hp * (monster.alpha ? FAUNA.ALPHA_HP : 1)
}

/** Les dégâts d'une bête — l'alpha frappe plus fort (R12). */
function damageOf(monster: Monster): number {
  return MONSTER_DEFS[monster.type].damage * (monster.alpha ? FAUNA.ALPHA_DAMAGE : 1)
}

/** Le chef prend sa taille : ses PV montent, et ils sont pleins. */
function promoteToAlpha(state: SimState, entityId: number, type: MonsterType): void {
  const e = state.entities.find((x) => x.id === entityId)
  if (e) e.hp = MONSTER_DEFS[type].hp * FAUNA.ALPHA_HP
}

/**
 * Une tuile pour un congénère : près du premier, chez lui, libre — et TOUJOURS
 * hors du champ de l'hôte. Sans cette dernière garde, une harde née en bordure
 * d'anneau essaimerait vers l'intérieur et un cerf se matérialiserait à l'écran.
 */
function herdSpot(
  state: SimState,
  type: MonsterType,
  tx: number,
  ty: number,
  host: Entity,
): { tx: number; ty: number } | null {
  const span = FAUNA.HERD_SPAWN_SPREAD * 2 + 1
  const minSq = FAUNA.SPAWN_RING_MIN * FAUNA.SPAWN_RING_MIN
  for (let tries = 0; tries < 6; tries++) {
    const nx = tx + Math.floor(roll(state) * span) - FAUNA.HERD_SPAWN_SPREAD
    const ny = ty + Math.floor(roll(state) * span) - FAUNA.HERD_SPAWN_SPREAD
    if (nx < 0 || ny < 0 || nx >= state.map.width || ny >= state.map.height) continue
    const dx = nx + 0.5 - host.x
    const dy = ny + 0.5 - host.y
    if (dx * dx + dy * dy < minSq) continue // trop près de l'hôte : il le verrait naître
    if (!TERRAINS[terrainAt(state.map, nx, ny)]?.walkable) continue
    if (isBlockedAt({ map: state.map, structures: state.structures, nodes: state.nodes }, nx, ny)) continue
    if (!inHabitat(state, type, nx, ny)) continue
    return { tx: nx, ty: ny }
  }
  return null
}

/**
 * LA MORT DU CHEF (spec faune R12). L'alpha ne répond plus : la meute n'existe
 * plus. Elle éclate SUR-LE-CHAMP — plus d'appel, plus de courage, plus
 * d'encerclement. Chacun pour soi, et chacun s'enfuit.
 *
 * C'est la règle qui rend une meute battable sans en faire un tas de points de
 * vie : on n'abat pas quatre loups, on en abat UN — le gros, celui qu'on voit.
 * Encore faut-il l'atteindre, et il est au milieu des siens.
 *
 * Ceci tourne AVANT la boucle des monstres, et interrompt le coup en cours : un
 * loup en plein wind-up est ignoré par `advanceMonsters` (il est « occupé »), et
 * la meute mettait donc une demi-seconde à comprendre. « De suite » veut dire de
 * suite — le loup dont le chef tombe lâche sa morsure.
 */
function disperseLeaderless(state: SimState, byId: Map<number, Entity>): void {
  for (const m of state.monsters) {
    if (m.routed || m.alphaId === undefined) continue
    const chief = byId.get(m.alphaId)
    if (chief && chief.hp > 0) continue

    m.routed = true
    delete m.herdId // la meute est DISSOUTE : elle ne se reforme pas
    m.targetId = null
    m.stalking = false
    m.fleeSince = -1
    const e = byId.get(m.entityId)
    if (e) delete e.windup // il lâche le coup qu'il était en train de porter
  }
}

/**
 * Ce lieu a-t-il été chassé trop récemment (spec faune R16) ? Le rayon de silence
 * (46) est plus large que l'anneau de naissance (42) : un chasseur qui reste sur
 * place ne voit donc plus rien venir du tout. Il faut MARCHER — et c'est
 * précisément ce que fait un chasseur.
 */
function isQuiet(state: SimState, x: number, y: number): boolean {
  for (const q of state.faunaQuiet) {
    if (q.until <= state.tick) continue
    if (distSq(x, y, q.x, q.y) <= FAUNA.QUIET_RADIUS * FAUNA.QUIET_RADIUS) return true
  }
  return false
}

/** Le peuplement du tick : on efface ce que personne ne voit, on sème devant. */
export function advanceFauna(state: SimState, avatars: Entity[], byId: Map<number, Entity>): void {
  // La déroute d’une meute décapitée ne dépend d'aucun peuplement : elle vaut
  // aussi dans un banc de test à faune nulle.
  disperseLeaderless(state, byId)

  // Les zones de silence expirées ne servent plus à rien : la liste reste courte.
  if (state.faunaQuiet.length > 0) {
    state.faunaQuiet = state.faunaQuiet.filter((q) => q.until > state.tick)
  }

  // Un monde sans faune ambiante (banc de test, scénario headless) ne paie rien,
  // et surtout ne consomme pas un seul tirage du PRNG.
  if (state.faunaCap <= 0) return
  despawnUnwatched(state, avatars)
  trySpawn(state, avatars)
}

/* ── Le comportement ──────────────────────────────────────────────────────── */

/**
 * Brouter : quelques pas, un arrêt, un demi-tour — et jamais hors de chez soi.
 * Un pas qui sortirait de l'habitat est refusé : la bête reste dans son biome
 * sans qu'on ait à lui donner un territoire explicite.
 */
/** Le prochain pas de broutage laisserait-il la bête chez elle ? */
function stepStaysHome(state: SimState, monster: Monster, entity: Entity, step: number): boolean {
  if (monster.wanderDx === 0 && monster.wanderDy === 0) return false
  const nx = entity.x + monster.wanderDx * step
  const ny = entity.y + monster.wanderDy * step
  return inHabitat(state, monster.type, Math.floor(nx), Math.floor(ny))
}

/** Le centre de gravité de la harde — sans compter la bête elle-même. */
function herdCenter(herd: Monster[], monster: Monster, byId: Map<number, Entity>): { x: number; y: number } | null {
  let sx = 0
  let sy = 0
  let n = 0
  for (const other of herd) {
    if (other.entityId === monster.entityId) continue
    const e = byId.get(other.entityId)
    if (!e || e.hp <= 0) continue
    sx += e.x
    sy += e.y
    n++
  }
  return n === 0 ? null : { x: sx / n, y: sy / n }
}

function graze(state: SimState, monster: Monster, entity: Entity, center: { x: number; y: number } | null): void {
  const def = MONSTER_DEFS[monster.type]

  // LA FOUILLE (R14) : le sanglier fouge, groin au sol. Il ne bouge plus et ne
  // voit plus rien (voir `alertnessOf`) — c'est la fenêtre du chasseur.
  if (monster.rootUntil !== undefined) {
    if (state.tick < monster.rootUntil) {
      monster.wanderDx = 0
      monster.wanderDy = 0
      return
    }
    delete monster.rootUntil
  }

  // LA COHÉSION (R9) : trop loin des siens, la bête revient — et cesse de tirer
  // au sort. Une harde qui broute chacun dans sa direction se disperse en une
  // minute et n'est plus une harde.
  if (center) {
    const dx = center.x - entity.x
    const dy = center.y - entity.y
    if (dx * dx + dy * dy > FAUNA.HERD_SPREAD * FAUNA.HERD_SPREAD) {
      moveToward(state, monster, entity, center.x, center.y, false, FAUNA.GRAZE_SPEED)
      return
    }
  }

  if (state.tick >= monster.thinkAt) {
    monster.thinkAt = state.tick + def.thinkEveryTicks
    const r = roll(state)
    const stalled = monster.wanderDx === 0 && monster.wanderDy === 0
    // Le sanglier ne fait pas que s'arrêter : il FOUGE. Tête baissée, aveugle.
    if (monster.type === 'boar' && r < FAUNA.ROOT_CHANCE) {
      monster.rootUntil = state.tick + FAUNA.ROOT_TICKS
      monster.wanderDx = 0
      monster.wanderDy = 0
      return
    }
    if (r < FAUNA.PAUSE_CHANCE) {
      monster.wanderDx = 0 // elle broute sur place
      monster.wanderDy = 0
    } else if (stalled || r < FAUNA.PAUSE_CHANCE + def.wanderChance) {
      // Elle repart, ou elle vire. Sinon (cas restant) elle GARDE son cap — et
      // c'est cette persistance qui fait une déambulation plutôt qu'un tremblement.
      monster.wanderDx = (Math.floor(roll(state) * 3) - 1) as -1 | 0 | 1
      monster.wanderDy = (Math.floor(roll(state) * 3) - 1) as -1 | 0 | 1
    }
  }
  if (monster.wanderDx === 0 && monster.wanderDy === 0) return

  // Le pas resterait-il dans l'habitat ? On regarde la tuile visée. Sortir de
  // chez soi n'est pas un arrêt mais un DEMI-TOUR — et le demi-tour se JOUE dans
  // le même tick. Se contenter d'inverser le cap et de rendre la main faisait
  // osciller la bête entre deux directions refusées, immobile à jamais sur la
  // lisière de son biome (bug attrapé au smoke test : des dizaines de bêtes
  // figées). Si les deux sens sont refusés, on lâche le cap : la prochaine
  // réflexion en tirera un neuf.
  const step = (def.speed * FAUNA.GRAZE_SPEED) / BALANCE.TICK_RATE_HZ
  if (!stepStaysHome(state, monster, entity, step)) {
    monster.wanderDx = -monster.wanderDx as -1 | 0 | 1
    monster.wanderDy = -monster.wanderDy as -1 | 0 | 1
    if (!stepStaysHome(state, monster, entity, step)) {
      monster.wanderDx = 0
      monster.wanderDy = 0
      return
    }
  }
  moveToward(state, monster, entity, entity.x + monster.wanderDx, entity.y + monster.wanderDy, false, FAUNA.GRAZE_SPEED)
}

/**
 * Le pas d'une bête. Quatre états, dans cet ordre de priorité :
 * charger (sanglier blessé et décidé) → fuir → s'alerter (figée) → brouter.
 */
export function faunaStep(
  state: SimState,
  monster: Monster,
  entity: Entity,
  threats: Threat[],
  byId: Map<number, Entity>,
  herds: Map<number, Monster[]>,
  hour: number,
): void {
  const def = MONSTER_DEFS[monster.type]
  const attacker = monster.lastAttackerId !== null ? byId.get(monster.lastAttackerId) : undefined
  const wounded = entity.hp < def.hp
  const hunted = wounded && attacker !== undefined && attacker.hp > 0
  const herd = monster.herdId !== undefined ? herds.get(monster.herdId) : undefined

  // La charge du sanglier (spec faune R7, combat.md R12) : acculé, il retourne
  // la chasse. Le lapin et le cerf ont `chargeChance: 0` — ils fuient toujours.
  if (hunted && state.tick >= monster.thinkAt) {
    monster.thinkAt = state.tick + def.thinkEveryTicks
    monster.fleeing = roll(state) >= def.chargeChance
  }
  if (hunted && !monster.fleeing) {
    monster.fleeSince = -1
    const d2 = distSq(entity.x, entity.y, attacker.x, attacker.y)
    if (d2 <= COMBAT.MELEE_ENGAGE_RANGE * COMBAT.MELEE_ENGAGE_RANGE) {
      if (startAttack(state, entity, attacker.x - entity.x, attacker.y - entity.y, { windupTicks: def.windupTicks, damage: def.damage })) {
        entity.cooldownUntil = state.tick + def.attackCooldownTicks
      }
    } else {
      moveToward(state, monster, entity, attacker.x, attacker.y, false)
    }
    return
  }

  // De qui a-t-on peur ? De celui qui frappe, sinon de celui qui approche trop.
  // Un sanglier qui FOUGE (R14) a le groin au sol : ses portées s'effondrent, et
  // c'est très exactement ce qui permet de l'approcher. Ce n'est pas un bonus
  // qu'on accorde au joueur — c'est un comportement de la bête, qu'il exploite.
  const alertness = monster.rootUntil !== undefined ? FAUNA.ROOT_ALERTNESS : 1
  const alertRange = (def.alertRange ?? 0) * alertness
  const flightRange = (def.flightRange ?? 0) * alertness
  const alertSq = alertRange * alertRange
  const flightSq = flightRange * flightRange
  const safeSq = FAUNA.SAFE_RANGE * FAUNA.SAFE_RANGE
  const spotted = nearestThreat(threats, entity, Math.max(def.alertRange ?? 0, FAUNA.SAFE_RANGE))
  const seen = spotted?.e
  const seenSq = spotted?.effSq ?? Infinity // distance PERÇUE : le loup qui rampe paraît loin

  const scare = hunted ? attacker : seen
  const scareSq = hunted ? distSq(entity.x, entity.y, attacker.x, attacker.y) : seenSq

  // LA CONTAGION D'ALARME (R9). Il suffit qu'UNE bête de la harde vous repère
  // pour que toutes partent — même celles qui n'ont rien vu. C'est ce qui fait
  // qu'on ne s'approche pas d'une harde comme d'une bête seule : elle a autant
  // d'yeux que de têtes.
  let alarmed = false
  if (herd) {
    for (const other of herd) {
      if (other.entityId === monster.entityId || other.fleeSince < 0) continue
      const oe = byId.get(other.entityId)
      if (!oe) continue
      if (distSq(entity.x, entity.y, oe.x, oe.y) <= FAUNA.HERD_ALARM_RADIUS * FAUNA.HERD_ALARM_RADIUS) {
        alarmed = true
        break
      }
    }
  }

  // La peur est COLLANTE. Elle se déclenche à `flightRange` mais ne retombe
  // qu'à `SAFE_RANGE` : sans ça, la bête se figerait au premier pas hors de la
  // zone de fuite — à `flightRange + ε`, à vous regarder. Une bête qui détale
  // détale jusqu'à être vraiment loin.
  const afraid =
    scare !== undefined && scareSq <= safeSq && (hunted || alarmed || scareSq <= flightSq || monster.fleeSince >= 0)

  if (afraid) {
    if (monster.fleeSince < 0) monster.fleeSince = state.tick
    // La fuite en à-coups : on court, on souffle, on repart (spec faune R6).
    const phase = (state.tick - monster.fleeSince) % (FAUNA.BURST_RUN_TICKS + FAUNA.BURST_PAUSE_TICKS)
    if (phase < FAUNA.BURST_RUN_TICKS) {
      moveToward(state, monster, entity, scare.x, scare.y, true, FAUNA.FLEE_SPEED)
    }
    return
  }

  // Assez loin : la peur retombe, et la bête oublie qui l'a frappée.
  monster.fleeSince = -1
  monster.lastAttackerId = null

  // LE SANGLIER (R14) : fouir, menacer, charger, souffler. Il ne fuit pas — il
  // décide. Sa machine prime sur l'alerte et le broutage, et c'est pour ça
  // qu'elle est interrogée ICI : après la fuite (blessé, il fuit ou il charge)
  // mais avant tout le reste.
  if (monster.type === 'boar' && boarStep(state, monster, entity, seen, alertness)) return

  // Vue mais pas encore inquiétée : la bête se fige et regarde. Le joueur sait
  // qu'il a été vu — « annoncés, pas surprises » (GDD §9bis).
  if (seen && seenSq <= alertSq) {
    monster.wanderDx = 0
    monster.wanderDy = 0
    return
  }

  // Hors de ses heures, la bête se couche (R10). Elle reste réveillable — les
  // deux branches ci-dessus (fuir, s'alerter) sont passées AVANT : un dormeur
  // qu'on approche détale quand même. C'est le broutage, et lui seul, qui cesse.
  if (isResting(monster.type, hour)) {
    monster.wanderDx = 0
    monster.wanderDy = 0
    return
  }

  graze(state, monster, entity, herd ? herdCenter(herd, monster, byId) : null)
}

/* ── Le sanglier : il ne fuit pas, il décide (spec faune R14) ─────────────── */

/**
 * LE SANGLIER. Les autres bêtes n'ont qu'un verbe : fuir. Lui en a quatre, et
 * c'est ce qui en fait une RENCONTRE plutôt qu'une cible :
 *
 *   FOUIR    — groin au sol, il ne voit plus rien. La fenêtre du chasseur : c'est
 *              le seul moment où l'on approche une bête qui, sinon, vous voit
 *              venir et ne fuit pas.
 *   MENACER  — vous êtes trop près. Il ne détale pas : il se plante, face à vous,
 *              et il attend. Une seconde. C'est le dernier moment pour reculer —
 *              « annoncés, pas surprises » (GDD §9bis).
 *   CHARGER  — droit, et plus vite qu'un sprint. On ne le distance pas : ON
 *              S'ÉCARTE. La direction est VERROUILLÉE au départ — il ne corrige
 *              pas sa course, il passe. C'est ce qui rend l'esquive possible, et
 *              c'est la première leçon du combat positionnel voulu par le GDD §7.
 *   SOUFFLER — il a dépassé, il est essoufflé, immobile. C'est là, et seulement
 *              là, qu'on le frappe.
 *
 * Rend `true` s'il a consommé son tick : ces états priment sur tout le reste —
 * un sanglier qui charge ne broute pas.
 */
function boarStep(
  state: SimState,
  monster: Monster,
  entity: Entity,
  threat: Entity | undefined,
  /** Sa vigilance présente : effondrée pendant qu'il fouge (voir FAUNA.ROOT_ALERTNESS). */
  alertness: number,
): boolean {
  const def = MONSTER_DEFS.boar

  // SOUFFLER. Il a chargé, il a dépassé : il ne peut plus rien. C'est la fenêtre,
  // et elle n'est offerte qu'à qui a su ne pas fuir en ligne droite.
  if (monster.windedUntil !== undefined && state.tick < monster.windedUntil) return true
  delete monster.windedUntil

  // CHARGER. Direction verrouillée : il ne tourne pas. Il encorne ce qu'il touche
  // en passant — UNE fois, la charge est un coup et non une tondeuse — puis il
  // file au-delà.
  if (monster.chargeUntil !== undefined && state.tick < monster.chargeUntil) {
    const dx = monster.chargeDx ?? 0
    const dy = monster.chargeDy ?? 0
    moveToward(state, monster, entity, entity.x + dx, entity.y + dy, false, FAUNA.CHARGE_SPEED)
    if (!monster.chargeHit && threat) {
      const reach = COMBAT.MELEE_ENGAGE_RANGE
      if (distSq(entity.x, entity.y, threat.x, threat.y) <= reach * reach) {
        monster.chargeHit = true
        applyDamage(state, threat, def.damage, entity.id)
      }
    }
    return true
  }
  if (monster.chargeUntil !== undefined) {
    delete monster.chargeUntil
    delete monster.chargeHit
    monster.windedUntil = state.tick + FAUNA.WINDED_TICKS // il souffle, à découvert
    return true
  }

  // MENACER — encore faut-il quelqu'un d'assez près. Et « assez près », pour une
  // bête qui fouge, c'est BEAUCOUP plus près : sa portée de menace s'effondre avec
  // sa vigilance. C'est là toute la fenêtre du chasseur — sans ce facteur, la
  // fouille serait un joli mot sans conséquence, puisqu'il chargerait quand même
  // à quatre tuiles.
  const threatRange = FAUNA.THREAT_RANGE * alertness
  if (!threat || distSq(entity.x, entity.y, threat.x, threat.y) > threatRange * threatRange) {
    delete monster.threatSince
    return false
  }

  if (monster.threatSince === undefined) monster.threatSince = state.tick
  monster.wanderDx = 0
  monster.wanderDy = 0
  delete monster.rootUntil // il relève la tête : on ne fouge pas devant un intrus

  // Il tient l'intrus dans son axe pendant l'avertissement : la charge partira là.
  const len = Math.max(0.001, Math.sqrt(distSq(entity.x, entity.y, threat.x, threat.y)))
  entity.facing = { x: (threat.x - entity.x) / len, y: (threat.y - entity.y) / len }

  if (state.tick - monster.threatSince < FAUNA.THREAT_TICKS) return true // il avertit

  // Vous n'avez pas reculé. LA CHARGE PART — dans la direction d'ICI et MAINTENANT.
  // C'est ce verrou qui rend l'esquive latérale possible, et c'est tout le geste
  // que le jeu demande d'apprendre.
  delete monster.threatSince
  monster.chargeUntil = state.tick + FAUNA.CHARGE_TICKS
  monster.chargeDx = entity.facing.x
  monster.chargeDy = entity.facing.y
  monster.chargeHit = false
  return true
}

/* ── Le prédateur : la meute de loups (spec faune R11) ────────────────────── */

/** Les frères de meute vivants, à portée de cohésion — la mesure du courage. */
function packNearby(herd: Monster[] | undefined, monster: Monster, entity: Entity, byId: Map<number, Entity>): number {
  if (!herd) return 0
  let n = 0
  for (const other of herd) {
    if (other.entityId === monster.entityId) continue
    const e = byId.get(other.entityId)
    if (!e || e.hp <= 0) continue
    if (distSq(entity.x, entity.y, e.x, e.y) <= FAUNA.PACK_COHESION_RADIUS * FAUNA.PACK_COHESION_RADIUS) n++
  }
  return n
}

/**
 * LE REPAS (R15). Un prédateur affamé qui trouve une carcasse à viande s'y rend,
 * s'y plante, et mange. Rend `true` s'il a consommé son tick.
 *
 * C'est ce qui ferme la boucle du prédateur : il chasse, il TUE, il MANGE — puis
 * il vous laisse passer. Sans ce dernier terme, une meute n'est pas un animal,
 * c'est un distributeur d'agression qui vous suit jusqu'à ce que l'un des deux
 * meure.
 */
function feedStep(state: SimState, monster: Monster, entity: Entity): boolean {
  // Il mange : il ne fait rien d'autre, et il est parfaitement vulnérable.
  if (monster.eatingUntil !== undefined) {
    if (state.tick < monster.eatingUntil) return true

    // Le repas est fini : la carcasse est entamée, et il est repu.
    const meal = state.corpses.find((c) => c.id === monster.mealCorpseId)
    if (meal) {
      // Une bouchée de moins sur la carcasse ; la dernière l'efface du monde.
      removeItems(meal.inventory, { raw_meat: 1 })
      if (countOf(meal.inventory, 'raw_meat') <= 0) {
        state.corpses = state.corpses.filter((c) => c.id !== meal.id)
      }
    }
    delete monster.eatingUntil
    delete monster.mealCorpseId
    monster.satedUntil = state.tick + FAUNA.SATED_TICKS
    return true
  }

  if (monster.satedUntil !== undefined && state.tick < monster.satedUntil) return false // repu : rien à manger de plus
  delete monster.satedUntil

  // Affamé : la carcasse la plus proche qui porte encore de la viande.
  let best: { id: number; x: number; y: number } | undefined
  let bestD = FAUNA.CARCASS_SEEK * FAUNA.CARCASS_SEEK
  for (const c of state.corpses) {
    if (countOf(c.inventory, 'raw_meat') <= 0) continue
    const d = distSq(entity.x, entity.y, c.x, c.y)
    if (d < bestD || (d === bestD && best && c.id < best.id)) {
      best = { id: c.id, x: c.x, y: c.y }
      bestD = d
    }
  }
  if (!best) return false

  if (bestD <= FAUNA.EAT_RANGE * FAUNA.EAT_RANGE) {
    monster.eatingUntil = state.tick + FAUNA.EAT_TICKS
    monster.mealCorpseId = best.id
    monster.targetId = null
    monster.stalking = false
    return true
  }

  // Il y va — et il ne chasse plus personne en chemin.
  monster.targetId = null
  monster.stalking = false
  moveToward(state, monster, entity, best.x, best.y, false)
  return true
}

/**
 * Le pas d'un loup. Cinq états, et chacun est une décision qu'il PREND — c'est
 * ce qui le sépare du zombie, qui n'en prend aucune :
 *
 *   1. il saigne trop        → il ROMPT et décroche (il ne meurt pas au contact)
 *   2. il a une cible        → il la chasse et la mord
 *   3. la meute chasse       → il RÉPOND À L'APPEL et converge sur la même proie
 *   4. il est seul face à un homme → il RÔDE : il suit, il attend, il n'engage pas
 *   5. rien                  → il patrouille avec les siens (ou il dort, R10)
 */
export function wolfStep(
  state: SimState,
  monster: Monster,
  entity: Entity,
  quarry: Entity[],
  byId: Map<number, Entity>,
  monsterByEntity: Map<number, Monster>,
  herds: Map<number, Monster[]>,
  hour: number,
  isAvatar: (id: number) => boolean,
): void {
  const def = MONSTER_DEFS.wolf
  const pack = monster.herdId !== undefined ? herds.get(monster.herdId) : undefined

  // 1. LA ROMPUE. Blessé au-delà du seuil — ou en déroute — il décroche, et rien
  //    ne le ramène tant qu'il n'est pas loin. Un loup ne se sacrifie pas.
  const broken = entity.hp < maxHpOf(monster) * FAUNA.PACK_BREAK_HP
  if (broken || monster.routed) {
    monster.targetId = null
    monster.stalking = false
    const attacker = monster.lastAttackerId !== null ? byId.get(monster.lastAttackerId) : undefined
    const from = attacker ?? nearestOf(quarry, entity, FAUNA.SAFE_RANGE)
    if (from) {
      if (monster.fleeSince < 0) monster.fleeSince = state.tick
      const phase = (state.tick - monster.fleeSince) % (FAUNA.BURST_RUN_TICKS + FAUNA.BURST_PAUSE_TICKS)
      if (phase < FAUNA.BURST_RUN_TICKS) moveToward(state, monster, entity, from.x, from.y, true, FAUNA.FLEE_SPEED)
      return
    }
    // Plus personne en vue : il s'éloigne au trot, il ne rechasse pas.
    if (monster.routed) {
      graze(state, monster, entity, null)
      return
    }
  }
  monster.fleeSince = -1

  // 2. LE REPAS (R15). Affamé, il va à la carcasse et il mange. Repu, il ne
  //    chasse plus du tout — mais il se DÉFEND : qui le frappe le trouve en face.
  //    Un prédateur rassasié qui se laisserait tuer sans réagir serait un décor.
  if (feedStep(state, monster, entity)) return

  const sated = monster.satedUntil !== undefined && state.tick < monster.satedUntil
  if (sated) {
    const aggressor = monster.lastAttackerId !== null ? byId.get(monster.lastAttackerId) : undefined
    if (!aggressor || aggressor.hp <= 0) {
      // Rien ne le menace : il patrouille avec les siens, ou il dort. Le joueur
      // peut passer à côté d'une meute repue — et c'est un moment de jeu à part
      // entière : on la VOIT, on la contourne, et rien n'arrive.
      monster.targetId = null
      monster.stalking = false
      if (isResting('wolf', hour)) {
        monster.wanderDx = 0
        monster.wanderDy = 0
        return
      }
      graze(state, monster, entity, pack ? herdCenter(pack, monster, byId) : null)
      return
    }
    // On l'a frappé : il rend le coup. Pas de traque, pas d'encerclement, pas de
    // hurlement — de la défense, et la rompue s'il saigne.
    monster.stalking = false
    monster.targetId = aggressor.id
    const d2 = distSq(entity.x, entity.y, aggressor.x, aggressor.y)
    if (d2 <= COMBAT.MELEE_ENGAGE_RANGE * COMBAT.MELEE_ENGAGE_RANGE) {
      if (startAttack(state, entity, aggressor.x - entity.x, aggressor.y - entity.y, { windupTicks: def.windupTicks, damage: damageOf(monster) })) {
        entity.cooldownUntil = state.tick + def.attackCooldownTicks
      }
    } else {
      moveToward(state, monster, entity, aggressor.x, aggressor.y, false)
    }
    return
  }

  // 3-4. La cible : la sienne, ou celle que la meute chasse déjà (l'APPEL).
  //
  // Choisie À CHAQUE TICK, sans passer par `thinkAt` — et ce n'est pas un détail.
  // `thinkAt` appartient au BROUTAGE : le consommer ici privait la patrouille de
  // son horloge, et les loups restaient plantés à leur lieu de naissance (16 loups,
  // zéro mouvement — attrapé au smoke test, pas au raisonnement). Viser ne coûte
  // rien et ne tire aucun dé : le déterminisme n'en dépend pas, et un prédateur
  // n'a aucune raison de réfléchir plus lentement que sa proie ne court.
  monster.targetId =
    chooseQuarry(state, monster, entity, quarry, def.aggroRange, isAvatar) ??
    packQuarry(state, pack, monster, entity, byId, isAvatar)
  const target = monster.targetId !== null ? byId.get(monster.targetId) : undefined

  if (target && target.hp > 0) {
    // Un homme est choisi : la meute hurle. Une fois, et le joueur est prévenu.
    if (isAvatar(target.id)) howlOnce(state, pack, monster, entity, target.id)

    // 4. LE COURAGE. Face à un HOMME, un loup mal entouré suit sans mordre : il
    //    reste à distance de morsure, il pèse. La meute décimée cesse d'attaquer,
    //    et le joueur SENT qu'il a brisé quelque chose.
    const brave = !isAvatar(target.id) || packNearby(pack, monster, entity, byId) >= FAUNA.PACK_COURAGE
    const d2 = distSq(entity.x, entity.y, target.x, target.y)

    if (!brave) {
      // Il rôde : il se maintient juste hors de portée, sans jamais engager.
      const prowl = COMBAT.MELEE_ENGAGE_RANGE * 2.5
      if (d2 > prowl * prowl) moveToward(state, monster, entity, target.x, target.y, false)
      else if (d2 < COMBAT.MELEE_ENGAGE_RANGE * COMBAT.MELEE_ENGAGE_RANGE) {
        moveToward(state, monster, entity, target.x, target.y, true) // trop près : il se retire
      }
      return
    }

    // À portée de crocs : il mord. Plus rien à calculer. (L'alpha mord plus fort.)
    if (d2 <= COMBAT.MELEE_ENGAGE_RANGE * COMBAT.MELEE_ENGAGE_RANGE) {
      if (startAttack(state, entity, target.x - entity.x, target.y - entity.y, { windupTicks: def.windupTicks, damage: damageOf(monster) })) {
        entity.cooldownUntil = state.tick + def.attackCooldownTicks
      }
      return
    }

    // L'ENCERCLEMENT (R11), en deux temps — et c'est le premier qui compte.
    //
    // LA TRAQUE. Le loup ne fonce pas sur la proie : il RAMPE vers SON POSTE, un
    // point sur le cercle autour d'elle, assigné par son rang dans la meute. Il
    // va lentement (STALK_SPEED) et, tant qu'il rampe, la proie ne le repère que
    // de bien plus près (STALK_STEALTH). Ces deux choses n'en font qu'une : une
    // meute qui charge pour se placer lève le gibier avant que le cercle ne soit
    // bouclé — l'encerclement ne se produirait jamais. La lenteur EST la manœuvre.
    //
    // LA RUÉE. Quand tout le monde est en place — ou que la proie a compris et
    // détale — le camouflage tombe et la meute se rue à pleine vitesse.
    const aware = targetAware(target, monsterByEntity)
    const ready = packInPlace(pack, target, byId)

    if (ready || aware || d2 <= FAUNA.COMMIT_RANGE * FAUNA.COMMIT_RANGE) {
      monster.stalking = false
      moveToward(state, monster, entity, target.x, target.y, false)
      return
    }

    monster.stalking = true
    const post = encirclePost(pack, monster, target)
    moveToward(state, monster, entity, post.x, post.y, false, FAUNA.STALK_SPEED)
    return
  }
  monster.stalking = false

  monster.targetId = null

  // 5. Rien à chasser. Hors de ses heures, il dort ; sinon il patrouille avec
  //    les siens (la meute reste groupée, même au repos).
  if (isResting('wolf', hour)) {
    monster.wanderDx = 0
    monster.wanderDy = 0
    return
  }
  graze(state, monster, entity, pack ? herdCenter(pack, monster, byId) : null)
}

/**
 * La proie a-t-elle COMPRIS ? Une bête qui détale n'est plus à surprendre : le
 * camouflage n'a plus d'objet, c'est une course. (Un joueur, lui, est réputé
 * toujours averti dès que la meute se rue — on ne lit pas dans sa tête.)
 */
function targetAware(target: Entity, monsterByEntity: Map<number, Monster>): boolean {
  const m = monsterByEntity.get(target.id)
  return m !== undefined && m.fleeSince >= 0
}

/** Toute la meute vivante est-elle arrivée à portée de son poste ? */
function packInPlace(pack: Monster[] | undefined, target: Entity, byId: Map<number, Entity>): boolean {
  if (!pack) return true // un loup seul n'a personne à attendre
  const reach = FAUNA.ENCIRCLE_RADIUS + FAUNA.POST_TOLERANCE
  let alive = 0
  for (const w of pack) {
    const e = byId.get(w.entityId)
    if (!e || e.hp <= 0) continue
    alive++
    if (distSq(e.x, e.y, target.x, target.y) > reach * reach) return false
  }
  return alive > 0
}

/**
 * Les huit relèvements d'un encerclement. Des LITTÉRAUX, pas des `cos`/`sin` :
 * une valeur qui décide d'un déplacement est dans le flux déterministe, et la
 * spec ECMAScript ne garantit pas la trigonométrie d'un moteur à l'autre
 * (invariant 2). 0.7071 ≈ √2/2, à la précision où l'on place un loup.
 */
const BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071],
  [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071],
]

/**
 * LE POSTE d'un loup dans l'encerclement : un point sur le cercle autour de la
 * proie, sur le relèvement que lui donne son RANG dans la meute.
 *
 * Le rang se lit dans l'ordre des `entityId` — stable, sans état à stocker, et
 * identique sur toutes les machines. Les postes sont espacés au maximum : à
 * trois loups on prend un relèvement sur trois (0°, 135°, 270°), pas trois
 * voisins. C'est ce qui ferme le cercle au lieu de faire un peloton.
 */
function encirclePost(pack: Monster[] | undefined, monster: Monster, target: Entity): { x: number; y: number } {
  let rank = 0
  let size = 1
  if (pack) {
    size = pack.length
    for (const other of pack) if (other.entityId < monster.entityId) rank++
  }
  // Un pas de relèvement premier avec 8 (3) étale les postes au lieu de les
  // agglutiner : rangs 0,1,2 → relèvements 0, 3, 6 (soit 0°, 135°, 270°).
  const bearing = BEARINGS[(rank * 3) % BEARINGS.length]!
  // Une meute nombreuse se tient un peu plus large : le cercle doit tenir tout
  // le monde sans que les loups se marchent dessus.
  const radius = FAUNA.ENCIRCLE_RADIUS + (size > 4 ? 1 : 0)
  return { x: target.x + bearing[0] * radius, y: target.y + bearing[1] * radius }
}

/**
 * LE FEU (R13). Un loup n'approche pas d'un Feu allumé — et il ne poursuit donc
 * personne qui s'y tient. C'est la seule vraie issue d'une poursuite, et c'est
 * elle qui donne à la fuite une DESTINATION plutôt qu'une direction.
 *
 * Que le salut d'une nuit de chasse soit le Foyer n'est pas un hasard : c'est le
 * jeu qui dit son nom.
 */
function underFireWard(state: SimState, e: Entity): boolean {
  for (const s of state.structures) {
    if (s.type !== 'fire' || s.hp <= 0) continue
    const dx = s.tx + 0.5 - e.x
    const dy = s.ty + 0.5 - e.y
    if (dx * dx + dy * dy <= FAUNA.FIRE_WARD * FAUNA.FIRE_WARD) return true
  }
  return false
}

/**
 * La cible d'un loup. DEUX portées, et c'est ce qui rend la rencontre grave :
 *
 *  — ACQUÉRIR demande de venir près (`aggroRange`, 13). On peut donc contourner
 *    une meute qu'on a vue à temps.
 *  — GARDER va bien plus loin (`PURSUIT_RANGE`, 26). Une meute qui vous a choisi
 *    ne vous oublie pas parce que vous avez couru un peu : elle vous SUIT. Et
 *    comme un sprint ne creuse que ~15 tuiles avant l'épuisement, on ne sème pas
 *    des loups — on leur échappe (par le Feu, ou en les faisant rompre), ou on
 *    meurt.
 *
 * Le gibier PÈSE plus que l'homme (PREY_PREFERENCE) : un joueur peut traverser
 * une chasse sans être choisi. Le monde ne tourne pas autour de lui.
 */
function chooseQuarry(
  state: SimState,
  monster: Monster,
  entity: Entity,
  quarry: Entity[],
  range: number,
  isAvatar: (id: number) => boolean,
): number | null {
  let bestId: number | null = null
  let bestScore = Infinity
  for (const q of quarry) {
    if (q.id === entity.id || q.hp <= 0) continue
    // Qui se tient au Feu est intouchable : la meute ne le choisit pas, et
    // l'abandonne s'il l'atteint en fuyant.
    if (isAvatar(q.id) && underFireWard(state, q)) continue

    // La proie qu'on tient DÉJÀ se garde bien plus loin qu'on ne l'aurait prise.
    const reach = q.id === monster.targetId ? FAUNA.PURSUIT_RANGE : range
    const d = distSq(entity.x, entity.y, q.x, q.y)
    if (d > reach * reach) continue

    const score = isAvatar(q.id) ? d : d / (FAUNA.PREY_PREFERENCE * FAUNA.PREY_PREFERENCE)
    if (score < bestScore || (score === bestScore && bestId !== null && q.id < bestId)) {
      bestScore = score
      bestId = q.id
    }
  }
  return bestId
}

/**
 * LE HURLEMENT (R13). La meute vient de choisir un homme : elle le DIT. Une fois,
 * par meute et par proie — c'est le seul avertissement, et il doit compter.
 *
 * Le GDD §9bis en fait une règle, pas une politesse : « annoncés, pas surprises ».
 * Sans lui, la première chose que le joueur apprendrait de la meute serait qu'il
 * est en train de mourir.
 */
function howlOnce(state: SimState, pack: Monster[] | undefined, monster: Monster, entity: Entity, targetId: number): void {
  if (monster.howledAt === targetId) return
  const members = pack ?? [monster]
  for (const w of members) w.howledAt = targetId
  emitEvent(state, {
    type: 'wolf_howl',
    tick: state.tick,
    targetEntityId: targetId,
    packSize: members.length,
    x: entity.x,
    y: entity.y,
  })
}

/**
 * L'APPEL : la cible qu'un frère de meute chasse déjà, s'il n'est pas trop loin.
 *
 * Le loup qui répond doit pouvoir ATTEINDRE cette proie lui-même — sinon l'appel
 * ressuscite ce que la meute vient d'abandonner : chaque loup relâchait sa cible
 * hors de portée, puis la reprenait aussitôt chez un frère pas encore mis à jour
 * ce tick, et la meute poursuivait à l'infini une proie hors d'atteinte (attrapé
 * par les tests de poursuite et du Feu). Répondre à un cri, ce n'est pas suivre
 * un mirage.
 */
function packQuarry(
  state: SimState,
  pack: Monster[] | undefined,
  monster: Monster,
  entity: Entity,
  byId: Map<number, Entity>,
  isAvatar: (id: number) => boolean,
): number | null {
  if (!pack) return null
  for (const other of pack) {
    if (other.entityId === monster.entityId || other.targetId === null) continue
    const oe = byId.get(other.entityId)
    if (!oe || oe.hp <= 0) continue
    if (distSq(entity.x, entity.y, oe.x, oe.y) > FAUNA.PACK_CALL_RADIUS * FAUNA.PACK_CALL_RADIUS) continue

    const t = byId.get(other.targetId)
    if (!t || t.hp <= 0) continue
    // La proie est-elle à MA portée de poursuite, et pas réfugiée au Feu ?
    if (distSq(entity.x, entity.y, t.x, t.y) > FAUNA.PURSUIT_RANGE * FAUNA.PURSUIT_RANGE) continue
    if (isAvatar(t.id) && underFireWard(state, t)) continue
    return other.targetId
  }
  return null
}

/** Le plus proche d'une liste — sans préférence, sans pondération. */
function nearestOf(list: Entity[], entity: Entity, range: number): Entity | undefined {
  let best: Entity | undefined
  let bestD = range * range
  for (const e of list) {
    if (e.id === entity.id || e.hp <= 0) continue
    const d = distSq(entity.x, entity.y, e.x, e.y)
    if (d < bestD || (d === bestD && best && e.id < best.id)) {
      best = e
      bestD = d
    }
  }
  return best
}
