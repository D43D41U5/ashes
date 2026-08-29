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
  EAU,
  BALANCE,
  CENDREUX,
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
  TERRAIN_WET_MEADOW,
  TERRAIN_WILLOW,
  TERRAIN_JUNIPER_HEATH,
  TICK_DT_S,
  isRangedWeapon,
  type MonsterType,
} from './balance'
import { CENDRE, profondeurNueDeCendre } from './cendre'
import { isBlockedAt, makeIndexedIsBlockedAt } from './collision'
import { applyDamage, die, startAttack, weaponKind, type Corpse } from './combat'
import { emitEvent } from './events'
import { fireState } from './fire'
import { distSq } from './geometry'
import { carryRatio, carryTier, countOf, isEmpty, removeItems, type ItemId } from './items'
import { profondeurAt, terrainAt, zoneTierAt, type WorldMap } from './map'
import { meteoQuiet, meteoVisionFactor } from './meteo'
import { estCoeur, estLisiere, TERRAINS_BOISES_MASSIF, TERRAINS_FEUILLUS } from './profondeur'
import { CREUX } from './racine-relief'
import { separationPush } from './ecart'
import { moveToward, spawnMonster, type Monster } from './monsters'
import { pathToward } from './pathfinding'
import { hash2 } from './noise'
import { poissonPoints } from './poisson'
import { rngRoll } from './rng'
import { niveauDEau, porteDeLEau } from './eau'
import { effetsDuJour } from './modificateur'
import { getGameTime, jourDeSaison } from './time'
import type { Entity, SimState } from './sim'
import { BEARINGS, ventGain } from './vent'

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
  const radial =
    d <= CIRCLES.DOMESTIC_RADIUS ? FAUNA.PREDATOR_BIAS_DOMESTIC : d >= CIRCLES.WILD_RADIUS ? FAUNA.PREDATOR_BIAS_WILD : 1
  // RICHESSE ↔ DANGER (V2-19, tension.md T11bis) : une zone plus riche (tier plus haut) attire
  // plus de prédateurs — le système de ressources est géographique, la peur doit l'être aussi.
  // `zoneTierAt` rend 0 sans zones (bancs) : le facteur vaut alors 1, comportement préservé.
  const tier = zoneTierAt(state.map, tx, ty)
  return radial * (1 + FAUNA.DANGER_PER_TIER * tier)
}

/**
 * LE SANG APPELLE (spec chasse C12). Le poids des prédateurs au peuplement, près
 * d'une carcasse FRAÎCHE ou d'une entité qui SAIGNE. Il se cumule au gradient de
 * danger (`predatorBias`) : tuer, c'est armer un minuteur.
 */
/**
 * UN CADAVRE PORTE-T-IL DE LA VIANDE ? La viande crue — ET LE QUARTIER (spec `depecage.md` R4) :
 * le cerf rend des quartiers, et tant que seul `raw_meat` comptait, le gros gibier n'attirait ni
 * ne nourrissait un loup — son minuteur C12 n'existait pas. C'est la seule lecture, partagée par
 * le flair (`bloodBias`), la recherche de repas et la bouchée.
 */
export function porteDeLaViande(c: Corpse): boolean {
  return countOf(c.inventory, 'raw_meat') > 0 || countOf(c.inventory, 'quartier') > 0
}

export function bloodBias(state: SimState, x: number, y: number): number {
  const r = HUNT.BLOOD_SCENT_RADIUS * HUNT.BLOOD_SCENT_RADIUS
  for (const c of state.corpses) {
    if (state.tick - c.diedAt >= HUNT.CARCASS_FRESH_TICKS) continue
    if (!porteDeLaViande(c)) continue
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
  // Les mots ouverts du pré (spec t0-exploration §2ter R35) : la prairie humide est de
  // l'HABITAT, pas de l'eau — elle n'entre PAS dans WATER_TERRAINS, l'eau réelle commande.
  TERRAIN_WET_MEADOW,
  TERRAIN_JUNIPER_HEATH,
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
export const WOOD_TERRAINS: readonly number[] = [
  TERRAIN_FOREST,
  TERRAIN_PINE,
  TERRAIN_LARCH,
  TERRAIN_OLD_GROWTH,
  TERRAIN_WILLOW, // la saulaie est un bois — et près de l'eau par construction (§2ter R35)
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
  // LE COUVERT SE PRÉCALCULE COMME L'EAU (spec faune R23) : par cellule, le COMPTE
  // de tuiles boisées — le plancher (`GROUND_COVER_MIN_TILES`) distingue un massif
  // d'une haie. Même passe, même grille, même prix.
  const boise = new Uint16Array(gw * gh)
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const t = terrainAt(map, tx, ty)
      const c = Math.floor(ty / cell) * gw + Math.floor(tx / cell)
      if (WATER_TERRAINS.includes(t)) wet[c] = 1
      else if (WOOD_TERRAINS.includes(t)) boise[c] = boise[c]! + 1
    }
  }
  const nearCell = (tx: number, ty: number, near: number, ok: (c: number) => boolean): boolean => {
    const r = Math.ceil(near / cell)
    const cx = Math.floor(tx / cell)
    const cy = Math.floor(ty / cell)
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        const nx = cx + ox
        const ny = cy + oy
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
        if (ok(ny * gw + nx)) return true
      }
    }
    return false
  }
  const nearWater = (tx: number, ty: number): boolean => nearCell(tx, ty, FAUNA.GROUND_WATER_NEAR, (c) => wet[c] === 1)
  // LE DORTOIR À PORTÉE (R23) : le gibier dort sous les arbres — un coin sans
  // massif boisé à portée n'est pas un coin, quelle que soit son herbe.
  const nearCover = (tx: number, ty: number): boolean =>
    nearCell(tx, ty, FAUNA.GROUND_COVER_NEAR, (c) => boise[c]! >= FAUNA.GROUND_COVER_MIN_TILES)

  // LE PAYS DÉCIDE DE LA NATURE DU COIN. On compte, autour de la graine, ce qui
  // domine : de l'herbe ou des arbres. Un semis tombé au milieu des bois devient
  // une SOUILLE (sanglier) ; au milieu des prés, une CLAIRIÈRE (cerf, lapin).
  // Le gibier n'a pas à s'adapter au coin : c'est le coin qui est ce qu'il est.
  const paysVoulu = (sx: number, sy: number): readonly number[] => {
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
    return bois > pres ? WOOD_TERRAINS : OPEN_TERRAINS
  }
  // La graine n'est qu'une graine : on cherche autour d'elle la meilleure tuile —
  // un pré près d'une rive — en anneaux croissants. Rien dans le rayon : pas de
  // coin. La vallée a le droit d'avoir des déserts, et c'est même ce qui donne
  // leur valeur aux coins qui restent.
  const snapCoin = (sx: number, sy: number, rayon: number, veut: readonly number[]): { x: number; y: number } | null => {
    for (let r = 0; r <= rayon; r++) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (r > 0 && Math.abs(ox) !== r && Math.abs(oy) !== r) continue // le bord de l'anneau
          const tx = sx + ox
          const ty = sy + oy
          if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue
          const terrain = terrainAt(map, tx, ty)
          if (!TERRAINS[terrain]?.walkable) continue
          if (!veut.includes(terrain)) continue // de l'herbe, OU des arbres
          if (!nearWater(tx, ty)) continue // …et de l'eau (on boit ; le sanglier s'y vautre)
          if (!nearCover(tx, ty)) continue // …et un DORTOIR (R23 : on dort sous les arbres)
          return { x: tx + 0.5, y: ty + 0.5 }
        }
      }
    }
    return null
  }

  const pts = poissonPoints(map.width, map.height, seed ^ 0x47524e44 /* 'GRND' */, FAUNA.GROUND_SPACING)
  const grounds: { x: number; y: number }[] = []
  for (const p of pts) {
    // LE COIN DE CHASSE EST UN LIEU LOGIQUE (retour utilisateur) : le gibier ne
    // vit pas sur un éboulis. Il lui faut de l'HERBE (un biome ouvert, où l'on
    // broute) et de l'EAU (on boit tous les jours). Le semis de Poisson donne
    // l'ESPACEMENT ; ces deux conditions donnent l'ADRESSE.
    const sx = Math.floor(p.x)
    const sy = Math.floor(p.y)
    const g = snapCoin(sx, sy, FAUNA.GROUND_SNAP, paysVoulu(sx, sy))
    if (g) grounds.push(g)
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

  if (profile === 'diurnal') return rampe(hour, FAUNA.ACTIVITY_DIURNAL)
  if (profile === 'nocturnal') {
    // La nuit enjambe minuit : on la lit sur deux rampes, et on garde la plus forte.
    const n = FAUNA.ACTIVITY_NOCTURNAL
    return Math.max(rampe(hour, n) /* 19h→7h du lendemain */, rampe(hour + 24, n))
  }
  // Crépusculaire : deux bosses, l'aube et le soir.
  return Math.max(rampe(hour, FAUNA.ACTIVITY_CREPUSCULAR_DAWN), rampe(hour, FAUNA.ACTIVITY_CREPUSCULAR_DUSK))
}

/** `ramp` appliqué à un trapèze déclaré `[up0, up1, down0, down1]` (voir `FAUNA.ACTIVITY_*`). */
function rampe(x: number, t: readonly [number, number, number, number]): number {
  return ramp(x, t[0], t[1], t[2], t[3])
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
  // LA CENDRE N'EST L'HABITAT DE PERSONNE (spec faune R25). Le front avance sur
  // le biome sans changer sa tuile de terrain : sans cette garde, un pré cendré
  // resterait « de la prairie » aux yeux du cerf — il y naîtrait, y brouterait,
  // y dormirait. Frange comprise : on ne CHOISIT jamais un sol cendré (seule la
  // loi de dégâts, elle, épargne la frange — deux seuils, deux rôles).
  if (profondeurNueDeCendre(state, tx, ty) >= 0) return false
  const terrain = terrainAt(state.map, tx, ty)
  return habitat.includes(terrain)
}

/**
 * LA LOI DE LA CENDRE (spec faune R25, A40) — le monde se nettoie tout seul.
 *
 * Toute FAUNE (bête à habitat : gibier et prédateurs — jamais les cendreux, qui
 * sont chez eux) posée sur la cendre AU-DELÀ DE LA FRANGE brûle, vite. Le
 * comportement l'évite partout (habitat, mur de `moveToward`) : cette loi est le
 * FILET — recul, géométrie pathologique, donnée périmée — et elle est diégétique :
 * on trouve une carcasse prise par la cendre, pas un cerf broutant l'absurde.
 *
 * La mort n'est pas une mise à mort : pas de `slainClean` (le drapeau n'est
 * simplement jamais posé), pas de silence de chasse R16 (gardé par la cause dans
 * `die`). Rend `true` si la bête est morte ce tick — son pas ne se joue pas.
 */
export function morsureDeLaCendre(state: SimState, monster: Monster, entity: Entity): boolean {
  if (!isWild(monster.type)) return false
  const p = profondeurNueDeCendre(state, Math.floor(entity.x), Math.floor(entity.y))
  if (p <= CENDRE.FRANGE_TUILES) return false // hors cendre (−1) ou sur la frange : rien
  entity.hp -= FAUNA.CENDRE_DOT_HP_S * TICK_DT_S
  if (entity.hp > 0) return false
  entity.hp = 0
  die(state, entity, 0, 'cendre') // 0 = pas de tueur — la convention des morts environnementales (foudre, froid, faim)
  return true
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

/**
 * LE COUVERT EFFECTIF d'une tuile (spec chasse C3 + §2quater R41) : le couvert du terrain,
 * MODULÉ par la profondeur — au cœur d'un massif encore boisé, on est mieux caché
 * (`HUNT.COVER_COEUR`). UNE seule fonction pour les trois lecteurs (détectabilité, traque,
 * couchage) : un couvert que la chasse voit et que le gibier ignore — ou l'inverse — serait
 * deux jeux. Sans champ de profondeur (banc, carte d'avant), elle rend le nominal : inerte.
 */
export function couvertEffectif(state: SimState, tx: number, ty: number): number {
  const t = terrainAt(state.map, tx, ty)
  const base = TERRAINS[t]?.cover ?? 1
  if (TERRAINS_BOISES_MASSIF.includes(t) && estCoeur(profondeurAt(state.map, tx, ty))) {
    return base * HUNT.COVER_COEUR
  }
  return base
}

/** LE COUVERT (spec chasse C3) : ce qui reste de la visibilité sur cette tuile. */
export function coverAt(state: SimState, x: number, y: number): number {
  return couvertEffectif(state, Math.floor(x), Math.floor(y))
}

/**
 * ═══ BANDER SE VOIT (spec `tir.md` T7, décision d'Alexis) ═══
 *
 * Sans cette règle, l'arc SUPPRIMAIT le jeu d'approche au lieu de s'y ajouter : la
 * méfiance dérive de la distance PERÇUE (C1), donc à douze tuiles le stimulus est nul,
 * donc TOUT tir long aurait été automatiquement propre — le vent, le couvert, le pas
 * lent et la posture de la bête auraient cessé de payer quoi que ce soit.
 *
 * La parade ne touche PAS C6, et c'est ce qui la rend juste : elle ne fait qu'ajouter
 * un corps qui BOUGE là où il n'y en avait pas. Un homme qui tire sur sa corde n'est
 * plus un rocher — il se voit un peu plus, et il s'entend un peu.
 *
 * Ce que ça donne, et c'est délibérément asymétrique : à douze tuiles, RIEN (le
 * stimulus y est déjà quasi nul, et le tir long reste propre — c'est le fantasme du
 * chasseur) ; à cinq ou six, bander pleinement fait lever la tête à la bête PENDANT
 * qu'on vise. Le stop-and-go de C1 ne survit pas seulement, il gagne une phase :
 * *je bande — elle fixe — je tire MAINTENANT, ou je relâche et j'attends.*
 */
function drawTell(e: Entity): boolean {
  return e.charge !== undefined && isRangedWeapon(weaponKind(e))
}

/**
 * LA LITIÈRE QUI CRAQUE (forêts-vivantes §2 R3) : le multiplicateur de BRUIT du sol.
 * 1 partout — et sur le sol des FEUILLUS, une PENTE CONTINUE de 1 (lisière, d = 1) au
 * plafond `HUNT.LITIERE_BRUIT_COEUR` (au PROF_CAP de l'érosion) : s'enfoncer cache mieux
 * (`COVER_COEUR`) mais s'entend mieux. UN SEUL lecteur (`avatarThreat`) — le patron
 * `couvertEffectif` : un bruit que la chasse entendrait et que la bête ignorerait serait
 * deux jeux. Sans champ de profondeur (banc, carte d'avant) : 1, inerte au bit près.
 */
export function bruitDuSol(state: SimState, tx: number, ty: number): number {
  const t = terrainAt(state.map, tx, ty)
  if (!TERRAINS_FEUILLUS.includes(t)) return 1
  const d = profondeurAt(state.map, tx, ty)
  if (d <= 1) return 1
  const pente = (Math.min(d, CREUX.PROF_CAP) - 1) / (CREUX.PROF_CAP - 1)
  return 1 + (HUNT.LITIERE_BRUIT_COEUR - 1) * pente
}

/**
 * L'ENVOL DE LA LISIÈRE (forêts-vivantes §3 R4) : un pas BRUYANT (bruit effectif ≥
 * `ENVOL_SEUIL` — la marche oui, le pas lent non, le portage lourd toujours) sur une tuile
 * de LISIÈRE fait gicler les oiseaux : fait de domaine `bird_flush` émis AU MOMENT du
 * geste, et le gibier dans le rayon d'alarme prend un coup de méfiance — la forêt prévient
 * avant la bête. Les perchoirs se REPOSENT (R4bis) : `state.envols`, liste bornée purgée
 * ici même — un envol par zone de `ENVOL_COOLDOWN_RAYON` tous les `ENVOL_COOLDOWN_TICKS`.
 * Avatars seulement : ni les bêtes ni les villageois ne déclenchent (la forêt connaît les
 * siens). Aucun tirage : la passe est une pure lecture de l'état.
 */
export function advanceEnvols(state: SimState): void {
  for (const e of state.entities) {
    if (e.hp <= 0) continue
    // Les tests bon marché d'abord : l'allure, puis la tuile — le balayage des bêtes en dernier.
    const tx = Math.floor(e.x)
    const ty = Math.floor(e.y)
    if (gaitNoise(e) * bruitDuSol(state, tx, ty) < HUNT.ENVOL_SEUIL) continue
    if (!estLisiere(profondeurAt(state.map, tx, ty))) continue
    if (state.monsters.some((m) => m.entityId === e.id)) continue
    if (state.npcs.some((n) => n.entityId === e.id)) continue

    const envols = (state.envols ??= [])
    let bloque = false
    for (let i = envols.length - 1; i >= 0; i--) {
      const v = envols[i]!
      if (state.tick - v.t >= HUNT.ENVOL_COOLDOWN_TICKS) {
        envols.splice(i, 1)
        continue
      }
      if (Math.max(Math.abs(v.x - tx), Math.abs(v.y - ty)) < HUNT.ENVOL_COOLDOWN_RAYON) bloque = true
    }
    if (bloque) continue

    envols.push({ x: tx, y: ty, t: state.tick })
    emitEvent(state, { type: 'bird_flush', tick: state.tick, x: tx, y: ty })
    alarmeDEnvol(state, tx, ty)
  }
}

/**
 * CE QU'UN ENVOL FAIT AU RESTE DU COIN : le gibier alentour prend un coup de
 * méfiance. Extrait d'`advanceEnvols` le jour où le TÉTRAS s'est mis à voler
 * (R21) — parce que c'est la MÊME chose : des ailes qui claquent préviennent le
 * bois, que ce soit la nuée d'une lisière ou l'oiseau parti sous vos pieds. Deux
 * copies auraient divergé au premier réglage.
 *
 * Aucun tirage : pure lecture, bornée au rayon d'alarme.
 */
function alarmeDEnvol(state: SimState, tx: number, ty: number): void {
  const rayon2 = HUNT.ENVOL_ALARME_RAYON * HUNT.ENVOL_ALARME_RAYON
  for (const m of state.monsters) {
    if (!isPrey(m.type)) continue
    const em = state.entities.find((x) => x.id === m.entityId)
    if (!em || em.hp <= 0) continue
    const dx = em.x - (tx + 0.5)
    const dy = em.y - (ty + 0.5)
    if (dx * dx + dy * dy > rayon2) continue
    m.suspicion = Math.min(1, m.suspicion + HUNT.ENVOL_SUSPICION)
  }
}

/** La menace qu'un avatar OPPOSE, entrée une fois (spec chasse C5) : vue + ouïe. */
export function avatarThreat(state: SimState, e: Entity): Threat {
  const bande = drawTell(e)
  return {
    e,
    vision: gaitVisibility(e) * coverAt(state, e.x, e.y) * (bande ? HUNT.DRAW_VISIBILITY : 1),
    noise: gaitNoise(e) * bruitDuSol(state, Math.floor(e.x), Math.floor(e.y))
      * HUNT.HEARING_FACTOR * (bande ? HUNT.DRAW_NOISE : 1),
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
 * LE STIMULUS QU'UN AVATAR OFFRE AUX MORTS (spec cendreux R24 — les sens honnêtes). Même
 * patron qu'`avatarThreat` — la furtivité entre UNE fois, ici — mais la peau du sens diffère :
 * le Cendreux n'a pas d'oreilles, il SENT le sol. Le canal VUE est celui de la chasse (allure
 * × couvert, bander se voit — un mort a des yeux) ; le canal VIBRATION est le pas qui ébranle
 * (bruit d'allure × litière × `SENS.VIBRATION`), SANS `DRAW_NOISE` (la corde d'arc est un truc
 * d'oreilles — T7 intact, le tir long reste propre) et SANS le couvert : la végétation cache
 * des yeux, jamais du sol. Le portage lourd interdit le silence pour les morts aussi (C2,
 * via `gaitNoise`). LA MÉTÉO VOILE LA VUE SEULE (`meteo`, le facteur que `nearestPrey` a
 * relevé au point de la proie) : le brouillard n'étouffe pas le sol — un sprint s'y sent à
 * la même distance qu'au clair.
 */
export function stimulusPourLesMorts(state: SimState, e: Entity, meteo = 1): number {
  const vue = gaitVisibility(e) * coverAt(state, e.x, e.y) * (drawTell(e) ? HUNT.DRAW_VISIBILITY : 1) * meteo
  const vibration = gaitNoise(e) * bruitDuSol(state, Math.floor(e.x), Math.floor(e.y)) * CENDREUX.SENS.VIBRATION
  return Math.max(vue, vibration)
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
 *
 * LA MÉTÉO VOILE LES SENS (spec meteo.md R7) : la distance perçue se divise par
 * `meteoVisionFactor` AU POINT DE LA MENACE regardée — on se cache dans la pluie,
 * on n'aveugle pas la bête au soleil. Diviser la distance effective, c'est
 * multiplier par le facteur TOUTES les portées comparées en aval (le plafond ici,
 * `perceiveRange` et `flightRange` dans la jauge) — la modulation entre UNE fois,
 * dans la loi, comme la furtivité. La PANIQUE et l'espace vital (`rawSq`) restent
 * à la distance VRAIE : l'averse ne sauve pas qui marche SUR la bête.
 */
function nearestThreat(
  state: SimState,
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
      // V7 (`vent.md`) — LE NEZ PORTE CE QUE LE VENT PORTE. La force au point de la BÊTE (c'est
      // elle qui sent) module la portée du canal ; le CÔNE, lui, ne bouge pas : la parade reste
      // UN CÔTÉ, pas un facteur. Le gain vaut EXACTEMENT 1 hors front — un monde sans météo
      // renifle donc au bit près comme avant l'unification — et jusqu'à 1/AMBIANT sous une
      // bande : sous la pluie battante, l'odeur vous précède de bien plus loin.
      if (upwind >= HUNT.SCENT_COS) scent = HUNT.SCENT_STRENGTH * ventGain(state, entity.x, entity.y)
    }
    // Trois canaux, le plus fort gagne : l'OUÏE n'a ni couvert ni secteur
    // aveugle, et le NEZ n'a rien du tout — il a juste besoin du bon côté.
    // Puis LA MÉTEO au point de la menace voile les trois d'un coup (R7) : c'est
    // la PORTÉE de perception qui rétrécit, pas un canal — le rideau d'eau
    // étouffe l'odeur et le pas comme il gomme la silhouette.
    const perceived = Math.max(t.vision * angle, t.noise, scent) * meteoVisionFactor(state, a.x, a.y)
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
  //
  // ET L'ALERTE EST UN VERROU, PAS UNE COMPARAISON (même patron que `wary`,
  // carte des oscillations 2026-08-28) : la jauge POURSUIT son stimulus et
  // rasait 0,7 dans les deux sens plusieurs fois par seconde — chaque
  // re-franchissement RE-PAYAIT la nervosité, qui ralentit la décrue, qui
  // multiplie les re-franchissements : une contre-réaction positive branchée
  // sur un seuil nu, le seul mécanisme du fichier qui EMPIRAIT avec le temps.
  // Levée à `SUSPICION_ALERT`, l'alerte ne se rend qu'à `SUSPICION_ALERT_CALM` —
  // et la nervosité ne se paie qu'une fois par VRAIE alerte.
  if (monster.alertSince === undefined && monster.suspicion >= HUNT.SUSPICION_ALERT) {
    monster.alertSince = state.tick
    monster.nervous = Math.min(HUNT.NERVOUS_MAX, (monster.nervous ?? 1) * HUNT.NERVOUS_FACTOR)
  } else if (monster.alertSince !== undefined && monster.suspicion < HUNT.SUSPICION_ALERT_CALM) {
    delete monster.alertSince
  }

  // LE VERROU DE LA CURIOSITÉ (hystérésis) — en DERNIER, quand la jauge du tick
  // est arrêtée (le plancher de menace ci-dessus la relève encore). La jauge
  // POURSUIT son stimulus : à distance de seuil, elle le franchit dans les deux
  // sens plusieurs fois par seconde — et le gel, la posture et la teinte
  // battaient avec elle. L'état se lève donc à `SUSPICION_CURIOUS` et ne retombe
  // qu'à `SUSPICION_CALM`. Il ne se calcule qu'ICI : `wary` est la seule lecture
  // autorisée de ce seuil, sim comme client — un `>= SUSPICION_CURIOUS` recopié
  // ailleurs recréerait le battement à côté du verrou.
  if (monster.suspicion >= HUNT.SUSPICION_CURIOUS) monster.wary = true
  else if (monster.suspicion < HUNT.SUSPICION_CALM) delete monster.wary
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

  // LES RÉSIDENTS COMPTENT (loup.md L4) : une meute de Louvière PRÉSENTE dans un
  // coin mange le quota de prédateurs de ce coin — c'est le nombre de loups que
  // LE JOUEUR VOIT qui est borné, pas le nombre qu'une fonction a fabriqués.
  // Sans cette ligne, la meute venue chasser s'ajoutait PAR-DESSUS les places
  // ambiantes, et le mur de dix-neuf loups (R18) revenait par la porte de derrière.
  if (state.grounds.length > 0) {
    let posOf: Map<number, Entity> | null = null
    for (const m of state.monsters) {
      if (m.ambient || !isPredator(m.type)) continue
      if (posOf === null) {
        posOf = new Map()
        for (const e of state.entities) posOf.set(e.id, e)
      }
      const e = posOf.get(m.entityId)
      if (!e || e.hp <= 0) continue
      predators++
      const near = nearestGround(state, e.x, e.y)
      if (!near || near.d2 > FAUNA.GROUND_RADIUS * FAUNA.GROUND_RADIUS) continue
      const k = `${near.g.x},${near.g.y}`
      predPerGround.set(k, (predPerGround.get(k) ?? 0) + 1)
    }
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
    if (isBlockedAt({ map: state.map, structures: state.structures, nodes: state.nodes, etat: state }, tx, ty)) continue
    // LA PRESSION DE CHASSE (R16) : le gibier a déserté ce qu'on vient de chasser.
    // Rien ne naît ici tant que les bois n'ont pas retrouvé leur calme — c'est ce
    // qui force à lever le camp au lieu de récolter sur place.
    if (isQuiet(state, tx + 0.5, ty + 0.5)) continue
    // LA SÉCHERESSE REPLIE LE GIBIER SUR CE QUI RESTE D'EAU (spec `saisons.md` S10). Le coin
    // de chasse a été placé au worldgen près d'une rive ; si cette rive était une MARE et que
    // l'Ardeur l'a bue, plus rien ne naît ici — la vie se concentre là où l'eau tient. Le
    // balayage ne se paie QUE pendant une sécheresse : hors de là, le test s'arrête au premier
    // `if`, et l'eau de la carte n'a pas bougé.
    const niveauEau = niveauDEau(state)
    if (niveauEau <= -EAU.SEUIL_ASSECHEMENT && !eauVivanteAutour(state, tx, ty, niveauEau)) continue

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
    // UNE place suffit : le RÔDEUR SOLITAIRE est la sortie voulue depuis que la
    // meute vit en Louvière (loup.md L4 — l'ambiant n'ouvre plus de meute). La
    // garde des deux places datait d'un monde où un demi-quota ne fabriquait
    // « que des rôdeurs inutiles » ; le rôdeur est désormais la règle.
    const predRoom = predatorRoom(state, ground, budget)
    if (predRoom < 1) candidates = candidates.filter((t) => !isPredator(t))
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
        // LA PART DU RÔDEUR (loup.md L4) : l'ambiant aminci, en nombre explicite —
        // sans lui, la chute de `herdCost` (3,5 → 1) triplait la fréquence de
        // tirage du loup et affamait la souille de ses sangliers (garde A27).
        (isPredator(t) ? danger * FAUNA.RODEUR_PART : 1) /
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

/** Les PV maximaux d'une bête — l'alpha en porte davantage (R12), le petit bien moins (loup.md L15). */
export function maxHpOf(monster: Monster): number {
  if (monster.petit === true) return MONSTER_DEFS[monster.type].hp * FAUNA.PETIT_HP
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
    if (isBlockedAt({ map: state.map, structures: state.structures, nodes: state.nodes, etat: state }, nx, ny)) continue
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
    // Le PETIT ne déroute pas : il se terre (loup.md L15). Il garde son clan —
    // c'est autour de lui que le gîte se repeuplera.
    if (m.petit === true) continue
    const chief = byId.get(m.alphaId)
    if (chief && chief.hp > 0) continue
    routClanMember(state, m, byId)
  }
}

/** La rompue d'un membre de clan — partagée entre la dispersion (R12) et la déroute collective (loup.md L14). */
function routClanMember(state: SimState, m: Monster, byId: Map<number, Entity>): void {
  m.routed = true
  delete m.herdId // la meute est DISSOUTE : elle ne se reforme pas
  m.targetId = null
  m.stalking = false
  m.fleeSince = -1
  delete m.sortie
  delete m.sortieX
  delete m.sortieY
  delete m.chasseAbstraiteAt
  delete m.rageUntil // la déroute éteint la rage : les freins de survie priment (L13)
  delete m.bondPrepUntil // …et lâche la détente, comme elle lâche le coup en cours
  // LE DÉSERTEUR (loup.md L3) : il a quitté le clan — le gîte ne le compte plus
  // (sinon quatre fuyards le tiendraient plein à jamais : un plafond compte ce
  // qu'il borne), et le monde le reprend hors regard (balayage `expiresAt`).
  if (m.homePoi !== undefined) {
    delete m.homePoi
    m.expiresAt = state.tick + FAUNA.ROUTED_LINGER_TICKS
  }
  const e = byId.get(m.entityId)
  if (e) delete e.windup // il lâche le coup qu'il était en train de porter
}

/**
 * LA DÉROUTE COLLECTIVE (loup.md L14) : le clan qui a perdu la moitié de ses
 * ADULTES casse d'un coup — blessés ou pas, enragés ou pas. C'est le pendant
 * graduel de la mort de l'alpha : on n'abat pas cinq loups, on en abat deux et
 * le reste comprend. Seuls les clans FONDÉS (`clanAdultes`, posé par la
 * Louvière) portent cette règle : une meute de banc sans étalon ne déroute
 * qu'à l'alpha, comme avant.
 */
function routBrokenClans(state: SimState, byId: Map<number, Entity>): void {
  let vivants: Map<number, number> | null = null
  let etalons: Map<number, number> | null = null
  for (const m of state.monsters) {
    if (m.herdId === undefined || m.clanAdultes === undefined || m.petit === true || m.routed) continue
    const e = byId.get(m.entityId)
    if (!e || e.hp <= 0) continue
    vivants ??= new Map()
    etalons ??= new Map()
    vivants.set(m.herdId, (vivants.get(m.herdId) ?? 0) + 1)
    etalons.set(m.herdId, m.clanAdultes)
  }
  if (!vivants || !etalons) return
  for (const [herdId, alive] of vivants) {
    if (alive >= etalons.get(herdId)! * FAUNA.PACK_ROUT_LOSS) continue
    for (const m of state.monsters) {
      if (m.herdId !== herdId || m.routed || m.petit === true) continue
      routClanMember(state, m, byId)
    }
  }
}

/**
 * Ce lieu a-t-il été chassé trop récemment (spec faune R16) ? Le rayon de silence
 * (46) est plus large que l'anneau de naissance (42) : un chasseur qui reste sur
 * place ne voit donc plus rien venir du tout. Il faut MARCHER — et c'est
 * précisément ce que fait un chasseur.
 *
 * Et LA MÉTÉO fait taire les mêmes bois (spec météo R6) : sous l'empreinte d'un
 * front mouillé, MÊME gate, mêmes conséquences exactes — mais par PRÉDICAT pur
 * (`meteoQuiet`), jamais par points `faunaQuiet` : une bande MOBILE en sèmerait à
 * chaque tick. Les deux silences coexistent par construction (critère A5 météo).
 */
/** Reste-t-il de l'eau AUJOURD'HUI dans le rayon d'abreuvement de ce point (S10) ? Une mare
 *  asséchée n'en est plus ; un lac, si. */
function eauVivanteAutour(state: SimState, tx: number, ty: number, niveau: number): boolean {
  const r = FAUNA.GROUND_WATER_NEAR
  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      // Le niveau est GLOBAL : on le lit une fois pour le rayon entier, jamais par tuile.
      if (porteDeLEau(state, tx + ox, ty + oy, niveau)) return true
    }
  }
  return false
}

function isQuiet(state: SimState, x: number, y: number): boolean {
  for (const q of state.faunaQuiet) {
    if (q.until <= state.tick) continue
    if (distSq(x, y, q.x, q.y) <= FAUNA.QUIET_RADIUS * FAUNA.QUIET_RADIUS) return true
  }
  return meteoQuiet(state, x, y)
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
      // Le couvert EFFECTIF (§2quater R41) — la table brute donnerait à la bête un couvert
      // que la chasse ne voit pas : elle se coucherait à côté du cœur qui l'abrite.
      const c = couvertEffectif(state, nx, ny)
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

/*
 * LE VENT a quitté ce module (spec `vent.md`, 2026-08-24 : « le front est le vent, unifie »).
 * `advanceWind` vivait ici parce que l'odorat était son unique lecteur ; il est désormais DÉRIVÉ
 * du front météo, dans `vent.ts`, et posé par `advanceVent` juste après `advanceMeteo` — donc
 * toujours AVANT la faune, qui le lit. Hors météo, sa valeur est identique au bit près à celle
 * d'avant l'unification : même clé de hash, même cadence.
 */

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
  advanceGroundItems(state)

  // La déroute d’une meute décapitée ne dépend d'aucun peuplement : elle vaut
  // aussi dans un banc de test à faune nulle. La déroute COLLECTIVE (loup.md
  // L14) suit — le clan qui a perdu la moitié de ses adultes casse d'un coup.
  disperseLeaderless(state, byId)
  routBrokenClans(state, byId)

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
 * ═══ LA PASTILLE DU COIN (spec faune R24, A38) — la carte est une mémoire, pas un GPS ═══
 *
 * LA DÉCOUVERTE : approcher le cœur d'un coin VIVANT à `GROUND_SIGHT` le pose sur
 * la carte du joueur (`knownGrounds`, le patron `knownPois` — par POSITION, pas
 * par index : un coin meurt et renaît ailleurs, R27). L'OUBLI : revenir à portée
 * d'une pastille dont le coin est MORT l'éteint — la carte ne se corrige qu'au
 * CONSTAT, jamais à distance. Les PNJ n'ont pas de carte.
 */
export function advanceCoinsConnus(state: SimState, avatars: Entity[]): void {
  if (avatars.length === 0) return
  const sight2 = FAUNA.GROUND_SIGHT * FAUNA.GROUND_SIGHT
  const npc = new Set(state.npcs.map((n) => n.entityId))
  for (const a of avatars) {
    if (npc.has(a.id)) continue
    for (const g of state.grounds) {
      if (distSq(a.x, a.y, g.x, g.y) > sight2) continue
      const connus = (a.knownGrounds ??= [])
      let deja = false
      for (const k of connus) {
        if (k.x === g.x && k.y === g.y) {
          deja = true
          break
        }
      }
      if (deja) continue
      connus.push({ x: g.x, y: g.y })
      emitEvent(state, { type: 'coin_decouvert', tick: state.tick, entityId: a.id, x: g.x, y: g.y })
    }
    const connus = a.knownGrounds
    if (!connus) continue
    for (let i = connus.length - 1; i >= 0; i--) {
      const k = connus[i]!
      if (distSq(a.x, a.y, k.x, k.y) > sight2) continue
      let vivant = false
      for (const g of state.grounds) {
        if (g.x === k.x && g.y === k.y) {
          vivant = true
          break
        }
      }
      if (vivant) continue
      connus.splice(i, 1)
      emitEvent(state, { type: 'coin_disparu', tick: state.tick, entityId: a.id, x: k.x, y: k.y })
    }
  }
}

/* ═══ LE DORTOIR (spec faune R26) — la harde dort au couvert, chacun son arbre ═══ */

/**
 * LA GRILLE BOISÉE, mémoïsée PAR CARTE. La même maille et le même plancher que le
 * placement des coins (R23) — un dortoir est une cellule d'au moins
 * `GROUND_COVER_MIN_TILES` tuiles boisées. Dérivé pur de la carte (le terrain ne
 * change jamais après la génération) : une WeakMap module, pas de l'état de sim —
 * le patron du cumul d'`avanceeDeCendre`.
 */
interface GrilleBoisee {
  gw: number
  gh: number
  boise: Uint16Array
}
const BOISE_PAR_CARTE = new WeakMap<WorldMap, GrilleBoisee>()
function grilleBoisee(map: WorldMap): GrilleBoisee {
  const connu = BOISE_PAR_CARTE.get(map)
  if (connu) return connu
  const cell = FAUNA.GROUND_WATER_CELL
  const gw = Math.ceil(map.width / cell)
  const gh = Math.ceil(map.height / cell)
  const boise = new Uint16Array(gw * gh)
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      if (!WOOD_TERRAINS.includes(terrainAt(map, tx, ty))) continue
      const c = Math.floor(ty / cell) * gw + Math.floor(tx / cell)
      boise[c] = boise[c]! + 1
    }
  }
  const grille = { gw, gh, boise }
  BOISE_PAR_CARTE.set(map, grille)
  return grille
}

/**
 * CE MASSIF PEUT-IL ÊTRE UN DORTOIR ? (R26, et la porte de R27.) Trois refus :
 * cendré (R25 — on ne dort pas dans le feu), OCCUPÉ (un bâti dans l'emprise de
 * la cellule : village, maison — la bête ne dort pas dans une cour), et PRIS
 * par une autre harde (une harde = SON dortoir). `sansLesHardes` retire ce
 * troisième refus : c'est la question de VIABILITÉ d'un coin (R27) — « un
 * couvert existe-t-il ? » — pas celle d'une harde qui cherche le sien.
 */
function dortoirEligible(
  state: SimState,
  cellX: number,
  cellY: number,
  herdId: number | undefined,
  sansLesHardes = false,
): boolean {
  const cell = FAUNA.GROUND_WATER_CELL
  const cx = cellX * cell + cell / 2
  const cy = cellY * cell + cell / 2
  if (profondeurNueDeCendre(state, Math.floor(cx), Math.floor(cy)) >= 0) return false
  // L'OCCUPATION rayonne (R27) : une maison au cœur d'un massif l'occupe TOUT
  // ENTIER — pas sa seule cellule de 8×8, sinon la harde dormait dans la cour,
  // deux cellules plus loin (constaté au banc A44).
  for (const s of state.structures) {
    if (distSq(cx, cy, s.tx + 0.5, s.ty + 0.5) < FAUNA.DORTOIR_OCCUPATION * FAUNA.DORTOIR_OCCUPATION) return false
  }
  if (!sansLesHardes) {
    for (const m of state.monsters) {
      if (m.dortoirX === undefined || m.dortoirY === undefined) continue
      if (herdId !== undefined && m.herdId === herdId) continue
      if (distSq(cx, cy, m.dortoirX, m.dortoirY) < FAUNA.DORTOIR_EXCLUSION * FAUNA.DORTOIR_EXCLUSION) return false
    }
  }
  return true
}

/**
 * UN COUVERT EXISTE-T-IL ENCORE autour de ce point ? (R27 — la viabilité du
 * troisième organe.) La même grille et le même plancher que l'élection — mais
 * sans la règle des hardes : un massif pris par la harde voisine reste un
 * couvert qui EXISTE.
 */
function dortoirDisponible(state: SimState, gx: number, gy: number): boolean {
  const cell = FAUNA.GROUND_WATER_CELL
  const { gw, gh, boise } = grilleBoisee(state.map)
  const r = Math.ceil(FAUNA.GROUND_COVER_NEAR / cell)
  const cgx = Math.floor(gx / cell)
  const cgy = Math.floor(gy / cell)
  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      const nx = cgx + ox
      const ny = cgy + oy
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
      if (boise[ny * gw + nx]! < FAUNA.GROUND_COVER_MIN_TILES) continue
      if (dortoirEligible(state, nx, ny, undefined, true)) return true
    }
  }
  return false
}

/** LA GRILLE MOUILLÉE — le miroir runtime du précalcul d'eau du placement (R17). */
interface GrilleMouillee {
  gw: number
  gh: number
  wet: Uint8Array
}
const EAU_PAR_CARTE = new WeakMap<WorldMap, GrilleMouillee>()
function grilleMouillee(map: WorldMap): GrilleMouillee {
  const connu = EAU_PAR_CARTE.get(map)
  if (connu) return connu
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
  const grille = { gw, gh, wet }
  EAU_PAR_CARTE.set(map, grille)
  return grille
}

function eauAPortee(state: SimState, gx: number, gy: number): boolean {
  const cell = FAUNA.GROUND_WATER_CELL
  const { gw, gh, wet } = grilleMouillee(state.map)
  const r = Math.ceil(FAUNA.GROUND_WATER_NEAR / cell)
  const cgx = Math.floor(gx / cell)
  const cgy = Math.floor(gy / cell)
  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      const nx = cgx + ox
      const ny = cgy + oy
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
      if (wet[ny * gw + nx] === 1) return true
    }
  }
  return false
}

/**
 * ═══ LE COIN VIVANT (spec faune R27, A44) — il se répare, ou il meurt et renaît ailleurs ═══
 *
 * Appelé UNE fois par bascule de jour de saison (le rythme du front de cendre —
 * `sim.ts`, le même carrefour qu'`avancerLaCendre`). Trois temps :
 *
 *   1. CHAQUE COIN re-prouve ses organes : un gagnage non cendré, un couvert
 *      encore disponible. (L'eau ne meurt pas — la cendre ne prend pas l'eau.)
 *   2. Un coin mort S'ÉTEINT : retiré de `state.grounds` (plus une naissance —
 *      rien ne naît hors d'un coin), et ses bêtes SE LÈVENT : sans territoire,
 *      rendues à l'ambiant, elles fuient le cœur mort et se dissiperont hors de
 *      portée de vue — jamais sous les yeux (c'est `despawnUnwatched` qui efface).
 *   3. Il RENAÎT AILLEURS : un tirage par le RNG D'ÉTAT (le replay rejoue la
 *      renaissance), sous les MÊMES règles que le semis (R23 : herbe ou bois,
 *      eau et couvert à portée, hors cendre) plus l'espacement avec les coins
 *      VIVANTS. Pas de site ce jour-là : le déficit est retenu (`coinsAResemer`)
 *      et retenté chaque jour — la vallée ne perd pas ses coins en silence.
 */
export function entretienDesCoins(state: SimState): void {
  const morts: { x: number; y: number }[] = []
  const vivants: { x: number; y: number }[] = []
  for (const g of state.grounds) {
    const tx = Math.floor(g.x)
    const ty = Math.floor(g.y)
    const gagnageMort = profondeurNueDeCendre(state, tx, ty) >= 0
    const sansDortoir = !dortoirDisponible(state, g.x, g.y)
    if (gagnageMort || sansDortoir) morts.push(g)
    else vivants.push(g)
  }
  if (morts.length > 0) {
    state.grounds = vivants
    for (const g of morts) {
      emitEvent(state, { type: 'coin_eteint', tick: state.tick, x: g.x, y: g.y })
      for (const m of state.monsters) {
        if (m.groundX !== g.x || m.groundY !== g.y) continue
        delete m.groundX
        delete m.groundY
        delete m.dortoirX
        delete m.dortoirY
        delete m.dodo
        delete m.guet
        m.ambient = true // plus personne ne la retient : elle se dissipera hors de vue
        if (m.fleeSince < 0) {
          m.fleeSince = state.tick
          if (m.fleeFromX === undefined) {
            m.fleeFromX = g.x
            m.fleeFromY = g.y
          }
        }
      }
    }
    state.coinsAResemer = (state.coinsAResemer ?? 0) + morts.length
  }

  // LA RENAISSANCE — bornée : quelques dizaines de tirages par coin manquant et
  // par jour, jamais une boucle qui cherche jusqu'à trouver.
  let manque = state.coinsAResemer ?? 0
  while (manque > 0) {
    let trouve = false
    for (let k = 0; k < FAUNA.RESSEMIS_ESSAIS && !trouve; k++) {
      const tx = Math.floor(roll(state) * state.map.width)
      const ty = Math.floor(roll(state) * state.map.height)
      const terrain = terrainAt(state.map, tx, ty)
      if (!TERRAINS[terrain]?.walkable) continue
      if (!OPEN_TERRAINS.includes(terrain) && !WOOD_TERRAINS.includes(terrain)) continue
      if (profondeurNueDeCendre(state, tx, ty) >= 0) continue
      const x = tx + 0.5
      const y = ty + 0.5
      if (!eauAPortee(state, x, y)) continue
      if (!dortoirDisponible(state, x, y)) continue
      let trop = false
      for (const g of state.grounds) {
        if (distSq(x, y, g.x, g.y) < FAUNA.GROUND_SPACING * FAUNA.GROUND_SPACING) {
          trop = true
          break
        }
      }
      if (trop) continue
      state.grounds.push({ x, y })
      emitEvent(state, { type: 'coin_seme', tick: state.tick, x, y })
      trouve = true
    }
    manque -= 1 // trouvé ou pas : les essais du jour sont consommés pour CE coin
    state.coinsAResemer = (state.coinsAResemer ?? 0) - (trouve ? 1 : 0)
    if (!trouve) break // pas de site aujourd'hui : on retentera demain
  }
}

/**
 * L'ÉLECTION DU DORTOIR : le meilleur massif éligible du canton — le plus proche
 * du cœur du coin, départagé par la position (arithmétique pure, zéro tirage).
 * `null` : aucun massif (le banc sans bois, un canton entièrement mangé — R27
 * en tirera l'extinction ; ici la bête retombe sur le repos groupé d'avant).
 */
function elireDortoir(state: SimState, monster: Monster): { x: number; y: number } | null {
  const gx = monster.groundX
  const gy = monster.groundY
  if (gx === undefined || gy === undefined) return null
  const cell = FAUNA.GROUND_WATER_CELL
  const { gw, gh, boise } = grilleBoisee(state.map)
  const r = Math.ceil(FAUNA.GROUND_COVER_NEAR / cell)
  const cgx = Math.floor(gx / cell)
  const cgy = Math.floor(gy / cell)
  let bestX = -1
  let bestY = -1
  let bestD = Infinity
  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      const nx = cgx + ox
      const ny = cgy + oy
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
      if (boise[ny * gw + nx]! < FAUNA.GROUND_COVER_MIN_TILES) continue
      if (!dortoirEligible(state, nx, ny, monster.herdId)) continue
      const px = nx * cell + cell / 2
      const py = ny * cell + cell / 2
      const d = distSq(gx, gy, px, py)
      if (d < bestD || (d === bestD && (px < bestX || (px === bestX && py < bestY)))) {
        bestD = d
        bestX = px
        bestY = py
      }
    }
  }
  return bestX >= 0 ? { x: bestX, y: bestY } : null
}

/**
 * « CHACUN SON ARBRE » : les places autour du centre du dortoir, par RANG dans la
 * harde (l'ordre des `entityId` — le même rang que la sentinelle et la scission).
 * Douze places pour une harde de huit : jamais deux bêtes sur la même.
 */
const PLACES_DU_DORTOIR: readonly (readonly [number, number])[] = [
  [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2],
]

/**
 * LE PAS DU DORTOIR (R26) — rend `true` s'il a consommé le tick. La bête gagne
 * son massif au trot, rejoint SA place, et s'endort (`dodo`) — les sens bridés
 * et le guetteur vivent dans `faunaStep`, pas ici. Une fois couchée elle ne se
 * relève plus pour se replacer : le sommeil n'oscille pas.
 */
function dortoirStep(
  state: SimState,
  monster: Monster,
  entity: Entity,
  herd: Monster[] | undefined,
): boolean {
  if (!isPrey(monster.type)) return false
  if (monster.groundX === undefined || monster.groundY === undefined) return false

  // Le dortoir se COPIE d'une sœur avant de s'élire : une harde, un massif.
  if (monster.dortoirX === undefined && herd) {
    for (const other of herd) {
      if (other.entityId !== monster.entityId && other.dortoirX !== undefined && other.dortoirY !== undefined) {
        monster.dortoirX = other.dortoirX
        monster.dortoirY = other.dortoirY
        break
      }
    }
  }
  if (monster.dortoirX === undefined) {
    const d = elireDortoir(state, monster)
    if (d === null) return false
    monster.dortoirX = d.x
    monster.dortoirY = d.y
  }

  let rank = 0
  if (herd) for (const other of herd) if (other.entityId < monster.entityId) rank++
  const place = PLACES_DU_DORTOIR[rank % PLACES_DU_DORTOIR.length]!
  const px = monster.dortoirX + place[0] * FAUNA.DORTOIR_SPREAD
  const py = (monster.dortoirY ?? 0) + place[1] * FAUNA.DORTOIR_SPREAD

  // Pas encore couchée et pas à sa place : elle y va — au trot, la nuit tombe.
  // (0,9 tuile de tolérance : un tronc ou une sœur peuvent boucher le dernier
  // pas, et une bête qui pousse un arbre toute la nuit serait pire qu'une bête
  // couchée un peu court.)
  if (monster.dodo !== true && distSq(entity.x, entity.y, px, py) > FAUNA.DORTOIR_ARRIVE * FAUNA.DORTOIR_ARRIVE) {
    moveToward(state, monster, entity, px, py, false, FAUNA.WARY_SPEED)
    return true
  }
  monster.wanderDx = 0
  monster.wanderDy = 0
  // L'ENDORMISSEMENT RE-PROUVE LE DORTOIR (R27) — une fois par nuit, au moment
  // de fermer les yeux : un bâti posé dans la journée, ou le front arrivé, et le
  // massif n'est plus un lit. Toute la harde l'oublie — la prochaine pensée élira
  // le meilleur massif restant, et le coin survit tant qu'il en reste un.
  if (monster.dodo !== true && monster.guet !== true) {
    const cell = FAUNA.GROUND_WATER_CELL
    const cX = Math.floor(monster.dortoirX / cell)
    const cY = Math.floor((monster.dortoirY ?? 0) / cell)
    if (!dortoirEligible(state, cX, cY, monster.herdId)) {
      delete monster.dortoirX
      delete monster.dortoirY
      if (herd) {
        for (const other of herd) {
          delete other.dortoirX
          delete other.dortoirY
        }
      }
      return false
    }
  }
  if (monster.guet !== true) monster.dodo = true
  return true
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
/**
 * LA BORNE DU HUITIÈME : sin(22,5°). Une direction unitaire dont la composante
 * dépasse ça sur un axe a bien ce sens-là dans le découpage en huit. Littéral et
 * non calculé — `Math.sin` n'est pas garanti au bit près d'un moteur à l'autre
 * (invariant §2).
 */
const OCTANT_SIN = 0.3827

/**
 * VISER LOIN QUAND ON DONNE UN CAP, ET NON UN POINT (en tuiles).
 *
 * `moveToward` prend une CIBLE, et sa zone morte est une tolérance de POSITION : « ne corrige
 * pas un désalignement plus petit que ça ». Deux branches lui passent pourtant un VECTEUR
 * UNITAIRE (la fuite, la charge) — « va par là ». Sur un vecteur unitaire, une tolérance en
 * tuiles devient un couperet ANGULAIRE, et depuis que la zone morte se dérive du pas, cet
 * angle dépend de la VITESSE : une bête lancée perdait la finesse de son cap au moment précis
 * où elle en a le plus besoin. Attrapé par le banc A20 — les deux moitiés d'une harde qui se
 * fend cessaient de tenir (9,9 tuiles d'écart contre 8 tolérées), parce que l'infléchissement
 * de cohésion (19°) passait sous le couperet.
 *
 * Viser QUATRE TUILES dans le cap rend au geste sa précision, à toute allure — et ne change
 * rien à ce qu'il veut dire : c'est une direction, pas un rendez-vous.
 */
const CAP_VISEE = 4

/**
 * LE HUITIÈME LE PLUS PROCHE d'une direction (unitaire ou non) : chaque composante
 * vaut -1, 0 ou 1, et le secteur retenu est bien celui dont l'axe est le plus proche
 * — bornes à 22,5°, comme un compas.
 *
 * Il existe parce que `moveToward` ne peut PAS le faire : sa zone morte se mesure en
 * TUILES (une tolérance d'alignement vers une cible lointaine, ce qui est juste), et
 * appliquée à un VECTEUR UNITAIRE elle devient un couperet angulaire à 6°. Une
 * poussée qui rase un axe basculait alors d'un secteur à l'autre à chaque tick.
 */
export function octantOf(x: number, y: number): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
  const l = Math.sqrt(x * x + y * y)
  if (l < 0.0001) return { x: 0, y: 0 }
  const ux = x / l
  const uy = y / l
  return {
    x: ux > OCTANT_SIN ? 1 : ux < -OCTANT_SIN ? -1 : 0,
    y: uy > OCTANT_SIN ? 1 : uy < -OCTANT_SIN ? -1 : 0,
  }
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
      const pace = monster.wary ? FAUNA.WARY_SPEED : FAUNA.GRAZE_SPEED
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
      // LE CAP QUI BUTE SE TAIT (`capVetoJusqua`) : un but refusé par la
      // lisière (demi-tour, plus bas) ne se re-vise pas pendant le veto — sans
      // quoi chaque pensée renvoyait la bête gratter la même rive (mesuré :
      // l'aller-retour de 10 px de `tremblement.png`). Le veto éteint TOUS les
      // buts (migration ET dérive) : la bête broute où elle est.
      const veto = monster.capVetoJusqua !== undefined && state.tick < monster.capVetoJusqua
      if (monster.capVetoJusqua !== undefined && state.tick >= monster.capVetoJusqua) delete monster.capVetoJusqua
      const goal = veto ? null : migrationTarget(monster, state.tick)
      if (goal && roll(state) < FAUNA.DRIFT_BIAS) {
        const dx = goal.x - entity.x
        const dy = goal.y - entity.y
        // LE SEUIL D'ARRIVÉE SE DÉRIVE DU PAS (leçon du corps et du pas) : la
        // bête parcourt `thinkEveryTicks × pas` entre deux relectures du but.
        // L'ancien seuil (0,5 tuile, écrit en dur) était DEUX FOIS PLUS ÉTROIT
        // que ce chemin-là : elle le traversait d'une pensée à l'autre, demi-tour
        // à la pensée suivante, retraversait — le cycle limite de la carte des
        // oscillations (①). La moitié du chemin d'une pensée garantit qu'un
        // aller ne peut plus traverser la zone entière ; 0,5 reste le plancher.
        const pasParPensee = ((def.speed * FAUNA.GRAZE_SPEED) / BALANCE.TICK_RATE_HZ) * def.thinkEveryTicks
        const arrive = Math.max(FAUNA.BUT_ARRIVE_PLANCHER, pasParPensee / 2 + FAUNA.BUT_ARRIVE_MARGE)
        monster.wanderDx = (dx > arrive ? 1 : dx < -arrive ? -1 : 0) as -1 | 0 | 1
        monster.wanderDy = (dy > arrive ? 1 : dy < -arrive ? -1 : 0) as -1 | 0 | 1
      } else if (monster.herdId !== undefined && !veto && roll(state) < FAUNA.DRIFT_BIAS) {
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
    // …ET LA LISIÈRE FAIT TAIRE LES BUTS (`CAP_VETO_TICKS`) : si un but (la
    // migration, la dérive) a mené ici, la pensée suivante le re-viserait et la
    // bête gratterait la même rive en boucle. Le demi-tour se joue, ET le but
    // se tait — au prochain tirage elle broute librement, ailleurs.
    monster.capVetoJusqua = state.tick + FAUNA.CAP_VETO_TICKS
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

/** Ce que le GIBIER vient manger au sol (l'appât du chasseur). Les VERS (forêts-vivantes
 *  §1) sont le premier appât DÉDIÉ : appâter cesse de coûter des points de faim. */
const BAIT_ITEMS: readonly ItemId[] = ['berries', 'raw_meat', 'cooked_meat', 'stew', 'worms']
/** Ce qu'un PRÉDATEUR vient manger au sol — la viande, et rien d'autre (le quartier EST de la
 *  viande, `depecage.md` R4 : un quartier jeté détourne un loup comme une pièce crue). */
const CARRION_ITEMS: readonly ItemId[] = ['raw_meat', 'cooked_meat', 'quartier']

/** La pile au sol la plus proche qui porte un de ces items. */
/** Une pile est-elle POSÉE SUR UNE COULÉE (à ≤ 2 tuiles d'une tuile de chemin) ? Balayage
 *  de la liste — elle fait quelques centaines d'entrées, et on ne la lit qu'aux piles. */
function surUneCoulee(state: SimState, px: number, py: number): boolean {
  const coulees = state.map.coulees
  if (!coulees) return false
  const tx = Math.floor(px)
  const ty = Math.floor(py)
  const width = state.map.width
  for (const i of coulees) {
    if (i < 0) continue
    const x = i % width
    if (Math.abs(x - tx) <= 2 && Math.abs((i - x) / width - ty) <= 2) return true
  }
  return false
}

function nearestPile(
  state: SimState,
  entity: Entity,
  range: number,
  wanted: readonly ItemId[],
): { id: number; x: number; y: number } | undefined {
  let best: { id: number; x: number; y: number } | undefined
  let bestD = Infinity
  for (const p of state.groundItems) {
    if (p.count <= 0 || !wanted.includes(p.item)) continue
    // L'APPÂT SUR UNE COULÉE PORTE PLUS LOIN (forêts-vivantes §4 R5bis) : le chemin amène
    // le nez dessus. La géographie module le COMBIEN, jamais le si — le plancher est la
    // portée nominale, partout. Mémorisé sur la pile à la première lecture (fonction pure
    // de la position : même tick, même valeur, sur tous les moteurs).
    const portee = range * ((p.surCoulee ??= surUneCoulee(state, p.x, p.y)) ? HUNT.BAIT_COULEE_FACTEUR : 1)
    const d = distSq(entity.x, entity.y, p.x, p.y)
    if (d > portee * portee) continue
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
/** Les heures où la harde descend boire (forêts-vivantes §4 R5quater) : l'aube et le soir. */
function crepuscule(hour: number): boolean {
  return (hour >= HUNT.COULEE_AUBE_DE && hour < HUNT.COULEE_AUBE_A)
    || (hour >= HUNT.COULEE_SOIR_DE && hour < HUNT.COULEE_SOIR_A)
}

/**
 * LA HARDE EMPRUNTE SA COULÉE (forêts-vivantes §4 R5quater) — la trace ne ment plus. Aux
 * heures crépusculaires, le gibier dont le COIN est proche d'une fin de coulée rejoint le
 * chemin et le DESCEND, pas à pas dans l'ordre du tracé, jusqu'à l'eau — où il BOIT, tête
 * baissée (`drinkUntil` → BAIT_ALERTNESS : la fenêtre d'affût que la géographie enseigne).
 * UNE descente par fenêtre (couleePas = −1 après avoir bu), purge à la sortie du crépuscule.
 * AUCUN tirage : l'attache est une fonction pure du coin et de la carte (mémorisée), le pas
 * suit l'ordre de la liste — sur une carte sans coulées, la passe est inerte au bit près.
 */
function couleeStep(state: SimState, monster: Monster, entity: Entity, hour: number): boolean {
  const coulees = state.map.coulees
  if (!coulees || coulees.length === 0 || !isPrey(monster.type)) return false
  if (!crepuscule(hour)) {
    if (monster.couleePas !== undefined) delete monster.couleePas
    if (monster.drinkUntil !== undefined) delete monster.drinkUntil
    return false
  }

  // Elle boit : immobile, tête baissée — puis la vie normale reprend jusqu'à l'autre fenêtre.
  if (monster.drinkUntil !== undefined) {
    if (state.tick < monster.drinkUntil) {
      monster.wanderDx = 0
      monster.wanderDy = 0
      return true
    }
    delete monster.drinkUntil
    return false
  }
  if (monster.couleePas === -1) return false // elle a bu cette fenêtre

  // L'ATTACHE, mémorisée UNE fois : « sa » coulée = celle dont la FIN (l'eau) est la plus
  // proche de son coin, à ≤ COULEE_ATTACHE. Fonction pure du coin et de la carte.
  const width = state.map.width
  if (monster.couleeDebut === undefined) {
    monster.couleeDebut = -1
    if (monster.groundX !== undefined && monster.groundY !== undefined) {
      let debut = 0
      let meilleure = HUNT.COULEE_ATTACHE * HUNT.COULEE_ATTACHE
      for (let k = 0; k <= coulees.length; k++) {
        if (k < coulees.length && coulees[k]! >= 0) continue
        if (k > debut) {
          const finIdx = coulees[k - 1]!
          const fx = finIdx % width
          const d2 = distSq(monster.groundX + 0.5, monster.groundY + 0.5, fx + 0.5, (finIdx - fx) / width + 0.5)
          if (d2 < meilleure) {
            meilleure = d2
            monster.couleeDebut = debut
          }
        }
        debut = k + 1
      }
    }
  }
  if (monster.couleeDebut < 0) return false

  // La borne du chemin, puis le raccord : au premier tick de la fenêtre, elle rejoint la
  // tuile du chemin la plus PROCHE d'elle (près de l'eau où elle vit), et descend depuis là.
  let fin = monster.couleeDebut
  while (fin < coulees.length && coulees[fin]! >= 0) fin += 1
  if (monster.couleePas === undefined) {
    let pas = -1
    let meilleure = HUNT.COULEE_ATTACHE * HUNT.COULEE_ATTACHE
    for (let k = monster.couleeDebut; k < fin; k++) {
      const i = coulees[k]!
      const x = i % width
      const d2 = distSq(entity.x, entity.y, x + 0.5, (i - x) / width + 0.5)
      if (d2 < meilleure) {
        meilleure = d2
        pas = k
      }
    }
    if (pas < 0) return false // trop écartée du chemin : pas de descente forcée
    monster.couleePas = pas
  }

  const cible = coulees[Math.min(monster.couleePas, fin - 1)]!
  const cx = (cible % width) + 0.5
  const cy = (cible - (cible % width)) / width + 0.5
  if (distSq(entity.x, entity.y, cx, cy) <= 0.6 * 0.6) {
    if (monster.couleePas >= fin - 1) {
      // Le bout du chemin : l'eau. Elle boit — et ne redescendra pas cette fenêtre.
      monster.drinkUntil = state.tick + HUNT.COULEE_BOIRE_TICKS
      monster.couleePas = -1
      monster.wanderDx = 0
      monster.wanderDy = 0
      return true
    }
    monster.couleePas += 1
    return true
  }
  moveToward(state, monster, entity, cx, cy, false, FAUNA.WARY_SPEED)
  return true
}

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
    if (dot > HUNT.BURROW_BLOCKED_DOT && ml < hl) return false // le chasseur COUPE la ligne : détour
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
 * L'ENVOL (spec faune R21) — LE DÉCOLLAGE.
 *
 * Ce qui vole ne détale pas : ça part en l'air. Le bond est une DROITE, tirée
 * UNE fois au décollage — le cap à l'opposé de la peur, et le point de chute le
 * plus LOINTAIN qui soit posable. Rien ne se recalcule ensuite : un oiseau levé
 * ne négocie pas sa trajectoire, et c'est ce qui rend le tir possible (la cible
 * est prévisible pendant 1,3 s — c'est LE contrat de la fenêtre de tir).
 *
 * IL FRANCHIT CE QUI BLOQUE, IL NE S'Y POSE PAS. On balaie de la portée maximale
 * vers soi et on retient la première tuile marchable, libre ET de son habitat :
 * sans la dernière condition, un tétras levé en lisière atterrissait au pré,
 * hors de chez lui, et repartait aussitôt en `homing` — un vol pour rien. Sans
 * point de chute valable, PAS d'envol : il détale au sol comme les autres (la
 * bête acculée contre une falaise ne s'invente pas une issue).
 *
 * Déterminisme : `sqrt` et l'arithmétique de base, aucun tirage. Deux joueurs
 * voient le même oiseau partir au même endroit.
 *
 * Rend `true` s'il a décollé — l'appelant lui rend alors son tick.
 */
function decolle(state: SimState, monster: Monster, entity: Entity): boolean {
  // Le cap : à l'opposé du point de peur qu'on vient d'arrêter. Sans peur lisible
  // (elle n'a rien vu, elle a été alarmée de loin), l'est arbitraire — mais un
  // oiseau levé PART, il ne reste pas posé faute de direction.
  let dx = entity.x - (monster.fleeFromX ?? entity.x)
  let dy = entity.y - (monster.fleeFromY ?? entity.y)
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len > 0.001) {
    dx /= len
    dy /= len
  } else {
    dx = 1
    dy = 0
  }

  const monde = { map: state.map, structures: state.structures, nodes: state.nodes, etat: state }
  let px = -1
  let py = -1
  for (let d = FAUNA.VOL_TUILES; d >= 1; d--) {
    const tx = Math.floor(entity.x + dx * d)
    const ty = Math.floor(entity.y + dy * d)
    if (tx < 0 || ty < 0 || tx >= state.map.width || ty >= state.map.height) continue
    if (!TERRAINS[terrainAt(state.map, tx, ty)]?.walkable) continue
    if (isBlockedAt(monde, tx, ty)) continue
    if (!inHabitat(state, monster.type, tx, ty)) continue
    px = tx + 0.5
    py = ty + 0.5
    break
  }
  if (px < 0) return false

  monster.volDepuis = state.tick
  monster.volUntil = state.tick + FAUNA.VOL_TICKS
  monster.volFromX = entity.x
  monster.volFromY = entity.y
  monster.volX = px
  monster.volY = py

  // LE MÊME FAIT QUE LA NUÉE DE LA LISIÈRE (`bird_flush`), et c'est voulu : le
  // client sait déjà le peindre et le faire sonner, et le bois alentour prend le
  // même coup de méfiance. Ce qui claque sous vos pieds prévient tout le coin —
  // c'est le prix d'une approche ratée, et il ne se paie pas qu'en un oiseau.
  const tx = Math.floor(entity.x)
  const ty = Math.floor(entity.y)
  emitEvent(state, { type: 'bird_flush', tick: state.tick, x: tx, y: ty })
  alarmeDEnvol(state, tx, ty)
  return true
}

/**
 * L'ENVOL (R21) — LE BOND, tick par tick.
 *
 * Interpolation pure sur la droite du décollage : la position ne se DÉRIVE pas
 * d'une vitesse accumulée, elle se CALCULE de la fraction écoulée. C'est ce qui
 * garantit qu'il se pose exactement où il avait été dit, au bit près, quel que
 * soit le moteur — et qu'un bond ne dérive jamais dans un obstacle.
 *
 * Rend `true` tant qu'il est EN L'AIR (le tick lui appartient, rien d'autre ne
 * s'applique). Au tick de la retombée : nettoie et rend `false` — il se pose EN
 * FUITE, et le reste du pas de fuite s'exécute normalement. Un oiseau ne se pose
 * pas serein.
 */
function volStep(state: SimState, monster: Monster, entity: Entity): boolean {
  const until = monster.volUntil
  if (until === undefined) return false
  const depuis = monster.volDepuis ?? state.tick
  const total = Math.max(1, until - depuis)
  const t = state.tick - depuis

  if (t >= total) {
    entity.x = monster.volX ?? entity.x
    entity.y = monster.volY ?? entity.y
    delete monster.volUntil
    delete monster.volDepuis
    delete monster.volFromX
    delete monster.volFromY
    delete monster.volX
    delete monster.volY
    return false
  }

  const fx = monster.volFromX ?? entity.x
  const fy = monster.volFromY ?? entity.y
  const f = t / total
  entity.x = fx + ((monster.volX ?? fx) - fx) * f
  entity.y = fy + ((monster.volY ?? fy) - fy) * f
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

  // L'ENVOL (R21). EN L'AIR, PLUS RIEN D'AUTRE NE S'APPLIQUE — elle ne broute
  // pas, ne charge pas, ne se couche pas, ne recolle pas à une harde. C'est la
  // raison d'être de la garde en TÊTE de la machine à états : un état de vol
  // interrogé plus bas se serait fait doubler par le sanglier, le couché ou
  // l'appât selon le tick, et l'oiseau aurait clignoté entre deux mondes.
  if (volStep(state, monster, entity)) return

  // LE RÉVEIL (R26) : l'heure rend les sens et la station debout — le sommeil ne
  // survit jamais à ses heures, quelle que soit la branche qui consommera le tick.
  if ((monster.dodo !== undefined || monster.guet !== undefined) && !isResting(monster.type, hour)) {
    delete monster.dodo
    delete monster.guet
  }

  const attacker = monster.lastAttackerId !== null ? byId.get(monster.lastAttackerId) : undefined
  const wounded = entity.hp < def.hp
  const hunted = wounded && attacker !== undefined && attacker.hp > 0
  const herd = monster.herdId !== undefined ? herds.get(monster.herdId) : undefined

  // La charge du sanglier (spec faune R7, combat.md R12) : acculé, il retourne
  // la chasse. Le lapin et le cerf ont `chargeChance: 0` — ils fuient toujours.
  if (hunted && state.tick >= monster.thinkAt) {
    monster.thinkAt = state.tick + def.thinkEveryTicks
    // LE BRAME (S18) : au cœur des Pluies, le cerf s'appelle et CHARGE au lieu de fuir. Le
    // cadran existait déjà pour le sanglier — on l'accorde au cerf, le temps de la saison.
    const brame = monster.type === 'deer' ? (effetsDuJour(jourDeSaison(state)).brame ?? 0) : 0
    const charge = brame > 0 ? Math.min(1, FAUNA.BRAME_CHARGE * brame) : def.chargeChance
    monster.fleeing = roll(state) >= charge
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
  // LA SENTINELLE EST DIURNE (R26) : la nuit, la harde dort au dortoir sans
  // garde permanente — c'est le GUETTEUR, levé par le bruit, qui la remplace.
  const sentinel =
    herd !== undefined && !isResting(monster.type, hour) && sentinelOf(herd, state.tick) === monster.entityId
  const watch = sentinel ? FAUNA.SENTINEL_ACUITY : herd !== undefined && isPrey(monster.type) ? FAUNA.HERD_RELAX : 1
  // Les têtes baissées (chasse C11/C18) : la bête TAPIE à bout de sang, et celle
  // qui MANGE un appât, ne voient plus grand-chose. Ce sont deux fenêtres que le
  // chasseur a lui-même ouvertes — l'une par son coup, l'autre par sa main.
  const headDown =
    monster.rootUntil !== undefined ? FAUNA.ROOT_ALERTNESS
    : monster.bedded ? HUNT.BED_ALERTNESS
    : monster.baitUntil !== undefined ? HUNT.BAIT_ALERTNESS
    : monster.drinkUntil !== undefined ? HUNT.BAIT_ALERTNESS // elle BOIT (§4 R5quater) — même fenêtre
    : 1
  // LE SOMMEIL BRIDE LES SENS (R26) : la dormeuse au dortoir ne voit, n'entend et
  // ne sent presque rien — le guetteur (`guet`), lui, est revenu aux sens pleins.
  const sleep = monster.dodo === true ? FAUNA.SLEEP_SENSES : 1
  const alertness = headDown * watch * sleep
  const alertRange = (def.alertRange ?? 0) * alertness
  const flightRange = (def.flightRange ?? 0) * alertness
  // Le plafond de perception (chasse C1) : au-delà, rien ne monte — mais on
  // regarde jusqu'à SAFE_RANGE, car une bête en fuite surveille plus loin.
  const perceiveRange = alertRange * HUNT.PERCEIVE_FACTOR
  // Le NEZ porte un peu plus loin que l'œil (SCENT_RANGE_FACTOR) : on élargit la
  // fenêtre de recherche en conséquence, sinon la menace au vent ne serait même
  // pas EXAMINÉE — et le vent (C17) n'existerait qu'à courte portée.
  const spotted = nearestThreat(
    state,
    threats,
    entity,
    Math.max(perceiveRange * HUNT.SCENT_RANGE_FACTOR, FAUNA.SAFE_RANGE),
    state.wind,
  )
  const seen = spotted?.e

  // LA CONTAGION D'ALARME (R9). Il suffit qu'UNE bête de la harde vous repère
  // pour que toutes partent — même celles qui n'ont rien vu. Et elle transmet
  // LE POINT DE PEUR (R9bis) : toute la harde fuira le même lieu, ensemble.
  //
  // C'EST UN CRI, PAS UN ÉTAT (mesuré 2026-08-01, plainte « parfois ils
  // tremblent »). Alarmer sur « une sœur COURT en ce moment » rendait l'alarme
  // permanente tant qu'une seule bête tenait sa course : celle qui avait fini la
  // sienne — donc déjà à FLEE_GOAL du point de peur — se faisait relever, voyait
  // sa fuite s'achever DANS LE MÊME TICK, retombait, et se faisait relever au
  // suivant. Un tick de sprint (0,34 tuile), un tick de trot en sens inverse
  // (0,11), vingt fois par seconde : la bête vibrait sur place en clignotant
  // entre deux silhouettes. On n'écoute donc que les cris FRAIS. La vague se
  // propage toujours de proche en proche (chaque bête levée devient à son tour
  // un cri frais) — c'est la levée en chaîne de R9, et elle est intacte.
  let alarmed = false
  let alarmFromX: number | undefined
  let alarmFromY: number | undefined
  if (herd) {
    for (const other of herd) {
      if (other.entityId === monster.entityId || other.fleeSince < 0) continue
      if (state.tick - other.fleeSince > FAUNA.HERD_ALARM_TICKS) continue
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

  // LE GUETTEUR (R26). Trop de bruit : le verrou `wary` d'UNE dormeuse se lève —
  // elle se met debout, sens pleins, et guette (la branche « curieuse » plus bas
  // fait le reste : figée, le regard sur la menace). UNE SEULE par harde : les
  // autres dorment — c'est le guetteur qui, en repérant vraiment quelqu'un,
  // lèvera la harde entière par la contagion.
  if (monster.dodo === true && monster.wary === true) {
    let dejaUnGuet = false
    if (herd) {
      for (const other of herd) {
        if (other.guet === true) {
          dejaUnGuet = true
          break
        }
      }
    }
    if (!dejaUnGuet) {
      delete monster.dodo
      monster.guet = true
    }
  } else if (monster.guet === true && monster.wary !== true) {
    delete monster.guet // le calme est revenu (le verrou est retombé) : elle se recouche
  }

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
    delete monster.dodo // la peur réveille tout (R26) — la fuite se court les yeux ouverts
    delete monster.guet
    if (monster.fleeFromX === undefined) {
      const fx = hunted ? attacker.x : seen ? seen.x : alarmFromX
      const fy = hunted ? attacker.y : seen ? seen.y : alarmFromY
      monster.fleeFromX = fx ?? entity.x
      monster.fleeFromY = fy ?? entity.y
    }
    // L'ENVOL (R21) : ce qui vole ne détale pas, ça DÉCOLLE — et seulement à la
    // levée, jamais en cours de fuite. Une bête ne s'envole qu'une fois par peur :
    // posée, elle court (mal — le tétras est lent au sol), et c'est là qu'on la
    // reprend si on l'a suivie. Le point de peur vient d'être arrêté juste
    // au-dessus, donc le bond porte TOUJOURS à l'opposé de la menace.
    if (def.vol === true && decolle(state, monster, entity)) return
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
            dx += (cx / cl) * FAUNA.HERD_COHESION_WEIGHT
            dy += (cy / cl) * FAUNA.HERD_COHESION_WEIGHT
            const l2 = Math.max(0.001, Math.sqrt(dx * dx + dy * dy))
            dx /= l2
            dy /= l2
          }
        }
        // LA BÊTE DIMINUÉE (chasse C10) : le sang lui coûte sa vitesse. C'est ce
        // qui rend la traque gagnable — l'écart se referme à mesure qu'elle s'épuise.
        moveToward(state, monster, entity, entity.x + dx * CAP_VISEE, entity.y + dy * CAP_VISEE, false, FAUNA.FLEE_SPRINT * woundedSlow(monster, entity))
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
  const threatened = hunted || (seen !== undefined && monster.wary === true)
  if (bedStep(state, monster, entity, threatened)) return

  // L'APPÂT (chasse C18) : la nourriture qu'un chasseur a POSÉE. Elle y va, elle
  // mange, elle ne voit plus rien — la fenêtre du chasseur, ouverte de sa main.
  if (!threatened && monster.dodo !== true && baitStep(state, monster, entity)) return

  // LA COULÉE (forêts-vivantes §4 R5quater) : au crépuscule, la harde descend SON chemin
  // et boit — la fenêtre d'affût que la géographie enseigne. Après l'appât (une pile posée
  // prime : c'est la main du chasseur), avant l'impatience et le repos.
  if (!threatened && monster.dodo !== true && couleeStep(state, monster, entity, hour)) return

  // L'IMPATIENCE (R6bis) : alertée trop longtemps face à une menace plantée là,
  // la bête ne reste pas statue — elle tape du sabot, fixe, puis S'ÉCARTE au
  // trot jusqu'à retomber sous le seuil. (Gibier qui fuit seulement : le
  // sanglier, lui, ne recule pas.)
  // (Elle lit le VERROU d'alerte — `alertSince`, hystérétique — jamais le seuil
  // nu : comparé chaque tick, il faisait alterner recul et broutage.)
  if (
    (def.flightRange ?? 0) > 0 &&
    monster.dodo !== true && // une dormeuse ne tape pas du sabot (R26) — elle dort, ou elle se lève
    seen !== undefined &&
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
  // (Une DORMEUSE ne se fige pas pour regarder — elle dort : c'est le guetteur,
  // debout et aux sens pleins, qui tient ce rôle pour la harde entière.)
  if (seen && monster.wary && monster.dodo !== true) {
    monster.wanderDx = 0
    monster.wanderDy = 0
    const d = Math.sqrt(distSq(entity.x, entity.y, seen.x, seen.y))
    if (d > 0) entity.facing = { x: (seen.x - entity.x) / d, y: (seen.y - entity.y) / d }
    return
  }

  // LE RETOUR AU PAYS. La fuite ne demande la permission à aucun terrain : une
  // bête peut se réveiller à trente tuiles de chez elle, dans un biome qui n'est
  // pas le sien. Elle rentre — avant même de songer à dormir ou à brouter.
  // (SAUF aux heures du dortoir (R26) : le massif élu peut être d'une essence
  // hors habitat — une pinède est un toit, pas un garde-manger — et goHome se
  // battrait toute la nuit contre le dortoir. La nuit, le dortoir EST le pays.)
  if (!(isResting(monster.type, hour) && monster.dortoirX !== undefined) && goHome(state, monster, entity)) return

  // LE RETOUR AU TERRITOIRE (R17). La fuite engagée (30 tuiles) peut la jeter
  // HORS de son coin de chasse. Elle y revient — au trot, et sans traîner : un
  // gibier qui déserterait son canton à chaque frayeur ferait de la carte un
  // brouillard mouvant, et le chasseur ne pourrait rien apprendre.
  //
  // ET LE RETOUR EST COLLANT (`ranging`) — la troisième fois qu'on apprend cette
  // leçon dans ce fichier, après la cohésion et le retour au pays. Rendre la main
  // au franchissement exact de `GROUND_RADIUS` lâchait la bête PILE sur la
  // frontière : un pas de trot (WARY_SPEED, deux fois plus long) la faisait
  // rentrer, deux pas de broutage la ressortaient, et ça vibrait à un cycle de
  // trois ticks — avec le sprite qui se retourne à chaque fois. Elle rentre donc
  // jusqu'à `GROUND_COMFORT`, et la frontière redevient franchissable.
  if (monster.groundX !== undefined && monster.groundY !== undefined) {
    const vetoCanton = monster.capVetoJusqua !== undefined && state.tick < monster.capVetoJusqua
    // (Un veto ÉTEINT se rend ici aussi — pas seulement à la pensée de `graze` :
    // une bête qui ne broute plus traînait le champ périmé dans le snapshot.)
    if (monster.capVetoJusqua !== undefined && !vetoCanton) delete monster.capVetoJusqua
    const away = distSq(entity.x, entity.y, monster.groundX, monster.groundY)
    if (!monster.ranging && !vetoCanton && away > FAUNA.GROUND_RADIUS * FAUNA.GROUND_RADIUS) monster.ranging = true
    else if (monster.ranging && away < FAUNA.GROUND_COMFORT * FAUNA.GROUND_COMFORT) delete monster.ranging
    if (monster.ranging) {
      // LE CANTON NE S'ATTEINT PAS À TRAVERS UN AUTRE PAYS (carte des
      // oscillations ②) : `moveToward(ground)` ne consulte pas l'habitat, or
      // `goHome` — testé juste au-dessus — le fait respecter. Quand le prochain
      // pas de retour SORTIRAIT de l'habitat, les deux branches se préemptaient
      // tick à tick : un pas dehors, un pas dedans, à jamais. Le retour qui bute
      // se tait (`CAP_VETO_TICKS`) — la bête vit où elle est, le canton attendra.
      const dgx = monster.groundX - entity.x
      const dgy = monster.groundY - entity.y
      const lg = Math.max(0.001, Math.sqrt(dgx * dgx + dgy * dgy))
      const pas = (MONSTER_DEFS[monster.type].speed * FAUNA.WARY_SPEED) / BALANCE.TICK_RATE_HZ
      const nx = entity.x + (dgx / lg) * Math.max(1, pas)
      const ny = entity.y + (dgy / lg) * Math.max(1, pas)
      // (Seulement pour qui est CHEZ SOI : une bête déjà dehors — aucun habitat
      // à portée de `goHome` — garde le droit de rentrer à travers n'importe quoi,
      // c'est sa seule route de retour.)
      const chezElle = inHabitat(state, monster.type, Math.floor(entity.x), Math.floor(entity.y))
      if (chezElle && !inHabitat(state, monster.type, Math.floor(nx), Math.floor(ny))) {
        delete monster.ranging
        monster.capVetoJusqua = state.tick + FAUNA.CAP_VETO_TICKS
      } else {
        moveToward(state, monster, entity, monster.groundX, monster.groundY, false, FAUNA.WARY_SPEED)
        return
      }
    }
  }

  // Hors de ses heures, la bête se couche (R10) — et elle se couche AVEC les
  // siens (LE REPOS GROUPÉ, R9bis) : écartée, elle revient d'abord, puis dort.
  // Elle reste réveillable — les branches ci-dessus (fuir, s'alerter) sont
  // passées AVANT : un dormeur qu'on approche détale quand même.
  if (isResting(monster.type, hour)) {
    monster.wanderDx = 0
    monster.wanderDy = 0
    // LE DORTOIR D'ABORD (R26) : une bête de coin dort au massif de SA harde,
    // espacée — « chacun son arbre ». Le repos groupé d'avant ne reste que pour
    // les bêtes sans géographie (banc sans bois, canton sans massif).
    if (dortoirStep(state, monster, entity, herd)) return
    const center = herd ? herdCenter(herd, monster, byId) : null
    // COLLANT, comme tout le reste : le centre de la harde se déplace dès qu'une
    // dormeuse se recale, donc celle qui vient de rentrer sous REST_SPREAD s'en
    // retrouvait dehors au tick suivant. Elle vise le CONFORT, et ne relâche que
    // là. (Même verrou que la cohésion de pâture : les deux branches s'excluent —
    // on broute OU on dort — et c'est le même geste, recoller aux siens.)
    if (center) {
      const d2 = distSq(entity.x, entity.y, center.x, center.y)
      if (!monster.regrouping && d2 > FAUNA.REST_SPREAD * FAUNA.REST_SPREAD) monster.regrouping = true
      else if (monster.regrouping && d2 < FAUNA.REST_COMFORT * FAUNA.REST_COMFORT) delete monster.regrouping
      if (monster.regrouping) moveToward(state, monster, entity, center.x, center.y, false, FAUNA.GRAZE_SPEED)
    } else {
      delete monster.regrouping
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
    const { push, nearestSq } = separationPush(
      herd.length, (i) => herd[i]!.entityId,
      monster.entityId, entity.x, entity.y, (id) => byId.get(id), radius, FAUNA.SEPARATION_DEADBAND,
    )
    if (!monster.separating && nearestSq < FAUNA.HERD_SEPARATION * FAUNA.HERD_SEPARATION) {
      monster.separating = true
      monster.wanderDx = 0
      monster.wanderDy = 0
    } else if (monster.separating && nearestSq >= FAUNA.HERD_SEPARATION_COMFORT * FAUNA.HERD_SEPARATION_COMFORT) {
      delete monster.separating
    }
    if (monster.separating) {
      if (push) {
        // LE PAS SE RANGE EN HUIT — et il faut le ranger ICI (mesuré 2026-08-01).
        //
        // `moveToward` découpe la direction avec sa ZONE MORTE, qui vaut un
        // dixième de tuile : pour une VISÉE (« la tuile là-bas »), c'est une
        // tolérance d'alignement, et c'est juste. Pour un VECTEUR UNITAIRE comme
        // la poussée, c'est un couperet ANGULAIRE à 6° au lieu de 22,5° — le
        // secteur « plein nord » ne fait plus que 11° de large. Or une poussée
        // équilibrée pointe justement le long d'un axe : elle rasait donc la
        // frontière, et la bête alternait nord-ouest / nord-est à chaque tick en
        // montant droit. Elle frissonnait, et son sprite se retournait avec elle.
        //
        // On quantifie donc la poussée AVANT, aux vraies bornes du huitième
        // (sin 22,5° ≈ 0,3827), et on vise une tuile entière dans ce sens-là.
        const q = octantOf(push.x, push.y)
        moveToward(state, monster, entity, entity.x + q.x, entity.y + q.y, false, FAUNA.GRAZE_SPEED)
        return
      }
      // ÉQUILIBRÉE ENTRE SES VOISINES (zone morte de `separationPush`) : elle
      // reste où elle est. Rendre la main au broutage ici rouvrait le
      // tremblement par l'autre bout — le cap d'errance la ramenait AUSSITÔT
      // sur la voisine dont elle venait de s'écarter, la somme des répulsions
      // repassait le seuil, et elle repartait : un aller-retour par tick, la
      // zone morte franchie dans les deux sens. Serrée entre deux congénères,
      // une bête ne broute pas À TRAVERS elles — elle attend qu'on lui fasse
      // de la place. (Ses voisines, elles, continuent de penser : le nœud se
      // défait tout seul.)
      monster.wanderDx = 0
      monster.wanderDy = 0
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
    moveToward(state, monster, entity, entity.x + dx * CAP_VISEE, entity.y + dy * CAP_VISEE, false, FAUNA.CHARGE_SPEED)
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
  // …ET ELLE NE SE LÈVE PAS AU MÊME RAYON (hystérésis — tout seuil qui commande
  // un mouvement veut la sienne) : engagée à `threatRange`, la menace tient
  // jusqu'à `× THREAT_RELEASE`. Sans marge, l'intrus qui longeait l'anneau
  // faisait alterner gel-de-menace et pas de broutage tick à tick.
  const threatRange = FAUNA.THREAT_RANGE * alertness
  const lache = monster.threatSince !== undefined ? threatRange * FAUNA.THREAT_RELEASE : threatRange
  if (!threat || distSq(entity.x, entity.y, threat.x, threat.y) > lache * lache) {
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

/**
 * LE BOND, une fois lancé (spec faune R19) — et sa retombée.
 *
 * Rend `true` tant que le loup est PRIS par le geste : en vol, ou immobile à
 * reprendre pied. Il ne décide de rien ; il exécute ce que `startLeap` a engagé.
 *
 * Trois choses s'y jouent, et chacune paie une dette mesurée :
 *  — LE CAP EST VERROUILLÉ. On vise `leapDx/Dy` pris au départ, jamais la position
 *    courante de la proie : c'est l'esquive latérale, la même leçon que la charge
 *    du sanglier (R14), et la seule raison pour laquelle une meute reste jouable.
 *  — UN COUP PAR BOND (`leapHit`). Un loup qui traverse trois corps n'en encorne
 *    qu'un — sinon le bond deviendrait une tondeuse.
 *  — LA RETOMBÉE (`windedUntil`, partagé avec le souffle du sanglier : c'est le
 *    même fait, et le client en tire déjà la teinte « offerte »).
 */
function leapStep(
  state: SimState,
  monster: Monster,
  entity: Entity,
  byId: Map<number, Entity>,
  monsterByEntity: Map<number, Monster>,
): boolean {
  if (monster.windedUntil !== undefined && state.tick < monster.windedUntil) return true
  delete monster.windedUntil

  // LA DÉTENTE (Alexis, 2026-08-28) : tassé, immobile — le télégraphe du bond.
  if (monster.bondPrepUntil !== undefined) {
    if (state.tick < monster.bondPrepUntil) {
      const t = monster.targetId !== null ? byId.get(monster.targetId) : undefined
      if (t && t.hp > 0) {
        const dx = t.x - entity.x
        const dy = t.y - entity.y
        const l = Math.sqrt(dx * dx + dy * dy)
        if (l > 0.001) entity.facing = { x: dx / l, y: dy / l } // le regard SUIT la proie : on lit où ça part
      }
      return true
    }
    delete monster.bondPrepUntil
    // LE DÉCOLLAGE — cap pris ICI et MAINTENANT, puis verrouillé (R19 : le loup
    // n'est pas un artilleur ; c'est la couverture du bond qui le fait porter,
    // pas une prédiction — et c'est ce qui laisse le pas de côté marcher).
    const t = monster.targetId !== null ? byId.get(monster.targetId) : undefined
    if (!t || t.hp <= 0) return true // la proie est tombée pendant la détente : le bond avorte
    const dx = t.x - entity.x
    const dy = t.y - entity.y
    const l = Math.sqrt(dx * dx + dy * dy)
    if (l < 0.001) return true
    monster.leapUntil = state.tick + FAUNA.LEAP_TICKS
    monster.leapDx = dx / l
    monster.leapDy = dy / l
    monster.leapHit = false
    entity.facing = { x: dx / l, y: dy / l }
    // …et il VOLE dès ce tick : on tombe dans la branche du vol ci-dessous.
  }

  if (monster.leapUntil === undefined) return false

  if (state.tick < monster.leapUntil) {
    const dx = monster.leapDx ?? 0
    const dy = monster.leapDy ?? 0
    moveToward(state, monster, entity, entity.x + dx * CAP_VISEE, entity.y + dy * CAP_VISEE, false, FAUNA.LEAP_SPEED)
    if (monster.leapHit !== true) {
      // CE QU'IL TOUCHE EN PASSANT, et non « sa cible » : un bond est un corps
      // lancé. La proie visée qui s'est écartée n'est pas touchée ; le malchanceux
      // qui se trouvait sur la trajectoire l'est.
      //
      // MAIS JAMAIS UN FRÈRE DE MEUTE — et ce n'est pas une politesse, c'est ce qui
      // décide si la règle marche. Sans cette ligne, MESURÉ : les loups se blessaient
      // les uns les autres à chaque bond (ils chassent épaule contre épaule), passaient
      // sous le seuil de la ROMPUE, décrochaient — et l'homme qui marche finissait à
      // CENT tuiles, intact. Le bond se retournait contre la meute qu'il devait armer.
      // L'ORDRE DE `byId` DÉCIDE QUI ENCAISSE quand deux corps sont à portée — c'est
      // donc du flux déterministe. Il est sûr, et il faut le savoir : l'index est
      // reconstruit à chaque tick depuis `state.entities`, un TABLEAU sérialisé tel
      // quel. Même ordre dans le Worker et sur Node, et après un rechargement.
      const reach = COMBAT.MELEE_ENGAGE_RANGE
      for (const other of byId.values()) {
        if (other.id === entity.id || other.hp <= 0) continue
        const om = monsterByEntity.get(other.id)
        if (om !== undefined && om.herdId !== undefined && om.herdId === monster.herdId) continue
        if (distSq(entity.x, entity.y, other.x, other.y) > reach * reach) continue
        monster.leapHit = true
        applyDamage(state, other, damageOf(monster), entity.id)
        break
      }
    }
    return true
  }

  delete monster.leapUntil
  delete monster.leapHit
  monster.windedUntil = state.tick + FAUNA.LEAP_RECOVER_TICKS
  return true
}

/**
 * LE DÉPART DU BOND (R19, amendé 2026-08-28) — d'abord LA DÉTENTE, puis le vol.
 *
 * Le loup se tasse `LEAP_CROUCH_TICKS` durant (immobile, teinte de menace : le
 * télégraphe), et le cap se verrouille AU DÉCOLLAGE, dans `leapStep` — sur la
 * proie telle qu'elle est à cet instant, sans anticipation : le loup n'est pas
 * un artilleur. C'est le fait que le bond COUVRE plus de terrain que la proie
 * n'en gagne (dimensionnement dans `balance.ts`) qui le fait porter, pas une
 * prédiction — et c'est ce qui laisse le pas de côté marcher.
 */
function startLeap(state: SimState, monster: Monster, entity: Entity, target: Entity, cooldownTicks: number): void {
  const dx = target.x - entity.x
  const dy = target.y - entity.y
  const l = Math.sqrt(dx * dx + dy * dy)
  if (l < 0.001) return
  // IL N'EST PLUS TAPI, et ce n'est pas cosmétique. `stalking` commande DEUX choses
  // hors d'ici : la silhouette (`beast-posture` peint un loup tapi accroupi — un loup
  // en plein vol l'aurait été aussi) et sa VISIBILITÉ (`STALK_STEALTH`, 0,42 : une
  // proie n'aurait vu qu'à moitié le corps qui lui arrive dessus). La branche de la
  // ruée l'éteint déjà pour exactement ces raisons ; le bond est une ruée.
  monster.stalking = false
  // LA DÉTENTE (Alexis, 2026-08-28) : le bond ne part plus À l'instant — le loup
  // se TASSE d'abord, immobile, `LEAP_CROUCH_TICKS` durant (teinte de menace,
  // silhouette tapie : le ressort se bande, et on le VOIT). Le cap, lui, se
  // verrouille AU DÉCOLLAGE (`leapStep`), sur la proie telle qu'elle sera : la
  // détente annonce l'esquive, elle ne l'élargit pas — le pas de côté se joue
  // toujours pendant le vol.
  monster.bondPrepUntil = state.tick + FAUNA.LEAP_CROUCH_TICKS
  monster.wanderDx = 0
  monster.wanderDy = 0
  entity.facing = { x: dx / l, y: dy / l } // le regard désigne déjà la proie
  // Le bond COMPTE comme le coup du loup : il paie la même cadence qu'une morsure,
  // sans quoi il en serait un second, gratuit, par-dessus. Payé AU TASSEMENT :
  // une détente avortée (proie tombée) n'est pas un coup gratuit à rejouer.
  entity.cooldownUntil = state.tick + cooldownTicks
  // …ET IL PAIE SA PROPRE CADENCE (Alexis, 2026-08-28) : `LEAP_COOLDOWN` entre
  // deux bonds du même loup — la morsure de 1,5 s ne suffisait pas, la
  // récupération en dure 1,6 et il repartait au relevé. Écrit ICI, le seul point
  // de départ d'un bond : aucun appelant ne peut l'oublier. La rage le raccourcit
  // de moitié (loup.md L13 — « le bond part plus souvent »).
  const enRage = monster.rageUntil !== undefined && state.tick < monster.rageUntil
  monster.bondAt = state.tick + (enRage ? Math.floor(FAUNA.LEAP_COOLDOWN / 2) : FAUNA.LEAP_COOLDOWN)
}

/**
 * LA CHASSE EST FINIE : IL OUBLIE SON DÉTOUR (R20).
 *
 * Un chemin est fait POUR une proie. Gardé au-delà, il est SÉRIALISÉ dans la sauvegarde
 * et resservirait à la chasse suivante : `PATH_STALE` rattrape le gros des cas, mais pas
 * une proie neuve qui passe près du bout de l'ancien itinéraire — le loup partirait
 * alors sur une route qu'il n'a pas cherchée, vers un lieu qui ne veut plus rien dire.
 * On le jette partout où la cible tombe : la rompue, la satiété, la patrouille.
 */
function oublieLeChemin(monster: Monster): void {
  if (monster.path !== undefined && monster.path.length > 0) monster.path = []
  delete monster.stuckSince
  delete monster.stuckD
}

/**
 * SUIVRE LE PASSAGE (R20) — rend `true` si le loup a un chemin et l'a joué ce tick.
 *
 * Il ne le suit que tant qu'il en a un : dès qu'il est épuisé, il retombe sur sa
 * course droite. C'est ce qui le garde ANIMAL — il ne longe pas un itinéraire quand
 * la voie est libre, il fonce ; le chemin n'est qu'un détour qu'on lui a soufflé.
 */
function pathStep(state: SimState, monster: Monster, entity: Entity, target: Entity): boolean {
  const path = monster.path
  if (!path || path.length === 0) return false

  // PÉRIMÉ : la proie n'est plus au bout. Un chemin qu'on suit vers un lieu que la
  // proie a quitté est pire que pas de chemin — c'est une bête qui court après hier.
  const fin = path[path.length - 1]!
  if (distSq(fin.tx + 0.5, fin.ty + 0.5, target.x, target.y) > FAUNA.PATH_STALE * FAUNA.PATH_STALE) {
    monster.path = []
    return false
  }

  // On consomme d'un coup tous les jalons déjà atteints : les traiter un par tick
  // ferait piétiner la bête à chaque virage serré (le pas vaut 0,24 tuile, un jalon
  // en vaut 1 — trois jalons empilés lui coûtaient trois ticks d'immobilité).
  while (path.length > 0) {
    const wp = path[0]!
    const dx = wp.tx + 0.5 - entity.x
    const dy = wp.ty + 0.5 - entity.y
    if (dx * dx + dy * dy >= BALANCE.WAYPOINT_RADIUS * BALANCE.WAYPOINT_RADIUS) {
      monster.stalking = false
      moveToward(state, monster, entity, wp.tx + 0.5, wp.ty + 0.5, false)
      return true
    }
    path.shift()
  }
  return false
}

/**
 * IL SE COGNE, PUIS IL DEMANDE (R20). Appelé après chaque pas de chasse : c'est le
 * PAS REFUSÉ qui déclenche tout, jamais un raisonnement sur la géométrie.
 *
 * Deux voies, et l'ordre est la décision d'Alexis — « ils n'ont aucune raison d'être
 * trop malins, SAUF si l'un d'entre eux trouve un chemin : il peut le communiquer » :
 *
 *  1. UN FRÈRE SAIT DÉJÀ → on copie son chemin. Coût nul, et c'est la meute qui
 *     devient intelligente, pas le loup. Visuellement, ils s'enfilent par le même
 *     trou l'un derrière l'autre — ce que fait une vraie meute.
 *  2. PERSONNE NE SAIT → il cherche, UNE fois, et la meute entière porte la dépense
 *     (`pathAt` écrit sur tous) : quatre loups coincés coûtent UN A*, pas quatre.
 */
function noteBlocked(
  state: SimState,
  monster: Monster,
  entity: Entity,
  target: Entity,
  /**
   * LE POINT QU'IL VISE VRAIMENT — la proie quand il se rue, son POSTE quand il rampe.
   * Ce n'est pas un détail : un rampeur va vers le cercle à 2 t/s pendant que la proie
   * marche à 4, donc il ne gagne JAMAIS de terrain sur elle. MESURÉ en mesurant la
   * mauvaise distance : HUIT recherches par minute en pleine plaine, sans obstacle.
   */
  butX: number,
  butY: number,
  pack: Monster[] | undefined,
  byId: Map<number, Entity>,
): void {
  // LE PROGRÈS, pas le mouvement. Un loup qui bute sur un mur GLISSE le long (la
  // collision sépare les axes) : `moved` reste vrai et il longerait la roche pour
  // toujours. On mesure donc ce qui compte — s'est-il RAPPROCHÉ ?
  const d = Math.sqrt(distSq(entity.x, entity.y, butX, butY))
  // ARRIVÉ N'EST PAS COINCÉ. Un loup au contact d'une proie qui tourne ne gagne plus
  // de terrain — par définition, il n'en a plus à gagner. MESURÉ sans cette garde :
  // SIX recherches et vingt-six chemins copiés en une minute sur un terrain SANS
  // AUCUN obstacle, la meute se mettant à suivre des itinéraires en pleine plaine.
  // Au-delà de la portée de bond, en revanche, se rapprocher est tout son métier.
  //
  // ELLE SE JUGE SUR LA PROIE, JAMAIS SUR LE BUT. Le but d'un rampeur est son POSTE,
  // à 3,5 tuiles de la proie : comparé à la portée de bond, il est TOUJOURS « arrivé »,
  // et le rampeur bloqué derrière un mur ne cherchait donc jamais rien — la meute qui
  // vient se poster restait plantée, exactement le cas que cette ligne existe pour
  // servir. Le PROGRÈS se mesure sur le but ; la PERTINENCE, sur la proie.
  if (Math.sqrt(distSq(entity.x, entity.y, target.x, target.y)) <= FAUNA.LEAP_RANGE) {
    delete monster.stuckSince
    delete monster.stuckD
    return
  }
  if (monster.stuckSince === undefined || monster.stuckD === undefined) {
    monster.stuckSince = state.tick
    monster.stuckD = d
    return
  }
  if (state.tick - monster.stuckSince < FAUNA.STUCK_TICKS) return
  // La fenêtre est écoulée : un loup lancé couvre 4,8 tuiles en une seconde. S'il n'a
  // pas gagné ne serait-ce que `STUCK_PROGRESS`, quelque chose le retient.
  if (d < monster.stuckD - FAUNA.STUCK_PROGRESS) {
    monster.stuckSince = state.tick
    monster.stuckD = d
    return
  }
  delete monster.stuckSince
  delete monster.stuckD

  // QUELQUE CHOSE BARRE-T-IL, VRAIMENT ? Ne pas gagner de terrain a d'autres causes
  // que les murs : un poste d'encerclement qui bascule de l'autre côté quand la proie
  // fait demi-tour suffit à figer la distance. MESURÉ sans cette garde : SEPT
  // recherches par minute sur un terrain SANS obstacle, et des loups qui suivent un
  // itinéraire en pleine plaine au lieu de courir droit.
  //
  // On échantillonne la droite loup→proie de tuile en tuile. C'est une douzaine de
  // lectures sur l'index d'occupation (caché par carte), soit mille fois moins qu'un
  // A* — et c'est la question exacte que le chemin existe pour résoudre.
  const world = { map: state.map, structures: state.structures, nodes: state.nodes, moverVillageId: null, etat: state }
  const bloque = makeIndexedIsBlockedAt(world)
  const vx = target.x - entity.x
  const vy = target.y - entity.y
  const pas = Math.max(1, Math.floor(Math.sqrt(vx * vx + vy * vy)))
  let barre = false
  for (let i = 1; i <= pas && !barre; i++) {
    const sx = entity.x + (vx * i) / pas
    const sy = entity.y + (vy * i) / pas
    if (bloque(Math.floor(sx), Math.floor(sy))) barre = true
  }
  if (!barre) return

  if (pack) {
    for (const other of pack) {
      if (other.entityId === monster.entityId) continue
      const chemin = other.path
      if (!chemin || chemin.length === 0) continue
      const oe = byId.get(other.entityId)
      if (!oe || oe.hp <= 0) continue
      if (distSq(entity.x, entity.y, oe.x, oe.y) > FAUNA.PACK_CALL_RADIUS * FAUNA.PACK_CALL_RADIUS) continue
      // Copie profonde : deux loups qui partagent le MÊME tableau se le consomment
      // mutuellement — le second suivrait les jalons que le premier a déjà mangés.
      monster.path = chemin.map((p) => ({ tx: p.tx, ty: p.ty }))
      return
    }
  }

  if (monster.pathAt !== undefined && state.tick - monster.pathAt < FAUNA.PATH_COOLDOWN_TICKS) return
  monster.pathAt = state.tick
  if (pack) for (const o of pack) o.pathAt = state.tick // la meute a payé, pas lui seul

  monster.path =
    pathToward(world, entity.x, entity.y, Math.floor(target.x), Math.floor(target.y), FAUNA.PATH_EXPLORE) ?? []
}

/* ── Le prédateur : la meute de loups (spec faune R11) ────────────────────── */

/** Les frères de meute vivants, à portée de cohésion — la mesure du courage. */
function packNearby(herd: Monster[] | undefined, monster: Monster, entity: Entity, byId: Map<number, Entity>): number {
  if (!herd) return 0
  let n = 0
  for (const other of herd) {
    if (other.entityId === monster.entityId) continue
    if (other.petit === true) continue // un petit ne donne pas de courage (loup.md L15)
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
      if (!removeItems(meal.inventory, { raw_meat: 1 })) removeItems(meal.inventory, { quartier: 1 })
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
    // LA JAUGE MANGE (loup.md L6) : une proie en rend `FAIM_PAR_PROIE` — il en
    // faut une ou deux. ET LA DIGESTION DEMEURE (R15, réparée le 2026-08-28) :
    // un repas rend QUIET un temps, quelle que soit la jauge. La première
    // écriture l'avait perdue — un rôdeur de nuit à 0,45 de faim restait en
    // chasse et FAUCHAIT LA COLONNE entière : MESURÉ au diag-raid, butin rentré
    // 0/24, raiders vivants 0/4 — « il mange, puis il vous laisse passer »
    // n'était plus vrai qu'une proie sur deux. Deux horloges, deux rôles : la
    // digestion fait la TRÊVE, la jauge fait le CYCLE (départ, retour).
    if (monster.type === 'wolf') {
      monster.faim = Math.max(0, (monster.faim ?? 1) - FAUNA.FAIM_PAR_PROIE)
    }
    monster.satedUntil = state.tick + FAUNA.SATED_TICKS
    return true
  }

  // Repu : rien à manger de plus. Le loup le lit sur sa jauge (L6), le reste sur R15.
  if (monster.type === 'wolf') {
    if ((monster.faim ?? 1) <= FAUNA.FAIM_RETOUR) return false
  } else {
    if (monster.satedUntil !== undefined && state.tick < monster.satedUntil) return false
    delete monster.satedUntil
  }

  // LE SANG APPELLE (chasse C12). Une carcasse FRAÎCHE porte BIEN plus loin
  // qu'une vieille : `CARCASS_SEEK_FRESH` (40) contre `CARCASS_SEEK` (16). Mis
  // bout à bout avec le portage — qui interdit le silence (C2) —, TUER ARME UN
  // MINUTEUR : on tue, on charge la viande… et on entend le hurlement.
  let best: { id: number; x: number; y: number; pile: boolean } | undefined
  let bestD = Infinity
  for (const c of state.corpses) {
    if (!porteDeLaViande(c)) continue
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

/* ── LA LOUVIÈRE (spec loup.md — décisions d'Alexis 2026-08-28) ───────────── */

/** Le gîte d'un loup résident : le centre de sa Louvière, ou `null` (rôdeur, banc). */
function denOf(state: SimState, monster: Monster): { x: number; y: number } | null {
  if (monster.homePoi === undefined) return null
  const z = state.map.zones[monster.homePoi]
  if (!z || z.kind !== 'louviere') return null
  return { x: z.x + z.w / 2, y: z.y + z.h / 2 }
}

/**
 * LE DÉPART (L7-L8) : l'alpha a faim, le clan part — les petits restent. La
 * destination est le coin de chasse le plus proche QUI N'EST PAS TU (la pression
 * de chasse R16 et la météo font taire) : le joueur qui vide sa clairière envoie
 * sa meute plus loin, et c'est un effet de monde qu'on n'a pas eu à écrire.
 * Sans aucun coin (banc de test) : on chasse autour de chez soi.
 */
function departDuClan(
  state: SimState,
  alpha: Monster,
  pack: Monster[] | undefined,
  byId: Map<number, Entity>,
  den: { x: number; y: number },
): void {
  let dest = den
  let bestD = Infinity
  for (const g of state.grounds) {
    if (isQuiet(state, g.x, g.y)) continue
    const d = distSq(den.x, den.y, g.x, g.y)
    if (d < bestD) {
      bestD = d
      dest = g
    }
  }
  for (const w of pack ?? [alpha]) {
    if (w.petit === true) continue // les petits restent au gîte (L7)
    const e = byId.get(w.entityId)
    if (!e || e.hp <= 0) continue
    w.sortie = true
    w.sortieX = dest.x
    w.sortieY = dest.y
  }
}

/** LE RETOUR (L10) : la sortie s'éteint pour tout le clan — repu, on rentre. */
function finDeSortie(monster: Monster, pack: Monster[] | undefined | null): void {
  for (const w of pack ?? [monster]) {
    delete w.sortie
    delete w.sortieX
    delete w.sortieY
    delete w.chasseAbstraiteAt
  }
}

/**
 * LA RAGE S'ALLUME (L13) — sur tout le clan d'un coup, les petits exceptés.
 * Écriture idempotente, aucun tirage : la rafraîchir chaque tick de sang est sûr.
 */
function enrage(state: SimState, members: Monster[]): void {
  for (const w of members) {
    if (w.petit === true) continue
    w.rageUntil = state.tick + FAUNA.RAGE_TICKS
  }
}

/**
 * QUI A FRAPPÉ LE CLAN (L5) ? Son propre agresseur d'abord, puis celui d'un
 * frère — petits compris : le gîte se défend en CLAN, et c'est ce qui rend le
 * raid de tanière un geste et non un self-service. Borné à `PURSUIT_RANGE` de
 * SOI : un gîte ne poursuit pas son agresseur à travers la vallée — il défend
 * son seuil (la poursuite illimitée est précisément ce que la décision ⑦ écarte).
 */
function clanAggressor(
  state: SimState,
  monster: Monster,
  entity: Entity,
  pack: Monster[] | undefined,
  byId: Map<number, Entity>,
): Entity | undefined {
  const reach = FAUNA.PURSUIT_RANGE * FAUNA.PURSUIT_RANGE
  const own = monster.lastAttackerId !== null ? byId.get(monster.lastAttackerId) : undefined
  if (own && own.hp > 0 && distSq(entity.x, entity.y, own.x, own.y) <= reach) return own
  if (!pack) return undefined
  for (const w of pack) {
    if (w.entityId === monster.entityId || w.lastAttackerId === null) continue
    const we = byId.get(w.entityId)
    if (!we || we.hp <= 0) continue
    const agg = byId.get(w.lastAttackerId)
    if (agg && agg.hp > 0 && distSq(entity.x, entity.y, agg.x, agg.y) <= reach) return agg
  }
  return undefined
}

/**
 * LA VIE DU GÎTE (L5) — ce qu'un adulte tranquille fait de sa journée :
 *
 *   — LA RONDE : un adulte au plus s'écarte jusqu'à `DEN_PATROL_RADIUS`. Le tour
 *     se DÉRIVE du rang et du tick (précédent : la sentinelle R9bis) — zéro état
 *     stocké, et le client calcule exactement le même tour. Le pas de la ronde
 *     suit les relèvements : il FAIT LE TOUR, il ne fait pas l'aller-retour.
 *   — L'EMPRISE : trop loin du gîte (le retour de chasse passe par ici), il rentre.
 *   — LE REPOS (R10) : hors de ses heures, couché, resserré avec les siens.
 *   — sinon il vaque — le broutage ordinaire, ancré sur la gueule du gîte.
 */
function denLife(
  state: SimState,
  monster: Monster,
  entity: Entity,
  pack: Monster[] | undefined,
  byId: Map<number, Entity>,
  hour: number,
  den: { x: number; y: number },
): void {
  const ids: number[] = []
  if (pack) {
    for (const w of pack) {
      if (w.petit === true) continue
      const e = byId.get(w.entityId)
      if (!e || e.hp <= 0) continue
      ids.push(w.entityId)
    }
  }
  if (ids.length === 0) ids.push(monster.entityId)
  ids.sort((a, b) => a - b)
  const garde = ids[Math.floor(state.tick / FAUNA.DEN_PATROL_SHIFT) % ids.length]!
  if (garde === monster.entityId) {
    const b = BEARINGS[Math.floor(state.tick / FAUNA.DEN_PATROL_STEP) % BEARINGS.length]!
    moveToward(state, monster, entity, den.x + b[0] * FAUNA.DEN_PATROL_RADIUS, den.y + b[1] * FAUNA.DEN_PATROL_RADIUS, false, FAUNA.WARY_SPEED)
    return
  }
  // L'EMPRISE EST COLLANTE (diag-tremblement 2026-08-28 : des adultes épinglés à
  // 10,6 du gîte, six inversions de cap par seconde — la séparation des corps
  // poussait la meute vers l'anneau, le rayon nu la rappelait d'un tick). Le
  // rappel s'ENGAGE (`regagne`) et ne lâche qu'à `DEN_HOME_CONFORT` — la même
  // leçon que la cohésion, le retour au pays et le canton.
  const d2 = distSq(entity.x, entity.y, den.x, den.y)
  if (monster.regagne !== true && d2 > FAUNA.DEN_HOME_RADIUS * FAUNA.DEN_HOME_RADIUS) monster.regagne = true
  else if (monster.regagne === true && d2 <= FAUNA.DEN_HOME_CONFORT * FAUNA.DEN_HOME_CONFORT) delete monster.regagne
  if (monster.regagne === true) {
    moveToward(state, monster, entity, den.x, den.y, false, FAUNA.WARY_SPEED)
    return
  }
  if (isResting('wolf', hour)) {
    // LE REPOS GROUPÉ AUSSI (le même patron que `REST_SPREAD`/`REST_COMFORT` de
    // la harde, qui l'avait déjà appris) : rappelé à `REST_SPREAD`, le dormeur
    // ne lâche qu'à `REST_COMFORT` — sinon la séparation le ressortait d'un pas
    // et il se recalait sans fin.
    if (!monster.regrouping && d2 > FAUNA.REST_SPREAD * FAUNA.REST_SPREAD) monster.regrouping = true
    else if (monster.regrouping && d2 < FAUNA.REST_COMFORT * FAUNA.REST_COMFORT) delete monster.regrouping
    if (monster.regrouping) {
      moveToward(state, monster, entity, den.x, den.y, false, FAUNA.GRAZE_SPEED)
      return
    }
    monster.wanderDx = 0
    monster.wanderDy = 0
    return
  }
  graze(state, monster, entity, den)
}

/**
 * LE PAS D'UN PETIT (L15). Il ne se bat jamais — il JOUE, et il SE TERRE :
 *
 *   — LA PEUR : un homme à moins de `PETIT_ALERTE`, il court à la gueule du gîte
 *     et s'y tapit. C'est là qu'on le tue — et c'est là que la fureur (L13) donne
 *     son prix au geste.
 *   — LE JEU : il poursuit un frère, les rôles tournent par tranches de temps
 *     (dérivé du tick — aucun tirage), jamais à plus de `PETIT_JEU_RAYON` du gîte.
 *   — seul, il trottine autour de la gueule.
 */
function pupStep(
  state: SimState,
  monster: Monster,
  entity: Entity,
  quarry: Entity[],
  byId: Map<number, Entity>,
  isAvatar: (id: number) => boolean,
): void {
  const den = denOf(state, monster) ?? { x: entity.x, y: entity.y }

  let menace: Entity | undefined
  let menaceD = FAUNA.PETIT_ALERTE * FAUNA.PETIT_ALERTE
  for (const q of quarry) {
    if (!isAvatar(q.id) || q.hp <= 0) continue
    const d = distSq(entity.x, entity.y, q.x, q.y)
    if (d < menaceD || (d === menaceD && menace !== undefined && q.id < menace.id)) {
      menace = q
      menaceD = d
    }
  }
  if (menace) {
    monster.wanderDx = 0
    monster.wanderDy = 0
    if (distSq(entity.x, entity.y, den.x, den.y) > 1.5 * 1.5) {
      moveToward(state, monster, entity, den.x, den.y, false) // il court se terrer
    }
    return
  }

  // Le camarade de jeu : l'autre petit du clan, s'il vit encore.
  let mate: Monster | undefined
  if (monster.herdId !== undefined) {
    for (const m of state.monsters) {
      if (m.herdId !== monster.herdId || m.petit !== true || m.entityId === monster.entityId) continue
      const e = byId.get(m.entityId)
      if (!e || e.hp <= 0) continue
      if (mate === undefined || m.entityId < mate.entityId) mate = m
    }
  }
  if (mate) {
    const mateE = byId.get(mate.entityId)!
    // Le jeu reste AU GÎTE : trop loin, on rentre d'abord — et LE RETOUR
    // S'ENGAGE (`regagne`, hystérésis jusqu'à `PETIT_JEU_CONFORT`). Le poursuivi
    // FUIT son frère sans regarder où : relâché PILE au rayon, la fuite du jeu
    // le ressortait au tick suivant — vingt inversions de cap par seconde,
    // épinglé à 5,0 du gîte (la pire signature du diag-tremblement 2026-08-28).
    const dDen2 = distSq(entity.x, entity.y, den.x, den.y)
    if (monster.regagne !== true && dDen2 > FAUNA.PETIT_JEU_RAYON * FAUNA.PETIT_JEU_RAYON) monster.regagne = true
    else if (monster.regagne === true && dDen2 <= FAUNA.PETIT_JEU_CONFORT * FAUNA.PETIT_JEU_CONFORT) delete monster.regagne
    if (monster.regagne === true) {
      moveToward(state, monster, entity, den.x, den.y, false, FAUNA.PETIT_JEU_VITESSE)
      return
    }
    // Qui poursuit qui — le rang et la tranche décident, et les rôles tournent.
    const slice = Math.floor(state.tick / FAUNA.PETIT_JEU_SLICE)
    const jeChasse = (monster.entityId < mate.entityId) === (slice % 2 === 0)
    if (jeChasse) {
      if (distSq(entity.x, entity.y, mateE.x, mateE.y) > 1) {
        moveToward(state, monster, entity, mateE.x, mateE.y, false, FAUNA.PETIT_JEU_VITESSE)
      } else {
        monster.wanderDx = 0 // attrapé ! la tranche suivante inversera les rôles
        monster.wanderDy = 0
      }
    } else {
      moveToward(state, monster, entity, mateE.x, mateE.y, true, FAUNA.PETIT_JEU_VITESSE)
    }
    return
  }
  graze(state, monster, entity, den)
}

/**
 * LA ROUTE DE CHASSE (L8-L9) — un résident en sortie qui n'a rien sous la dent
 * fait route vers son coin ; arrivé, si personne ne regarde, LA CHASSE ABSTRAITE
 * se joue : la faim du clan tombe au bout du temps, sans qu'une bête meure.
 *
 * ⚠ C'est cette règle qui ferme la boucle DU TOUT : le gibier est AMBIANT (R1/R3),
 * il n'existe pas là où personne ne regarde — une chasse réelle y viderait un
 * coin vide pour toujours, et un banc qui pose un joueur et un cerf n'aurait
 * rien vu (le banc fabrique la prémisse). Dès qu'un avatar est à `CHASSE_REELLE`,
 * l'horloge s'annule : la vraie chasse reprend tous ses droits.
 */
function sortieTravel(
  state: SimState,
  monster: Monster,
  entity: Entity,
  pack: Monster[] | undefined,
  byId: Map<number, Entity>,
  quarry: Entity[],
  isAvatar: (id: number) => boolean,
): void {
  const sx = monster.sortieX
  const sy = monster.sortieY
  if (sx === undefined || sy === undefined) {
    graze(state, monster, entity, pack ? herdCenter(pack, monster, byId) : null)
    return
  }
  if (distSq(entity.x, entity.y, sx, sy) > FAUNA.SORTIE_ARRIVEE * FAUNA.SORTIE_ARRIVEE) {
    moveToward(state, monster, entity, sx, sy, false, FAUNA.WARY_SPEED) // au trot : il a un but
    return
  }
  // Rendu au coin. L'horloge de l'abstraite est celle de l'ALPHA — une par clan.
  if (monster.alpha === true || pack === undefined) {
    let watched = false
    for (const q of quarry) {
      if (!isAvatar(q.id) || q.hp <= 0) continue
      if (distSq(entity.x, entity.y, q.x, q.y) <= FAUNA.CHASSE_REELLE * FAUNA.CHASSE_REELLE) {
        watched = true
        break
      }
    }
    if (watched) {
      delete monster.chasseAbstraiteAt // on nous regarde : la chasse sera vraie
    } else if (monster.chasseAbstraiteAt === undefined) {
      monster.chasseAbstraiteAt = state.tick + FAUNA.CHASSE_ABSTRAITE_TICKS
    } else if (state.tick >= monster.chasseAbstraiteAt) {
      // LE REPAS QU'ON N'A PAS VU : le clan est nourri, aucune bête n'est morte.
      for (const w of pack ?? [monster]) {
        if (w.sortie === true) w.faim = 0
      }
      finDeSortie(monster, pack)
      return
    }
  }
  // En attendant : la meute quête autour du coin — on peut la SURPRENDRE ici.
  graze(state, monster, entity, { x: sx, y: sy })
}

/**
 * LE DOS D'UNE PROIE (L12) — la direction de sa prise à revers, ou `null` si son
 * regard n'est pas lisible. Les bêtes posent `facing` à chaque pas (chasse C4),
 * l'avatar aussi ; LE PNJ, JAMAIS (`npc.ts` n'écrit pas ce champ — il garde le
 * cap de sa naissance, plein est) : lire son dos rendrait un verdict tiré au
 * sort par la géographie. Contre un PNJ, les postes restent ceux du rang.
 */
function dosDe(state: SimState, target: Entity): { x: number; y: number } | null {
  for (const n of state.npcs) if (n.entityId === target.id) return null
  const f = target.facing
  const l = Math.sqrt(f.x * f.x + f.y * f.y)
  if (l < 0.001) return null
  return { x: -f.x / l, y: -f.y / l }
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

  // LE PETIT (loup.md L15) : il ne se bat pas, il vit — et c'est tout son pas.
  if (monster.petit === true) {
    pupStep(state, monster, entity, quarry, byId, isAvatar)
    return
  }

  // LA FAIM MONTE (L6) — plus lentement aux heures de repos. Elle monte pour tous
  // les adultes, résidents ou rôdeurs : c'est la même bête. Absente = affamé
  // (le rôdeur ambiant naît en chasse, comme il l'a toujours fait).
  {
    const repos = isResting('wolf', hour) ? FAUNA.FAIM_REPOS_FACTEUR : 1
    monster.faim = Math.min(1, (monster.faim ?? 1) + repos / FAUNA.FAIM_PLEINE_TICKS)
  }

  // LA RAGE EXPIRE d'elle-même (L13) : sans nouveau sang, elle retombe.
  if (monster.rageUntil !== undefined && state.tick >= monster.rageUntil) delete monster.rageUntil
  const rage = monster.rageUntil !== undefined

  // 0. LE BOND EN COURS (R19). Il est ENGAGÉ : plus rien ne le fait dévier, ni une
  //    cible qui change, ni une blessure. C'est ce qui le rend esquivable — un bond
  //    qui se corrigerait en vol ne serait qu'une morsure téléguidée, et le pas de
  //    côté du joueur ne vaudrait plus rien.
  if (leapStep(state, monster, entity, byId, monsterByEntity)) return

  // 1. LA ROMPUE. Blessé au-delà du seuil — ou en déroute — il décroche, et rien
  //    ne le ramène tant qu'il n'est pas loin. Un loup ne se sacrifie pas.
  const broken = entity.hp < maxHpOf(monster) * FAUNA.PACK_BREAK_HP
  if (broken || monster.routed) {
    // Un loup qui rompt vous a VU : il n'est plus à surprendre (chasse C6).
    if (monster.alertSince === undefined) monster.alertSince = state.tick
    monster.targetId = null
    monster.stalking = false
    oublieLeChemin(monster)
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

  // LE DÉPART ET LE RETOUR (loup.md L7/L10). Le résident part quand SON ALPHA a
  // faim — le clan part ensemble, et c'est ce qui fait du départ un moment. Le
  // solitaire (rôdeur ambiant, meute de banc sans gîte) se lève tout seul, sur la
  // même hystérésis : FAIM_DEPART arme, FAIM_RETOUR désarme.
  const den = denOf(state, monster)
  if (den !== null && monster.alpha === true) {
    if (monster.sortie !== true && (monster.faim ?? 1) >= FAUNA.FAIM_DEPART) departDuClan(state, monster, pack, byId, den)
    if (monster.sortie === true && (monster.faim ?? 1) <= FAUNA.FAIM_RETOUR) finDeSortie(monster, pack)
  } else if (den === null) {
    if (monster.sortie !== true && (monster.faim ?? 1) >= FAUNA.FAIM_DEPART) monster.sortie = true
    if (monster.sortie === true && (monster.faim ?? 1) <= FAUNA.FAIM_RETOUR) finDeSortie(monster, null)
  }

  // 2. LE REPAS (R15). Affamé, il va à la carcasse et il mange — et sa JAUGE (L6)
  //    tombe d'une proie. Un loup en RAGE ne mange pas : il se bat (L13).
  if (!rage && feedStep(state, monster, entity)) return

  // CHASSE-T-IL ? La rage engage toujours. Sinon deux verrous se superposent :
  // la SORTIE (le cycle — un résident tranquille ne chasse personne, L5 ; le
  // rôdeur de nuit, lui, a été ENVOYÉ) et la DIGESTION (la trêve de R15 : qui
  // vient de manger vous laisse passer, jauge ou pas — c'est elle qui laisse
  // les survivants d'une colonne s'échapper).
  const sated = monster.satedUntil !== undefined && state.tick < monster.satedUntil
  const hunts = rage || (!sated && (monster.nightHunter === true || monster.sortie === true))
  if (!hunts) {
    // IL SE DÉFEND — et le CLAN se défend (L5) : qui frappe un membre, petit
    // compris, trouve les adultes en face. Pas de traque, pas de hurlement :
    // de la défense, et la rompue s'il saigne.
    const aggressor = clanAggressor(state, monster, entity, pack, byId)
    if (aggressor) {
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
    // Rien ne le menace : la vie du gîte (L5), ou la patrouille d'antan. Le
    // joueur peut passer à côté d'une meute tranquille — et c'est un moment de
    // jeu à part entière : on la VOIT, on la contourne, et rien n'arrive.
    monster.targetId = null
    monster.stalking = false
    oublieLeChemin(monster)
    delete monster.alertSince // tranquille : il baisse la garde (C6)
    if (den !== null) {
      denLife(state, monster, entity, pack, byId, hour, den)
      return
    }
    if (goHome(state, monster, entity)) return
    if (isResting('wolf', hour)) {
      monster.wanderDx = 0
      monster.wanderDy = 0
      return
    }
    graze(state, monster, entity, pack ? herdCenter(pack, monster, byId) : null)
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
    chooseQuarry(state, monster, entity, quarry, def.aggroRange * vigor, isAvatar, stealthOf, monsterByEntity, vigor, rage) ??
    packQuarry(state, pack, monster, entity, byId, isAvatar, vigor)
  const target = monster.targetId !== null ? byId.get(monster.targetId) : undefined

  if (target && target.hp > 0) {
    // Une cible prise : le loup est ENGAGÉ — plus de coup propre sur lui (C6).
    if (monster.alertSince === undefined) monster.alertSince = state.tick
    // Un homme est choisi : la meute hurle. Une fois, et le joueur est prévenu.
    if (isAvatar(target.id)) howlOnce(state, pack, monster, entity, target.id)

    // LE SANG ENRAGE (loup.md L13, décision ⑦) : la proie qui saigne met le CLAN
    // en rage — le courage tombe, la traque devient une ruée. Rafraîchie tant que
    // le sang coule ; elle retombera d'elle-même (`RAGE_TICKS`) une fois la plaie
    // fermée ou la proie perdue. Écriture idempotente, aucun tirage.
    if (bleeds(state, target, monsterByEntity)) enrage(state, pack ?? [monster])

    // 4. LE COURAGE. Face à un HOMME, un loup mal entouré suit sans mordre : il
    //    reste à distance de morsure, il pèse. La meute décimée cesse d'attaquer,
    //    et le joueur SENT qu'il a brisé quelque chose. LA RAGE le lève (L13) :
    //    un loup enragé mord, même seul — c'est un frein d'ENGAGEMENT.
    const brave =
      !isAvatar(target.id) ||
      monster.nightHunter === true || // la nuit ne pèse pas un homme : elle est venue pour lui
      monster.rageUntil !== undefined ||
      packNearby(pack, monster, entity, byId) >= FAUNA.PACK_COURAGE
    const d2 = distSq(entity.x, entity.y, target.x, target.y)

    if (!brave) {
      // Il rôde : il se maintient juste hors de portée, sans jamais engager.
      const prowl = COMBAT.MELEE_ENGAGE_RANGE * FAUNA.PROWL_RANGE_FACTOR
      if (d2 > prowl * prowl) moveToward(state, monster, entity, target.x, target.y, false)
      else if (d2 < COMBAT.MELEE_ENGAGE_RANGE * COMBAT.MELEE_ENGAGE_RANGE) {
        moveToward(state, monster, entity, target.x, target.y, true) // trop près : il se retire
      }
      return
    }

    // LE PASSAGE (R20) — il a un détour en tête : il le joue, et il ne bondit pas
    // dans un mur en chemin. Mais si la proie est à portée de crocs (il vient de
    // franchir la porte), la morsure passe d'abord : on ne longe pas un itinéraire
    // avec la gorge de sa proie sous le nez.
    if (d2 > COMBAT.MELEE_ENGAGE_RANGE * COMBAT.MELEE_ENGAGE_RANGE && pathStep(state, monster, entity, target)) return

    // LE BOND (R19) — ON BONDIT SUR CE QUI AVANCE, ON MORD CE QUI EST ARRÊTÉ.
    //
    // C'est `target.moved` qui départage, et c'est tout le correctif : la morsure
    // plantée marche depuis toujours contre une proie immobile (banc « il s'arrête » :
    // 17 morsures) et n'a JAMAIS porté contre une proie qui avance (bancs marche,
    // zigzag, tour de meute : 46 à 72 coups armés, zéro dégât), parce que son wind-up
    // fige le loup pendant que la proie prend 1,8 tuile.
    //
    // Le bond part depuis le POSTE (`LEAP_RANGE` = `ENCIRCLE_RADIUS`) : le loup n'a plus
    // besoin de se coller d'abord — se coller était précisément ce qui ne servait à rien.
    // LA CADENCE DU BOND (Alexis, 2026-08-28 : « il peut le spam sans que le
    // joueur comprenne pourquoi ») : il ne payait que la cadence d'une morsure
    // (1,5 s), or sa récupération en dure 1,6 — relevé, il repartait AUSSITÔT.
    // `bondAt` (écrit par `startLeap`) impose `LEAP_COOLDOWN` entre deux bonds du
    // MÊME loup ; absent = jamais bondi, et le PREMIER bond reste immédiat —
    // c'est lui qui ouvre la chasse, le retarder rouvrirait le zéro-dégât mesuré.
    // Entre deux bonds, il vient au contact et MORD, wind-up visible : le joueur
    // retrouve un rythme qui se lit.
    if (
      target.moved &&
      d2 <= FAUNA.LEAP_RANGE * FAUNA.LEAP_RANGE &&
      state.tick >= entity.cooldownUntil &&
      state.tick >= (monster.bondAt ?? 0) &&
      entity.windup === undefined
    ) {
      startLeap(state, monster, entity, target, def.attackCooldownTicks)
      return
    }

    // LE BOND DE RUPTURE (loup.md L11, décision ⑥) — sur une cible ARRÊTÉE, le
    // bond n'est pas la règle (la morsure plantée la tient) mais il SURVIENT, de
    // temps en temps : une surprise cadencée, jamais une routine. La rage double
    // la cadence. Le premier cycle ATTEND (l'armement part du premier regard) —
    // un bond à la première seconde ne serait pas une surprise, ce serait la règle.
    if (!target.moved && d2 <= FAUNA.LEAP_RANGE * FAUNA.LEAP_RANGE) {
      const cadence = monster.rageUntil !== undefined ? Math.floor(FAUNA.BOND_LENT_COOLDOWN / 2) : FAUNA.BOND_LENT_COOLDOWN
      if (monster.bondLentAt === undefined) monster.bondLentAt = state.tick + cadence
      else if (
        state.tick >= monster.bondLentAt &&
        state.tick >= entity.cooldownUntil &&
        state.tick >= (monster.bondAt ?? 0) && // la cadence du bond vaut pour TOUS les bonds
        entity.windup === undefined
      ) {
        monster.bondLentAt = state.tick + cadence
        startLeap(state, monster, entity, target, def.attackCooldownTicks)
        return
      }
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
    const aware = targetAware(entity, target, monsterByEntity, isAvatar)
    const ready = packInPlace(pack, target, byId)

    // LA RAGE NE RAMPE PAS (L13) : plus de traque, plus de camouflage — il fonce.
    if (monster.rageUntil !== undefined || ready || aware || d2 <= FAUNA.COMMIT_RANGE * FAUNA.COMMIT_RANGE) {
      monster.stalking = false
      moveToward(state, monster, entity, target.x, target.y, false)
      noteBlocked(state, monster, entity, target, target.x, target.y, pack, byId)
      return
    }

    monster.stalking = true
    // LA PRISE À REVERS EST UNE MANŒUVRE DE CIBLE LENTE (L11/L12) : sur une proie
    // ARRÊTÉE, le dos est figé et le poste tient. La calculer sur une proie qui
    // marche faisait TOURNER les postes à chaque pas (le « mieux placé » changeait
    // de tête, la garde du cap scié comptait 7 retournements/s pour un plafond
    // de 4) — le mobile, lui, garde les postes du rang.
    const post = encirclePost(pack, monster, target, target.moved ? null : dosDe(state, target), byId, entity)
    moveToward(state, monster, entity, post.x, post.y, false, FAUNA.STALK_SPEED)
    // Un rampeur bloqué cherche aussi : sinon la meute qui vient se POSTER derrière
    // un mur reste plantée là, et l'encerclement n'a jamais lieu. Son but est son
    // POSTE — c'est sur lui qu'on juge s'il avance.
    noteBlocked(state, monster, entity, target, post.x, post.y, pack, byId)
    return
  }
  monster.stalking = false

  monster.targetId = null
  oublieLeChemin(monster)
  // Retour à la patrouille : la garde retombe — un loup qui ne chasse rien
  // redevient approchable (C6), et c'est toute la décision n°1 de la spec :
  // la mise à mort propre vaut aussi sur les prédateurs.
  if (!monster.routed) delete monster.alertSince

  // 5. Rien à chasser SOUS LA DENT — mais la sortie a une DESTINATION (loup.md
  //    L8-L9) : le résident en chasse fait route vers son coin, et c'est là que
  //    la chasse abstraite se joue si personne ne regarde.
  if (monster.sortie === true && den !== null) {
    sortieTravel(state, monster, entity, pack, byId, quarry, isAvatar)
    return
  }

  // Rien à chasser. Il rentre chez lui s'il en est sorti ; hors de ses heures,
  // il dort ; sinon il patrouille avec les siens (la meute reste groupée).
  if (goHome(state, monster, entity)) return
  if (isResting('wolf', hour)) {
    monster.wanderDx = 0
    monster.wanderDy = 0
    return
  }
  graze(state, monster, entity, pack ? herdCenter(pack, monster, byId) : null)
}

/**
 * LA PROIE A COMPRIS — et le camouflage n'a plus d'objet (R11) : c'est une course.
 *
 * Pour une BÊTE, c'est écrit dans son état : elle est levée, elle détale.
 *
 * Pour un HOMME, ça ne l'était NULLE PART — `monsterByEntity` ne contient pas les
 * avatars, donc ce test rendait toujours faux et la branche « la meute se rue »
 * n'a jamais pu s'exécuter contre un joueur. MESURÉ (2026-08-01, `diag-loup.mts`,
 * 4 graines) : une meute de quatre rampait à 2,0 tuiles/s derrière un homme qui
 * marche à 4 — de 12 à 26 tuiles en six secondes, puis elle perdait sa cible et
 * se rendormait. ZÉRO morsure sur TOUS les bancs, cercle jamais bouclé. « On ne
 * sème pas des loups » (R13) se démentait au pas de promenade.
 *
 * DÉCISION (Alexis, 2026-08-01) : **l'homme qui S'ÉLOIGNE lève la meute.** Figé,
 * ou venant vers elle, il est TRAQUÉ — elle rampe, elle boucle son cercle, puis
 * elle se rue. Se figer devient un vrai choix (gagner du temps contre être
 * encerclé), symétrique du stop-and-go que le joueur apprend déjà à la chasse.
 *
 * Le sens de marche se lit sur `facing`, que le pas d'input pose lui-même
 * (`sim.ts`) : aucun état neuf, rien de plus dans le snapshot. Et `moved` interdit
 * qu'un homme à l'arrêt soit déclaré fuyard sur un vieux cap.
 *
 * RÉSERVÉ AUX AVATARS, et c'est une condition de justesse, pas une préférence :
 * SEUL le pas d'input pose `facing`. Un PNJ ne le pose JAMAIS (vérifié : aucune
 * écriture dans `npc.ts`) — il garde donc éternellement le cap de sa naissance,
 * plein est. Le lire sur un villageois aurait rendu un verdict tiré au sort par la
 * GÉOGRAPHIE : le loup posté à l'ouest l'aurait cru en fuite, celui posté à l'est
 * l'aurait cru immobile, quoi que le villageois fasse. Une proie qui n'est ni bête
 * ni joueur reste donc TRAQUÉE — l'encerclement de R11, exactement comme avant.
 */
function preyFleeing(hunter: Entity, prey: Entity): boolean {
  if (!prey.moved) return false
  const dx = prey.x - hunter.x
  const dy = prey.y - hunter.y
  const l = Math.sqrt(dx * dx + dy * dy)
  if (l < 0.001) return false
  return (prey.facing.x * dx + prey.facing.y * dy) / l > FAUNA.FLEEING_DOT
}

function targetAware(
  hunter: Entity,
  target: Entity,
  monsterByEntity: Map<number, Monster>,
  isAvatar: (id: number) => boolean,
): boolean {
  const m = monsterByEntity.get(target.id)
  if (m !== undefined) return m.fleeSince >= 0
  return isAvatar(target.id) && preyFleeing(hunter, target)
}

/**
 * TOUT LE MONDE EST EN PLACE ? — mais « tout le monde », c'est la meute qui chasse
 * CETTE proie, pas la meute au grand complet.
 *
 * Compter les absents fait dépendre la ruée d'un loup qui n'a rien à voir avec
 * l'affaire : un frère resté au loin — occupé ailleurs, ou parti mourir — retient
 * tous les autres à ramper en l'attendant. MESURÉ (homme figé, un frère à cent
 * tuiles, 3 graines) : première morsure à 5,8 s et 72 % du temps passé à ramper,
 * contre 4,7 s et 60 % quand seuls les encercleurs comptent. Ils finissaient par
 * mordre — non pas parce que le cercle se fermait, mais parce qu'un loup dont le
 * poste est de l'autre côté finit par PASSER sur la proie et s'engage au contact.
 * L'encerclement est l'affaire de ceux qui encerclent.
 */
function packInPlace(pack: Monster[] | undefined, target: Entity, byId: Map<number, Entity>): boolean {
  if (!pack) return true // un loup seul n'a personne à attendre
  const reach = FAUNA.ENCIRCLE_RADIUS + FAUNA.POST_TOLERANCE
  let alive = 0
  for (const w of pack) {
    if (w.targetId !== target.id) continue // il chasse autre chose : il ne compte pas
    const e = byId.get(w.entityId)
    if (!e || e.hp <= 0) continue
    alive++
    if (distSq(e.x, e.y, target.x, target.y) > reach * reach) return false
  }
  return alive > 0
}

/*
 * Les huit relèvements (`BEARINGS`) habitent `vent.ts` depuis l'unification : le vent en est le
 * premier lecteur, l'encerclement et le balayage de sentinelle les réimportent. Mêmes valeurs,
 * même ordre, au bit près — c'est un déplacement, pas une réécriture.
 */

/**
 * LE POSTE d'un loup dans l'encerclement : un point sur le cercle autour de la
 * proie, sur le relèvement que lui donne son RANG dans la meute.
 *
 * Le rang se lit dans l'ordre des `entityId` — stable, sans état à stocker, et
 * identique sur toutes les machines. Les postes sont espacés au maximum : à
 * trois loups on prend un relèvement sur trois (0°, 135°, 270°), pas trois
 * voisins. C'est ce qui ferme le cercle au lieu de faire un peloton.
 */
function encirclePost(
  pack: Monster[] | undefined,
  monster: Monster,
  target: Entity,
  /** LA PRISE À REVERS (loup.md L12) : la direction du dos de la proie — quand il se lit. */
  dos?: { x: number; y: number } | null,
  byId?: Map<number, Entity>,
  entity?: Entity,
): { x: number; y: number } {
  let rank = 0
  let size = 1
  const adultes: Monster[] = []
  if (pack) {
    for (const other of pack) {
      if (other.petit === true) continue // un petit ne tient pas de poste (L15)
      adultes.push(other)
    }
    size = Math.max(1, adultes.length)
    for (const other of adultes) if (other.entityId < monster.entityId) rank++
  }
  // Une meute nombreuse se tient un peu plus large : le cercle doit tenir tout
  // le monde sans que les loups se marchent dessus.
  const radius = FAUNA.ENCIRCLE_RADIUS + (size > 4 ? 1 : 0)

  // LA PRISE À REVERS (L12) : le relèvement le plus proche du DOS revient au loup
  // LE MIEUX PLACÉ pour l'atteindre — pas un bonus, une INTENTION. Le cercle se
  // ferme toujours ; il se ferme avec quelqu'un derrière. Départage par dot
  // (produit scalaire normalisé, `sqrt` seul), égalités par `entityId` : pur.
  let dosIdx = -1
  if (dos && byId && entity) {
    let best = -Infinity
    for (let i = 0; i < BEARINGS.length; i++) {
      const b = BEARINGS[i]!
      const d = b[0] * dos.x + b[1] * dos.y
      if (d > best) {
        best = d
        dosIdx = i
      }
    }
    let bestDot = -Infinity
    let bestId = monster.entityId
    for (const w of adultes.length > 0 ? adultes : [monster]) {
      const e = w.entityId === monster.entityId ? entity : byId.get(w.entityId)
      if (!e || e.hp <= 0) continue
      const dx = e.x - target.x
      const dy = e.y - target.y
      const l = Math.sqrt(dx * dx + dy * dy)
      const dot = l < 0.001 ? -1 : (dx * dos.x + dy * dos.y) / l
      if (dot > bestDot || (dot === bestDot && w.entityId < bestId)) {
        bestDot = dot
        bestId = w.entityId
      }
    }
    if (bestId === monster.entityId && dosIdx >= 0) {
      const b = BEARINGS[dosIdx]!
      return { x: target.x + b[0] * radius, y: target.y + b[1] * radius }
    }
  }

  // Un pas de relèvement premier avec 8 (3) étale les postes au lieu de les
  // agglutiner : rangs 0,1,2 → relèvements 0, 3, 6 (soit 0°, 135°, 270°).
  let idx = (rank * 3) % BEARINGS.length
  if (idx === dosIdx) idx = (idx + 1) % BEARINGS.length // le poste du dos est pris
  const bearing = BEARINGS[idx]!
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
    // Un loup ne fuit qu'un feu ALLUMÉ (faune.md:91, « Feu allumé ») — les braises ne
    // suffisent pas (spec feu-station S3 : la chasse tient à l'allumé, pas aux braises).
    if (fireState(state, s) !== 'lit') continue
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
  /** LA RAGE (loup.md L13) : la poursuite s'allonge jusqu'à `PURSUIT_RANGE_RAGE` — bornée. */
  rage = false,
): number | null {
  let bestId: number | null = null
  let bestScore = Infinity
  for (const q of quarry) {
    if (q.id === entity.id || q.hp <= 0) continue
    // Qui se tient au Feu est intouchable : la meute ne le choisit pas, et
    // l'abandonne s'il l'atteint en fuyant.
    if (isAvatar(q.id) && underFireWard(state, q)) continue

    // La proie qu'on tient DÉJÀ se garde bien plus loin qu'on ne l'aurait prise —
    // mais un loup somnolent lâche prise plus tôt (R10bis). L'ACQUISITION se voile
    // de météo AU POINT DE LA PROIE (spec meteo.md R7 : on se cache dans la pluie) ;
    // la POURSUITE, elle, reste à distance vraie ET par tous les temps — même
    // doctrine que la furtivité trois lignes plus bas : une meute qui vous a choisi
    // ne vous perd ni parce que vous rampez, ni parce qu'il pleut sur vous.
    // LA RAGE ALLONGE LA POURSUITE (loup.md L13) — flatte de l'heure (la fureur ne
    // somnole pas), et BORNÉE : une meute ne poursuit jamais à l'infini (décision ⑦).
    const tenue = rage ? Math.max(FAUNA.PURSUIT_RANGE * vigor, FAUNA.PURSUIT_RANGE_RAGE) : FAUNA.PURSUIT_RANGE * vigor
    const reach = q.id === monster.targetId ? tenue : range * meteoVisionFactor(state, q.x, q.y)
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
