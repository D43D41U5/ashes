/**
 * La TEMPÉRATURE (spec 2026-07-08) — modèle thermostat, pur et déterministe.
 * L'ambiant = BASE − acte + (nuit + biome + fronts, amortis par l'abri), planché
 * par la bulle d'un feu. Aucune fonction transcendante (seul `sqrt`, autorisé).
 *
 * ═══ DEUX ÉCHELLES, UNE UNITÉ : LE DEGRÉ CELSIUS (décision d'Alexis, 2026-08-22) ═══
 *
 * L'AMBIANT BORNÉ vit dans [`AMBIANT_MIN`, `AMBIANT_MAX`] = [−18, +30] °C ; LE CORPS dans
 * [25, 37] °C. *(Le plafond a été relevé de 22 à 30 quand le socle est devenu une courbe — l'Ardeur
 * atteint +26 ; voir `balance.ts`.)* ⚠ **ET DEPUIS LE 2026-09-30, IL Y A UNE TROISIÈME LECTURE** :
 * `airNonBorneAt` rend l'air **sans le clamp**, et elle descend jusqu'à **−100 °C** au sommet en
 * hiver (`FROID_PAR_ETAGE` = 28 par palier). Elle n'est PAS pour le corps : la demande en crans de
 * la braise la lit (`braise.md` B-R4), le corps ne lit jamais qu'un déficit en crans (B-R6). C'est
 * pour cela que `AMBIANT_MIN` peut rester l'ancre du modèle du corps sans mentir sur la montagne.
 * Ambiant et corps ne se confondent pas —
 * un corps n'est pas de l'air — et c'est `cibleCorporelle` qui fait le pont : la température
 * à laquelle un corps nu se STABILISE dans cet air-là. Voir l'en-tête de `TEMPERATURE` dans
 * `balance.ts` pour la conversion depuis l'ancienne jauge 0-100 (une application affine :
 * l'équilibrage n'a pas bougé d'un bit, seules les étiquettes ont changé).
 */
import { BALANCE, BRAISE, CENDREUX, POI, TEMPERATURE } from './balance'
import { effetsDuJour } from './modificateur'
import { brumeColdAt } from './brume'
import { fireWarmthFactor } from './fire'
import { die } from './combat'
import { terrainAt } from './map'
import { auMemeEtage, palierDuSol, terrainAEtage } from './etages'
import { meteoColdAt } from './meteo'
import { roofAt, structuresDeLaTuile, type Structure } from './village'
import { avanceesDepuisAges, froidDeCendre } from './cendre'
import { froidDeFumerolle } from './fumerolle'
import { isOnPoiKind } from './poi-discovery'
import { TICKS_PER_CYCLE, gameTimeAt } from './time'
import { braiseNeuve, cransCouverts, type Braise } from './braise'
import type { SimState } from './sim'

const T = TEMPERATURE

/** Borne l'AMBIANT dans la fenêtre du monde (°C). C'est ce plancher qui borne, en cascade,
 *  le froid que le corps peut atteindre : air à `AMBIANT_MIN` ⇒ corps à `CORPS_MORTEL`. */
/**
 * LE CLAMP DE L'AIR BORNÉ, et c'est le SEUL — exporté depuis le 2026-10-02 parce que `gel.ts` en
 * a besoin pour borner un palier par le haut (`plafondDuPalier`). Le recopier là-bas aurait fait
 * deux vérités d'un seul intervalle, et une borne fausse se tait.
 */
export function clampTemp(v: number): number {
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

/**
 * ═══ CETTE TUILE EST-ELLE COUVERTE ? — un TOIT, une maison d'héritage, ou une Grotte ═══
 *
 * ⚠ **LE TOIT A ÉTÉ AJOUTÉ le 2026-09-02, et il manquait depuis toujours.** La fonction ne
 * connaissait que `house` et la Grotte, et la spec `etages.md` (E-R14) affirmait pourtant qu'elle
 * *« reconnaît déjà les toits »*. Elle ne les reconnaissait pas — or `house` est une pièce
 * d'**héritage** (`fam: 'heritage'`, `pose: 'monde'`) que le worldgen dépose et **que le joueur
 * ne peut pas bâtir**, et la Grotte exige les zones `karst`/`gouffre`, **absentes du monde joué**.
 * Conséquence, mesurée : **rien de ce qu'un joueur construit ne l'abritait** — ni de la pluie, ni
 * du froid, et 0 tuile couverte sur toute la carte, trois graines.
 *
 * `roof` est pourtant la pièce dont c'est tout le métier (`occupe: 'toit'`, label « Toit »),
 * posable au marteau pour une bûche. On la lit par `roofAt`, qui EXISTE et qui est déjà la
 * réponse à « qu'est-ce qui couvre cette tuile ? » — pas un second prédicat écrit à côté.
 *
 * ⚠ **TROIS SYSTÈMES EN DÉPENDENT D'UN COUP**, et c'est voulu : le FROID (`ambientAt`), la
 * MÉTÉO (R5 — un feu neuf prend sous un toit) et, depuis la branche B1, la LUMIÈRE
 * (`partDuCiel`). Un toit qui n'abritait de rien était une pièce qu'on posait pour la forme.
 */
export function isSheltered(state: SimState, tx: number, ty: number, etage?: number): boolean {
  // ═══ SOUS LA ROCHE, ON EST À L'ABRI (spec `grottes.md` G-R5 ; décision du 2026-09-05 :
  // « `isSheltered` apprend “sous la roche” ») ═══
  //
  // Le bâti du sol ne couvre rien ici, et rien ne s'y pose qui enferme (G-R7). Une tuile qui
  // n'existe pas à l'étage (terrain 0) EST la roche : personne ne s'y tient, « dehors » est faux.
  if (etage !== undefined && etage < 0) return sousLaRoche(state, tx, ty, etage)
  if (roofAt(state.structures, tx, ty) !== undefined) return true
  // ⚠ PAR L'INDEX AUSSI (2026-10-03) : c'était le SECOND balayage linéaire de cette fonction, et
  //   les deux ensemble faisaient les 286 ms d'une cuisson sur une base de 800 structures. Le
  //   prédicat est inchangé au bit — `house` sans condition d'étage, comme le `.some` d'avant.
  if (structuresDeLaTuile(state.structures, tx, ty).some((s) => s.type === 'house')) return true
  return isOnPoiKind(state, tx, ty, 'grotte')
}

/**
 * CETTE TUILE EST-ELLE SOUS LA ROCHE ? — un étage négatif est CREUSÉ sous son palier (`−(p + 1)`,
 * G-R1) : toute tuile qui y existe a la roche au-dessus de la tête, la salle d'un karst comme
 * la cave d'une mesa. Le sol (`etage` absent ou ≥ 0) répond faux. C'est LE prédicat de la
 * grotte pour le froid : l'abri (`isSheltered`) et l'air fixe (`GROTTE_AMBIANT`) le partagent.
 */
export function sousLaRoche(state: SimState, tx: number, ty: number, etage?: number): boolean {
  return etage !== undefined && etage < 0 && terrainAEtage(state.map, etage, tx, ty) !== 0
}

/**
 * LA BULLE D'UN FEU, dans [0, 1] — 1 au CENTRE DE SA TUILE, linéaire → 0 à FIRE_RANGE, × son
 * état (allumé 1, braises atténuées, éteint 0 : spec feu-station S3). La chaleur (`fireBubble`)
 * et la lumière (`nuit.ts`, `lumiereDuFeu`) la lisent toutes deux — UN seul rayon à calibrer.
 *
 * ⚠ LE CENTRE EST (tx + ½, ty + ½) — spec `lumiere-globale.md` LG-R17 (Alexis, 2026-09-16 :
 * « Recentrer la chaleur aussi »). Il valait le coin nord-ouest de la tuile : un corps à la même
 * distance du feu avait plus chaud au nord-ouest qu'au sud-est, d'une demi-tuile, et l'écran
 * (le trou du voile, centré sur la tuile) était plus clair que la sim de ce côté-là. Une
 * simulation, un seul centre — celui de la lumière.
 */
export function bulleDuFeu(state: SimState, s: Structure, x: number, y: number): number {
  const factor = fireWarmthFactor(state, s)
  if (factor <= 0) return 0
  const dx = s.tx + 0.5 - x
  const dy = s.ty + 0.5 - y
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist >= T.FIRE_RANGE) return 0
  return factor * (1 - dist / T.FIRE_RANGE)
}

/** Réchauffement du feu le plus proche : FIRE_WARMTH au contact, linéaire → 0 à FIRE_RANGE.
 *  À L'ÉTAGE du corps (G-R7) : un bivouac sous la roche ne chauffe pas la terrasse au-dessus,
 *  et le Feu du village ne traverse pas la roche jusqu'à la salle. Aucune ligne de vue : ce
 *  qui chauffe chauffe à travers un mur ; c'est la LUMIÈRE qui s'y arrête (LG-R11). */
export function fireBubble(state: SimState, x: number, y: number, etage?: number): number {
  let best = 0
  for (const s of state.structures) {
    if (s.type !== 'fire' || !auMemeEtage(s, etage)) continue
    const warmth = T.FIRE_WARMTH * bulleDuFeu(state, s, x, y)
    if (warmth > best) best = warmth
  }
  return best
}

/**
 * Réchauffement des sources chaudes — MÊME LOI que `fireBubble` (linéaire,
 * max au contact → 0 au bord du rayon). C'est un feu qu'on n'a pas allumé :
 * sur une carte où le Grand Froid mord, il réécrit les itinéraires.
 */
export function naturalWarmth(state: SimState, x: number, y: number, etage?: number): number {
  // La source est au SOL ; son rayon ne traverse pas la roche jusqu'à la salle du dessous (G-R7,
  // le même mot que `fireBubble`).
  if (etage !== undefined && etage < 0) return 0
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
export function baselineTemperature(state: SimState, x: number, y: number, etage?: number): number {
  return baselineTemperatureAt(state, x, y, state.tick, undefined, etage)
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
export function baselineTemperatureAt(state: SimState, x: number, y: number, tick: number, cst?: ConstantesDeTuile, etage?: number): number {
  // ═══ DANS UNE GROTTE, IL FAIT 13 °C — TOUJOURS (décision d'Alexis, 2026-09-06) ═══
  //
  // Une grotte n'AMORTIT pas le froid du monde comme un toit : elle l'IGNORE. Ni l'heure, ni
  // l'acte, ni le front, ni le biome du dessus, ni la Brume, ni la cendre n'y entrent — l'air y
  // est la moyenne annuelle du pays, `T.GROTTE_AMBIANT`, et il n'en bouge pas. Décidé ICI, avant
  // toute lecture de l'horloge, parce que c'est l'écrivain unique du froid du monde : le corps,
  // les Cendreux, l'encyclopédie et le HUD le lisent tous par cette porte. Seuls le feu et la
  // tenue, qui PLANCHENT l'ambiant après coup, peuvent encore le lever.
  if (sousLaRoche(state, Math.floor(x), Math.floor(y), etage)) return T.GROTTE_AMBIANT
  const shelter = cst?.abri ?? abriDeTuile(state, x, y, etage)
  return froidDuMonde(state, x, y, tick, shelter, cst)
}

/**
 * ═══ L'AIR RÉEL D'UNE TUILE, **SANS LA BORNE DU MODÈLE DU CORPS** (B-R4, `braise.md`) ═══
 *
 * Jumelle exacte de `baselineTemperatureAt` : même grotte, même abri, même composition — **moins le
 * `clampTemp` final**. Elle existe pour ce que la braise devra compter, et pour rien d'autre :
 *
 * ```
 * cransExiges(air) = ceil( max(0, AMBIANT_DOUX − air) / BRAISE.CRAN_DEGRES )
 * ```
 *
 * ⚠ **SANS ELLE CETTE FORMULE NE REND QUE 0 OU 1** — MESURÉ : le déficit maximal d'un air borné
 * vaut `AMBIANT_DOUX − AMBIANT_MIN` = 6 − (−18) = 24, et `ceil(24 / 28)` = 1. Sous le clamp, le
 * palier 1 d'été et le palier 3 d'hiver rendent donc **le même chiffre**, et toute l'échelle de
 * `braise.md` (un cran = un étage = une saison) est inécrivable.
 *
 * ⚠ **CE N'EST PAS L'AIR DU CORPS, ET IL NE DOIT JAMAIS LE DEVENIR** (B-R6). Le corps lit
 * `ambientTemperature`, borné, et c'est ce qui tient tout son modèle : `cibleCorporelle`,
 * `PENTE_CORPS`, `CORPS_MORTEL` et `AMBIANT_MIN` sont calibrés sur une bande de 24 °C. À −86 °C la
 * valeur serait re-clampée mais la VITESSE de dérive (proportionnelle à l'écart) exploserait — on
 * mourrait instantanément au palier 3 au lieu de « se mettre à mourir ». Ce que le corps lira, c'est
 * un **déficit en crans** (1 à 4), jamais ces degrés-là.
 *
 * ⚠ Aucun appelant aujourd'hui, et c'est assumé : elle arrive à l'étape 1 de `braise.md` § 3 parce
 * que l'étape 4 (la braise en état) ne peut pas s'écrire sans elle, et qu'une étape 1 qui la
 * remettrait à plus tard livrerait un froid d'altitude que rien ne sait lire. *(Une loi livrée sans
 * appelant est un risque connu du dépôt — celui-ci est daté et nommé, pas oublié.)*
 */
export function airNonBorneAt(state: SimState, x: number, y: number, tick: number, cst?: ConstantesDeTuile, etage?: number): number {
  if (sousLaRoche(state, Math.floor(x), Math.floor(y), etage)) return T.GROTTE_AMBIANT
  const shelter = cst?.abri ?? abriDeTuile(state, x, y, etage)
  return airDuMonde(state, x, y, tick, shelter, cst)
}

/**
 * ═══ L'AIR DE LA DEMANDE — non borné, MAIS AVEC LES FEUX (B-R5) ═══
 *
 * C'est l'air que la braise doit couvrir, et il n'est ni `ambientTemperature` ni `airNonBorneAt` :
 *
 *   · **non borné**, comme `airNonBorneAt` — sous le clamp, `cransExiges` ne rendrait que 0 ou 1 et
 *     toute l'échelle « un cran = un étage = une saison » serait inécrivable ;
 *   · **planché par le feu et par la source chaude**, comme `ambientTemperature` — parce que « au
 *     pied d'une balise, la demande tombe à 0 : le camp est un répit » EST la règle (B-R5), et que
 *     c'est elle qui garde vivants et GRATUITS l'abri, la grotte à 13 °C et la Source chaude.
 *
 * ⚠ **ET JAMAIS LA BRAISE ELLE-MÊME.** Si la braise entrait dans l'air qu'elle lit, elle baisserait
 * sa propre demande, la demande remonterait en se vidant, et on aurait l'oscillation que
 * `feu-station.md` S5 a déjà eu à écarter pour l'attraction des Cendreux. Le piège est connu,
 * documenté, et il vaut ici mot pour mot : la braise n'est **pas** une source de chaleur du monde,
 * elle est une COUVERTURE de la demande.
 *
 * ⚠ Le zéro de `fireBubble`/`naturalWarmth` est une ABSENCE, pas une température : on ne plancher
 * que sur une source RÉELLE (le `max` à trois termes avait déjà planché tout le monde à 0 °C une
 * fois, et plus rien ne pouvait tuer de froid).
 */
export function airDeLaDemande(state: SimState, x: number, y: number, etage?: number): number {
  let t = airNonBorneAt(state, x, y, state.tick, undefined, etage)
  const feu = fireBubble(state, x, y, etage)
  if (feu > 0 && feu > t) t = feu
  const source = naturalWarmth(state, x, y, etage)
  if (source > 0 && source > t) t = source
  return t
}

/**
 * ═══ LA DEMANDE, EN CRANS (B-R4) — le calcul de température EXISTANT est la demande ═══
 *
 * ```
 * cransExiges(air) = ceil( max(0, AMBIANT_DOUX − air) / BRAISE.CRAN_DEGRES )
 * ```
 *
 * Conséquence voulue : la saison (`SOCLE`), l'heure, la météo, la brume, l'abri, la grotte et la
 * Source chaude restent tous vivants et gratuits — et « lire la fenêtre météo » survit comme
 * maîtrise, puisqu'un orage au palier 1 en fait un endroit de palier 2 le temps qu'il passe.
 * Contrepartie acceptée : **une nuit d'hiver coûte des crans même en bas.**
 *
 * À `CRAN_DEGRES` = `FROID_PAR_ETAGE` = 28, la table de B-R4b tombe d'elle-même : **en hiver le
 * palier k demande k+1 crans, en été il en demande k.** Personne n'a eu à l'écrire, et c'est la
 * marée de la montagne — l'été ouvre un étage, l'hiver le referme.
 *
 * ⚠ `Math.ceil` et une division : les deux sont autorisés par l'invariant §2 (pas de `pow`, pas
 * d'`exp`), donc la demande est la même au bit près sur Node et dans le navigateur.
 */
export function cransExiges(state: SimState, x: number, y: number, etage?: number): number {
  const manque = T.AMBIANT_DOUX - airDeLaDemande(state, x, y, etage)
  if (manque <= 0) return 0
  return Math.ceil(manque / BRAISE.CRAN_DEGRES)
}

/**
 * ═══ CE QUE LE CORPS RESSENT (B-R6) — le DÉFICIT en crans, jamais l'air brut ═══
 *
 * ```
 * manque      = cransExiges − cransCouverts                     // 0 quand la braise suffit
 * airRessenti = clampTemp(AMBIANT_DOUX − manque × DEFICIT_DEGRES)
 * ```
 *
 * ⚠ **C'EST CE QUI SAUVE TOUT LE MODÈLE DU CORPS.** `cibleCorporelle`, `PENTE_CORPS`,
 * `CORPS_MORTEL` et `AMBIANT_MIN` sont calibrés sur une bande de 24 °C ; à −86 °C la valeur serait
 * re-clampée mais la VITESSE de dérive (proportionnelle à l'écart) exploserait — on mourrait
 * instantanément au palier 3 au lieu de « se mettre à mourir ». Le corps ne voit donc jamais l'air
 * d'altitude : il voit un déficit de 1 à 4 crans, et rien d'autre.
 *
 * ⚠ **ET LA FORMULE NAÏVE `air + couverts × CRAN_DEGRES` EST FAUSSE À 28** : un palier 2 d'hiver
 * couvert de 2 crans rendrait −58 + 56 = −2 °C, AU-DESSUS du seuil d'hypothermie — un cran de
 * retard ne ferait alors rien du tout. On ne corrige pas l'air, on le REMPLACE par le déficit.
 *
 * Puis toute la cascade existante s'applique sans modification (`cibleCorporelle`, la dérive,
 * `CORPS_MORTEL`, `HYPOTHERMIA_DAMAGE_MAX`) : on ne meurt pas à l'instant où l'on manque un cran,
 * on **se met à mourir** — et c'est ce qui donne au repli le temps d'être une décision.
 */
export function airRessenti(demande: number, braise: Braise): number {
  const manque = demande - cransCouverts(braise)
  if (manque <= 0) return T.AMBIANT_DOUX
  return clampTemp(T.AMBIANT_DOUX - manque * BRAISE.DEFICIT_DEGRES)
}

/**
 * ═══ CE QUI, DANS LE FROID D'UNE TUILE, NE DÉPEND PAS DU TICK (perf, 2026-08-26) ═══
 *
 * Deux termes du froid ne bougent pas quand l'horloge bouge : **l'ABRI** (une maison ou une
 * grotte est là ou n'y est pas) et **le souffle des FUMEROLLES** (une bouche est ouverte ou
 * non — son froid ne dépend que de la distance et de l'avancée de la cendre). Les relire à
 * chaque instant d'une intégration, c'est poser quarante-huit fois la même question.
 *
 * MESURÉ sur le monde joué (772 structures, 6 144 tuiles × 24 tranches) :
 *   · `isSheltered`      618 ms — il BALAIE `state.structures`, et il grandit avec ce qu'on bâtit
 *   · `froidDeFumerolle` 216 ms — un balayage de mailles + une allocation par appel
 * soit **les deux tiers** de `baselineTemperatureAt` (1 030 ms) à eux seuls. La recuisson du
 * gel du client, qui les appelle en boucle, mangeait **121 % d'une image**.
 *
 * On les relève donc UNE FOIS PAR TUILE et on les passe. Les valeurs sont IDENTIQUES au bit
 * près — c'est le même appel, avec les mêmes arguments, simplement sorti de la boucle.
 *
 * ⚠ L'ARGUMENT EST OPTIONNEL, ET C'EST DÉLIBÉRÉ : la température se lit par entité et par tick
 *   dans toute la sim. Sans le passer, chaque appelant retrouve EXACTEMENT son comportement
 *   d'avant (le fallback est le même calcul, au même endroit) — le hisser est une décision
 *   d'appelant, prise là où il y a une boucle à sortir.
 *
 * ⚠ ET C'EST À LA TUILE : `froidDeFumerolle` lit x/y en FLOTTANT (la pente du souffle est
 *   continue), donc ces constantes ne valent que pour le point qu'on leur a donné. `neigeAuSol`
 *   travaille à la tuile entière — c'est là qu'on les hisse, et nulle part au hasard.
 */
export interface ConstantesDeTuile {
  /** `T.SHELTER_FACTOR` sous un toit ou dans une grotte, `1` à découvert. */
  abri?: number
  /** Les degrés que le souffle des fumerolles RETIRE ici (`0` s'il n'y en a aucune). */
  fumerolle?: number
  /**
   * Les degrés que la VIEILLE CENDRE retire ici (R22 — `0` hors cendre et sur la frange).
   *
   * ⚠ IL SE HISSE SOUS LA MÊME SENTINELLE QUE `fumerolle`, jamais par un `??=` : son zéro est
   * une VALEUR (hors cendre, frange), pas une absence. Voir le site de hissage dans `gel.ts`.
   */
  cendre?: number
}

/**
 * ⚠ LES DEUX CHAMPS SONT INDÉPENDAMMENT OPTIONNELS, ET CE N'EST PAS DE LA SOUPLESSE.
 *
 * Les deux intégrations n'ont pas les mêmes besoins : la CHUTE (`dehorsSansMeteo`) lit le
 * souffle des fumerolles et **jamais l'abri** ; la FONTE (`baselineTemperatureAt`) lit les deux.
 * Les servir en un seul paquet fait payer `isSheltered` — le plus cher des deux, 4,2 µs sur un
 * monde bâti — à une boucle qui n'en fera rien. MESURÉ : la première version, qui les liait,
 * rendait la passe de recuisson PLUS LENTE qu'avant le correctif. Chacun se relève donc quand
 * il est vraiment demandé, et pas avant.
 */
export function abriDeTuile(state: SimState, x: number, y: number, etage?: number): number {
  return isSheltered(state, Math.floor(x), Math.floor(y), etage) ? T.SHELTER_FACTOR : 1
}

/**
 * Le souffle des fumerolles en un point — l'écrivain UNIQUE, pour que le chemin hissé et le
 * chemin direct ne puissent pas diverger.
 *
 * ⚠ `?? []` N'EST PAS DE LA PRUDENCE : le client fabrique de FAUX `SimState` par double cast
 *   pour ses façades (`etat-gel.ts` et consorts, qui relisent le froid du monde sans avoir de
 *   sim). Un champ neuf y est donc `undefined`, et `.length` dessus JETTE — constaté au
 *   navigateur, la scène entière tombait. Sans fumerolle, le froid vaut zéro.
 */
export function froidDeFumerolleDeTuile(state: SimState, x: number, y: number): number {
  const ages = state.cendreAge ?? []
  return froidDeFumerolle(state.map, x, y, avanceesDepuisAges(ages, ages.length), state.seed)
}

/**
 * LE FROID DU MONDE À DÉCOUVERT — l'écrivain unique de `baselineTemperatureAt` et de
 * `climatFlore`, qui ne diffèrent QUE par le facteur d'abri.
 */
/**
 * ═══ LE FROID QUE COÛTE L'ALTITUDE — `− FROID_PAR_ETAGE × palier` (F-R6, B-R4b) ═══
 *
 * ⚠ **IL SE DÉRIVE DU PALIER DU SOL, JAMAIS DE `entity.etage`** — et ce n'est pas un détail de
 * style : `poserLEtageDuCorps` **EFFACE** `corps.etage` dès qu'un corps se tient sur le palier de
 * sa tuile (`etages.ts:180`, `delete corps.etage`), c'est-à-dire pour tout marcheur, y compris au
 * sommet. Un terme écrit en `etage ?? 0` serait donc **inerte en jeu** — et, le pire, une garde
 * qui poserait `entity.etage` à la main passerait au VERT sur une fonctionnalité morte.
 *
 * ⚠ **ET PAS `niveauDuCorps` NON PLUS**, qui n'est pas borné : MESURÉ sur le monde joué, il existe
 * **3 459 tuiles de niveau 4** (les chapeaux posés au-dessus du palier 3) — là, `niveauDuCorps`
 * rendrait 4 et le terme vaudrait **−112 °C**, un palier de froid que la loi ne prévoit pas.
 * `palierDuSol` borne à `0..PALIERS−1` par construction, et rend 0 sur toute carte sans `palier`
 * (une carte d'avant, le monde complet, une carte de test) : ces mondes-là ne changent pas d'un bit.
 *
 * Le signe est négatif ou nul pour tout palier ≥ 0, ce qui garde `climatMaximal` (qui n'a pas de
 * position) valide comme borne OPTIMISTE sans y toucher — c'est ce que F-R6 avait prévu.
 */
function froidDEtage(state: SimState, x: number, y: number): number {
  return -T.FROID_PAR_ETAGE * palierDuSol(state.map, Math.floor(x), Math.floor(y))
}

/**
 * ═══ L'AIR DU MONDE, **NON BORNÉ** — la composition seule, sans `clampTemp` ═══
 *
 * C'est le corps de `froidDuMonde`, dont il n'est séparé que par le clamp final. Il existe pour
 * une raison MESURÉE et non pour la symétrie : sous le clamp, **le compte de crans de la braise se
 * réduit à {0, 1}**. Le déficit maximal d'un air borné vaut `AMBIANT_DOUX − AMBIANT_MIN` = 24, et
 * `ceil(24 / 28)` = 1 — donc tout palier ≥ 1 rendrait *le même chiffre*, hiver comme été, palier 1
 * comme palier 3, et la barre entière de `braise.md` serait inécrivable (B-A2).
 *
 * ⚠ **`T₀` RESTE BORNÉ, ET C'EST DÉLIBÉRÉ.** T₀ est par définition l'ambiant à découvert que la
 * météo TROUVE en arrivant (`meteo.md` R11-R12) : c'est dessus que l'orage décide de sa morsure et
 * que la pluie décide d'être neige. Le déborner changerait la météo, qui n'a rien demandé — et ne
 * changerait rien à la limite de neige, qui sature à `LIMITE_NEIGE` = 0 bien avant −18.
 */
function airDuMonde(state: SimState, x: number, y: number, tick: number, shelter: number, cst?: ConstantesDeTuile): number {
  // ═══ UNE SEULE LECTURE DE L'HORLOGE (perf, 2026-08-26) ═══
  //
  // `baseDuMonde` et `expositionSansMeteo` demandaient CHACUNE `gameTimeAt(state, tick)` — le
  // même appel, le même tick, et un objet de onze champs alloué deux fois pour la même réponse.
  // MESURÉ : 30 ms pour 147 456 lectures, doublées. On la fait une fois et on la passe ; les
  // deux fonctions gardent leur repli par défaut, donc tous leurs autres appelants sont intacts.
  const time = gameTimeAt(state, tick)
  // LE SOCLE PORTE L'ALTITUDE, ET L'EXPOSITION NON — parce que seul le groupe de l'exposition est
  // multiplié par `shelter` (décision d'Alexis du 2026-09-30 : « l'altitude ne s'abrite pas »).
  // C'est la SEULE différence avec la version d'avant le 2026-09-30, et elle est d'un terme.
  const base = baseDuMonde(state, tick, time) + froidDEtage(state, x, y)
  const exposedSansMeteo = expositionSansMeteo(state, x, y, tick, cst, time)
  // R11-R12 (`meteo.md`) : LE FRONT LIT LE FROID QU'IL TROUVE. `T₀` est le monde SANS lui, à
  // découvert — c'est sur elle que l'orage décide de sa morsure (`partDeBlizzard`) et que la pluie
  // décide d'être neige (`neigeA`). Calculée ICI, une fois, et passée : pas de seconde lecture.
  // Elle porte l'altitude (donc la première neige tombe en HAUT avant le bas, contrôle de F-R6)
  // et reste BORNÉE — voir l'en-tête.
  const t0 = clampTemp(base + exposedSansMeteo)
  const meteo = meteoColdAt(state, x, y, tick, t0)
  return base + shelter * (exposedSansMeteo - meteo)
}

/**
 * LE FROID DU MONDE À DÉCOUVERT, BORNÉ — l'écrivain unique de `baselineTemperatureAt` et de
 * `climatFlore`. Exactement `airDuMonde` sous `clampTemp` : une seule expression, pour qu'un
 * chemin borné et un chemin non borné ne puissent pas diverger d'un bit.
 */
function froidDuMonde(state: SimState, x: number, y: number, tick: number, shelter: number, cst?: ConstantesDeTuile): number {
  return clampTemp(airDuMonde(state, x, y, tick, shelter, cst))
}

/**
 * LA TEMPÉRATURE DU MONDE SANS LE FRONT, À DÉCOUVERT — `T₀` de la spec météo (R11-R12) :
 * biome, heure, acte, Brume, cendre ; ni front, ni abri, ni feu. C'est ce que la pluie et
 * l'orage TROUVENT en arrivant : la limite de neige et le refroidissement éolien se lisent
 * dessus, jamais sur la température sous le front (aucune circularité). Mêmes expressions,
 * même ordre que `froidDuMonde` — au bit près.
 */
export function dehorsSansMeteo(state: SimState, x: number, y: number, tick: number, cst?: ConstantesDeTuile): number {
  const time = gameTimeAt(state, tick) // une seule lecture, comme `froidDuMonde` (voir son en-tête)
  // ⚠ `+ froidDEtage` EST OBLIGATOIRE ICI, et pas par symétrie : cette expression DOIT rester
  //   égale au `t0` de `airDuMonde`, sans quoi la chute de neige et les cinq `effetOrage` liraient
  //   un autre monde que celui où le froid tombe. C'est ce que promet l'en-tête (« au bit près »).
  return clampTemp(baseDuMonde(state, tick, time) + froidDEtage(state, x, y) + expositionSansMeteo(state, x, y, tick, cst, time))
}

/**
 * LE SOCLE DU JOUR : la part du froid qu'aucun toit ne coupe — **une courbe du jour de
 * l'année depuis le 2026-08-23** (spec `saisons.md` S4 ; c'était `BASE − ACT_COLD(acte)`,
 * une marche par saison). Le tour entre dans la lecture : l'hiver s'élargit d'un an sur
 * l'autre en tirant ses voisins vers lui (S12).
 */
export function socleDuJour(jour: number, tour: number): number {
  const e = effetsDuJour(jour)
  return T.SOCLE(jour + (e.socleJours ?? 0), tour) + (e.socleDegres ?? 0)
}

function baseDuMonde(state: SimState, tick: number, time = gameTimeAt(state, tick)): number {
  // LE SOCLE DU JOUR, ET RIEN D'AUTRE : il ne connaît ni la tuile, ni le biome, ni la hauteur —
  // c'est le froid que le CALENDRIER impose à toute la vallée à cet instant.
  // ⚠ LE TERME D'ÉTAGE N'EST PAS ICI, et il aurait été naturel de l'y mettre : cette fonction n'a
  //   PAS DE POSITION. Il est ajouté à son résultat par `airDuMonde` (et par `dehorsSansMeteo`),
  //   c'est-à-dire **dans le même groupe que le socle** et donc HORS du facteur d'abri — F-R6 le
  //   voulait « dans l'exposition », ce qui l'aurait fait diviser par deux sous un toit (décision
  //   d'Alexis du 2026-09-30 : « l'altitude ne s'abrite pas »). Voir `froidDEtage`.
  return socleDuJour(time.seasonDay, time.tour)
}

/** L'EXPOSITION hors front — biome, nuit, Brume — SIGNÉE (le biome peut réchauffer),
 *  celle que l'abri amortit. Le froid du front s'y ajoute dans `froidDuMonde`, après `T₀`. */
function expositionSansMeteo(state: SimState, x: number, y: number, tick: number, cst?: ConstantesDeTuile, time = gameTimeAt(state, tick)): number {
  const tx = Math.floor(x)
  const ty = Math.floor(y)
  const biome = T.BIOME_OFFSET[terrainAt(state.map, tx, ty)] ?? 0
  // LA BRUME (spec brume.md R4) et LE FRONT MÉTÉO (spec meteo.md R4) sont des EXPOSITIONS
  // de plus : l'abri les amortit, et le feu comme la tenue les PLANCHENT (l'ambiant est un
  // max) — le déni de zone tombe de ces lois, pas d'une mécanique neuve. Le froid météo
  // arrive en RAMPE (gradient bord → cœur de bande) : le front qui approche se SENT venir.
  // LE FROID DE LA CENDRE EST RETIRÉ (2026-08-24), avec le front dont il était la bande la plus
  // étroite. CE QUI A PRIS SA PLACE EST LOCAL : les FUMEROLLES (décision d'Alexis) — des trous qui
  // soufflent froid au cœur de la corruption. C'est une EXPOSITION de plus, au même titre que la
  // brume et le front météo : l'abri l'amortit, le feu et la tenue la PLANCHENT (l'ambiant est un
  // `max`). Et elle traverse `climatFlore` (`shelter = 1`), donc AUCUNE structure ne la lève —
  // pas de serre gratuite (`flore-froid` F1bis).
  //
  // ⚠ ELLE RÉVEILLE LES MORTS, et ce n'est pas un effet de bord : `CENDREUX.TORPEUR` lit ce même
  //   froid de base. Une fumerolle rend donc les Cendreux actifs autour d'elle même en été. Assumé
  //   (Alexis a pris la piste en connaissance de cause) ; le bouton est `FUMEROLLE.FROID`.
  // ⚠ `?? []` N'EST PAS DE LA PRUDENCE : le client fabrique de FAUX `SimState` par double cast
  //   pour ses façades (`etat-gel.ts` et consorts, qui relisent le froid du monde sans avoir de
  //   sim). Un champ neuf y est donc `undefined`, et `.length` dessus JETTE — constaté au
  //   navigateur, la scène entière tombait. Le même piège avait déjà donné un `NaN` silencieux
  //   sur `jourDeSaison` à la refonte des saisons. Sans fumerolle, le froid vaut zéro.
  // Le souffle des fumerolles ne dépend PAS du tick : un appelant qui boucle sur l'horloge le
  // relève une fois et le passe (voir `ConstantesDeTuile`). Sans lui, on le calcule ici — même
  // appel, mêmes arguments, même valeur.
  const fumerolle = cst?.fumerolle ?? froidDeFumerolleDeTuile(state, x, y)
  // LE FROID DE LA VIEILLE CENDRE (spec `cendre.md` R22, décision d'Alexis 2026-08-27) — le
  // SOCLE sur lequel les fumerolles font leurs pics. Zéro sur la frange (on y travaille, R14),
  // montée linéaire jusqu'à `CENDRE.FROID_COEUR` à l'entrée de la bande vieille. Il n'est PAS
  // hissé dans `ConstantesDeTuile` et c'est mesuré, pas supposé : il lit le coût NU (deux
  // lectures de tableau et une racine mémoïsée — `profondeurNueDeCendre`), là où le souffle
  // balaie des mailles et allouait. Le hisser aurait demandé une sentinelle (`??=` sur un
  // nombre qui vaut LÉGITIMEMENT 0 hors cendre recalculerait à chaque tranche).
  const cendre = cst?.cendre ?? froidDeCendre(state, tx, ty)
  // LA NUIT EST UNE PENTE (`partDeNuit`, décision d'Alexis 2026-08-23) : `time.nuit` vaut 1 sur
  // toute la nuit et redescend sur les lisières du jour — le froid du soir se SENT venir, il ne
  // claque plus de douze degrés en un tick. La nuit pleine est inchangée au bit près.
  return biome - T.ECART_NUIT(time.seasonDay) * time.nuit - brumeColdAt(state, x, y, tick) - fumerolle - cendre // amorti par l'abri
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
  return clampTemp(socleDuJour(time.seasonDay, time.tour) + BIOME_MAX - T.ECART_NUIT(time.seasonDay) * time.nuit)
}

/** Température ambiante cible (°C) au lieu (x,y) : le froid de base, PLANCHERÉ par un feu /
 *  une source chaude. */
export function ambientTemperature(state: SimState, x: number, y: number, etage?: number): number {
  // Ni le feu ni la source chaude ne peuvent refroidir : ils ne font que plancher.
  //
  // ⚠ LE ZÉRO DE CES DEUX-LÀ EST UNE ABSENCE, PAS UNE TEMPÉRATURE. `fireBubble` et
  // `naturalWarmth` rendent 0 quand il n'y a NI feu NI source à portée ; sous l'ancienne
  // jauge 0-100, un `max` à trois termes était inoffensif — 0 était le fond de l'échelle.
  // Depuis le passage en °C (2026-08-22), 0 est le gel du gué, en plein milieu du domaine :
  // le même `max` planchait TOUT le monde à 0 °C, et plus rien ne pouvait tuer de froid.
  // On ne plancher donc que sur une source RÉELLE.
  let t = baselineTemperature(state, x, y, etage)
  const feu = fireBubble(state, x, y, etage)
  if (feu > 0 && feu > t) t = feu
  const source = naturalWarmth(state, x, y, etage)
  if (source > 0 && source > t) t = source
  return t
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
export function eveilCendreuxAt(state: SimState, x: number, y: number, tick: number, etage?: number): number {
  return eveilPourTemperature(baselineTemperatureAt(state, x, y, tick, undefined, etage))
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
  // LA THERMOGENÈSE (décision d'Alexis, 2026-08-29) : tenir 37 °C se paie en VENTRE — chaque
  // degré ressenti sous `AMBIANT_DOUX` coûte de la faim. Elle vit ICI et non dans
  // `advanceEconomy` parce que le ressenti (ambiant plancheré par le feu, puis par la tenue)
  // n'est relevé qu'une fois par corps et par tick — le recalculer dans la passe économique
  // paierait un second balayage des structures par entité. Remplace `ACT_HUNGER_FACTOR` :
  // la saison n'affame plus par décret, elle affame par sa courbe `SOCLE`.
  const faimParDegreTick = BALANCE.HUNGER_COLD_PER_DEGREE_HOUR / (TICKS_PER_CYCLE / 24)
  // Copie défensive (comme advanceCombat) : die() peut réassigner state.entities.
  for (const entity of [...state.entities]) {
    if (monsterIds.has(entity.id)) continue // pas de température pour les monstres
    // ═══ LA BRAISE : C'EST ICI QUE LE FROID LA RENCONTRE (`braise.md` B-R6 et B-R8) ═══
    //
    // ⚠ **ET C'EST LE SEUL ENDROIT, EXPRÈS.** La demande coûte une lecture d'air par corps et par
    // tick — exactement celle que cette boucle payait déjà (`ambientTemperature`, qu'elle ne
    // demande plus pour un porteur). Une passe séparée `advanceBraise` l'aurait payée DEUX fois
    // pour la même réponse, et la spec elle-même branche B-R6 ici (§ 3 point 4).
    //
    // ⚠ **LA MIGRATION EST CETTE LIGNE** (B-R2 : « un champ requis neuf hors de la racine du
    // `SimState` casse les sauvegardes existantes »). Un corps humain sans braise en reçoit une
    // PLEINE : une vallée sauvegardée avant le champ, un avatar né avant lui, une arrivée rejouée
    // par `replay-log`. La population est celle que cette boucle balaie déjà — depuis le retrait
    // des villages PNJ (2026-09-29), « entité qui n'est pas un monstre » EST « humain ». Aucun
    // tirage de PRNG, aucun compte d'entité changé : même graine, même état.
    const braise = (entity.braise ??= braiseNeuve())
    const demande = cransExiges(state, entity.x, entity.y, entity.etage)
    // B-R8 — LA VIDANGE NE COURT QUE QUAND LA BRAISE COUVRE : l'été en bas, la grotte à 13 °C et
    // le pied d'un feu ne coûtent rien. La charge est une monnaie d'altitude et d'hiver, jamais
    // une horloge. Et elle est CONSTANTE tant qu'elle couvre — c'est ce qui fait tenir
    // `(N − d) × T` (B-R7) sans aucune table de vitesse, quelle que soit la taille du déficit.
    //
    // ⚠ LA VIDANGE PASSE AVANT LA LECTURE, et c'est le mécanisme de B-R7b : sous
    // `floor(charge / DUREE_CRAN)`, une braise pleine de `N` crans n'en couvre plus que `N − 1`
    // dès le premier tick de froid. C'est ce qui fait qu'un palier de demande `N` se TOUCHE sans
    // s'habiter, et qu'aucune porte n'a eu à être codée pour fermer le palier 2.
    if (demande > 0 && braise.charge > 0) {
      braise.charge = Math.max(0, braise.charge - BRAISE.VIDANGE_PAR_TICK)
    }
    // B-R6 — LE CORPS LIT LE DÉFICIT, JAMAIS L'AIR BRUT. Il ne voit donc plus `ambientTemperature`
    // du tout : `airRessenti` porte le feu et l'abri par la demande (B-R5), et borne le reste au
    // déficit en crans. C'est ce qui permet à l'air du monde de descendre à −100 °C au sommet sans
    // qu'un seul nombre du modèle du corps ne bouge.
    //
    // ⚠ **ET C'EST LA DERNIÈRE ÉTAPE DU CHEMIN** : plus rien ne replanche ce que la braise a rendu.
    // ═══ IL N'Y A PLUS DE VÊTEMENT SUR LE CHEMIN DU FROID (B-R15, étape 5 — 2026-10-03) ═══
    //
    // Une `tenue_hiver` planchait ici le ressenti à `TENUE_FLOOR` = −5,2 °C, dont la cible
    // corporelle vaut 31,4 °C — au-dessus de l'hypothermie. MESURÉ avant son retrait : braise VIDE
    // au cœur du Grand Froid, **une tenue dans le sac rendait les QUATRE paliers survivables
    // indéfiniment** (31,40 °C, 100 PV) quand un corps sans elle mourait au tick 7435. Toute
    // l'échelle de B-R4b était donc neutralisée par un objet cousu, et par simple POSSESSION.
    // *« La braise est la SEULE porte du froid »* : elle l'est maintenant, sans exception à lire.
    //
    // ⚠ L'OBJET, LUI, EXISTE ENCORE (recette, poids, encyclopédie) : c'est la chaîne
    // chasse → cuir → couture qu'il faut re-motiver ou couper, et B-R15 la renvoie à `cuir.md` —
    // une décision, pas un retrait mécanique. Ce qui sort ici, c'est le PLANCHER.
    const ambient = airRessenti(demande, braise)
    // Le surcoût suit l'EFFORT de compensation (l'écart au doux), pas la température atteinte :
    // lutter contre le froid coûte à manger, PERDRE la lutte coûte des PV (l'hypothermie,
    // plus bas). Près d'un feu, ambiant ≥ doux → zéro surcoût : se chauffer nourrit.
    const manque = T.AMBIANT_DOUX - ambient
    if (manque > 0) entity.hunger = Math.max(0, entity.hunger - manque * faimParDegreTick)
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
