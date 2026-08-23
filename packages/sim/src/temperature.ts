/**
 * La TEMPÉRATURE (spec 2026-07-08) — modèle thermostat, pur et déterministe.
 * L'ambiant = BASE − acte + (nuit + biome + fronts, amortis par l'abri), planché
 * par la bulle d'un feu. Aucune fonction transcendante (seul `sqrt`, autorisé).
 *
 * ═══ DEUX ÉCHELLES, UNE UNITÉ : LE DEGRÉ CELSIUS (décision d'Alexis, 2026-08-22) ═══
 *
 * L'AMBIANT vit dans [−18, +22] °C ; LE CORPS dans [25, 37] °C. Ils ne se confondent pas —
 * un corps n'est pas de l'air — et c'est `cibleCorporelle` qui fait le pont : la température
 * à laquelle un corps nu se STABILISE dans cet air-là. Voir l'en-tête de `TEMPERATURE` dans
 * `balance.ts` pour la conversion depuis l'ancienne jauge 0-100 (une application affine :
 * l'équilibrage n'a pas bougé d'un bit, seules les étiquettes ont changé).
 */
import { CENDREUX, POI, TEMPERATURE } from './balance'
import { froidDeCendre, frontAuTick } from './cendre'
import { brumeColdAt } from './brume'
import { fireWarmthFactor } from './fire'
import { die } from './combat'
import { countOf } from './items'
import { terrainAt } from './map'
import { meteoColdAt, pousseeDeCendre } from './meteo'
import { isOnPoiKind } from './poi-discovery'
import { gameTimeAt } from './time'
import type { SimState } from './sim'

const T = TEMPERATURE

/** Borne l'AMBIANT dans la fenêtre du monde (°C). C'est ce plancher qui borne, en cascade,
 *  le froid que le corps peut atteindre : air à `AMBIANT_MIN` ⇒ corps à `CORPS_MORTEL`. */
function clampTemp(v: number): number {
  return Math.max(T.AMBIANT_MIN, Math.min(T.AMBIANT_MAX, v))
}

/**
 * L'AIR QUI TUE — l'ambiant où un corps nu se stabilise PILE à l'hypothermie (−10 °C).
 *
 * DÉRIVÉ des deux échelles, jamais écrit : il suit toute retouche de `PENTE_CORPS`, de
 * `AMBIANT_DOUX` ou des seuils du corps. C'est le repère dont les tests et les specs ont
 * besoin pour dire « cet air-là est mortel » sans confondre un seuil d'AIR et un seuil de
 * CORPS — la confusion que l'ancienne jauge unique rendait invisible.
 *
 * Il tombe exactement sur `GEL.SEUIL_PROFOND`, et ce n'est pas un hasard qu'on garde :
 * **le lac devient un chemin là où l'homme nu commence à mourir de froid.**
 */
export const AMBIANT_HYPOTHERMIE = T.AMBIANT_DOUX - (T.CORPS_SAIN - T.CORPS_HYPOTHERMIE) / T.PENTE_CORPS

/**
 * LA TEMPÉRATURE OÙ UN CORPS SE STABILISE DANS CET AIR — le pont entre les deux échelles.
 *
 * Tant que l'air est plus doux que `AMBIANT_DOUX`, le corps tient ses 37 : le métabolisme
 * suffit. En dessous, il perd `PENTE_CORPS` degré par degré d'air manquant — et comme l'air
 * ne descend jamais sous `AMBIANT_MIN`, la cible ne descend jamais sous `CORPS_MORTEL`.
 *
 * ⚠ C'est un ÉQUILIBRE, pas une température atteinte : `advanceTemperature` y fait DÉRIVER
 * le corps (`driftStep`), il n'y saute pas. Un homme qui traverse une bande de blizzard n'a
 * pas le temps d'y arriver — c'est très exactement ce qui rend la traversée jouable.
 */
export function cibleCorporelle(ambiant: number): number {
  const manque = T.AMBIANT_DOUX - ambiant
  if (manque <= 0) return T.CORPS_SAIN
  return T.CORPS_SAIN - manque * T.PENTE_CORPS
}

/**
 * LE BIOME LE PLUS DOUX de la table — DÉRIVÉ, jamais écrit. `climatMaximal` s'en sert comme
 * borne prouvablement optimiste : la poser en dur (`+5`) rendrait la borne fausse EN SILENCE
 * le jour où quelqu'un ajoute un biome plus tiède, et des nœuds seraient déclarés gelés sans
 * l'être. Le `0` d'amorçage est le défaut d'un terrain absent de la table (`?? 0`).
 */
const BIOME_MAX = Math.max(0, ...Object.values(T.BIOME_OFFSET))

/** Sur l'empreinte d'une structure à toit (maison) — ou d'une Grotte → abrité. */
export function isSheltered(state: SimState, tx: number, ty: number): boolean {
  if (state.structures.some((s) => s.tx === tx && s.ty === ty && s.type === 'house')) return true
  return isOnPoiKind(state, tx, ty, 'grotte')
}

/** Réchauffement du feu le plus proche : FIRE_WARMTH au contact, linéaire → 0 à FIRE_RANGE. */
export function fireBubble(state: SimState, x: number, y: number): number {
  let best = 0
  for (const s of state.structures) {
    if (s.type !== 'fire') continue
    // Un feu éteint ne chauffe plus ; les braises chauffent atténué (spec feu-station S3).
    const factor = fireWarmthFactor(state, s)
    if (factor <= 0) continue
    const dx = s.tx - x
    const dy = s.ty - y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist >= T.FIRE_RANGE) continue
    const warmth = T.FIRE_WARMTH * factor * (1 - dist / T.FIRE_RANGE)
    if (warmth > best) best = warmth
  }
  return best
}

/**
 * Réchauffement des sources chaudes — MÊME LOI que `fireBubble` (linéaire,
 * max au contact → 0 au bord du rayon). C'est un feu qu'on n'a pas allumé :
 * sur une carte où le Grand Froid mord, il réécrit les itinéraires.
 */
export function naturalWarmth(state: SimState, x: number, y: number): number {
  let best = 0
  for (const z of state.map.zones) {
    if (z.kind !== 'source_chaude') continue
    const dx = z.x + z.w / 2 - x
    const dy = z.y + z.h / 2 - y
    const dist = Math.sqrt(dx * dx + dy * dy) // sqrt est autorisé (invariant #2)
    if (dist >= POI.HOTSPRING_RANGE_TILES) continue
    const warmth = POI.HOTSPRING_WARMTH * (1 - dist / POI.HOTSPRING_RANGE_TILES)
    if (warmth > best) best = warmth
  }
  return best
}

/**
 * Température de BASE d'un lieu — biome + heure + acte + abri, SANS aucune source de chaleur
 * (ni feu ni source chaude). C'est le froid « du monde ». Sert au gate d'attraction des
 * Cendreux (spec feu-station S5) : surtout PAS l'ambiant fini (qui inclut le feu), sinon un
 * Cendreux qui s'approche se réchaufferait, franchirait le seuil et oscillerait à la lisière.
 */
export function baselineTemperature(state: SimState, x: number, y: number): number {
  return baselineTemperatureAt(state, x, y, state.tick)
}

/**
 * LE MÊME FROID DU MONDE, À UN TICK QUELCONQUE.
 *
 * Elle existe pour L'HYSTÉRÉSIS DU DÉGEL (spec `gel.md` G8) : « l'eau prend sous son seuil,
 * elle ne dégèle qu'au-dessus de `seuil + HYSTERESIS` » est une loi À MÉMOIRE, or rien du
 * gel n'est stocké. La mémoire se RECALCULE : toutes les composantes du froid — l'heure,
 * l'acte, la bande météo, la nappe de Brume — sont déjà des fonctions pures du tick, il
 * suffisait de ne pas figer l'horloge sur `state.tick`.
 *
 * `baselineTemperature` n'est plus qu'elle, prise sur le tick courant : mêmes expressions,
 * même ordre, au bit près.
 *
 * ⚠ CE QU'ELLE NE SAIT PAS : un front ou une nappe PURGÉS de l'état sont invisibles à sa
 * relecture — elle rend alors le froid d'hier SANS eux, donc trop chaud, jamais trop froid.
 * L'erreur va dans le sens du dégel : elle peut raccourcir une hystérésis, jamais inventer
 * une glace qui n'a pas existé.
 */
export function baselineTemperatureAt(state: SimState, x: number, y: number, tick: number): number {
  const shelter = isSheltered(state, Math.floor(x), Math.floor(y)) ? T.SHELTER_FACTOR : 1
  return froidDuMonde(state, x, y, tick, shelter)
}

/**
 * LE FROID DU MONDE À DÉCOUVERT — l'écrivain unique de `baselineTemperatureAt` et de
 * `climatFlore`, qui ne diffèrent QUE par le facteur d'abri.
 */
function froidDuMonde(state: SimState, x: number, y: number, tick: number, shelter: number): number {
  const base = baseDuMonde(state, tick)
  const exposedSansMeteo = expositionSansMeteo(state, x, y, tick)
  // R11-R12 (`meteo.md`) : LE FRONT LIT LE FROID QU'IL TROUVE. `T₀` est le monde SANS lui, à
  // découvert — c'est sur elle que l'orage décide de sa morsure (`froidEolien`) et que la pluie
  // décide d'être neige (`neigeA`). Calculée ICI, une fois, et passée : pas de seconde lecture.
  const t0 = clampTemp(base + exposedSansMeteo)
  const meteo = meteoColdAt(state, x, y, tick, t0)
  return clampTemp(base + shelter * (exposedSansMeteo - meteo))
}

/**
 * LA TEMPÉRATURE DU MONDE SANS LE FRONT, À DÉCOUVERT — `T₀` de la spec météo (R11-R12) :
 * biome, heure, acte, Brume, cendre ; ni front, ni abri, ni feu. C'est ce que la pluie et
 * l'orage TROUVENT en arrivant : la limite de neige et le refroidissement éolien se lisent
 * dessus, jamais sur la température sous le front (aucune circularité). Mêmes expressions,
 * même ordre que `froidDuMonde` — au bit près.
 */
export function dehorsSansMeteo(state: SimState, x: number, y: number, tick: number): number {
  return clampTemp(baseDuMonde(state, tick) + expositionSansMeteo(state, x, y, tick))
}

/** `BASE − ACT_COLD` : la part du froid qu'aucun toit ne coupe — loi totale (saison-sans-fin T1). */
function baseDuMonde(state: SimState, tick: number): number {
  const time = gameTimeAt(state, tick)
  // La carte est plate : le froid ne vient plus de l'altitude, seulement du BIOME (la neige, le
  // glacier) et de l'heure. Le froid des zones hautes est porté par leur terrain, pas par une hauteur.
  return T.BASE - T.ACT_COLD(time.act)
}

/** L'EXPOSITION hors front — biome, nuit, Brume, cendre — SIGNÉE (le biome peut réchauffer),
 *  celle que l'abri amortit. Le froid du front s'y ajoute dans `froidDuMonde`, après `T₀`. */
function expositionSansMeteo(state: SimState, x: number, y: number, tick: number): number {
  const tx = Math.floor(x)
  const ty = Math.floor(y)
  const time = gameTimeAt(state, tick)
  const biome = T.BIOME_OFFSET[terrainAt(state.map, tx, ty)] ?? 0
  // LA BRUME (spec brume.md R4) et LE FRONT MÉTÉO (spec meteo.md R4) sont des EXPOSITIONS
  // de plus : l'abri les amortit, et le feu comme la tenue les PLANCHENT (l'ambiant est un
  // max) — le déni de zone tombe de ces lois, pas d'une mécanique neuve. Le froid météo
  // arrive en RAMPE (gradient bord → cœur de bande) : le front qui approche se SENT venir.
  // LE FROID DE LA CENDRE (spec `cortege-cendre.md` R3) est une EXPOSITION DE PLUS, au même
  // titre que la brume et le front météo — pas une loi neuve. Il entre donc dans `exposed` :
  // l'abri l'amortit, le feu et la tenue le PLANCHENT (l'ambiant est un `max`). La fiction est
  // gratuite : une terre brûlée n'a plus de couvert, **le froid vient d'où plus rien ne pousse**.
  //
  // Et il traverse `climatFlore` (même écrivain, `shelter = 1`), donc la flore l'encaisse en
  // entier et AUCUNE structure ne le lève — la serre gratuite que `flore-froid` F1bis interdit
  // reste interdite. C'est la contrainte que devra respecter la future parade anti-cendre : elle
  // repoussera le SEUIL, jamais le CLIMAT.
  // ⚠ Le front est lu AU TICK DEMANDÉ, jamais à `state.tick` : cette fonction sert l'hystérésis
  // du dégel (`gel.md` G8), qui relit le froid du monde à un tick passé.
  //
  // LE VENT DE CENDRE (R6) entre ICI, et par la seule porte qui ne ment pas : il gonfle le front
  // QUE LE FROID REGARDE, sans toucher au front réel. La stérilité et la hantise, elles, lisent
  // toujours `frontAuTick` — **le vent pousse, il n'avance pas** : rien ne brûle de plus, rien ne
  // devient stérile de plus, et quand il est passé le monde est exactement où il était.
  const frontFroid =
    frontAuTick(state.map, state.calendarScale, tick) + pousseeDeCendre(state, x, y, tick)
  const cendre = froidDeCendre(state.map, tx, ty, frontFroid)
  // LA NUIT EST UNE PENTE (`partDeNuit`, décision d'Alexis 2026-08-23) : `time.nuit` vaut 1 sur
  // toute la nuit et redescend sur les lisières du jour — le froid du soir se SENT venir, il ne
  // claque plus de douze degrés en un tick. La nuit pleine est inchangée au bit près.
  return biome - T.NIGHT_COLD * time.nuit - brumeColdAt(state, x, y, tick) - cendre // amorti par l'abri
}

/**
 * LE CLIMAT D'UNE PLANTE (spec `flore-froid.md` F1) — le froid du monde SANS abri.
 *
 * C'est `baselineTemperatureAt` avec `shelter = 1`, et rien d'autre : **une plante est
 * dehors.** Comme `1 × exposé === exposé` au bit près, les deux fonctions ne peuvent pas
 * diverger sur une tuile non abritée — c'est le critère A1, et c'est ce qui autorise le
 * client à recalculer le gel de la flore par la même façade que le gel de l'eau.
 *
 * ═══ NI LE FEU NI LA SOURCE CHAUDE (F1bis) ═══
 *
 * Même raisonnement qu'au gel (G1) et qu'au gate des Cendreux : lire `ambientTemperature`
 * ferait d'un feu de camp une SERRE GRATUITE, et le payoff « bâtir des serres AVANT
 * l'hiver » (`agriculture.md` R7) mourrait le jour où on pose un foyer au bord du potager.
 * **Le feu réchauffe les hommes, pas la terre.** C'est aussi le seul terme qui coûterait un
 * balayage des structures par nœud, sur un chemin appelé par la passe économique.
 *
 * Pas d'abri non plus, et c'est délibéré : `isSheltered` ne connaît que la maison et la
 * grotte, il balaie `state.structures`, et la serre — la vraie réponse au froid pour une
 * culture — passe par son TYPE (F4), jamais par le champ thermique.
 */
export function climatFlore(state: SimState, x: number, y: number, tick: number): number {
  return froidDuMonde(state, x, y, tick, 1)
}

/**
 * LE POINT LE PLUS DOUX QUE LA VALLÉE PUISSE ATTEINDRE À CE TICK, pour la flore — O(1),
 * aucune lecture de carte. Patron de `gelPossible` (spec `gel.md`), à l'envers : là où
 * `gelPossible` SURESTIME le froid pour ne jamais rater une glace, celle-ci le SOUS-ESTIME
 * pour ne jamais déclarer gelé ce qui ne l'est pas.
 *
 * Sert de court-circuit à la passe économique : quand `climatMaximal < FLORE.SEUIL_GEL`,
 * **tout ce qui vit gèle**, où que ce soit — inutile d'aller lire le terrain d'un nœud, ni
 * la Brume, ni le front. C'est exactement le cas coûteux (l'acte III entier, et toutes les
 * nuits dès l'acte II) : celui où des milliers de nœuds sont à échéance et gelés à la fois.
 *
 * `+2 °C` est le biome le plus DOUX de la table (`BIOME_OFFSET`, le couvert forestier) ; la
 * Brume et le front ne peuvent que refroidir, donc les ignorer ne fait que surestimer la
 * douceur. La borne est prouvablement optimiste, jamais approchée.
 */
export function climatMaximal(state: SimState, tick: number): number {
  const time = gameTimeAt(state, tick)
  // Le terme de nuit est le MÊME que celui d'`expositionSansMeteo` — la pente exacte, pas le
  // booléen : global au monde, il n'a pas à être majoré, et la borne reste prouvablement douce.
  return clampTemp(T.BASE - T.ACT_COLD(time.act) + BIOME_MAX - T.NIGHT_COLD * time.nuit)
}

/** Température ambiante cible (0-100) au lieu (x,y) : le froid de base, PLANCHERÉ par un feu / une source chaude. */
export function ambientTemperature(state: SimState, x: number, y: number): number {
  // Ni le feu ni la source chaude ne peuvent refroidir : ils ne font que plancher.
  return Math.max(baselineTemperature(state, x, y), fireBubble(state, x, y), naturalWarmth(state, x, y))
}

/** Un pas de dérive vers une cible, freiné par l'isolation. Pur. Une dérive proportionnelle
 *  à l'écart est INVARIANTE par changement d'échelle affine : `K_DRIFT` n'a pas eu à bouger
 *  quand la jauge est passée en degrés. */
export function driftStep(current: number, ambient: number, insulation: number): number {
  return current + ((ambient - current) * T.K_DRIFT) / insulation
}

/**
 * L'ÉVEIL D'UN CENDREUX EN CE POINT, À CE TICK — le cadran unique du monstre (décisions
 * d'Alexis 2026-08-21). 0 = amorphe (il fait chaud), 1 = plein régime (le froid mord),
 * PENTE CONTINUE entre `TORPEUR.CHAUD` et `TORPEUR.FROID` — jamais un seuil.
 *
 * Lit le froid de BASE (`baselineTemperatureAt` — hors feu, sinon un cendreux qui approche
 * d'un foyer se « réchaufferait » et oscillerait à la lisière de la bulle, la note de S5).
 * PARAMÉTRÉ PAR TICK, et c'est structurel : le présage de horde se décide à l'AUBE pour le
 * crépuscule à venir — dimensionné sur l'éveil du tick COURANT (le jour, chaud), aucune horde
 * n'aurait marché avant l'acte III (constat du panel). Vit ici et non dans `cendreux.ts`
 * parce que `monsters.ts` en a besoin sans cycle d'imports.
 *
 * Sur la nuit de plaine, cette pente REND l'ancienne table `UNDEAD_SHARE` au bit près
 * (60/35/10 → 0/0,5/1) ; partout ailleurs, la géographie décide enfin (neige, glacier,
 * brume, front, cendre). La saison refroidit la vallée : la montée tombe de la table du
 * froid, elle n'est plus décrétée.
 */
export function eveilCendreuxAt(state: SimState, x: number, y: number, tick: number): number {
  return eveilPourTemperature(baselineTemperatureAt(state, x, y, tick))
}

/** La pente seule, pour qui a déjà la température en main (un tick de `cendreuxStep` la lit
 *  une fois et en tire l'éveil, l'allure ET le gate de convergence — un seul relevé du froid). */
export function eveilPourTemperature(T: number): number {
  const t = CENDREUX.TORPEUR
  const e = (t.CHAUD - T) / (t.CHAUD - t.FROID)
  return e < 0 ? 0 : e > 1 ? 1 : e
}

/** Dégâts PV/tick dus au froid, sur la température du CORPS : 0 au-dessus de
 *  `CORPS_HYPOTHERMIE` (29 °C), linéaire jusqu'au maximum à `CORPS_MORTEL` (25 °C). */
export function coldDamagePerTick(temp: number): number {
  if (temp >= T.CORPS_HYPOTHERMIE) return 0
  const u = (T.CORPS_HYPOTHERMIE - temp) / (T.CORPS_HYPOTHERMIE - T.CORPS_MORTEL)
  return (u > 1 ? 1 : u) * T.HYPOTHERMIA_DAMAGE_MAX
}

/** L'ENGOURDISSEMENT, sur la température du CORPS : 0 à `CORPS_CONFORT` (37 °C), 1 à
 *  `CORPS_HYPOTHERMIE` (29 °C), linéaire entre les deux. */
export function coldEffectRamp(temp: number): number {
  if (temp >= T.CORPS_CONFORT) return 0
  if (temp <= T.CORPS_HYPOTHERMIE) return 1
  return (T.CORPS_CONFORT - temp) / (T.CORPS_CONFORT - T.CORPS_HYPOTHERMIE)
}

/** Malus de vitesse dû à l'engourdissement : 1 au confort, plancher SPEED_FLOOR à l'hypothermie. */
export function coldSpeedFactor(temp: number): number {
  return 1 - coldEffectRamp(temp) * (1 - T.SPEED_FLOOR)
}

/** Malus de régén d'endurance dû à l'engourdissement : 1 au confort, plancher STAMINA_FLOOR à l'hypothermie. */
export function coldStaminaRegenFactor(temp: number): number {
  return 1 - coldEffectRamp(temp) * (1 - T.STAMINA_FLOOR)
}

/** Fait dériver chaque humain vers son ambiant. Une étape de tick. */
export function advanceTemperature(state: SimState): void {
  const monsterIds = new Set(state.monsters.map((m) => m.entityId))
  // Copie défensive (comme advanceCombat) : die() peut réassigner state.entities.
  for (const entity of [...state.entities]) {
    if (monsterIds.has(entity.id)) continue // pas de température pour les monstres
    let ambient = ambientTemperature(state, entity.x, entity.y)
    // LA TENUE D'HIVER PLAFONNE LE FROID (spec cuir/température) : la porter plancher
    // l'ambiant ressenti — au-dessus de l'hypothermie, donc survivable. C'est ce qui
    // donne une raison à toute la chaîne chasse→cuir→couture, et rend la plaine
    // franchissable en acte III. Vraie protection, pas un simple ralentissement de dérive.
    if (countOf(entity.inventory, 'tenue_hiver') > 0) ambient = Math.max(ambient, T.TENUE_FLOOR)
    // LA DÉRIVE SE FAIT SUR L'ÉCHELLE DU CORPS : on vise `cibleCorporelle(ambiant)`, jamais
    // l'air lui-même — un corps ne finit pas à la température de l'air, il se stabilise plus
    // haut. Le clamp est celui du corps : `CORPS_MORTEL` est le fond, atteint quand l'air est
    // à `AMBIANT_MIN`.
    const cible = cibleCorporelle(ambient)
    const derive = driftStep(entity.temperature, cible, T.INSULATION_BODY)
    entity.temperature = Math.max(T.CORPS_MORTEL, Math.min(T.CORPS_SAIN, derive))

    const dmg = coldDamagePerTick(entity.temperature)
    if (dmg > 0) {
      const before = entity.hp
      entity.hp = Math.max(0, entity.hp - dmg)
      if (before > 0 && entity.hp <= 0) die(state, entity, 0, 'cold')
    }
  }
}
