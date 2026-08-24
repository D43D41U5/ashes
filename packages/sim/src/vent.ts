/**
 * LE VENT (spec `vent.md`, décision d'Alexis 2026-08-24 : « le front est le vent, unifie »).
 *
 * ═══ CE QUI N'ALLAIT PAS ═══
 *
 * Le jeu portait DEUX vents qui ne se connaissaient pas. `state.wind` : un des huit relèvements,
 * qui SAUTAIT d'un coup toutes les cinq minutes, norme 1, sans force, avec un unique lecteur —
 * l'odorat (chasse C17). Et le FRONT MÉTÉO : une bande cardinale qui traverse la vallée en une
 * demi-journée, c'est-à-dire DÉJÀ une direction de vent. Le même fait physique modélisé deux
 * fois : un front de pluie pouvait entrer par le nord pendant que les herbes se couchaient
 * vers l'est.
 *
 * ═══ LE MODÈLE ═══
 *
 * Le vent ne se pose plus, il se DÉRIVE. Il n'y a plus de vent « à part » : il y a un front qui
 * marche, et le vent EST sa marche. Entre deux fronts, un relèvement d'ambiance tient le monde
 * en vie (c'est l'ancien vent, inchangé).
 *
 * LE CAP EST GLOBAL, LA FORCE EST LOCALE. Le souffle dépend du point (la bande est spatiale) ;
 * le cap ne le peut pas — un front fait tourner le vent sur TOUTE la vallée, et un cap qui
 * changerait de tuile à tuile serait absurde autant qu'inaffichable. Le cap se pilote donc sur
 * le souffle pris AU CENTRE DE LA CARTE ; la force se lit au point (`ventForceAt`).
 *
 * ═══ TROIS CONTRAINTES, CHACUNE HÉRITÉE ═══
 *
 * 1. PUR À FRONT DONNÉ, ET SANS MÉMOIRE. Aucun état propre : tout se calcule de `(front, tick,
 *    x, y)` et du relèvement d'ambiance, lui-même `hash2(seed, tranche)`. `neigeAuSol` REMBOBINE
 *    la géométrie des cycles passés (`gel.md` G7) : un vent qui garderait un cap lissé d'un tick
 *    à l'autre ne se rembobinerait plus. Le lissage vit au client (`vent-lisse.ts`).
 * 2. ZÉRO TIRAGE PRNG. Tout par `hash2`, jamais par le PRNG de l'état — sans quoi un monde sans
 *    faune paierait quand même le vent, et l'ordre des tirages changerait avec la météo
 *    (garde A5, héritée d'A18).
 * 3. PAS DE TRIGONOMÉTRIE. Le cap parcourt des INDEX de `BEARINGS` : + − × ÷ et `Math.round`.
 */

import { HUNT, VENT } from './balance'
import { frontDuCycle, meteoIntensityAt, type MeteoFront } from './meteo'
import { hash2 } from './noise'
import type { SimState } from './sim'
import { TICKS_PER_CYCLE } from './time'

/**
 * CE QU'IL FAUT POUR LIRE LE VENT — la façade, patron d'`EtatEau` (`eau.ts`).
 *
 * Le CLIENT lit les mêmes lois que la sim (écrivain unique, A8) mais n'a pas de `SimState` : il
 * a un snapshot. Exiger l'état entier l'aurait forcé soit à un cast, soit à une seconde formule
 * — et une seconde formule diverge au premier calibrage. `SimState` s'y assigne tel quel.
 *
 * ⚠ PAS DE `seed` ICI, DÉLIBÉRÉMENT. Seul `capAt` en a besoin (le relèvement d'ambiance), et
 * seule la sim l'appelle. La façade du gel dont le client se sert n'a PAS de graine — son type
 * dit `SimState` mais son objet ne porte que sept champs : l'exiger ici aurait typé vrai et lu
 * `undefined` au runtime, en silence. `capAt` demande donc un `SimState`, et le dit.
 */
export type EtatVent = Pick<SimState, 'tick' | 'map' | 'wind' | 'calendarScale' | 'jourDeDepart' | 'meteo' | 'meteoActive'>

/** La graine des `hash2` de ce module — « VENT » en ASCII, comme `0x57494e44` l'était pour
 *  l'ancien relèvement (dont on garde la clé à l'identique : voir `indexAmbiant`). */
const VENT_SALT = 0x56454e54

/**
 * Les huit relèvements. Des LITTÉRAUX, pas des `cos`/`sin` : une valeur qui décide d'un
 * déplacement est dans le flux déterministe, et la spec ECMAScript ne garantit pas la
 * trigonométrie d'un moteur à l'autre (invariant 2). 0.7071 ≈ √2/2.
 *
 * Ils vivaient dans `faune.ts` (postes de meute, balayage de sentinelle, vent) ; ils habitent
 * ici depuis l'unification, parce que le vent en est désormais le premier lecteur — et `faune.ts`
 * les réimporte. Déplacement PUR : mêmes valeurs, même ordre, au bit près.
 */
export const BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071],
  [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071],
]

/**
 * V1 — LE CAP D'UN FRONT EST SON AXE DE TRAVERSÉE, et c'est un INDEX de `BEARINGS`.
 *
 * La convention est celle de `frontMeteoPos`, à la lettre : « ouest (0) et nord (2) traversent
 * vers +axe ; est (1) et sud (3) vers −axe », l'axe `y` croissant vers le sud. Un front qui
 * entre par l'ouest pousse donc vers l'est : `(+1, 0)`, l'index 0.
 *
 * Les quatre cardinaux sont les index PAIRS — c'est ce qui permet au virage de passer par les
 * diagonales intermédiaires.
 */
export function indexDuFront(edge: MeteoFront['edge']): number {
  return edge === 0 ? 0 : edge === 1 ? 4 : edge === 2 ? 2 : 6
}

/** Le vecteur du cap d'un front — `indexDuFront` lu dans la table. Écrivain unique : aucun
 *  autre module ne compose un cap depuis `front.edge` (garde A8), le client compris. */
export function capDuFront(edge: MeteoFront['edge']): readonly [number, number] {
  return BEARINGS[indexDuFront(edge)]!
}

/**
 * LE FRONT QUI SOUFFLE au tick donné — celui que lisent LE CAP ET LA FORCE, ensemble.
 *
 * ═══ L'ANGLE MORT DU BORD DE CYCLE, ET SA SORTIE ═══
 *
 * `state.meteo` est nul avant l'élection, et l'élection tombe AU BORD DE CYCLE. Or `frontDuCycle`
 * pose `startTick = debut` quand la marge est nulle — « une pluie d'automne occupe le CYCLE
 * ENTIER : le front part à l'aube ». Pour ces fronts-là, c'est-à-dire PRÉCISÉMENT CEUX OÙ LE
 * PRÉSAGE COMPTE LE PLUS, l'avance de phase voudrait mordre sur le cycle précédent, où le front
 * n'existe pas encore : le vent ne se lèverait jamais avant les plus longues pluies.
 *
 * Sortie : quand `tick + AVANCE_TICKS` franchit le bord de cycle, on lit `frontDuCycle(cycle+1)`.
 * Ce n'est pas une entorse, c'est UN PATRON DÉJÀ EN PLACE — `advanceMeteo` appelle exactement
 * cette fonction au crépuscule pour annoncer le blizzard du lendemain, « la même fonction que
 * l'aube : le mensonge est impossible par construction ». L'avertissement porté par `meteo.ts`
 * (« elle dit ce que le cycle AURAIT élu ») vise les cycles PASSÉS d'un monde qui ne les a pas
 * vécus ; ici on regarde en AVANT, et le cycle à venir sera élu par cette fonction même.
 *
 * ⚠ Le cap et la force doivent lire LE MÊME front, sinon le vent forcirait sans tourner puis
 * tournerait d'un coup à l'aube. C'est pour cela que ce choix vit ici, et une seule fois.
 */
export function frontQuiSouffle(state: EtatVent, tick: number = state.tick): MeteoFront | null {
  if (!state.meteoActive) return null
  const t = tick + VENT.AVANCE_TICKS
  const courant = state.meteo
  if (courant && t >= courant.startTick && t < courant.endTick) return courant
  const cycle = Math.floor(tick / TICKS_PER_CYCLE)
  if (Math.floor(t / TICKS_PER_CYCLE) === cycle) return null
  const prochain = frontDuCycle(cycle + 1, state.calendarScale, state.jourDeDepart)
  if (prochain && t >= prochain.startTick && t < prochain.endTick) return prochain
  return null
}

/**
 * V2 — LE SOUFFLE EN UN POINT : l'intensité du front lue EN AVANCE DE PHASE.
 *
 * Aucune géométrie nouvelle, aucune seconde rampe à calibrer — c'est la MÊME bande, en avance.
 * Conséquence voulue et suffisante : le vent monte à découvert avant que la bande n'arrive, puis
 * retombe pendant que la queue de la pluie finit de passer. Le présage est GAGNÉ (le joueur sent
 * le front venir avant de le voir) au lieu d'être décoré.
 */
export function souffleAt(state: EtatVent, x: number, y: number, tick: number = state.tick): number {
  const front = frontQuiSouffle(state, tick)
  if (!front) return 0
  return meteoIntensityAt(front, tick + VENT.AVANCE_TICKS, state.map.width, state.map.height, x, y)
}

/**
 * V3 — LA FORCE AU POINT, et pourquoi elle n'habite pas la norme du cap.
 *
 * `state.wind = {0, 0}` est une SENTINELLE VIVANTE, pas une valeur : elle dit « ce monde n'a pas
 * de vent, et n'en aura jamais » — une décision d'HÔTE, comme `faunaCap`, dont les bancs se
 * servent pour mesurer l'odorat en canal isolé. Une force qui pourrait légitimement valoir 0 au
 * calme serait entrée en collision avec elle, exactement comme les `max(…, 0)` sont entrés en
 * collision avec le zéro Celsius. D'où : cap unitaire dans `wind`, force dans un champ séparé.
 *
 * ⚠ DEUX ZÉROS DIFFÉRENTS. Le 0 rendu ici est celui de la SENTINELLE (le monde sans vent) ;
 * `VENT.AMBIANT` est le plancher d'un monde VENTÉ au calme. Ne jamais « réparer » le premier en
 * le remontant au second : c'est par là que le calme plat fuirait, et la mesure des bancs
 * deviendrait silencieusement fausse.
 */
export function ventForceAt(state: EtatVent, x: number, y: number, tick: number = state.tick): number {
  if (state.wind.x === 0 && state.wind.y === 0) return 0
  return VENT.AMBIANT + (1 - VENT.AMBIANT) * souffleAt(state, x, y, tick)
}

/**
 * LE GAIN — la force rapportée à l'ambiance : 0 au calme plat, EXACTEMENT 1 hors front, et
 * jusqu'à `1 / AMBIANT` au cœur d'une bande.
 *
 * C'est la forme que consomment les règles calibrées AVANT le vent (l'odorat, V7) : hors météo,
 * `souffle` vaut 0, donc `force` vaut `AMBIANT + 0` — le même nombre, et la division rend 1 au
 * bit près. Une règle multipliée par ce gain est donc INCHANGÉE dans tous les mondes sans front,
 * et seulement là où un front souffle elle change. C'est ce qui rend V7 sûr à livrer.
 */
export function ventGain(state: EtatVent, x: number, y: number, tick: number = state.tick): number {
  return ventForceAt(state, x, y, tick) / VENT.AMBIANT
}

/** Le relèvement d'ambiance d'une tranche. La clé `0x57494e44` est celle de l'ancien
 *  `advanceWind` : à tranche égale, le vent d'ambiance est IDENTIQUE à celui d'avant
 *  l'unification — un monde sans météo souffle exactement comme hier. */
function indexAmbiant(seed: number, tranche: number): number {
  return Math.floor(hash2(seed, tranche, 0x57494e44) * BEARINGS.length) % BEARINGS.length
}

/**
 * V4 — LE CAP GLOBAL. Il parcourt les relèvements intermédiaires de l'ambiance vers le cap du
 * front à mesure que le souffle (AU CENTRE DE LA CARTE) monte — en INDEX ENTIER.
 *
 * ═══ POURQUOI PAS UN LERP DE VECTEURS ═══
 *
 * La forme évidente — `normalise(capAmbiant × (1−souffle) + capDuFront × souffle)` — PRODUIT NaN
 * à une entrée atteignable : `BEARINGS` contient l'opposé de chaque cardinal, donc quand
 * l'ambiance est anti-parallèle au front (un relèvement sur huit, tiré par `hash2` : ça arrive),
 * la somme vaut exactement (0,0) à souffle = 0,5, la division plante, et le NaN part dans
 * `state.wind` — donc dans le protocole ET dans la sauvegarde. La parade du client (pousser par
 * le travers AVANT le lerp, `vent-lisse.ts`) ne se transpose pas : elle marche parce que
 * `VentLisse` possède `this.dir` d'une frame à l'autre. Une fonction pure par tick n'a rien à
 * pousser. Le parcours en index, lui, n'a aucun cas dégénéré : il n'y a rien à normaliser.
 *
 * ═══ POURQUOI `i₀` EST GELÉ ═══
 *
 * Le relèvement d'ambiance se retire tous les `WIND_SHIFT_TICKS` (5 min) ; une traversée dure
 * `fenetre × cycle`, soit 15 à 30 min. L'ambiance se retire donc TROIS À SIX FOIS à l'intérieur
 * d'une seule traversée : laissée libre, elle ferait bouger `i₀` — et avec lui l'écart — en plein
 * virage, et le cap sauterait d'un à deux crans en un tick, au milieu même du passage que cette
 * loi doit rendre continu. `i₀` est donc celui de la tranche qui court à l'INSTANT OÙ LE SOUFFLE
 * PEUT COMMENCER (`startTick − AVANCE_TICKS`), et il tient jusqu'à la sortie. Le raccord y est
 * continu par construction : à cet instant, la tranche gelée EST la tranche courante.
 *
 * Le cap avance par crans de 45°. C'est LE CLIENT qui rend la pente continue (`VentLisse` rallie
 * en arc, demi-vie 4 s) — contrainte 1 : un lissage entré dans la sim coûterait le rembobinage.
 */
export function capAt(state: SimState, tick: number = state.tick): readonly [number, number] {
  const front = frontQuiSouffle(state, tick)
  const debutSouffle = front ? Math.max(0, front.startTick - VENT.AVANCE_TICKS) : tick
  const i0 = indexAmbiant(state.seed, Math.floor(debutSouffle / HUNT.WIND_SHIFT_TICKS))
  if (!front) return BEARINGS[i0]!
  const souffle = souffleAt(state, state.map.width / 2, state.map.height / 2, tick)
  if (souffle <= 0) return BEARINGS[i0]!
  const i1 = indexDuFront(front.edge)
  // LE SENS DU VIRAGE, tiré une fois pour toute la traversée (le vent ne change pas d'avis en
  // cours de route) — et sur le CYCLE du front, la graine de tous ses autres `hash2`.
  const sens = hash2(front.cycle, 7, VENT_SALT) < 0.5 ? -1 : 1
  const n = BEARINGS.length
  const ecart = sens > 0 ? (i1 - i0 + n) % n : (i0 - i1 + n) % n
  return BEARINGS[(i0 + sens * Math.round(souffle * ecart) + n * n) % n]!
}

/**
 * LA PHASE DU VENT. Posée juste après `advanceMeteo` (le front du tick est connu) et donc avant
 * la faune, qui le lit — l'ordre qu'avait déjà l'ancien `advanceWind` en tête d'`advanceFauna`.
 *
 * LE CAP NE SE REPOSE QU'AUX RELAIS D'AMBIANCE, OU SOUS UN FRONT. Ce n'est pas une optimisation :
 * c'est ce qui préserve la sémantique dont dépendent une douzaine de tests — un `sim.wind` posé
 * à la main (« l'archer est SOUS le vent ») doit TENIR le temps de la mesure. Hors météo, la
 * cadence est donc exactement celle d'avant l'unification, à la valeur près.
 */
export function advanceVent(state: SimState): void {
  // LE CALME PLAT est une décision d'HÔTE : un monde dont le vent est le vecteur nul n'a pas de
  // vent, et n'en aura jamais. On éteint la force AVEC lui — sans cette ligne, un calme plat
  // garderait `windForce ≥ AMBIANT`, et fuirait par le champ qu'on vient d'ajouter.
  if (state.wind.x === 0 && state.wind.y === 0) {
    state.windForce = 0
    return
  }
  state.windForce = ventForceAt(state, state.map.width / 2, state.map.height / 2)
  // Le vent du DÉPART tient : il vient de l'hôte (ou du banc), et le monde ne le rebat pas au
  // tick 0. Il tournera au premier relais, comme tous les suivants.
  if (state.tick === 0) return
  if (!frontQuiSouffle(state) && state.tick % HUNT.WIND_SHIFT_TICKS !== 0) return
  const b = capAt(state)
  state.wind = { x: b[0], y: b[1] }
}
