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
import {
  BALANCE,
  CIRCLES,
  COMBAT,
  FAUNA,
  HUNT,
  MONSTER_DEFS,
  TERRAINS,
  TERRAIN_ALPINE_FLOWERS,
  TERRAIN_ALPINE_MEADOW,
  TERRAIN_DEEP_WATER,
  TERRAIN_FLOWER_MEADOW,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_HEATH,
  TERRAIN_LARCH,
  TERRAIN_MARSH,
  TERRAIN_OLD_GROWTH,
  TERRAIN_PEAT_BOG,
  TERRAIN_PINE,
  TERRAIN_REED_MARSH,
  TERRAIN_SHALLOW_WATER,
  TICK_DT_S,
  type MonsterType,
} from './balance'
import { isBlockedAt } from './collision'
import { applyDamage, die, startAttack } from './combat'
import { emitEvent } from './events'
import { distSq } from './geometry'
import { carryRatio, carryTier, countOf, isEmpty, removeItems, type ItemId } from './items'
import { terrainAt, type WorldMap } from './map'
import { moveToward, spawnMonster, type Monster } from './monsters'
import { hash2 } from './noise'
import { poissonPoints } from './poisson'
import { rngRoll } from './rng'
import { getGameTime } from './time'
import type { Entity, SimState } from './sim'

/**
 * COMBIEN LE COIN AIME-T-IL LES PRÉDATEURS ? (spec tension.md, GDD §8bis)
 *
 * Pur, déterministe (`sqrt` seulement) : rare près du foyer, courant au loin. Sans
 * foyer déclaré (bancs de test), le monde reste uniforme — on n'impose pas une
 * géographie à qui ne l'a pas demandée.
 */
export function predatorBias(state: SimState, tx: number, ty: number): number {
  const home = state.home
  if (!home) return 1
  const dx = tx - home.x
  const dy = ty - home.y
  const d = Math.sqrt(dx * dx + dy * dy)
  if (d <= CIRCLES.DOMESTIC_RADIUS) return FAUNA.PREDATOR_BIAS_DOMESTIC
  if (d >= CIRCLES.WILD_RADIUS) return FAUNA.PREDATOR_BIAS_WILD
  return 1
}

/**
 * LE SANG APPELLE (spec chasse C12). Le poids des prédateurs au peuplement, près
 * d'une carcasse FRAÎCHE ou d'une entité qui SAIGNE. Il se cumule au gradient de
 * danger (`predatorBias`) : tuer, c'est armer un minuteur.
 */
export function bloodBias(state: SimState, x: number, y: number): number {
  const r = HUNT.BLOOD_SCENT_RADIUS * HUNT.BLOOD_SCENT_RADIUS
  for (const c of state.corpses) {
    if (state.tick - c.diedAt >= HUNT.CARCASS_FRESH_TICKS) continue
    if (countOf(c.inventory, 'raw_meat') <= 0) continue
    if (distSq(x, y, c.x, c.y) <= r) return HUNT.BLOOD_PREDATOR_BIAS
  }
  for (const e of state.entities) {
    if (e.hp <= 0 || e.wounds.bleeding !== true) continue
    if (distSq(x, y, e.x, e.y) <= r) return HUNT.BLOOD_PREDATOR_BIAS
  }
  for (const m of state.monsters) {
    if (!isBleeding(m, state.tick)) continue
    const e = state.entities.find((x2) => x2.id === m.entityId)
    if (!e || e.hp <= 0) continue
    if (distSq(x, y, e.x, e.y) <= r) return HUNT.BLOOD_PREDATOR_BIAS
  }
  return 1
}

/**
 * CE QU'UNE ESPÈCE COÛTE AU PLAFOND (spec faune R2/R9) : le nombre de places
 * qu'un tirage lui prend — 1 pour une solitaire, la taille moyenne de sa harde
 * pour une grégaire. Le tirage d'espèce divise par ça, sans quoi une bête qui
 * naît par quatre remplit le monde quatre fois plus vite qu'une bête qui naît
 * seule, à pondération horaire égale.
 */
function herdCost(type: MonsterType): number {
  const size = MONSTER_DEFS[type].herdSize
  if (!size) return 1
  return (size[0] + size[1]) / 2
}

/* ── LES COINS DE CHASSE (spec faune R17) ─────────────────────────────────── */

/**
 * OÙ LE GIBIER VIT. Les biomes OUVERTS : on y broute, on y voit venir. Le cerf
 * et le lapin sont des bêtes de pré — la forêt est leur abri, pas leur garde-manger.
 */
const OPEN_TERRAINS: readonly number[] = [
  TERRAIN_GRASS,
  TERRAIN_FLOWER_MEADOW,
  TERRAIN_ALPINE_MEADOW,
  TERRAIN_ALPINE_FLOWERS,
  TERRAIN_HEATH,
]

/**
 * …ET LES BOIS (spec faune R17). LA SOUILLE : le sanglier ne vit pas au pré — il
 * vit sous les arbres, et il se vautre dans la boue. Poser tous les coins de
 * chasse dans des prairies (première version) était une faute : le sanglier n'y
 * naissait que parce que le disque du coin (46 tuiles) débordait sur les bois
 * voisins — d'où VINGT-TROIS SANGLIERS dans une prairie à cerfs, une absurdité.
 *
 * La vallée porte donc DEUX natures de coin, et le terrain les distingue tout
 * seul : la CLAIRIÈRE (on y broute, on y boit) et LA SOUILLE (on y fouge, on s'y
 * vautre). C'est ce qui rend la carte apprenable : on va au pré pour le cerf, au
 * bois pour le sanglier.
 */
const WOOD_TERRAINS: readonly number[] = [
  TERRAIN_FOREST,
  TERRAIN_PINE,
  TERRAIN_LARCH,
  TERRAIN_OLD_GROWTH,
]

/** …ET OÙ IL BOIT. Tous les jours, et c'est ce qui fixe les troupeaux. */
const WATER_TERRAINS: readonly number[] = [
  TERRAIN_SHALLOW_WATER,
  TERRAIN_DEEP_WATER,
  TERRAIN_MARSH,
  TERRAIN_REED_MARSH,
  TERRAIN_PEAT_BOG,
]

/**
 * LE GIBIER A DES ADRESSES (décision utilisateur, 2026-07-13).
 *
 * Jusqu'ici la faune était un BROUILLARD UNIFORME : elle naissait dans un anneau
 * autour du joueur, où qu'il aille. Marcher dix minutes dans n'importe quelle
 * direction donnait exactement la même chose — donc la carte ne s'apprenait pas,
 * et « le gibier est une ressource de TERRITOIRE, pas de temps » (R16) restait
 * une phrase.
 *
 * Désormais le monde porte des COINS DE CHASSE : des lieux FIXES, semés une fois
 * pour la saison, où le gibier vit. Entre eux, la vallée est vide. On apprend la
 * clairière aux cerfs, la combe aux sangliers ; on y retourne ; on les épuise
 * (R16 : la pression de chasse), et l'on doit alors aller plus loin.
 *
 * Le semis est un Poisson (le même que les lieux) : déterministe, sans PRNG
 * d'état, et espacé — deux coins de chasse ne se touchent jamais.
 */
export function placeHuntingGrounds(map: WorldMap, seed: number): { x: number; y: number }[] {
  // LA GRILLE DE L'EAU. « Y a-t-il de l'eau près d'ici ? » est la question qu'on
  // pose des milliers de fois : on la précalcule une fois, par cellules. Une
  // passe sur la carte, et le reste devient gratuit.
  const cell = FAUNA.GROUND_WATER_CELL
  const gw = Math.ceil(map.width / cell)
  const gh = Math.ceil(map.height / cell)
  const wet = new Uint8Array(gw * gh)
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      if (!WATER_TERRAINS.includes(terrainAt(map, tx, ty))) continue
      wet[Math.floor(ty / cell) * gw + Math.floor(tx / cell)] = 1
    }
  }
  const nearWater = (tx: number, ty: number): boolean => {
    const r = Math.ceil(FAUNA.GROUND_WATER_NEAR / cell)
    const cx = Math.floor(tx / cell)
    const cy = Math.floor(ty / cell)
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        const nx = cx + ox
        const ny = cy + oy
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
        if (wet[ny * gw + nx] === 1) return true
      }
    }
    return false
  }

  const pts = poissonPoints(map.width, map.height, seed ^ 0x47524e44 /* 'GRND' */, FAUNA.GROUND_SPACING)
  const grounds: { x: number; y: number }[] = []
  for (const p of pts) {
    // LE COIN DE CHASSE EST UN LIEU LOGIQUE (retour utilisateur) : le gibier ne
    // vit pas sur un éboulis. Il lui faut de l'HERBE (un biome ouvert, où l'on
    // broute) et de l'EAU (on boit tous les jours). Le semis de Poisson donne
    // l'ESPACEMENT ; ces deux conditions donnent l'ADRESSE.
    //
    // Le point tiré n'est qu'une graine : on cherche autour de lui la meilleure
    // tuile — un pré près d'une rive. S'il n'y en a pas dans le rayon, ce point
    // ne devient PAS un coin de chasse : la vallée a le droit d'avoir des déserts,
    // et c'est même ce qui donne leur valeur aux coins qui restent.
    const sx = Math.floor(p.x)
    const sy = Math.floor(p.y)

    // LE PAYS DÉCIDE DE LA NATURE DU COIN. On compte, autour de la graine, ce qui
    // domine : de l'herbe ou des arbres. Un semis tombé au milieu des bois devient
    // une SOUILLE (sanglier) ; au milieu des prés, une CLAIRIÈRE (cerf, lapin).
    // Le gibier n'a pas à s'adapter au coin : c'est le coin qui est ce qu'il est.
    let pres = 0
    let bois = 0
    for (let oy = -FAUNA.GROUND_SNAP; oy <= FAUNA.GROUND_SNAP; oy += 3) {
      for (let ox = -FAUNA.GROUND_SNAP; ox <= FAUNA.GROUND_SNAP; ox += 3) {
        const tx = sx + ox
        const ty = sy + oy
        if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue
        const t = terrainAt(map, tx, ty)
        if (OPEN_TERRAINS.includes(t)) pres++
        else if (WOOD_TERRAINS.includes(t)) bois++
      }
    }
    const veut = bois > pres ? WOOD_TERRAINS : OPEN_TERRAINS

    let placed = false
    for (let r = 0; r <= FAUNA.GROUND_SNAP && !placed; r++) {
      for (let oy = -r; oy <= r && !placed; oy++) {
        for (let ox = -r; ox <= r && !placed; ox++) {
          if (r > 0 && Math.abs(ox) !== r && Math.abs(oy) !== r) continue // le bord de l'anneau
          const tx = sx + ox
          const ty = sy + oy
          if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue
          const terrain = terrainAt(map, tx, ty)
          if (!TERRAINS[terrain]?.walkable) continue
          if (!veut.includes(terrain)) continue // de l'herbe, OU des arbres
          if (!nearWater(tx, ty)) continue // …et de l'eau (on boit ; le sanglier s'y vautre)
          grounds.push({ x: tx + 0.5, y: ty + 0.5 })
          placed = true
        }
      }
    }
  }
  return grounds
}

/** Le coin de chasse le plus proche d'un point — et sa distance au carré. */
function nearestGround(state: SimState, x: number, y: number): { g: { x: number; y: number }; d2: number } | null {
  let best: { x: number; y: number } | null = null
  let bestD = Infinity
  for (const g of state.grounds) {
    const d = distSq(x, y, g.x, g.y)
    if (d < bestD) {
      bestD = d
      best = g
    }
  }
  return best ? { g: best, d2: bestD } : null
}

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
 * Une menace, telle que le gibier la PERÇOIT — par DEUX canaux (spec chasse C5) :
 *
 *   — `vision` : ce qui reste de sa VISIBILITÉ (allure × couvert). Le REGARD de
 *     la bête (C4) la module encore — il dépend du percepteur et s'applique donc
 *     dans `nearestThreat`, pas ici.
 *   — `noise` : son BRUIT, omnidirectionnel — ni le fourré ni le dos tourné n'y
 *     peuvent rien.
 *
 * La bête retient le PLUS FORT des deux. Un homme qui marche à découvert : 1.
 * Un sprinteur : 1,6 (entendu de PLUS loin). Un loup qui rampe en fourré :
 * presque rien. On ne diminue pas les sens de la proie — on rend la menace
 * discrète, ce qui n'est pas la même chose et se lit dans le code.
 */
export interface Threat {
  e: Entity
  vision: number
  noise: number
}

/**
 * LE BRUIT DE L'ALLURE (spec chasse C2) : ce que le pas d'un avatar laisse
 * entendre. Le PORTAGE INTERDIT LE SILENCE — au palier lourd, l'allure ne
 * descend jamais sous le bruit de la marche : on ne rampe pas avec un cerf sur
 * le dos, et c'est ce qui rend le retour de chasse bruyant (le troisième acte,
 * C12, se paiera là).
 */
export function gaitNoise(e: Entity): number {
  const raw =
    e.gait === 'still' ? HUNT.NOISE_STILL
    : e.gait === 'sneak' ? HUNT.NOISE_SNEAK
    : e.gait === 'sprint' ? HUNT.NOISE_SPRINT
    : HUNT.NOISE_WALK
  const tier = carryTier(carryRatio(e.inventory))
  const heavy = tier !== 'light' && tier !== 'medium'
  return heavy ? Math.max(raw, HUNT.NOISE_WALK) : raw
}

/** La VISIBILITÉ de l'allure : un corps immobile se voit mal, un sprint saute aux yeux. */
function gaitVisibility(e: Entity): number {
  return e.gait === 'still' ? HUNT.VIS_STILL
    : e.gait === 'sneak' ? HUNT.VIS_SNEAK
    : e.gait === 'sprint' ? HUNT.VIS_SPRINT
    : HUNT.VIS_WALK
}

/** LE COUVERT (spec chasse C3) : ce qui reste de la visibilité sur cette tuile. */
export function coverAt(state: SimState, x: number, y: number): number {
  return TERRAINS[terrainAt(state.map, Math.floor(x), Math.floor(y))]?.cover ?? 1
}

/** La menace qu'un avatar OPPOSE, entrée une fois (spec chasse C5) : vue + ouïe. */
export function avatarThreat(state: SimState, e: Entity): Threat {
  return {
    e,
    vision: gaitVisibility(e) * coverAt(state, e.x, e.y),
    noise: gaitNoise(e) * HUNT.HEARING_FACTOR,
  }
}

/**
 * La DÉTECTABILITÉ d'un avatar, tous canaux confondus et sans le regard — ce
 * que consomme l'acquisition du prédateur (`chooseQuarry`), qui n'a pas de
 * secteur aveugle en chasse.
 */
export function avatarDetectability(state: SimState, e: Entity): number {
  const t = avatarThreat(state, e)
  return Math.max(t.vision, t.noise)
}

/**
 * La plus proche MENACE, à la PERCEPTION. Pour du gibier, ce n'est plus seulement
 * l'homme : un loup en est une aussi — c'est ce qui fait de la vallée un
 * écosystème et non deux jeux superposés. Le cerf fuit le loup comme il fuit le
 * chasseur… mais il ne voit pas le loup qui rampe.
 *
 * On rend une distance EFFECTIVE (d / perçu) : un loup en traque à 4 tuiles
 * « pèse » comme un homme à 9, et un chasseur dans le DOS de la bête (spec
 * chasse C4) se VOIT deux fois moins — mais son pas s'ENTEND autant : le perçu
 * est le max des deux canaux (vue × regard, ouïe). Toutes les comparaisons en
 * aval (portées, SAFE_RANGE, la jauge) restent alors écrites en clair, sans un
 * seul facteur de furtivité qui traîne — la furtivité est entrée UNE fois, ici.
 *
 * `rawSq` accompagne : la PANIQUE (C1) et la géométrie (fuir, regarder) se
 * jouent sur la distance vraie, pas sur la distance perçue.
 */
function nearestThreat(
  threats: Threat[],
  entity: Entity,
  range: number,
  /** LE VENT (C17) : l'odeur descend le vent — le seul sens qui ignore vos précautions. */
  wind: { x: number; y: number },
): { e: Entity; effSq: number; rawSq: number } | undefined {
  let best: Entity | undefined
  let bestD = range * range
  let bestRaw = 0
  for (const t of threats) {
    const a = t.e
    if (a.id === entity.id || a.hp <= 0) continue
    const dSq = distSq(entity.x, entity.y, a.x, a.y)
    // LE REGARD (C4) : pleine VUE devant, réduite de flanc, faible dans le dos.
    // Un produit scalaire et trois littéraux — pas de trigo (invariant 2).
    let angle: number = HUNT.ANGLE_FRONT
    // L'ODORAT (C17) : la menace est-elle AU VENT de la bête ? Alors son odeur
    // descend jusqu'à elle — et ni le fourré, ni le pas feutré, ni le dos tourné
    // n'y peuvent rien. La parade n'est pas un facteur de plus : c'est UN CÔTÉ,
    // et le monde le repose sans cesse (le vent tourne).
    let scent = 0
    if (dSq > 0) {
      const d = Math.sqrt(dSq)
      const tx = (a.x - entity.x) / d
      const ty = (a.y - entity.y) / d
      const dot = entity.facing.x * tx + entity.facing.y * ty
      angle = dot >= HUNT.ANGLE_FRONT_COS ? HUNT.ANGLE_FRONT : dot <= HUNT.ANGLE_BACK_COS ? HUNT.ANGLE_BACK : HUNT.ANGLE_SIDE
      // « Au vent de moi » : le vecteur bête→menace pointe DANS le vent (l'odeur
      // voyage de la menace vers la bête, donc à contre-sens du vecteur).
      const upwind = -(tx * wind.x + ty * wind.y)
      if (upwind >= HUNT.SCENT_COS) scent = HUNT.SCENT_STRENGTH
    }
    // Trois canaux, le plus fort gagne : l'OUÏE n'a ni couvert ni secteur
    // aveugle, et le NEZ n'a rien du tout — il a juste besoin du bon côté.
    const perceived = Math.max(t.vision * angle, t.noise, scent)
    const effSq = dSq / (perceived * perceived)
    if (effSq < bestD || (effSq === bestD && best && a.id < best.id)) {
      best = a
      bestD = effSq
      bestRaw = dSq
    }
  }
  return best ? { e: best, effSq: bestD, rawSq: bestRaw } : undefined
}

/**
 * LA MÉFIANCE (spec chasse C1) — le pas de jauge du tick.
 *
 * Le stimulus dérive de la distance PERÇUE rapportée aux portées de l'espèce :
 * nul au-delà du plafond de perception, il sature à la distance de fuite. La
 * jauge le POURSUIT — montée en s² (près = beaucoup plus vite), décrue linéaire
 * et lente, ralentie encore par la nervosité. C'est ce différentiel qui achète
 * le STOP-AND-GO : se figer fait redescendre la jauge, repartir la fait remonter,
 * et l'approche devient un jeu de patience seconde par seconde.
 *
 * La PANIQUE court-circuite tout : une menace à distance BRUTE de contact lève
 * la bête, si discrète soit-elle — mais seulement chez les bêtes qui FUIENT
 * (`flightRange > 0`). Le sanglier ne panique pas : il MENACE (R14), et c'est
 * sa machine à lui qui répond au trop-près.
 *
 * Arithmétique pure, aucun tirage : le déterminisme n'en dépend même pas.
 */
function updateSuspicion(
  state: SimState,
  monster: Monster,
  spotted: { e: Entity; effSq: number; rawSq: number } | undefined,
  perceiveRange: number,
  flightRange: number,
  /** La peur imposée : coup reçu, contagion d'alarme, cri de mort — jauge à 1. */
  forced: boolean,
): void {
  const prev = monster.suspicion
  const panics = (MONSTER_DEFS[monster.type].flightRange ?? 0) > 0

  if (forced) {
    monster.suspicion = 1
  } else if (panics && spotted && spotted.rawSq <= HUNT.PANIC_RANGE * HUNT.PANIC_RANGE) {
    monster.suspicion = 1 // on lui a marché DESSUS : pas de rampe, la détente
  } else {
    let s = 0
    if (spotted && perceiveRange > 0) {
      const dEff = Math.sqrt(spotted.effSq)
      const span = Math.max(0.001, perceiveRange - flightRange)
      s = Math.min(1, Math.max(0, (perceiveRange - dEff) / span))
    }
    if (s > monster.suspicion) {
      monster.suspicion = Math.min(s, monster.suspicion + s * s * (TICK_DT_S / HUNT.RISE_S))
    } else {
      const nervous = monster.nervous ?? 1
      monster.suspicion = Math.max(s, monster.suspicion - TICK_DT_S / (HUNT.DECAY_S * nervous))
    }
  }

  // LA MENACE TIENT LA JAUGE (R14 × C6). Un sanglier planté face à vous ne
  // « se rassure » pas pendant que vous armez votre coup : sans ce plancher, sa
  // jauge s'effritait d'un cheveu sous le seuil pendant le wind-up d'un chasseur
  // immobile, l'alerte se re-datait au tick suivant — et le coup porté à une
  // bête qui vous FIXE redevenait propre (attrapé par le banc A6).
  if (monster.threatSince !== undefined) {
    monster.suspicion = Math.max(monster.suspicion, HUNT.SUSPICION_ALERT)
  }

  // Le franchissement du seuil d'alerte se DATE (la mise à mort propre l'interroge,
  // C6) et se PAIE (la nervosité ralentit toutes les décrues à venir).
  if (prev < HUNT.SUSPICION_ALERT && monster.suspicion >= HUNT.SUSPICION_ALERT) {
    monster.alertSince = state.tick
    monster.nervous = Math.min(HUNT.NERVOUS_MAX, (monster.nervous ?? 1) * HUNT.NERVOUS_FACTOR)
  } else if (monster.suspicion < HUNT.SUSPICION_ALERT && monster.alertSince !== undefined) {
    delete monster.alertSince
  }
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
 * LE PEUPLEMENT DU TICK — et il est fait POUR LE MULTI.
 *
 * Deux choses ont changé le jour où le gibier a eu des adresses (R17), et elles
 * sont toutes les deux structurelles :
 *
 *   1. LE BUDGET APPARTIENT AU COIN, PLUS AU MONDE. Un plafond global ne survit
 *      pas au multijoueur : trente bêtes pour TOUT le monde, c'est trois bêtes
 *      par joueur à dix joueurs — un monde mort. Chaque coin de chasse porte
 *      donc SA population (`GROUND_CAP`), et deux joueurs dans deux clairières
 *      différentes ont chacun la leur pleine. Deux joueurs dans LA MÊME clairière
 *      la partagent — ce qui est exactement juste : c'est le même pré.
 *      Le plafond du monde (`state.faunaCap`) demeure, mais comme GARDE-FOU de
 *      serveur : il protège le tick, il ne règle pas le jeu.
 *
 *   2. TOUT LE MONDE EST SERVI, à chaque tick de peuplement. On tirait UN avatar
 *      au sort : à dix joueurs, chacun attendait quatre secondes entre deux
 *      naissances, et remplir une clairière prenait des minutes. On boucle
 *      désormais sur tous les avatars, dans l'ordre de l'état (déterministe).
 *
 * L'anneau est échantillonné PAR REJET dans le carré [-MAX, MAX] : on tire une
 * tuile, on la garde si sa distance tombe dans l'anneau, si elle est marchable,
 * libre, et si une espèce y a son habitat. Pas de `cos`/`sin` — la spec du
 * langage ne garantit pas leur résultat d'un moteur à l'autre (invariant 2).
 */
function trySpawn(state: SimState, avatars: Entity[]): void {
  if (state.tick % FAUNA.SPAWN_EVERY_TICKS !== 0) return
  if (avatars.length === 0) return

  // La population de chaque coin de chasse, comptée une fois pour ce tick — et,
  // séparément, celle de ses PRÉDATEURS : c'est elle qui borne le danger (R18).
  const perGround = new Map<string, number>()
  const predPerGround = new Map<string, number>()
  let ambient = 0
  let predators = 0
  for (const m of state.monsters) {
    if (!m.ambient) continue
    ambient++
    const pred = isPredator(m.type)
    if (pred) predators++
    if (m.groundX === undefined || m.groundY === undefined) continue
    const k = `${m.groundX},${m.groundY}`
    perGround.set(k, (perGround.get(k) ?? 0) + 1)
    if (pred) predPerGround.set(k, (predPerGround.get(k) ?? 0) + 1)
  }

  const hour = getGameTime(state).hourOfCycle
  const budget = { world: ambient, worldPred: predators, perGround, predPerGround }
  for (const host of avatars) {
    if (budget.world >= state.faunaCap) return // le garde-fou du serveur, et lui seul
    trySpawnNear(state, host, hour, budget)
  }
}

/**
 * COMBIEN DE PLACES RESTE-T-IL AUX PRÉDATEURS ICI (spec faune R18) ?
 *
 * Dans un coin de chasse : `PREDATOR_SHARE` de sa population, et pas une bête de
 * plus. Sans coin (banc de test, monde uniforme) : la même part, mais du plafond
 * du monde — la règle ne dépend pas de la géographie, elle dépend du DANGER.
 */
function predatorRoom(
  state: SimState,
  ground: { x: number; y: number } | null,
  budget: { worldPred: number; predPerGround: Map<string, number> },
): number {
  if (ground) {
    const have = budget.predPerGround.get(`${ground.x},${ground.y}`) ?? 0
    return Math.floor(FAUNA.GROUND_CAP * FAUNA.PREDATOR_SHARE) - have
  }
  return Math.floor(state.faunaCap * FAUNA.PREDATOR_SHARE) - budget.worldPred
}

/**
 * Une tentative de naissance autour d'UN avatar.
 *
 * `budget` porte les DEUX bornes, et elles ne disent pas la même chose : celle du
 * COIN (`GROUND_CAP`) règle ce qu'on RESSENT, celle du MONDE (`state.faunaCap`)
 * protège la machine. Sans coins de chasse (banc de test), seule la seconde vaut,
 * et le peuplement redevient l'ancien, uniforme.
 */
function trySpawnNear(
  state: SimState,
  host: Entity,
  hour: number,
  budget: {
    world: number
    worldPred: number
    perGround: Map<string, number>
    predPerGround: Map<string, number>
  },
): void {
  const perGround = budget.perGround
  const predPerGround = budget.predPerGround
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

    // LES COINS DE CHASSE (R17). Le gibier a des ADRESSES : il ne naît QUE dans
    // un coin de chasse. Entre eux, la vallée est vide — et c'est ce vide qui
    // donne sa valeur au reste : on apprend la clairière aux cerfs, on y retourne,
    // on l'épuise (R16), et il faut alors aller plus loin. Un monde SANS coins
    // (banc de test) garde l'ancien peuplement uniforme : c'est une décision
    // d'HÔTE, exactement comme `faunaCap`.
    //
    // ET SON BUDGET EST LE SIEN. Le plafond appartient au COIN, pas au monde :
    // c'est ce qui rend le moteur multijoueur. Deux joueurs dans deux clairières
    // ont chacun la leur pleine ; deux joueurs dans la MÊME clairière la
    // partagent — c'est le même pré, il porte les mêmes bêtes.
    let ground: { x: number; y: number } | null = null
    if (state.grounds.length > 0) {
      const near = nearestGround(state, tx + 0.5, ty + 0.5)
      if (!near || near.d2 > FAUNA.GROUND_RADIUS * FAUNA.GROUND_RADIUS) continue
      const key = `${near.g.x},${near.g.y}`
      if ((perGround.get(key) ?? 0) >= FAUNA.GROUND_CAP) continue // ce coin est plein
      ground = near.g
    }

    // Le biome choisit l'espèce — et L'HEURE la pondère (R10). À 3h du matin, la
    // forêt donne des loups et des sangliers ; à midi, des cerfs. Le plancher
    // (SPAWN_FLOOR) laisse subsister une chance pour les endormis : le monde ne
    // se recompose pas d'un coup au coucher du soleil.
    let candidates = WILD_TYPES.filter((t) => inHabitat(state, t, tx, ty))
    if (candidates.length === 0) continue

    // LE GIBIER APPARTIENT À SON COIN (R17). Une bête de PRÉ ne naît pas dans un
    // bois, une bête de BOIS ne naît pas dans un pré — et la règle se dit en une
    // ligne : le gibier doit pouvoir vivre sur la tuile DU COIN, pas seulement sur
    // celle où il tombe.
    //
    // Sans elle, le disque d'un coin (46 tuiles) débordait sur les bois voisins et
    // une CLAIRIÈRE se remplissait de VINGT-TROIS SANGLIERS — une prairie à cerfs
    // pleine de bêtes de sous-bois. Le sanglier a maintenant SES coins : les
    // souilles. On va au pré pour le cerf, au bois pour le sanglier.
    //
    // Le PRÉDATEUR, lui, va où va le gibier : il n'a pas de pré à lui, il suit les
    // hardes. Il est admis partout — et borné, partout, par son quota (R18).
    if (ground) {
      const groundTerrain = terrainAt(state.map, Math.floor(ground.x), Math.floor(ground.y))
      candidates = candidates.filter(
        (t) => isPredator(t) || (MONSTER_DEFS[t].habitat?.includes(groundTerrain) ?? false),
      )
      if (candidates.length === 0) continue
    }

    // LE QUOTA DE PRÉDATEURS (spec faune R18). La nuit, le loup RAFLAIT le budget
    // d'une clairière — jusqu'à dix-neuf loups dans un seul coin. On ne le rend
    // pas plus rare (ça viderait la nuit de son sens) : on borne sa PART. Le reste
    // va au gibier, qui la nuit DORT (R10) — des cerfs couchés, et quelques loups
    // qui rôdent entre eux. C'est un écosystème, pas un mur.
    //
    // Il faut DEUX places libres pour ouvrir une meute : un loup seul n'ose pas
    // (R11, le courage), et un demi-quota ne fabriquerait que des rôdeurs inutiles.
    const predRoom = predatorRoom(state, ground, budget)
    if (predRoom < 2) candidates = candidates.filter((t) => !isPredator(t))
    if (candidates.length === 0) continue

    // LE GRADIENT DE DANGER (GDD §8bis, cercle sauvage). Le biome choisit l'espèce,
    // l'HEURE la pondère (R10)… et la DISTANCE AU FOYER décide de qui rôde : près
    // du camp, les prédateurs sont rares ; aux marges, le monde leur appartient.
    //
    // Sans lui, le cercle sauvage était riche SANS être dangereux : s'éloigner
    // rapportait sans faire peur, et le PORTAGE (qui rend la distance coûteuse)
    // n'achetait aucune tension. Les deux règles se tiennent la main.
    // LE SANG PÈSE (chasse C12) : près d'une carcasse fraîche ou d'un blessé, le
    // monde donne des prédateurs. Il se CUMULE au gradient de danger — chasser
    // aux marges est somptueux ET brûlant, exactement ce que veut le GDD §8bis.
    const danger = predatorBias(state, tx, ty) * bloodBias(state, tx + 0.5, ty + 0.5)
    const weights = candidates.map(
      (t) =>
        (FAUNA.SPAWN_FLOOR + (1 - FAUNA.SPAWN_FLOOR) * activityAt(t, hour)) *
        (isPredator(t) ? danger : 1) /
        // LE PRIX D'UNE HARDE (playtest : « il y a trop de bêtes » — et c'étaient
        // 43 CERFS sur 48). Le plafond était censé être un budget de POPULATION ;
        // il n'était qu'un budget de TIRAGES. Un tirage « cerf » coûte quatre
        // places (il naît par 3 à 5), un tirage « lapin » une seule : à pondération
        // horaire égale, la harde raflait le monde en quatre fois moins de tirages.
        // On divise donc le poids par ce que l'espèce COÛTE. La monoculture tombe,
        // et la densité, elle, ne bouge pas d'un pouce.
        herdCost(t),
    )
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
    // ELLE EST D'ICI (R17) : elle retient SON coin de chasse, et sa dérive y
    // reviendra toujours. Une bête sans coin (banc de test) garde l'errance libre.
    // Le coin est CRÉDITÉ tout de suite : la harde qui suit se compte dedans, et
    // le tour de peuplement du joueur suivant voit un budget à jour.
    const key = ground ? `${ground.x},${ground.y}` : null
    const pred = MONSTER_DEFS[type].predator === true
    const credit = (): void => {
      budget.world += 1
      if (pred) budget.worldPred += 1
      if (key) perGround.set(key, (perGround.get(key) ?? 0) + 1)
      if (key && pred) predPerGround.set(key, (predPerGround.get(key) ?? 0) + 1)
    }
    if (ground) {
      born.groundX = ground.x
      born.groundY = ground.y
    }
    credit()
    // LE TERRIER (chasse C16) : le lapin naît avec le sien — sa tuile de
    // naissance, hors du champ de quiconque par construction (R1). Levé, il y
    // court, et il y disparaît. Le trou existe donc AVANT qu'on le voie.
    if (type === 'rabbit') {
      born.burrowX = tx + 0.5
      born.burrowY = ty + 0.5
    }

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
      for (let n = 1; n < total; n++) {
        // LA HARDE SE COMPTE DANS SON COIN (R17), plus dans un compteur global :
        // sans ça, une clairière pleine continuait de recevoir des congénères
        // tant que le PLAFOND DU MONDE (240, un garde-fou de serveur) n'était pas
        // atteint — c'est-à-dire toujours.
        if (budget.world >= state.faunaCap) break // le garde-fou du monde
        if (key && (perGround.get(key) ?? 0) >= FAUNA.GROUND_CAP) break // …et celui du coin
        // …et le QUOTA DE PRÉDATEURS (R18) : une meute ne dépasse pas sa part.
        if (MONSTER_DEFS[type].predator && predatorRoom(state, ground, budget) <= 0) break
        const spot = herdSpot(state, type, tx, ty, host)
        if (!spot) continue
        const mateId = spawnMonster(state, type, spot.tx + 0.5, spot.ty + 0.5)
        const mate = state.monsters.find((m) => m.entityId === mateId)!
        mate.ambient = true
        credit()
        mate.herdId = herdId
        if (born.groundX !== undefined && born.groundY !== undefined) {
          mate.groundX = born.groundX
          mate.groundY = born.groundY
        }
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

/* ── LE SANG (spec chasse C8-C12) — l'échec fécond ────────────────────────── */

/** Cette bête saigne-t-elle ? (Plaie mortelle, ou plaie légère pas encore refermée.) */
export function isBleeding(monster: Monster, tick: number): boolean {
  if (monster.bleedMortal) return true
  return monster.bleedUntil !== undefined && tick < monster.bleedUntil
}

/** Un avatar saigne-t-il (blessure de combat R7) ? Le sang est le sang. */
function avatarBleeds(e: Entity): boolean {
  return e.wounds.bleeding === true
}

/**
 * LA BÊTE DIMINUÉE (C10). Sa vitesse suit ses PV : l'écart se referme à mesure
 * qu'elle saigne. PRESSER une bête mortellement atteinte devient une stratégie —
 * au prix de l'endurance ; l'autre, c'est d'ATTENDRE qu'elle se couche… mais le
 * sang appelle d'autres nez (C12).
 */
export function woundedSlow(monster: Monster, entity: Entity): number {
  const hpMax = maxHpOf(monster)
  if (hpMax <= 0 || entity.hp >= hpMax) return 1
  const ratio = Math.max(0, Math.min(1, entity.hp / hpMax))
  return HUNT.WOUNDED_SLOW_FLOOR + (1 - HUNT.WOUNDED_SLOW_FLOOR) * ratio
}

/**
 * LA PASSE DU SANG. Elle draine, elle sème, elle referme les plaies légères —
 * pour les BÊTES comme pour les AVATARS (le saignement d'un joueur, combat R7,
 * laisse la même piste : le sang est le sang, et un blessé qui traverse la nuit
 * est une proie — décision utilisateur n°2).
 *
 * Les gouttes sont de l'ÉTAT, jamais des événements (haute fréquence ≠ domaine),
 * et bornées des deux côtés : expiration + plafond FIFO.
 */
function advanceBlood(state: SimState, byId: Map<number, Entity>): void {
  // Les gouttes vieillissent. Le filtre ne tourne qu'en présence de sang.
  if (state.blood.length > 0) {
    state.blood = state.blood.filter((b) => state.tick - b.tick < HUNT.BLOOD_TTL)
  }

  const drop = (x: number, y: number): void => {
    state.blood.push({ x, y, tick: state.tick })
    // Plafond FIFO : la plus vieille goutte s'efface. L'état reste petit, et le
    // snapshot avec — c'est la même discipline que la faune ambiante.
    if (state.blood.length > HUNT.BLOOD_CAP) state.blood.shift()
  }

  for (const m of state.monsters) {
    // La plaie légère se REFERME (C8, décision n°3) : la piste s'éteint, la bête
    // survit — nerveuse au maximum, mais vivante. Sans ça, « toucher une fois et
    // attendre » serait la seule stratégie, et la traque perdrait son horloge.
    // Ce nettoyage passe AVANT la garde `isBleeding` : sinon le champ expiré
    // traînait dans l'état pour toujours (le snapshot ne ment pas, même sur ce
    // qui ne fait plus rien).
    if (!m.bleedMortal && m.bleedUntil !== undefined && state.tick >= m.bleedUntil) {
      delete m.bleedUntil
      delete m.bleedDropAt
    }
    if (!isBleeding(m, state.tick)) continue
    const e = byId.get(m.entityId)
    if (!e || e.hp <= 0) continue

    if (m.bleedDropAt === undefined || state.tick >= m.bleedDropAt) {
      m.bleedDropAt = state.tick + HUNT.BLOOD_EVERY_TICKS
      drop(e.x, e.y)
    }
    // La MORTELLE draine jusqu'au bout. Une bête qui meurt de sa plaie meurt de
    // la main de qui l'a blessée : `lastAttackerId` porte la mise à mort — la
    // viande, la pression de chasse et la chronique en dépendent.
    if (m.bleedMortal) {
      const before = e.hp
      e.hp = Math.max(0, e.hp - HUNT.BLEED_HP_PER_S / BALANCE.TICK_RATE_HZ)
      if (before > 0 && e.hp <= 0) die(state, e, m.lastAttackerId ?? 0)
    }
  }

  // Le sang des AVATARS : la même piste, et elle mène à eux.
  for (const e of state.entities) {
    if (e.hp <= 0 || !avatarBleeds(e)) continue
    if (state.monsters.some((m) => m.entityId === e.id)) continue
    if (state.tick % HUNT.BLOOD_EVERY_TICKS !== 0) continue
    drop(e.x, e.y)
  }
}

/**
 * LE COUCHÉ (C11). Une bête à plaie mortelle qu'on ne presse plus va se TAPIR
 * dans le meilleur couvert à portée : immobile, perception effondrée. On la
 * retrouve PAR LE SANG, pas en battant la carte — et attendre devient l'autre
 * stratégie du chasseur. Rend `true` si elle a consommé son tick.
 */
function bedStep(state: SimState, monster: Monster, entity: Entity, threatened: boolean): boolean {
  if (!monster.bleedMortal) {
    delete monster.calmSince
    delete monster.bedded
    return false
  }

  // Pressée : elle se relève et repart (la fuite reprend la main).
  if (threatened) {
    delete monster.calmSince
    delete monster.bedded
    return false
  }

  if (monster.calmSince === undefined) monster.calmSince = state.tick
  if (state.tick - monster.calmSince < HUNT.BED_AFTER) return false

  // Déjà tapie : elle ne bouge plus. Elle attend — et elle s'éteint.
  if (monster.bedded) {
    monster.wanderDx = 0
    monster.wanderDy = 0
    return true
  }

  // Le meilleur couvert à portée : la tuile de `cover` le plus bas. Sondage pur,
  // sans tirage — deux clients arrivent au même fourré.
  const tx = Math.floor(entity.x)
  const ty = Math.floor(entity.y)
  let bestX = tx
  let bestY = ty
  let bestCover = coverAt(state, entity.x, entity.y)
  for (let oy = -HUNT.BED_SEEK; oy <= HUNT.BED_SEEK; oy++) {
    for (let ox = -HUNT.BED_SEEK; ox <= HUNT.BED_SEEK; ox++) {
      const nx = tx + ox
      const ny = ty + oy
      if (nx < 0 || ny < 0 || nx >= state.map.width || ny >= state.map.height) continue
      const terrain = terrainAt(state.map, nx, ny)
      if (!TERRAINS[terrain]?.walkable) continue
      const c = TERRAINS[terrain]?.cover ?? 1
      if (c < bestCover) {
        bestCover = c
        bestX = nx
        bestY = ny
      }
    }
  }

  const cx = bestX + 0.5
  const cy = bestY + 0.5
  if (distSq(entity.x, entity.y, cx, cy) <= 0.5) {
    monster.bedded = true // arrivée : elle se tapit
    monster.wanderDx = 0
    monster.wanderDy = 0
    return true
  }
  // Elle y va — diminuée (C10), donc lentement.
  moveToward(state, monster, entity, cx, cy, false, FAUNA.WARY_SPEED * woundedSlow(monster, entity))
  return true
}

/**
 * LE VENT (spec chasse C17). Il tourne — lentement, par relèvements entiers, au
 * PRNG de l'état (donc dans le flux déterministe). L'odeur descend le vent : ce
 * vecteur décide, à chaque instant, de quel CÔTÉ l'on peut approcher.
 *
 * Le client doit le VOIR (herbes couchées) : une règle invisible est une
 * injustice, pas une profondeur.
 */
function advanceWind(state: SimState): void {
  // LE CALME PLAT est une décision d'HÔTE (comme `faunaCap`) : un monde dont le
  // vent est le vecteur nul n'a pas de vent, et n'en aura jamais. Les bancs de
  // test s'en servent — l'odorat est un canal à part, on le mesure séparément —
  // et le monde réel, lui, naît venté.
  if (state.wind.x === 0 && state.wind.y === 0) return
  // Le vent du DÉPART tient : il vient de l'hôte (ou du banc), et le monde ne le
  // rebat pas au tick 0. Il tournera au premier relais, comme tous les suivants.
  if (state.tick === 0 || state.tick % HUNT.WIND_SHIFT_TICKS !== 0) return
  // Dérivé par `hash2`, PAS par le PRNG de l'état : le vent ne doit consommer
  // aucun tirage — sans quoi un monde sans faune paierait quand même le vent
  // (« un banc de test ne tire RIEN », test A1), et l'ordre des tirages, dont
  // dépend tout le reste, changerait avec la météo.
  const slice = Math.floor(state.tick / HUNT.WIND_SHIFT_TICKS)
  const b = BEARINGS[Math.floor(hash2(state.seed, slice, 0x57494e44) * BEARINGS.length) % BEARINGS.length]!
  state.wind = { x: b[0], y: b[1] }
}

/** Les piles au sol PÉRISSENT (C18) : le monde ne se jonche pas. */
function advanceGroundItems(state: SimState): void {
  if (state.groundItems.length === 0) return
  state.groundItems = state.groundItems.filter((p) => p.expiresAt > state.tick && p.count > 0)
}

/** Le peuplement du tick : on efface ce que personne ne voit, on sème devant. */
export function advanceFauna(state: SimState, avatars: Entity[], byId: Map<number, Entity>): void {
  // LE SANG (C8-C11) : il draine, il sème, il tue. Avant toute décision de bête —
  // une bête qui succombe à sa plaie ce tick ne joue pas ce tick.
  advanceBlood(state, byId)
  advanceWind(state)
  advanceGroundItems(state)

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

/**
 * LE RETOUR AU PAYS (bug attrapé au banc, 2026-07-13).
 *
 * `stepStaysHome` refuse tout pas qui SORTIRAIT de l'habitat — mais pour une
 * bête DÉJÀ dehors, il refuse TOUT : sa tuile d'arrivée n'est jamais chez elle,
 * les deux sens du demi-tour échouent, et elle se fige à jamais. Un lapin jeté
 * en forêt restait planté là jusqu'à sa dissipation : 0,000 tuile en dix
 * secondes, mesuré au banc.
 *
 * Le bug dormait (la fuite s'arrêtait à quatorze tuiles, on sortait rarement de
 * son biome) ; LA FUITE ENGAGÉE l'a réveillé — on part maintenant à trente
 * tuiles, et la peur ne demande la permission à aucun terrain.
 *
 * La bête cherche donc sa tuile d'habitat la plus proche et y RENTRE. Sondage en
 * anneaux croissants, arithmétique pure, sans tirage. Rend `true` si elle a
 * consommé son tick (elle est dehors, et elle marche).
 */
function goHome(state: SimState, monster: Monster, entity: Entity): boolean {
  const tx = Math.floor(entity.x)
  const ty = Math.floor(entity.y)
  const home = inHabitat(state, monster.type, tx, ty)

  // LE RETOUR S'ENGAGE (même leçon que la cohésion et la séparation). Rendre la
  // main dès que `floor()` dit « habitat », c'est lâcher la bête PILE SUR LA
  // LISIÈRE — où le moindre pas de cohésion ou de séparation (qui ne connaissent
  // pas les biomes) la rejette dehors, et où `goHome` la rappelle aussitôt. Elle
  // danserait sur le bord. Elle rentre donc jusqu'au CŒUR de sa tuile, et c'est
  // seulement là qu'elle redevient une bête qui broute.
  if (home && !monster.homing) return false
  if (home && monster.homing) {
    const cx = Math.floor(entity.x) + 0.5
    const cy = Math.floor(entity.y) + 0.5
    if (distSq(entity.x, entity.y, cx, cy) <= FAUNA.HOMING_ARRIVE * FAUNA.HOMING_ARRIVE) {
      delete monster.homing
      return false
    }
    moveToward(state, monster, entity, cx, cy, false, FAUNA.WARY_SPEED)
    return true
  }

  monster.homing = true
  monster.wanderDx = 0
  monster.wanderDy = 0

  for (let r = 1; r <= FAUNA.HOMING_SEEK; r++) {
    let bestX = -1
    let bestY = -1
    let bestD = Infinity
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        // Le bord de l'anneau seulement : l'intérieur a été vu au tour d'avant.
        if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue
        const nx = tx + ox
        const ny = ty + oy
        if (!inHabitat(state, monster.type, nx, ny)) continue
        if (!TERRAINS[terrainAt(state.map, nx, ny)]?.walkable) continue
        const d = distSq(entity.x, entity.y, nx + 0.5, ny + 0.5)
        if (d < bestD || (d === bestD && (nx < bestX || (nx === bestX && ny < bestY)))) {
          bestD = d
          bestX = nx
          bestY = ny
        }
      }
    }
    if (bestX >= 0) {
      // Elle rentre au TROT : elle est en terrain découvert, exposée, et elle le sait.
      moveToward(state, monster, entity, bestX + 0.5, bestY + 0.5, false, FAUNA.WARY_SPEED)
      return true
    }
  }
  // Aucun habitat en vue (banc de test à carte uniforme) : qu'elle broute au
  // moins sur place plutôt que de rester une statue. On ne fige jamais une bête.
  delete monster.homing
  return false
}

/**
 * LA SENTINELLE d'une harde de GIBIER (spec faune R9bis / chasse C13) :
 * l'`entityId` de la bête de garde, ou −1 (harde trop petite, meute de
 * prédateurs). Le tour se DÉRIVE — rang dans la harde (ordre des `entityId`,
 * précédent : l'encerclement R11) + tick ÷ `SENTINEL_SHIFT` — zéro état
 * stocké, et le client (posture tête haute) calcule EXACTEMENT la même chose.
 */
export function sentinelOf(herd: Monster[], tick: number): number {
  if (herd.length < 3) return -1
  if (!isPrey(herd[0]!.type)) return -1
  const ids: number[] = []
  for (const m of herd) ids.push(m.entityId)
  ids.sort((a, b) => a - b)
  return ids[Math.floor(tick / FAUNA.SENTINEL_SHIFT) % ids.length]!
}

/** Les huit pas de grille — le cap de dérive d'une harde en choisit un par tranche. */
const DIRS8: readonly (readonly [-1 | 0 | 1, -1 | 0 | 1])[] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
]

/**
 * LA DÉRIVE DE PÂTURE (R9bis) : le cap de broutage partagé d'une harde, qui
 * tourne par tranches de temps. `hash2` et non le PRNG d'état : pur, zéro
 * tirage consommé — deux hardes voisines dérivent chacune de son côté, et le
 * replay n'y voit que du feu.
 */
function herdDrift(herdId: number, tick: number): readonly [-1 | 0 | 1, -1 | 0 | 1] {
  const slice = Math.floor(tick / FAUNA.DRIFT_SLICE_TICKS)
  return DIRS8[Math.floor(hash2(herdId, slice, 0x44524946) * DIRS8.length) % DIRS8.length]!
}

/**
 * LA MIGRATION DANS SON COIN (R17). Une bête qui appartient à un coin de chasse
 * ne dérive pas n'importe où : elle se donne, par tranches de temps, un BUT à
 * l'intérieur de son territoire — et elle y va. Le troupeau traverse donc sa
 * clairière, il ne quitte pas le canton.
 *
 * Le but est dérivé (`hash2` du coin, de la harde et de la tranche) : pur, zéro
 * tirage, et deux clients calculent le même. La bête solitaire (sanglier, lapin)
 * a le sien aussi — c'est SA place, pas celle d'un groupe.
 */
function migrationTarget(
  monster: Monster,
  tick: number,
): { x: number; y: number } | null {
  const gx = monster.groundX
  const gy = monster.groundY
  if (gx === undefined || gy === undefined) return null
  const slice = Math.floor(tick / FAUNA.MIGRATE_SLICE_TICKS)
  const key = monster.herdId ?? monster.entityId
  // Un point du disque du coin, tiré par rejet dans un carré (pas de trigo,
  // invariant §2) — on prend le premier acceptable, la boucle est bornée.
  const reach = FAUNA.GROUND_RADIUS * FAUNA.MIGRATE_REACH
  for (let k = 0; k < 6; k++) {
    const ox = (hash2(key * 7 + k, slice, 0x4d475831) * 2 - 1) * reach
    const oy = (hash2(key * 7 + k, slice, 0x4d475832) * 2 - 1) * reach
    if (ox * ox + oy * oy <= reach * reach) return { x: gx + ox, y: gy + oy }
  }
  return { x: gx, y: gy } // au pire : le cœur du coin
}

/**
 * LA SÉPARATION (R9bis) — LA SOMME DES RÉPULSIONS, pas la plus proche voisine.
 *
 * Repousser seulement la plus proche donne un BILLARD : en s'écartant de B, la
 * bête se rapproche de C ; au tick suivant elle s'écarte de C et revient sur B.
 * Avec cinq bêtes entassées, ça frémit sans fin (mesuré : 2,5× l'errance
 * normale). La somme des répulsions, elle, pointe vers l'EXTÉRIEUR du groupe —
 * une direction stable, qui résout tout le voisinage d'un coup. C'est la règle
 * des boids, et elle n'est pas décorative : c'est ce qui rend la foule calme.
 *
 * Rend le vecteur unitaire de fuite (ou `null` si personne ne gêne), et la
 * distance au voisin le plus proche — dont dépend l'hystérésis.
 */
function separationPush(
  herd: Monster[],
  monster: Monster,
  entity: Entity,
  byId: Map<number, Entity>,
  radius: number,
): { push: { x: number; y: number } | null; nearestSq: number } {
  let px = 0
  let py = 0
  let n = 0
  let nearestSq = Infinity
  for (const other of herd) {
    if (other.entityId === monster.entityId) continue
    const e = byId.get(other.entityId)
    if (!e || e.hp <= 0) continue
    const d2 = distSq(entity.x, entity.y, e.x, e.y)
    if (d2 < nearestSq) nearestSq = d2
    if (d2 >= radius * radius) continue
    const d = Math.sqrt(d2)
    if (d < 0.001) {
      // Deux bêtes exactement superposées : il faut bien choisir un sens, et il
      // doit être le MÊME sur toutes les machines — l'ordre des `entityId` tranche.
      px += monster.entityId < other.entityId ? 1 : -1
      n++
      continue
    }
    // Plus la voisine est près, plus elle pousse fort : c'est ce qui empêche la
    // somme de s'annuler bêtement au milieu d'un groupe symétrique.
    const w = radius / d
    px += ((entity.x - e.x) / d) * w
    py += ((entity.y - e.y) / d) * w
    n++
  }
  if (n === 0) return { push: null, nearestSq }
  const l = Math.sqrt(px * px + py * py)
  if (l < 0.001) return { push: null, nearestSq }
  return { push: { x: px / l, y: py / l }, nearestSq }
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

function graze(
  state: SimState,
  monster: Monster,
  entity: Entity,
  center: { x: number; y: number } | null,
  /** De garde (R9bis) : elle ne broute pas, elle VEILLE. */
  sentinel = false,
): void {
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
  // minute et n'est plus une harde. Encore MÉFIANTE (retombée de fuite, R6),
  // elle revient au TROT : le regroupement d'après-alerte est pressé. Elle passe
  // AVANT la garde : une sentinelle que la dérive a semée recolle D'ABORD, puis
  // veille — sans quoi elle ancrait la harde et le troupeau s'étirait en élastique.
  //
  // LE RAPPEL EST COLLANT (playtest : « des cerfs qui TREMBLENT en pâturant »).
  // Sans hystérésis, la bête franchissait HERD_SPREAD, se faisait rappeler d'un
  // pas, repassait sous le seuil — et RESSORTAIT aussitôt, parce que son cap
  // d'errance pointait toujours dehors. Deux à trois allers-retours par seconde :
  // un tremblement. Le rappel se déclenche donc à `HERD_SPREAD` mais ne lâche
  // qu'à `HERD_COMFORT` — exactement comme la peur, qui se déclenche à
  // `flightRange` et ne retombe qu'à `SAFE_RANGE`. Et il LÂCHE LE CAP : une bête
  // qu'on ramène ne repart pas d'où elle vient à la seconde où on la lâche.
  if (center) {
    const dx = center.x - entity.x
    const dy = center.y - entity.y
    const d2 = dx * dx + dy * dy
    if (!monster.regrouping && d2 > FAUNA.HERD_SPREAD * FAUNA.HERD_SPREAD) {
      monster.regrouping = true
      monster.wanderDx = 0
      monster.wanderDy = 0
    } else if (monster.regrouping && d2 < FAUNA.HERD_COMFORT * FAUNA.HERD_COMFORT) {
      delete monster.regrouping
    }
    if (monster.regrouping) {
      const pace = monster.suspicion >= HUNT.SUSPICION_CURIOUS ? FAUNA.WARY_SPEED : FAUNA.GRAZE_SPEED
      moveToward(state, monster, entity, center.x, center.y, false, pace)
      return
    }
  } else {
    delete monster.regrouping
  }

  // LA SENTINELLE (R9bis) : tête haute, immobile, et son regard BALAIE les
  // relèvements. C'est la bête qu'il faut lire pour approcher la harde — on
  // avance quand la garde regarde ailleurs.
  if (sentinel) {
    monster.wanderDx = 0
    monster.wanderDy = 0
    const b = BEARINGS[Math.floor(state.tick / FAUNA.SENTINEL_SWEEP_TICKS) % BEARINGS.length]!
    entity.facing = { x: b[0], y: b[1] }
    return
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
      // Elle repart, ou elle vire — et elle suit LE CAP PARTAGÉ plus souvent que
      // le hasard (LA DÉRIVE DE PÂTURE, R9bis) : c'est lui qui fait traverser le
      // paysage au troupeau au lieu de trembler sur place. Sinon (cas restant)
      // elle GARDE son cap — et c'est cette persistance qui fait une déambulation
      // plutôt qu'un tremblement.
      //
      // MAIS ELLE EST D'UN COIN (R17) : le cap ne vise plus une direction en
      // l'air, il vise un BUT DANS SON TERRITOIRE — un point de sa clairière,
      // qui change par tranches de temps. Le troupeau MIGRE dans son canton ;
      // il ne s'en va pas. C'est ce qui fait qu'on retrouve les cerfs au même
      // endroit demain — et c'est toute la différence entre un gibier de
      // territoire et un gibier de brouillard.
      const goal = migrationTarget(monster, state.tick)
      if (goal && roll(state) < FAUNA.DRIFT_BIAS) {
        const dx = goal.x - entity.x
        const dy = goal.y - entity.y
        monster.wanderDx = (dx > 0.5 ? 1 : dx < -0.5 ? -1 : 0) as -1 | 0 | 1
        monster.wanderDy = (dy > 0.5 ? 1 : dy < -0.5 ? -1 : 0) as -1 | 0 | 1
      } else if (monster.herdId !== undefined && roll(state) < FAUNA.DRIFT_BIAS) {
        const d = herdDrift(monster.herdId, state.tick)
        monster.wanderDx = d[0]
        monster.wanderDy = d[1]
      } else {
        monster.wanderDx = (Math.floor(roll(state) * 3) - 1) as -1 | 0 | 1
        monster.wanderDy = (Math.floor(roll(state) * 3) - 1) as -1 | 0 | 1
      }
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

/* ── L'APPÂT et LES PILES AU SOL (spec chasse C18) ────────────────────────── */

/** Ce que le GIBIER vient manger au sol (l'appât du chasseur). */
const BAIT_ITEMS: readonly ItemId[] = ['berries', 'raw_meat', 'cooked_meat', 'stew']
/** Ce qu'un PRÉDATEUR vient manger au sol — la viande, et rien d'autre. */
const CARRION_ITEMS: readonly ItemId[] = ['raw_meat', 'cooked_meat']

/** La pile au sol la plus proche qui porte un de ces items. */
function nearestPile(
  state: SimState,
  entity: Entity,
  range: number,
  wanted: readonly ItemId[],
): { id: number; x: number; y: number } | undefined {
  let best: { id: number; x: number; y: number } | undefined
  let bestD = range * range
  for (const p of state.groundItems) {
    if (p.count <= 0 || !wanted.includes(p.item)) continue
    const d = distSq(entity.x, entity.y, p.x, p.y)
    if (d < bestD || (d === bestD && best && p.id < best.id)) {
      best = { id: p.id, x: p.x, y: p.y }
      bestD = d
    }
  }
  return best
}

/**
 * L'APPÂT (C18). Le gibier vient à la nourriture posée, s'y plante, et mange —
 * tête baissée, portées effondrées (`BAIT_ALERTNESS`). C'est LA FENÊTRE DU
 * CHASSEUR, et c'est lui qui l'ouvre : la chasse cesse d'être subie.
 *
 * Rend `true` s'il a consommé son tick.
 */
function baitStep(state: SimState, monster: Monster, entity: Entity): boolean {
  // Il mange : il ne fait rien d'autre, et il est parfaitement approchable.
  if (monster.baitUntil !== undefined) {
    if (state.tick < monster.baitUntil) {
      monster.wanderDx = 0
      monster.wanderDy = 0
      return true
    }
    // Le repas est fini : la pile est entamée d'une unité.
    const pile = state.groundItems.find((p) => p.id === monster.baitId)
    if (pile) {
      pile.count -= 1
      if (pile.count <= 0) state.groundItems = state.groundItems.filter((p) => p.id !== pile.id)
    }
    delete monster.baitUntil
    delete monster.baitId
    return true
  }

  if (state.groundItems.length === 0) return false
  const pile = nearestPile(state, entity, HUNT.BAIT_SEEK, BAIT_ITEMS)
  if (!pile) return false

  if (distSq(entity.x, entity.y, pile.x, pile.y) <= HUNT.BAIT_RANGE * HUNT.BAIT_RANGE) {
    monster.baitUntil = state.tick + HUNT.BAIT_TICKS
    monster.baitId = pile.id
    monster.wanderDx = 0
    monster.wanderDy = 0
    return true
  }
  moveToward(state, monster, entity, pile.x, pile.y, false, FAUNA.WARY_SPEED)
  return true
}

/**
 * LE TERRIER (spec chasse C16). Le lapin naît avec le sien — sa tuile de
 * naissance, hors champ par construction (R1). Levé, il ne fuit pas « à
 * l'opposé » : il fuit CHEZ LUI, et il y disparaît.
 *
 * La seule condition : ne pas passer PAR la menace pour y aller (il n'est pas
 * suicidaire). Un chasseur qui se place SUR la ligne du terrier force donc un
 * détour — et c'est tout le jeu : la chasse au lapin devient une géométrie.
 *
 * Rend `true` s'il a consommé son tick (il court chez lui, ou il vient d'y entrer).
 */
function burrowRun(state: SimState, monster: Monster, entity: Entity, threatX: number, threatY: number): boolean {
  const bx = monster.burrowX
  const by = monster.burrowY
  if (bx === undefined || by === undefined) return false

  // La menace est-elle SUR le chemin ? (Elle barre la route si elle est du même
  // côté que le terrier — produit scalaire — et pas plus loin que lui.)
  let hx = bx - entity.x
  let hy = by - entity.y
  const hl = Math.sqrt(hx * hx + hy * hy)
  if (hl < 0.001) return false
  hx /= hl
  hy /= hl
  const mx = threatX - entity.x
  const my = threatY - entity.y
  const ml = Math.sqrt(mx * mx + my * my)
  if (ml > 0.001) {
    const dot = (mx / ml) * hx + (my / ml) * hy
    if (dot > 0.6 && ml < hl) return false // le chasseur COUPE la ligne : détour
  }

  // Il y est : il rentre. Le client dessine le trou — ce n'est pas le décor qui
  // avoue, c'est le lapin qui rentre chez lui, et c'est une CHASSE PERDUE.
  if (hl <= HUNT.BURROW_RANGE) {
    emitEvent(state, { type: 'prey_escaped', tick: state.tick, monsterType: monster.type, x: entity.x, y: entity.y })
    state.monsters = state.monsters.filter((m) => m.entityId !== monster.entityId)
    state.entities = state.entities.filter((e) => e.id !== monster.entityId)
    return true
  }

  moveToward(state, monster, entity, bx, by, false, FAUNA.FLEE_SPRINT * woundedSlow(monster, entity))
  return true
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
    delete monster.fleeFromX
    delete monster.fleeFromY
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
  // LA GARDE (R9bis) : la sentinelle voit plus loin, les brouteuses relâchent.
  const sentinel = herd !== undefined && sentinelOf(herd, state.tick) === monster.entityId
  const watch = sentinel ? FAUNA.SENTINEL_ACUITY : herd !== undefined && isPrey(monster.type) ? FAUNA.HERD_RELAX : 1
  // Les têtes baissées (chasse C11/C18) : la bête TAPIE à bout de sang, et celle
  // qui MANGE un appât, ne voient plus grand-chose. Ce sont deux fenêtres que le
  // chasseur a lui-même ouvertes — l'une par son coup, l'autre par sa main.
  const headDown =
    monster.rootUntil !== undefined ? FAUNA.ROOT_ALERTNESS
    : monster.bedded ? HUNT.BED_ALERTNESS
    : monster.baitUntil !== undefined ? HUNT.BAIT_ALERTNESS
    : 1
  const alertness = headDown * watch
  const alertRange = (def.alertRange ?? 0) * alertness
  const flightRange = (def.flightRange ?? 0) * alertness
  // Le plafond de perception (chasse C1) : au-delà, rien ne monte — mais on
  // regarde jusqu'à SAFE_RANGE, car une bête en fuite surveille plus loin.
  const perceiveRange = alertRange * HUNT.PERCEIVE_FACTOR
  // Le NEZ porte un peu plus loin que l'œil (SCENT_RANGE_FACTOR) : on élargit la
  // fenêtre de recherche en conséquence, sinon la menace au vent ne serait même
  // pas EXAMINÉE — et le vent (C17) n'existerait qu'à courte portée.
  const spotted = nearestThreat(
    threats,
    entity,
    Math.max(perceiveRange * HUNT.SCENT_RANGE_FACTOR, FAUNA.SAFE_RANGE),
    state.wind,
  )
  const seen = spotted?.e

  // LA CONTAGION D'ALARME (R9). Il suffit qu'UNE bête de la harde vous repère
  // pour que toutes partent — même celles qui n'ont rien vu. Et elle transmet
  // LE POINT DE PEUR (R9bis) : toute la harde fuira le même lieu, ensemble.
  let alarmed = false
  let alarmFromX: number | undefined
  let alarmFromY: number | undefined
  if (herd) {
    for (const other of herd) {
      if (other.entityId === monster.entityId || other.fleeSince < 0) continue
      const oe = byId.get(other.entityId)
      if (!oe) continue
      if (distSq(entity.x, entity.y, oe.x, oe.y) <= FAUNA.HERD_ALARM_RADIUS * FAUNA.HERD_ALARM_RADIUS) {
        alarmed = true
        alarmFromX = other.fleeFromX ?? oe.x
        alarmFromY = other.fleeFromY ?? oe.y
        break
      }
    }
  }

  // LA MÉFIANCE (chasse C1) : la jauge poursuit le stimulus. C'est elle — et
  // plus un rayon — qui décide de la suite. Un coup reçu (hunted) ou l'alarme
  // d'un congénère la saturent d'office.
  updateSuspicion(state, monster, spotted, perceiveRange, flightRange, hunted || alarmed)

  // L'ESPACE VITAL (R6bis). Une menace REPÉRÉE (jauge ≥ alerte) à bout portant :
  // levée, immobile ou pas — un cerf ne broute pas à trois mètres d'une
  // silhouette identifiée. C'est le correctif du joueur AFK encerclé de statues.
  // Réservé au gibier qui FUIT : le trop-près du sanglier, c'est la MENACE (R14).
  if (
    (def.flightRange ?? 0) > 0 &&
    spotted !== undefined &&
    monster.suspicion >= HUNT.SUSPICION_ALERT &&
    spotted.rawSq <= FAUNA.PERSONAL_SPACE * FAUNA.PERSONAL_SPACE
  ) {
    monster.suspicion = 1
  }

  // LA LEVÉE (R6) : l'engagement commence, et il mémorise D'OÙ vient la peur —
  // la menace vue, ou le lieu transmis par le cri de mort / la contagion.
  if (monster.fleeSince < 0 && (hunted || alarmed || monster.suspicion >= 1)) {
    monster.fleeSince = state.tick
    monster.suspicion = 1
    if (monster.fleeFromX === undefined) {
      const fx = hunted ? attacker.x : seen ? seen.x : alarmFromX
      const fy = hunted ? attacker.y : seen ? seen.y : alarmFromY
      monster.fleeFromX = fx ?? entity.x
      monster.fleeFromY = fy ?? entity.y
    }
  }

  // LA FUITE ENGAGÉE (R6). Une bête levée part LOIN : jusqu'à FLEE_GOAL de son
  // point de peur, menace visible ou pas (borne dure pour la bête acculée).
  // Plus de « je m'arrête à quatorze tuiles et je rebroute » : le playtest
  // rattrapait un cerf à la course, aucun cerf du monde n'accorde ça.
  if (monster.fleeSince >= 0) {
    monster.suspicion = 1
    const fromX = monster.fleeFromX ?? entity.x
    const fromY = monster.fleeFromY ?? entity.y
    const timeout = state.tick - monster.fleeSince > FAUNA.FLEE_MAX_TICKS
    const farFromFear = distSq(entity.x, entity.y, fromX, fromY) >= FAUNA.FLEE_GOAL * FAUNA.FLEE_GOAL
    // La menace COLLE encore ? Le point de peur se RÉ-ANCRE sur elle : le but
    // n'est pas d'être loin d'un souvenir, c'est d'être loin du DANGER. Sans ce
    // ré-ancrage, la bête marquait sa retombée en pleine poursuite — et le
    // sprinteur regagnait à chaque pause tout ce que le surrégime avait creusé.
    const safeSq2 = FAUNA.SAFE_RANGE * FAUNA.SAFE_RANGE
    const threatNear =
      (hunted && distSq(entity.x, entity.y, attacker.x, attacker.y) <= safeSq2) ||
      (spotted !== undefined && spotted.effSq <= safeSq2)
    if (farFromFear && threatNear && !timeout) {
      monster.fleeFromX = hunted ? attacker.x : seen!.x
      monster.fleeFromY = hunted ? attacker.y : seen!.y
    }
    const done = timeout || (farFromFear && !threatNear)
    if (!done) {
      // On fuit toujours QUELQUE CHOSE : la menace du moment, sinon le point de peur.
      const tx = hunted ? attacker.x : seen ? seen.x : fromX
      const ty = hunted ? attacker.y : seen ? seen.y : fromY
      // LE SOUFFLE EST UN LUXE DE LA MARGE (R6) : serrée de près (au PERÇU —
      // un chasseur qui se fige pendant qu'elle souffle redevient presque
      // invisible), pas de pause. Les à-coups ne reprennent qu'avec du champ.
      const gapSq = FAUNA.BREATHE_GAP * FAUNA.BREATHE_GAP
      const pressed =
        (hunted && distSq(entity.x, entity.y, attacker.x, attacker.y) <= gapSq) ||
        (spotted !== undefined && spotted.effSq <= gapSq)
      const phase = (state.tick - monster.fleeSince) % (FAUNA.BURST_RUN_TICKS + FAUNA.BURST_PAUSE_TICKS)
      if (phase < FAUNA.BURST_RUN_TICKS || pressed) {
        // LE TERRIER (chasse C16). Le lapin ne fuit pas « à l'opposé » : il fuit
        // CHEZ LUI. Sauf à devoir traverser la menace pour y aller — auquel cas
        // il n'est pas suicidaire. Atteint, il disparaît (plus bas). La chasse au
        // lapin devient une géométrie : COUPER LA LIGNE DU TERRIER, ou le perdre.
        const burrow = burrowRun(state, monster, entity, tx, ty)
        if (burrow) return

        // LA FUITE EN TROUPEAU (R9bis) : l'axe « loin de la peur », infléchi
        // vers les siens quand on s'écarte — ils partent ENSEMBLE, en SURRÉGIME
        // (FLEE_SPRINT : plus vite qu'un sprint de joueur, toujours).
        let dx = entity.x - tx
        let dy = entity.y - ty
        const len = Math.sqrt(dx * dx + dy * dy)
        if (len > 0.001) {
          dx /= len
          dy /= len
        } else {
          dx = 1
          dy = 0
        }

        // LA SCISSION (chasse C14). Une harde levée ÉCLATE EN DEUX : les rangs
        // pairs infléchissent d'un côté, les impairs de l'autre. Le chasseur qui
        // charge « la harde » court entre deux moitiés et n'a rien — ON CHOISIT
        // SA BÊTE AVANT DE LEVER LE GROUPE. (Rotation ±45°, coefficients
        // littéraux : pas de trigo, invariant §2.)
        //
        // Et c'est la MOITIÉ, pas la harde, qui devient l'unité de cohésion en
        // course (voir plus bas) : sans ça, la scission et le grégarisme se
        // battaient — chacun tirait la bête de son côté, et le troupeau
        // s'étirait en accordéon au lieu de se fendre en deux. La harde fuit le
        // MÊME point (R9bis), en DEUX groupes qui tiennent (C14).
        let half: Monster[] | undefined
        if (herd && herd.length >= 2) {
          let rank = 0
          for (const other of herd) if (other.entityId < monster.entityId) rank++
          const side = rank % 2 === 0 ? 1 : -1
          const s = side * HUNT.SPLIT_SIN
          const c = HUNT.SPLIT_COS
          const rx = dx * c - dy * s
          const ry = dx * s + dy * c
          dx = rx
          dy = ry
          half = herd.filter((o) => {
            let r = 0
            for (const other of herd) if (other.entityId < o.entityId) r++
            return (r % 2 === 0 ? 1 : -1) === side
          })
        }

        // LE CROCHET (chasse C15). En terrain DÉCOUVERT, la bête jinke : à chaque
        // burst, son cap tourne de ±40°. Courir droit derrière ne marche plus ;
        // anticiper et couper, si. En COUVERT, elle file tout droit — le terrain
        // décide du geste. Le sanglier ne jinke jamais (`jink: 0`) : il ne
        // zigzague pas, il se retourne.
        const jink = MONSTER_DEFS[monster.type].jink ?? 0
        if (jink > 0 && coverAt(state, entity.x, entity.y) >= HUNT.JINK_OPEN_COVER && phase === 0) {
          // Le sens du crochet est tiré au dé, une fois par burst — c'est ce qui
          // le rend imprévisible sans le rendre erratique.
          const s = (roll(state) < 0.5 ? 1 : -1) * HUNT.JINK_SIN * jink
          const c = 1 - (1 - HUNT.JINK_COS) * jink
          const rx = dx * c - dy * s
          const ry = dx * s + dy * c
          const l = Math.max(0.001, Math.sqrt(rx * rx + ry * ry))
          monster.jinkDx = rx / l
          monster.jinkDy = ry / l
        }
        if (monster.jinkDx !== undefined && monster.jinkDy !== undefined) {
          dx = monster.jinkDx
          dy = monster.jinkDy
        }

        // LA COHÉSION EN COURSE : trop écartée de SA MOITIÉ, elle recolle en
        // fuyant. Les deux groupes divergent ; chacun tient.
        const center = half ? herdCenter(half, monster, byId) : null
        if (center) {
          const cx = center.x - entity.x
          const cy = center.y - entity.y
          if (cx * cx + cy * cy > FAUNA.HERD_SPREAD * FAUNA.HERD_SPREAD) {
            const cl = Math.sqrt(cx * cx + cy * cy)
            dx += (cx / cl) * 0.35
            dy += (cy / cl) * 0.35
            const l2 = Math.max(0.001, Math.sqrt(dx * dx + dy * dy))
            dx /= l2
            dy /= l2
          }
        }
        // LA BÊTE DIMINUÉE (chasse C10) : le sang lui coûte sa vitesse. C'est ce
        // qui rend la traque gagnable — l'écart se referme à mesure qu'elle s'épuise.
        moveToward(state, monster, entity, entity.x + dx, entity.y + dy, false, FAUNA.FLEE_SPRINT * woundedSlow(monster, entity))
      }
      return
    }
    delete monster.jinkDx
    delete monster.jinkDy
    // LA RETOMBÉE MÉFIANTE (R6) : loin du point de peur, mais pas sereine —
    // jauge au seuil d'alerte, nervosité au plafond. Elle trotte, rejoint les
    // siens (le regroupement, R9bis, vit dans la cohésion de `graze`), et le
    // broutage se regagne à la décrue.
    monster.fleeSince = -1
    delete monster.fleeFromX
    delete monster.fleeFromY
    monster.suspicion = HUNT.SUSPICION_ALERT
    monster.nervous = HUNT.NERVOUS_MAX
  }
  monster.lastAttackerId = null

  // LE SANGLIER (R14) : fouir, menacer, charger, souffler. Il ne fuit pas — il
  // décide. Sa machine prime sur l'alerte et le broutage, et c'est pour ça
  // qu'elle est interrogée ICI : après la fuite (blessé, il fuit ou il charge)
  // mais avant tout le reste.
  if (monster.type === 'boar' && boarStep(state, monster, entity, seen, alertness)) return

  // LE COUCHÉ (chasse C11) : à bout de sang et qu'on ne presse plus, elle gagne
  // le meilleur couvert et s'y tapit. On la retrouve PAR LE SANG — et attendre
  // devient l'autre stratégie du chasseur. (Mais le sang appelle d'autres nez.)
  const threatened = hunted || (seen !== undefined && monster.suspicion >= HUNT.SUSPICION_CURIOUS)
  if (bedStep(state, monster, entity, threatened)) return

  // L'APPÂT (chasse C18) : la nourriture qu'un chasseur a POSÉE. Elle y va, elle
  // mange, elle ne voit plus rien — la fenêtre du chasseur, ouverte de sa main.
  if (!threatened && baitStep(state, monster, entity)) return

  // L'IMPATIENCE (R6bis) : alertée trop longtemps face à une menace plantée là,
  // la bête ne reste pas statue — elle tape du sabot, fixe, puis S'ÉCARTE au
  // trot jusqu'à retomber sous le seuil. (Gibier qui fuit seulement : le
  // sanglier, lui, ne recule pas.)
  if (
    (def.flightRange ?? 0) > 0 &&
    seen !== undefined &&
    monster.suspicion >= HUNT.SUSPICION_ALERT &&
    monster.alertSince !== undefined &&
    state.tick - monster.alertSince > FAUNA.IMPATIENCE_TICKS
  ) {
    moveToward(state, monster, entity, seen.x, seen.y, true, FAUNA.WARY_SPEED)
    return
  }

  // CURIEUSE ou ALERTÉE : la bête se fige et REGARDE — son regard se tourne vers
  // la menace, et c'est lisible. Le joueur sait qu'il a été vu, et sait qu'un pas
  // de plus fera monter la jauge — « annoncés, pas surprises » (GDD §9bis).
  // C'est ici que le STOP-AND-GO se joue : se figer maintenant fait redescendre
  // la jauge, et l'approche peut reprendre.
  if (seen && monster.suspicion >= HUNT.SUSPICION_CURIOUS) {
    monster.wanderDx = 0
    monster.wanderDy = 0
    const d = Math.sqrt(distSq(entity.x, entity.y, seen.x, seen.y))
    if (d > 0) entity.facing = { x: (seen.x - entity.x) / d, y: (seen.y - entity.y) / d }
    return
  }

  // LE RETOUR AU PAYS. La fuite ne demande la permission à aucun terrain : une
  // bête peut se réveiller à trente tuiles de chez elle, dans un biome qui n'est
  // pas le sien. Elle rentre — avant même de songer à dormir ou à brouter.
  if (goHome(state, monster, entity)) return

  // LE RETOUR AU TERRITOIRE (R17). La fuite engagée (30 tuiles) peut la jeter
  // HORS de son coin de chasse. Elle y revient — au trot, et sans traîner : un
  // gibier qui déserterait son canton à chaque frayeur ferait de la carte un
  // brouillard mouvant, et le chasseur ne pourrait rien apprendre.
  if (monster.groundX !== undefined && monster.groundY !== undefined) {
    const away = distSq(entity.x, entity.y, monster.groundX, monster.groundY)
    if (away > FAUNA.GROUND_RADIUS * FAUNA.GROUND_RADIUS) {
      moveToward(state, monster, entity, monster.groundX, monster.groundY, false, FAUNA.WARY_SPEED)
      return
    }
  }

  // Hors de ses heures, la bête se couche (R10) — et elle se couche AVEC les
  // siens (LE REPOS GROUPÉ, R9bis) : écartée, elle revient d'abord, puis dort.
  // Elle reste réveillable — les branches ci-dessus (fuir, s'alerter) sont
  // passées AVANT : un dormeur qu'on approche détale quand même.
  if (isResting(monster.type, hour)) {
    monster.wanderDx = 0
    monster.wanderDy = 0
    const center = herd ? herdCenter(herd, monster, byId) : null
    if (center && distSq(entity.x, entity.y, center.x, center.y) > FAUNA.REST_SPREAD * FAUNA.REST_SPREAD) {
      moveToward(state, monster, entity, center.x, center.y, false, FAUNA.GRAZE_SPEED)
    }
    return
  }

  // LA SÉPARATION (R9bis) : on ne broute pas les uns SUR les autres — deux
  // bêtes trop proches s'écartent d'un pas avant toute autre envie.
  //
  // COLLANTE, elle aussi (même leçon que la cohésion) : elle se déclenche à
  // `HERD_SEPARATION` et ne lâche qu'à `HERD_SEPARATION_COMFORT`. Un seuil unique
  // relâchait la bête à un cheveu du contact — son cap d'errance la ramenait sur
  // sa voisine au tick suivant, et les deux se repoussaient encore. Tout seuil qui
  // commande un mouvement veut son hystérésis, sinon il oscille.
  if (herd) {
    // Tant qu'elle s'écarte, elle vise le CONFORT (1,9) — pas le seuil (1,2) :
    // c'est l'hystérésis, et c'est elle qui fait qu'on ne relâche pas la bête à
    // un cheveu du contact.
    const radius = monster.separating ? FAUNA.HERD_SEPARATION_COMFORT : FAUNA.HERD_SEPARATION
    const { push, nearestSq } = separationPush(herd, monster, entity, byId, radius)
    if (!monster.separating && nearestSq < FAUNA.HERD_SEPARATION * FAUNA.HERD_SEPARATION) {
      monster.separating = true
      monster.wanderDx = 0
      monster.wanderDy = 0
    } else if (monster.separating && nearestSq >= FAUNA.HERD_SEPARATION_COMFORT * FAUNA.HERD_SEPARATION_COMFORT) {
      delete monster.separating
    }
    if (push && monster.separating) {
      moveToward(state, monster, entity, entity.x + push.x, entity.y + push.y, false, FAUNA.GRAZE_SPEED)
      return
    }
  }

  graze(state, monster, entity, herd ? herdCenter(herd, monster, byId) : null, sentinel)
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

  // Un sanglier qui MENACE est un sanglier ALERTÉ (chasse C6) : il vous fixe.
  // Plus de coup propre sur lui — sa fenêtre à lui, c'était la fouille.
  monster.suspicion = Math.max(monster.suspicion, HUNT.SUSPICION_ALERT)
  if (monster.alertSince === undefined) monster.alertSince = state.tick

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

    // Le repas est fini : la carcasse (ou la pile jetée) est entamée, et il est repu.
    const meal = state.corpses.find((c) => c.id === monster.mealCorpseId)
    if (meal) {
      // Une bouchée de moins de VIANDE : le prédateur ne consomme que ça. On
      // n'efface la carcasse que si elle ne porte plus RIEN — sinon elle demeure
      // comme conteneur lootable (le bois et les outils d'un mort mixte ne sont
      // pas mangés, donc pas détruits : critère de conservation A21).
      removeItems(meal.inventory, { raw_meat: 1 })
      if (isEmpty(meal.inventory)) {
        state.corpses = state.corpses.filter((c) => c.id !== meal.id)
      }
    }
    // LA VIANDE JETÉE (chasse C18) : le geste que faune R15 promettait et qu'on
    // ne pouvait pas exécuter — jeter de la viande à une meute qui vous serre,
    // c'est lui donner autre chose à faire (GDD §9bis).
    const pile = state.groundItems.find((p) => p.id === monster.baitId)
    if (pile) {
      pile.count -= 1
      if (pile.count <= 0) state.groundItems = state.groundItems.filter((p) => p.id !== pile.id)
    }
    delete monster.eatingUntil
    delete monster.mealCorpseId
    delete monster.baitId
    monster.satedUntil = state.tick + FAUNA.SATED_TICKS
    return true
  }

  if (monster.satedUntil !== undefined && state.tick < monster.satedUntil) return false // repu : rien à manger de plus
  delete monster.satedUntil

  // LE SANG APPELLE (chasse C12). Une carcasse FRAÎCHE porte BIEN plus loin
  // qu'une vieille : `CARCASS_SEEK_FRESH` (40) contre `CARCASS_SEEK` (16). Mis
  // bout à bout avec le portage — qui interdit le silence (C2) —, TUER ARME UN
  // MINUTEUR : on tue, on charge la viande… et on entend le hurlement.
  let best: { id: number; x: number; y: number; pile: boolean } | undefined
  let bestD = Infinity
  for (const c of state.corpses) {
    if (countOf(c.inventory, 'raw_meat') <= 0) continue
    const fresh = state.tick - c.diedAt < HUNT.CARCASS_FRESH_TICKS
    const reach = fresh ? HUNT.CARCASS_SEEK_FRESH : FAUNA.CARCASS_SEEK
    const d = distSq(entity.x, entity.y, c.x, c.y)
    if (d > reach * reach) continue
    if (d < bestD || (d === bestD && best && c.id < best.id)) {
      best = { id: c.id, x: c.x, y: c.y, pile: false }
      bestD = d
    }
  }

  // Et LA PILE DE VIANDE jetée au sol vaut une carcasse — c'est tout le sens du
  // geste : elle le détourne de VOUS. (Les ids de piles et de cadavres vivent
  // dans deux registres : le drapeau `pile` dit lequel, et il ne faut surtout
  // pas les confondre — `mealCorpseId` pointerait dans le vide.)
  const thrown = nearestPile(state, entity, HUNT.CARCASS_SEEK_FRESH, CARRION_ITEMS)
  if (thrown) {
    const d = distSq(entity.x, entity.y, thrown.x, thrown.y)
    if (!best || d < bestD) {
      best = { ...thrown, pile: true }
      bestD = d
    }
  }
  if (!best) return false

  if (bestD <= FAUNA.EAT_RANGE * FAUNA.EAT_RANGE) {
    monster.eatingUntil = state.tick + FAUNA.EAT_TICKS
    if (best.pile) monster.baitId = best.id
    else monster.mealCorpseId = best.id
    monster.targetId = null
    monster.stalking = false
    // Tête dans la carcasse : il baisse la garde (R15 : « parfaitement
    // vulnérable ») — un coup porté maintenant est PROPRE (chasse C6).
    delete monster.alertSince
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
  /** La furtivité des avatars (chasse C5) — le loup acquiert à la distance PERÇUE. */
  stealthOf: (e: Entity) => number,
): void {
  const def = MONSTER_DEFS.wolf
  const pack = monster.herdId !== undefined ? herds.get(monster.herdId) : undefined

  // 1. LA ROMPUE. Blessé au-delà du seuil — ou en déroute — il décroche, et rien
  //    ne le ramène tant qu'il n'est pas loin. Un loup ne se sacrifie pas.
  const broken = entity.hp < maxHpOf(monster) * FAUNA.PACK_BREAK_HP
  if (broken || monster.routed) {
    // Un loup qui rompt vous a VU : il n'est plus à surprendre (chasse C6).
    if (monster.alertSince === undefined) monster.alertSince = state.tick
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
      delete monster.alertSince // repu et tranquille : il baisse la garde (C6)
      if (goHome(state, monster, entity)) return
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
  //
  // L'HEURE DU LOUP (R10bis) : sa VIGUEUR pondère ce qu'il ose. À midi il est
  // assoupi et ne voit venir qu'à six tuiles ; à 3 h du matin, il rend ses
  // treize. R10 couchait le gibier hors de ses heures et laissait le prédateur
  // chasser à pleine portée jour et nuit — la nuit n'y gagnait rien.
  const vigor = wolfVigor(hour)
  monster.targetId =
    chooseQuarry(state, monster, entity, quarry, def.aggroRange * vigor, isAvatar, stealthOf, monsterByEntity, vigor) ??
    packQuarry(state, pack, monster, entity, byId, isAvatar, vigor)
  const target = monster.targetId !== null ? byId.get(monster.targetId) : undefined

  if (target && target.hp > 0) {
    // Une cible prise : le loup est ENGAGÉ — plus de coup propre sur lui (C6).
    if (monster.alertSince === undefined) monster.alertSince = state.tick
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
  // Retour à la patrouille : la garde retombe — un loup qui ne chasse rien
  // redevient approchable (C6), et c'est toute la décision n°1 de la spec :
  // la mise à mort propre vaut aussi sur les prédateurs.
  if (!monster.routed) delete monster.alertSince

  // 5. Rien à chasser. Il rentre chez lui s'il en est sorti ; hors de ses heures,
  //    il dort ; sinon il patrouille avec les siens (la meute reste groupée).
  if (goHome(state, monster, entity)) return
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
/**
 * LA VIGUEUR DU LOUP (spec faune R10bis) : ce qu'il ose, à cette heure. Elle
 * multiplie ses portées d'acquisition ET de poursuite. Plancher non nul : une
 * meute de plein jour reste dangereuse à qui lui marche dessus — on incline le
 * monde, on ne pose pas un interrupteur.
 */
export function wolfVigor(hour: number): number {
  return FAUNA.WOLF_DAY_FLOOR + (1 - FAUNA.WOLF_DAY_FLOOR) * activityAt('wolf', hour)
}

function chooseQuarry(
  state: SimState,
  monster: Monster,
  entity: Entity,
  quarry: Entity[],
  range: number,
  isAvatar: (id: number) => boolean,
  stealthOf: (e: Entity) => number,
  /** L'index du tick — sans lui, `bleeds` refaisait un `find` par proie, dans une
   *  boucle qui court déjà sur toutes les proies : O(bêtes²) à chaque tick de
   *  chaque loup. Invisible en solo, mortel à vingt joueurs. */
  monsterByEntity: Map<number, Monster>,
  /** L'heure du loup (R10bis) : elle raccourcit aussi sa POURSUITE. */
  vigor = 1,
): number | null {
  let bestId: number | null = null
  let bestScore = Infinity
  for (const q of quarry) {
    if (q.id === entity.id || q.hp <= 0) continue
    // Qui se tient au Feu est intouchable : la meute ne le choisit pas, et
    // l'abandonne s'il l'atteint en fuyant.
    if (isAvatar(q.id) && underFireWard(state, q)) continue

    // La proie qu'on tient DÉJÀ se garde bien plus loin qu'on ne l'aurait prise —
    // mais un loup somnolent lâche prise plus tôt (R10bis).
    const reach = q.id === monster.targetId ? FAUNA.PURSUIT_RANGE * vigor : range
    let d = distSq(entity.x, entity.y, q.x, q.y)
    // L'ACQUISITION se fait à la distance PERÇUE (chasse C5) : un homme qui rampe
    // en fourré n'existe pour le loup que de bien plus près. C'est la symétrie qui
    // rend la décision n°1 réelle — le loup vous chasse à la furtivité, vous le
    // chassez à la furtivité. La POURSUITE, elle, reste à la distance VRAIE : une
    // meute qui vous a choisi ne vous perd pas parce que vous vous êtes accroupi.
    if (isAvatar(q.id) && q.id !== monster.targetId) {
      const st = stealthOf(q)
      d = d / (st * st)
    }
    if (d > reach * reach) continue

    let score = isAvatar(q.id) ? d : d / (FAUNA.PREY_PREFERENCE * FAUNA.PREY_PREFERENCE)
    // LE PRÉDATEUR PRÉFÈRE LE SANG (chasse C12). Une cible qui saigne pèse plus
    // lourd : la meute cueille les diminués. Y compris VOTRE cerf blessé — la
    // piste que vous suivez, d'autres la suivent. Et y compris VOUS, si vous
    // saignez (décision utilisateur n°2 : le bandage devient un geste de survie).
    if (bleeds(state, q, monsterByEntity)) score = score / (HUNT.WOUNDED_PREFERENCE * HUNT.WOUNDED_PREFERENCE)
    if (score < bestScore || (score === bestScore && bestId !== null && q.id < bestId)) {
      bestScore = score
      bestId = q.id
    }
  }
  return bestId
}

/** Cette entité saigne-t-elle — bête blessée ou avatar entaillé ? Le sang est le sang. */
function bleeds(state: SimState, e: Entity, byEntity: Map<number, Monster>): boolean {
  if (e.wounds.bleeding === true) return true
  const m = byEntity.get(e.id)
  return m !== undefined && isBleeding(m, state.tick)
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
  /** L'heure du loup (R10bis) : on ne répond pas à un cri hors de sa portée du moment. */
  vigor = 1,
): number | null {
  if (!pack) return null
  for (const other of pack) {
    if (other.entityId === monster.entityId || other.targetId === null) continue
    const oe = byId.get(other.entityId)
    if (!oe || oe.hp <= 0) continue
    if (distSq(entity.x, entity.y, oe.x, oe.y) > FAUNA.PACK_CALL_RADIUS * FAUNA.PACK_CALL_RADIUS) continue

    const t = byId.get(other.targetId)
    if (!t || t.hp <= 0) continue
    // La proie est-elle à MA portée de poursuite (l'heure la raccourcit, R10bis),
    // et pas réfugiée au Feu ?
    const reach = FAUNA.PURSUIT_RANGE * vigor
    if (distSq(entity.x, entity.y, t.x, t.y) > reach * reach) continue
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
