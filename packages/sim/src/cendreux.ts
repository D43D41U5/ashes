/**
 * La levée des Cendreux (spec 2026-07-08). Critère de mort, réveil, IA. Pur/déterministe.
 */
import { BALANCE, CENDREUX, COMBAT, MONSTER_DEFS, SLOTS } from './balance'
import { startAttack } from './combat'
import { distSq } from './geometry'
import { emitEvent } from './events'
import { fireActive, fireState } from './fire'
import { baselineTemperature } from './temperature'
import { isEmpty, pourInto } from './items'
import {
  attackBlockingStructure,
  hordeStep,
  moveToward,
  nearestPrey,
  spawnMonster,
  type CacheFlux,
  type Monster,
} from './monsters'
import { pathToward } from './pathfinding'
import { getGameTime } from './time'
import type { Entity, SimState } from './sim'
import { spillOnGround } from './village'

/**
 * Combien de Cendreux NÉS D'UN CADAVRE marchent encore (le plafond de R8 se lit là-dessus).
 *
 * On ne compte ni les résidents des Repaires ni les hordes ni les gardes de convoi : le
 * plafond borne la CONTAGION, et ces populations-là sont déjà bornées par leurs propres
 * systèmes (`cap` du POI, `HORDE_SIZE`, dissipation à l'aube). Les compter aussi revenait à
 * fermer la levée avec des morts qu'elle n'avait pas faits — MESURÉ : 24 vivants (le plafond
 * pile) dès le jour 21, rien qu'avec les Repaires et les convois.
 */
export function risenAlive(state: SimState): number {
  let n = 0
  for (const m of state.monsters) {
    if (m.type !== 'cendreux' || m.risen !== true) continue
    const e = state.entities.find((en) => en.id === m.entityId)
    if (e && e.hp > 0) n += 1
  }
  return n
}

/**
 * Vrai si cette mort donnera un Cendreux : sous le plafond, SEUL, et LOIN D'UN FEU.
 *
 * La cause ne compte plus (spec R6, décision 2026-07-31). Elle a longtemps été `cold` seul,
 * et c'était un goulot, pas une règle : mesuré sur une saison Veillée entière, le froid n'a
 * tué qu'UNE fois (il ne mord la plaine qu'en acte III) — la levée ne se déclenchait donc
 * jamais. Toute mort compte désormais, y compris celle qu'un Cendreux inflige : c'est la
 * CONTAGION (R7), le lore pris au mot.
 */
export function willRiseAsCendreux(state: SimState, entity: Entity): boolean {
  // BORNÉE (R8) : au-delà du plafond, la vallée ne relève plus personne. Sans lui, la
  // contagion n'aurait aucun point fixe — une nuit qui tourne mal fermerait la porte au lieu
  // de faire une histoire (T15 de `tension.md`). Abattre un Cendreux rouvre une place.
  if (risenAlive(state) >= CENDREUX.MAX_ALIVE) return false
  // Loin d'un feu : aucune structure feu dans HEARTH_WARD_RADIUS.
  const hearthWardR = CENDREUX.HEARTH_WARD_RADIUS
  const nearFire = state.structures.some(
    (s) => s.type === 'fire' && fireActive(state, s) && distSq(s.tx + 0.5, s.ty + 0.5, entity.x, entity.y) <= hearthWardR * hearthWardR,
  )
  if (nearFire) return false
  // Seul : aucun allié vivant (même village) dans WITNESS_RADIUS.
  const witnessR = CENDREUX.WITNESS_RADIUS
  const village = state.villages.find((v) => v.memberIds.includes(entity.id))
  if (village) {
    const hasAlly = state.entities.some(
      (e) => e.id !== entity.id && e.hp > 0 && village.memberIds.includes(e.id) &&
        distSq(e.x, e.y, entity.x, entity.y) <= witnessR * witnessR,
    )
    if (hasAlly) return false
  }
  return true
}

/** Réveil : les cadavres marqués se lèvent en Cendreux (ou sont annulés par un feu). */
export function advanceCendreux(state: SimState): void {
  const ward = CENDREUX.HEARTH_WARD_RADIUS
  for (const corpse of [...state.corpses]) {
    if (corpse.risesAt === undefined || state.tick < corpse.risesAt) continue
    // Veillé par un feu à portée → annulation.
    const warded = state.structures.some(
      (s) => s.type === 'fire' && fireActive(state, s) && distSq(s.tx + 0.5, s.ty + 0.5, corpse.x, corpse.y) <= ward * ward,
    )
    if (warded) {
      delete corpse.risesAt
      corpse.decayAt = state.tick + COMBAT.CORPSE_TICKS
      continue
    }
    // Levée : le cadavre devient le Cendreux, portant son loot.
    // LES 40 CASES SE DEMANDENT ICI, et nulle part ailleurs. C'est le seul Cendreux qui
    // hérite d'un cadavre entier ; ceux des hordes et des convois naissent les mains vides
    // (sac d'espèce à 0) et n'ont pas à traîner un inventaire vide dans chaque snapshot.
    const id = spawnMonster(state, 'cendreux', corpse.x, corpse.y, SLOTS.NPC)
    const ent = state.entities.find((e) => e.id === id)!
    state.monsters.find((m) => m.entityId === id)!.risen = true // il compte dans le plafond (R8)
    // Les CASES passent au Cendreux (spec inventaire R6) : la levée n'est pas un
    // atelier de réparation — une hache usée se relève usée. `pourInto` conserve
    // l'usure (il ne reconstruit pas de case neuve), sinon mourir de froid
    // réparerait tout l'outillage porté et le Cendreux serait une lessiveuse.
    // Ce qui NE TIENT PAS dans les 40 cases du Cendreux (un cadavre gavé au-delà
    // pendant la fenêtre de levée) ne s'évapore pas : il tombe au sol (A21).
    pourInto(corpse.inventory, ent.inventory)
    state.corpses = state.corpses.filter((c) => c.id !== corpse.id)
    if (!isEmpty(corpse.inventory)) spillOnGround(state, corpse.x, corpse.y, {}, corpse.inventory)
    emitEvent(state, { type: 'cendreux_risen', tick: state.tick, entityId: id, x: corpse.x, y: corpse.y })
  }
}

/** La source de chaleur la plus proche dans `range` : un feu OU un vivant. */
export function nearestWarmth(
  state: SimState,
  entity: Entity,
  range: number,
): { x: number; y: number; prey?: Entity } | undefined {
  const r2 = range * range
  let best: { x: number; y: number; prey?: Entity } | undefined
  let bestD = r2
  for (const s of state.structures) {
    if (s.type !== 'fire') continue
    if (fireState(state, s) !== 'lit') continue // seul un feu ALLUMÉ est un phare (spec feu-station S5)
    const d = distSq(s.tx + 0.5, s.ty + 0.5, entity.x, entity.y)
    if (d < bestD) {
      bestD = d
      best = { x: s.tx + 0.5, y: s.ty + 0.5 }
    }
  }
  const prey = nearestPrey(state, entity, range)
  if (prey) {
    const d = distSq(prey.x, prey.y, entity.x, entity.y)
    if (d < bestD) {
      bestD = d
      best = { x: prey.x, y: prey.y, prey }
    }
  }
  return best
}

/**
 * IA du Cendreux : dormant le jour (rampe vers une proie en vue), cherche la chaleur la nuit,
 * coule vers le Feu ciblé quand il marche en horde — et frappe ce qui lui barre la route.
 */
export function cendreuxStep(state: SimState, monster: Monster, entity: Entity, flux: CacheFlux | null = null): void {
  const def = MONSTER_DEFS.cendreux
  if (entity.windup) return
  const night = getGameTime(state).isNight

  // Cible du tick de décision.
  if (state.tick >= (monster.thinkAt ?? 0)) {
    monster.thinkAt = state.tick + def.thinkEveryTicks
    let goal: { x: number; y: number; prey?: Entity } | undefined
    // Attirés par la chaleur quand il fait FROID (spec feu-station S5) : la nuit (comme
    // toujours), OU quand le froid de BASE — hors feu, sinon oscillation à la lisière de la
    // bulle — mord (biome froid, Grand Froid). Sinon, la chasse diurne.
    const cold = night || baselineTemperature(state, entity.x, entity.y) < CENDREUX.COLD_ATTRACT_THRESHOLD
    // UN VIVANT EN VUE PRIME SUR LE FOYER — dans les deux régimes. Le Cendreux cherche la
    // chaleur ; entre celle qui brûle et celle qui SAIGNE, il prend la seconde.
    //
    // Sans cette priorité, le feu était le meilleur bouclier du joueur. MESURÉ : un Cendreux
    // venu de l'ouest chemine vers le feu (S5), s'arrête à 1,4 tuile de son centre — et à
    // cette distance AUCUN humain ne peut plus le battre dans `nearestWarmth`. L'homme assis
    // de l'autre côté du feu, à 3,4 tuiles, n'était donc plus jamais ciblé : 0 coup, 0 dégât
    // en 4 000 ticks, quand le MÊME montage sans feu lui coûtait 2 652 PV. Le « phare qui
    // appelle les morts » (S5) livrait un monstre qui campe, là où S6 acte le Foyer ASSIÉGÉ.
    //
    // La portée du basculement est `aggroRange` — sa VUE, la même qui le réveille le jour :
    // on ne lui apprend pas une deuxième règle. Le feu reste ce qui l'amène de loin ; les
    // yeux font le reste. Aucun tirage RNG ajouté (le flux seedé est inchangé).
    //
    // UN MEMBRE DE HORDE NE CHERCHE PAS LA CHALEUR : il a déjà un Feu, celui qu'on lui a
    // donné pour cible. Sans cette exclusion, `nearestWarmth` lui trouvait un VIVANT jusqu'à
    // `WARMTH_SEEK_RANGE` (20) — or une horde marche justement sur un village, donc sur des
    // PNJ : chacun de ses 12 à 16 membres posait alors son propre A* (4 096 tuiles explorées,
    // deux fois par seconde) au lieu de couler dans le champ de flux PARTAGÉ. C'est
    // exactement le coût que R5 existe pour éviter. Ses YEUX marchent toujours : ce qui passe
    // à `aggroRange` se fait mordre, horde ou pas.
    const inHorde = state.hordes.some((h) => h.memberEntityIds.includes(monster.entityId))
    const seen = nearestPrey(state, entity, def.aggroRange)
    if (seen) goal = { x: seen.x, y: seen.y, prey: seen }
    else if (cold && !inHorde) goal = nearestWarmth(state, entity, CENDREUX.WARMTH_SEEK_RANGE)
    monster.targetId = goal?.prey?.id ?? null
    if (goal) {
      const world = { map: state.map, structures: state.structures, nodes: state.nodes, moverVillageId: null }
      // Le Feu bloque désormais sa tuile (hitbox) : viser À CÔTÉ, pas dessus —
      // sinon la dérive nocturne vers la chaleur ne trouve jamais de chemin.
      monster.path = pathToward(world, entity.x, entity.y, Math.floor(goal.x), Math.floor(goal.y)) ?? []
    } else {
      monster.path = []
    }
  }

  // Attaque si une proie ciblée est au contact.
  const target = monster.targetId !== null ? state.entities.find((e) => e.id === monster.targetId) : undefined
  if (target && distSq(entity.x, entity.y, target.x, target.y) <= COMBAT.MELEE_ENGAGE_RANGE * COMBAT.MELEE_ENGAGE_RANGE) {
    if (
      state.tick >= entity.cooldownUntil &&
      startAttack(state, entity, target.x - entity.x, target.y - entity.y, {
        windupTicks: def.windupTicks,
        damage: def.damage,
      })
    ) {
      entity.cooldownUntil = state.tick + def.attackCooldownTicks
    }
    return
  }

  // LA HORDE COULE VERS LE FEU (spec R2/R5). Sans proie en vue, un membre de horde suit la
  // descente de gradient du champ de flux — partagé entre toutes les bêtes qui visent le même
  // Foyer — et frappe le franchissement qui le barre. C'est là que vit le SIÈGE de masse ;
  // élargir l'A* à la place coûterait un BFS par bête et par demi-seconde.
  if (!target && hordeStep(state, monster, entity, flux)) return

  // Un pas vers le prochain nœud du chemin (A*) — ou, faute de chemin, DROIT sur la cible.
  // Les deux cas convergent exprès : ce qui décide du siège n'est pas « ai-je un chemin ? »
  // mais « ai-je AVANCÉ ? ».
  const wp = monster.path?.[0]
  let goX: number
  let goY: number
  if (wp) {
    const dx = wp.tx + 0.5 - entity.x
    const dy = wp.ty + 0.5 - entity.y
    if (dx * dx + dy * dy < BALANCE.WAYPOINT_RADIUS * BALANCE.WAYPOINT_RADIUS) {
      monster.path!.shift()
      return
    }
    goX = wp.tx + 0.5
    goY = wp.ty + 0.5
  } else if (target) {
    goX = target.x
    goY = target.y
  } else {
    return
  }
  moveToward(state, monster, entity, goX, goY, false)

  // LE SIÈGE, SEUL (spec R3 ; S6 de `feu-station.md`, acté le 2026-07-25 et jamais livré).
  // Il a poussé et n'a pas bougé d'un pouce : quelque chose le barre. Il le frappe — porte,
  // mur plein, ou mur d'ARÊTE, que `crossingBlocker` sait lire des deux côtés (R23).
  //
  // Le test se fait sur `entity.moved` et NON sur « l'A* n'a rendu aucun chemin » : mesuré, le
  // cas courant est un chemin de longueur 1 vers un voisin muré — la bête pousse contre la
  // paroi sans jamais l'attaquer. Avant ce repli : cible tenue 4 000 ticks sur 4 000,
  // **0 mur touché, 0 tuile parcourue**. N'importe quelle enceinte rendait le joueur
  // intouchable, et le Cendreux ne venait même pas frapper à la porte.
  if (!entity.moved && !entity.windup && state.tick >= entity.cooldownUntil) {
    attackBlockingStructure(state, monster, entity, goX, goY)
  }
}
