/**
 * LE NIVEAU D'EAU — un scalaire SIGNÉ dont la sécheresse et la crue sont les deux bouts
 * (spec `saisons.md` S10, décisions d'Alexis 2026-08-23).
 *
 *     négatif  · l'eau peu profonde se comporte comme de la TERRE — les mares partent,
 *                les gués deviennent poussière (la sécheresse de l'Ardeur)
 *     zéro     · la carte telle qu'elle est générée
 *     positif  · l'eau peu profonde se comporte comme de l'eau PROFONDE — les gués sont
 *                infranchissables — ET toute tuile de terre à `d ≤ niveau` d'une eau porte
 *                de l'eau peu profonde : **l'eau monte, s'étale depuis les rives, et
 *                redescend quand la crue passe** (le caractère « la Crue », S18)
 *
 * Demander les deux a SIMPLIFIÉ le modèle au lieu de le charger : un mécanisme, deux signes,
 * et le patron reste celui de `gel.ts` — **un état de tuile DÉRIVÉ, jamais une tuile qui
 * bouge**. Rien n'est stocké, rien n'est muté ; la carte de la fin de l'été est la carte du
 * printemps, lue autrement.
 *
 * ═══ L'ARIDITÉ EST GLOBALE, LA CONSÉQUENCE EST LOCALE ═══
 *
 * L'aridité se calcule pour la VALLÉE ENTIÈRE (combien de cycles depuis le dernier front
 * mouillé, × la chaleur de la saison) et non par tuile. C'est un écart assumé à la lettre de
 * la spec, pour deux raisons : les fronts des Pluies couvrent la carte entière (une bande de
 * 4500 sur une vallée de 1580), donc une aridité par point serait uniforme de toute façon ;
 * et surtout, ce que S10 commande est la MARCHABILITÉ et `nearWater` — donc la collision, le
 * pathfinding, les champs de flux et le gate de naissance de la faune, qui l'interrogeraient
 * des milliers de fois par tick. Un scalaire par tick coûte un rembobinage de huit cycles ;
 * un champ par tuile aurait coûté ça par tuile.
 *
 * Ce qui varie dans l'espace, c'est la DISTANCE À L'EAU (`map.distEau`, gelée à l'amorce) :
 * une mare part avant un lac, et la crue s'étale d'abord au bord des rivières. La forme de
 * l'eau reste donc celle de la carte, c'est son étendue qui respire.
 *
 * ═══ CONSÉQUENCE HEUREUSE : LA CRUE NOURRIT LE GIBIER ═══
 *
 * `nearWater` compte une tuile inondée comme de l'eau : les coins de chasse s'étendent avec
 * la montée. L'Éclosion inondée est pénible à traverser ET généreuse à chasser — c'est ce qui
 * en fait un caractère de saison plutôt qu'une gêne.
 */
import { BALANCE, EAU, TEMPERATURE, TERRAIN_DEEP_WATER, TERRAIN_SHALLOW_WATER } from './balance'
import { MARCHABLE, terrainAt, type WorldMap } from './map'
import { frontDuCycle, frontMouille } from './meteo'
import { effetsDuJour } from './modificateur'
import type { SimState } from './sim'
import { jourDeSaison, TICKS_PER_CYCLE, tourForDay } from './time'

/** Ce que `eau.ts` lit d'un état — la façade du client la satisfait comme celle du gel. */
export type EtatEau = Pick<SimState, 'tick' | 'calendarScale' | 'jourDeDepart' | 'map' | 'meteoActive'>

/**
 * COMBIEN DE CYCLES DEPUIS LE DERNIER CIEL MOUILLÉ — plafonné à `EAU.MEMOIRE_CYCLES`.
 *
 * On rembobine l'élection (`frontDuCycle`, l'écrivain unique) au lieu de ranger une date :
 * exactement ce que `neigeAuSol` fait pour la neige tombée. Un front de brouillard ou un vent
 * de cendre ne comptent pas — ils ne mouillent pas —, et l'orage sec de l'Ardeur non plus,
 * ce qui est tout l'intérêt de ce caractère-là.
 */
export function cyclesDepuisPluie(state: EtatEau, tick: number): number {
  if (!state.meteoActive) return EAU.MEMOIRE_CYCLES
  const cycle = Math.floor(tick / TICKS_PER_CYCLE)
  for (let k = 0; k <= EAU.MEMOIRE_CYCLES; k++) {
    const c = cycle - k
    if (c < 0) break
    const front = frontDuCycle(c, state.calendarScale, state.jourDeDepart)
    if (front && frontMouille(front)) return k
  }
  return EAU.MEMOIRE_CYCLES
}

/**
 * L'ARIDITÉ DE LA VALLÉE, dans [0, 1] — le produit de deux termes, et **il faut les deux** :
 * du temps sans pluie ET de la chaleur. Un mois sec d'hiver ne sèche rien ; trois jours de
 * canicule, si.
 */
export function ariditeGlobale(state: EtatEau, tick: number = state.tick): number {
  const jour = jourDeSaison(state as SimState, tick)
  const socle = TEMPERATURE.SOCLE(jour, tourForDay(jour))
  const chaleur = (socle - EAU.CHALEUR_SEUIL) / (EAU.CHALEUR_PLEINE - EAU.CHALEUR_SEUIL)
  if (chaleur <= 0) return 0
  const effets = effetsDuJour(jour)
  const secs = effets.jamaisMouille ? EAU.MEMOIRE_CYCLES : cyclesDepuisPluie(state, tick)
  const temps = (secs / EAU.SECHERESSE_CYCLES) * (effets.aridite ?? 1)
  const v = (chaleur > 1 ? 1 : chaleur) * temps
  return v > 1 ? 1 : v
}

/**
 * LA CRUE, dans [0, 1] — nulle hors du caractère « la Crue » (S18), maximale à l'ouverture de
 * l'Éclosion et décroissante jusqu'à sa fin : **c'est une FONTE**, elle vient du dégel et
 * s'épuise avec lui.
 */
export function crueGlobale(state: EtatEau, tick: number = state.tick): number {
  const jour = jourDeSaison(state as SimState, tick)
  if (!effetsDuJour(jour).crue) return 0
  // La part de la saison déjà écoulée : la fonte est au plus haut le premier jour.
  const dansLaSaison = ((Math.floor(jour) - 1) % BALANCE.ACT_DAYS) / BALANCE.ACT_DAYS
  return 1 - dansLaSaison
}

/** LE NIVEAU D'EAU SIGNÉ, dans [−1, 1]. La seule lecture dont tout le reste découle. */
export function niveauDEau(state: EtatEau, tick: number = state.tick): number {
  return crueGlobale(state, tick) - ariditeGlobale(state, tick)
}

/** La distance à l'eau d'une tuile (0 sur l'eau, plafonnée), ou 0 si la carte est d'avant. */
export function distanceALEau(map: WorldMap, tx: number, ty: number): number {
  const d = map.distEau
  if (d === undefined) return 0
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return 0
  return d[ty * map.width + tx] ?? 0
}

/**
 * CETTE EAU PEU PROFONDE EST-ELLE À SEC ? La mare partie, le gué en poussière — on y marche
 * comme sur la terre, `nearWater` n'y voit plus d'eau, et le poisson n'y est plus.
 */
export function estAsseche(state: EtatEau, tx: number, ty: number, niveau?: number): boolean {
  if (terrainAt(state.map, tx, ty) !== TERRAIN_SHALLOW_WATER) return false
  return (niveau ?? niveauDEau(state)) <= -EAU.SEUIL_ASSECHEMENT
}

/**
 * CETTE TERRE EST-ELLE SOUS L'EAU ? La crue s'étale depuis les rives : une tuile marchable à
 * `d ≤ niveau × PORTEE_CRUE` d'une eau porte de l'eau peu profonde.
 */
export function estInonde(state: EtatEau, tx: number, ty: number, niveauConnu?: number): boolean {
  // ⚠ SORTIE IMMÉDIATE AVANT TOUTE ARIDITÉ. Seule la CRUE inonde, et la crue est nulle 363
  // jours sur 365 — or `niveauDEau` rembobine huit cycles pour connaître l'aridité, dont ce
  // test n'a que faire. `crueGlobale` ne lit qu'un caractère de saison mémoïsé : O(1).
  if (niveauConnu === undefined && crueGlobale(state) <= 0) return false
  const niveau = niveauConnu ?? niveauDEau(state)
  if (niveau <= 0) return false
  const t = terrainAt(state.map, tx, ty)
  if (MARCHABLE[t] !== 1 || t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER) return false
  const d = distanceALEau(state.map, tx, ty)
  return d > 0 && d <= Math.round(niveau * EAU.PORTEE_CRUE)
}

/**
 * CE GUÉ EST-IL INFRANCHISSABLE ? Sous la crue, l'eau peu profonde se comporte comme de l'eau
 * profonde : **les passages se ferment**. C'est le miroir exact du lac gelé qui devient un
 * chemin — la vallée change de forme deux fois par an, dans les deux sens.
 */
export function estGueBloque(state: EtatEau, tx: number, ty: number, niveauConnu?: number): boolean {
  // ⚠ **CE TEST EST SUR LE CHEMIN LE PLUS CHAUD DE LA COLLISION** — `blockedSubAt` l'emprunte
  // une fois par SOUS-TUILE balayée, et les champs de flux ratissent l'eau en permanence. Il
  // sort donc AVANT de toucher à l'aridité : le niveau ne peut dépasser la crue (`niveau =
  // crue − aridité`), donc une crue nulle suffit à conclure, et `crueGlobale` ne coûte qu'une
  // lecture de caractère mémoïsé. Sans cette sortie, chaque sous-tuile d'eau payait un
  // rembobinage de huit cycles d'élection météo.
  //
  // `niveauConnu` se passe quand on balaie PLUSIEURS tuiles au même tick — le RENDU le fait,
  // un chunk entier par signature (`gel-layer.ts`) : le niveau est global, le relire par tuile
  // paierait le rembobinage autant de fois qu'il y a de tuiles. Même porte que `porteDeLEau`.
  if (niveauConnu === undefined && crueGlobale(state) < EAU.SEUIL_GUE_BLOQUE) return false
  if (terrainAt(state.map, tx, ty) !== TERRAIN_SHALLOW_WATER) return false
  return (niveauConnu ?? niveauDEau(state)) >= EAU.SEUIL_GUE_BLOQUE
}

/**
 * L'EAU EST-ELLE PRÉSENTE ICI, AUJOURD'HUI ? La surface unique pour tout ce qui demande « y
 * a-t-il de l'eau » — `nearWater` de la faune, la pêche, le rendu. Elle dit oui sur une eau
 * vivante, non sur une eau asséchée, et oui sur une terre inondée.
 */
export function porteDeLEau(state: EtatEau, tx: number, ty: number, niveauConnu?: number): boolean {
  const t = terrainAt(state.map, tx, ty)
  if (t === TERRAIN_DEEP_WATER) return true
  // `niveauConnu` se passe quand on balaie PLUSIEURS tuiles au même tick (le rayon
  // d'abreuvement d'un coin de chasse) : le niveau est global, le relire par tuile paierait
  // le rembobinage autant de fois qu'il y a de tuiles.
  const niveau = niveauConnu ?? niveauDEau(state)
  if (t === TERRAIN_SHALLOW_WATER) return !estAsseche(state, tx, ty, niveau)
  return estInonde(state, tx, ty, niveau)
}
