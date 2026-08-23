/**
 * LE GEL (spec `gel.md`, décision Alexis 2026-08-19) — le monde change d'état avec sa
 * température, sans qu'une tuile ne bouge.
 *
 * *« nous avons une température locale en tout point ? si oui, je veux que ça impacte le sol
 * et l'environnement, l'eau gèle, la végétation perd ses feuilles sauf les pins, ça fait
 * persister la neige au sol. »*
 *
 * ═══ TOUT EST DÉRIVÉ, RIEN N'EST STOCKÉ — le patron du FRONT DE CENDRE ═══
 *
 * La carte est immuable pendant la partie (`carte-immuable.test.ts` : « mille ticks de monde
 * vivant ne changent pas un bit de `map` »), et c'est ce qui rend l'autosave abordable. Le
 * gel ne peint donc AUCUNE tuile : comme la cendre remplace un champ par une comparaison
 * (`map.cendre[i] < front`), le gel remplace un champ par un PRÉDICAT PUR. Conséquences
 * exactes : zéro octet dans le `SimState` et dans la sauvegarde, zéro champ neuf, zéro
 * tirage sur le PRNG (`hash2` est un hachage, pas le générateur d'état), et le client lira
 * LES MÊMES fonctions que la sim — doctrine de l'écrivain unique.
 *
 * ═══ G1 — LE GEL SE JUGE SUR LE FROID DU MONDE ═══
 *
 * `baselineTemperature`, JAMAIS `ambientTemperature`. C'est le raisonnement exact du gate
 * d'attraction des Cendreux (spec feu-station S5) : lire l'ambiant ferait dégeler le lac
 * autour d'un feu de camp, et fondre la glace sous les pas d'un PNJ qui s'approche — la
 * carte changerait de forme parce que quelqu'un la regarde. Le froid des fronts météo et de
 * la Brume, lui, entre déjà dans la baseline par construction : **un blizzard gèle ce qu'il
 * traverse**, et le dégèle en s'éloignant, sans une ligne de code de plus (A8).
 *
 * ═══ G3 — LE GEL NE RECLASSE JAMAIS UNE TUILE ═══
 *
 * `isWater` ne bouge pas, le worldgen n'en sait rien (il tourne à la création, en acte I),
 * et « l'eau commande la faune » (spec faune R17) continue de lire le TERRAIN : un lac gelé
 * reste un point d'eau pour le gibier et pour le placement des coins de chasse. Sans cette
 * règle, geler la vallée stériliserait la faune — ce qui n'est demandé nulle part.
 *
 * ═══ G8 — LE DÉGEL A DE L'HYSTÉRÉSIS (et elle ne coûte pas un octet d'état) ═══
 *
 * L'eau PREND sous son seuil, mais elle ne REND LA MAIN qu'au-dessus de `seuil +
 * HYSTERESIS`. Sans cette marge, une température qui oscille autour du seuil ferait
 * clignoter la carte d'un tick à l'autre. La mémoire que ça demande se RECALCULE au lieu de
 * se ranger : la température étant une fonction pure du tick, « c'était gelé il y a un
 * instant » se relit par `baselineTemperatureAt` — voir `estGele` pour la loi, ses limites
 * et la démonstration de ce qui exigerait, lui, un vrai champ d'état.
 *
 * ═══ G8bis — ET PERSONNE NE RESTE EMMURÉ ═══
 *
 * Le gel est la première règle qui RETIRE de la marchabilité à une tuile occupée. La glace
 * ne cède pas — elle disparaît, ce qui revient au même pour qui est dessus. `advanceDegel`
 * replie chaque tick quiconque se tient sur de l'eau profonde dégelée. Voir sa doc : elle ne
 * regarde QUE l'eau profonde, pour ne pas devenir un désembourbeur universel qui masquerait
 * les vrais défauts.
 *
 * ═══ ON ÉVALUE AU COIN DE LA TUILE, PARTOUT ═══
 *
 * Toutes les lois de gel prennent des coordonnées de TUILE (entiers). Le déplacement
 * travaille en flottants et en sous-tuiles, le pathfinding en entiers : si la vitesse
 * demandait le gel en `(x, y)` continu et l'A* en `(tx, ty)`, une tuile d'eau à cheval sur
 * le bord d'une bande de blizzard serait franchissable pour l'un et bloquante pour l'autre.
 * G4 (« ce qui traverse, traverse pour tout le monde ») se perdrait de la façon la plus
 * difficile à voir. `collision.ts` plancher donc systématiquement avant d'appeler ici.
 *
 * ═══ LE COURT-CIRCUIT EST HONNÊTE, ET IL LE DOIT ═══
 *
 * `estGele` vit sur les chemins CHAUDS : la collision à chaque pas, les champs de flux sur
 * des centaines de milliers de tuiles. Or `baselineTemperature` scanne `state.structures`
 * (l'abri) et les zones (la grotte). Deux gardes le protègent, dans cet ordre de coût :
 *
 *  1. `gelPossible(state)` — O(1), aucune lecture de carte : le point le PLUS FROID que la
 *     vallée puisse atteindre à ce tick. Au-dessus de `SEUIL_GUE`, rien ne gèle nulle part.
 *  2. le terrain : seule l'EAU gèle, et l'eau est une petite part de la carte.
 *
 * La borne du n°1 doit être **prouvablement conservatrice**, jamais approchée : une borne
 * fausse rendrait une tuile franchissable pour l'avatar et bloquante pour l'A*. Elle
 * SURESTIME donc le froid partout où elle doute — présence d'une Brume plutôt que
 * `dansLaBrume`, présence d'un front plutôt que son intensité au point.
 *
 * ⚠ LA PRÉDICTION CLIENT EST ENCORE AVEUGLE AU GEL. `MoveWorld.etat` est optionnel, et le
 * client bâtit ses propres `MoveWorld` (chantier de rendu, tranche suivante) : tant qu'il ne
 * le renseigne pas, il prédit la glace comme de l'eau — élastique sur les lacs gelés.
 *
 * Pur et déterministe : `+ − × ÷`, `floor`, `min`, `max` (invariant n°2).
 */
import {
  BRUME,
  FLORE,
  GEL,
  TEMPERATURE,
  TERRAIN_DEEP_WATER,
  TERRAIN_FOREST,
  TERRAIN_OLD_GROWTH,
  TERRAIN_SHALLOW_WATER,
  TERRAIN_WILLOW,
  TERRAINS,
} from './balance'
import { terrainAt } from './map'
import { coldMaximal, frontDuCycle, frontMeteoPos, largeurDe, neigeA, type BandeMeteo } from './meteo'
import { fbm2, hash2 } from './noise'
import type { SimState } from './sim'
import { baselineTemperature, baselineTemperatureAt, climatFlore, climatMaximal, dehorsSansMeteo } from './temperature'
import { actForDay, partDeNuit, seasonDayAtTick, TICKS_PER_CYCLE } from './time'

/**
 * LE PLANCHER DE TEMPÉRATURE DE LA VALLÉE à ce tick — une borne INFÉRIEURE prouvée du
 * `baselineTemperature` de n'importe quelle tuile d'EAU, calculée en O(1).
 *
 * La formule complète est `clamp(BASE − ACT_COLD − abri × (biome − nuit − brume − météo))`.
 * Sur une tuile d'eau, `biome` vaut 0 (ni 4 ni 6 n'ont d'entrée dans `BIOME_OFFSET`), et
 * `abri` vaut 1 au pire (l'abri ne fait que RÉDUIRE une exposition négative). Il reste à
 * majorer chaque exposition, ce qu'on fait par PRÉSENCE et non par intensité :
 *   · la nuit est globale — exacte, pas majorée, et depuis la rampe (`partDeNuit`) elle vaut
 *     sa PENTE plutôt qu'un booléen ;
 *   · une Brume dans l'état vaut `COLD_MALUS` partout (elle ne mord en vrai que sous sa nappe) ;
 *   · un front vaut son PLEIN froid partout (`coldMaximal` — la ligne `ORAGE_FROID` pour un
 *     orage, qui ne l'atteint en vrai que par grand froid, R12 ; et seulement dans sa bande).
 * On sous-estime donc toujours la température : si CETTE valeur est déjà trop chaude pour
 * geler, aucune tuile ne gèle — c'est la seule chose que le court-circuit affirme.
 */
function plancherDeLaVallee(state: SimState): number {
  // On refait le calcul de `getGameTime` au lieu de l'appeler, et pour UNE raison MESURÉE :
  // il ALLOUE son résultat (un objet de cinq champs). Cette borne est interrogée une fois
  // par tuile bloquante — des centaines de milliers de fois par champ de flux —, or on n'a
  // besoin que de deux de ses cinq champs. Mêmes expressions, même ordre, zéro allocation.
  const jour = seasonDayAtTick(state.tick, state.calendarScale)
  const cycleTick = (state.tick + state.cycleOffset) % TICKS_PER_CYCLE
  let t = TEMPERATURE.BASE - TEMPERATURE.ACT_COLD(actForDay(jour))
  // La nuit est une PENTE (`partDeNuit`) : on la lit ICI plutôt que via `GameTime`, pour la
  // même raison MESURÉE qui fait recalculer `cycleTick` à la main — zéro allocation.
  t -= TEMPERATURE.NIGHT_COLD * partDeNuit(cycleTick)
  if (state.brume) t -= BRUME.COLD_MALUS
  if (state.meteo) t -= coldMaximal(state.meteo.type)
  return t
}

/**
 * QUELQUE CHOSE PEUT-IL GELER DANS CETTE VALLÉE, à ce tick ? O(1), aucune lecture de carte.
 * Faux ⇒ `estGele` est faux PARTOUT — c'est le cas de tout l'acte I, et de la plupart des
 * journées d'acte II. Exposée : le client (tranche de rendu) et les bancs veulent la même
 * porte d'entrée bon marché avant de balayer un écran de tuiles.
 */
export function gelPossible(state: SimState): boolean {
  // `+ HYSTERESIS` : une glace posée peut SURVIVRE jusqu'au seuil relevé (G8). Une borne qui
  // s'arrêterait au seuil nu écarterait des tuiles encore gelées — et une borne fausse, c'est
  // une tuile franchissable pour l'avatar et bloquante pour l'A*.
  //
  // ⚠ ELLE EST EXACTEMENT TENDUE, et c'est une dépendance à écrire. Le point le plus froid
  // de l'acte I vaut 50, et `SEUIL_GUE + HYSTERESIS` vaut 50 : la borne ne tient que parce
  // que `estGele` compare par `<` STRICT (à 50, elle rend faux, et ici aussi). Relâcher l'une
  // des deux comparaisons en `<=` sans l'autre rendrait cette borne UNSOUND — en silence.
  // (La rampe de nuit ne la touche pas : `partDeNuit` vaut 1 sur toute la nuit, donc le point
  //  le plus froid de chaque acte est CELUI D'AVANT, au bit près. Vérifié le 2026-08-23.)
  return plancherDeLaVallee(state) < GEL.SEUIL_GUE + GEL.HYSTERESIS
}

/**
 * LE SEUIL DE CETTE TUILE — `undefined` si elle ne peut pas geler (ce n'est pas de l'eau).
 * Deux seuils, deux promesses (G2) : le gué prend tiède (on ne patauge plus, on glisse), le
 * lac prend NETTEMENT plus froid — et devient alors un chemin.
 */
function seuilDe(terrain: number): number | undefined {
  if (terrain === TERRAIN_SHALLOW_WATER) return GEL.SEUIL_GUE
  if (terrain === TERRAIN_DEEP_WATER) return GEL.SEUIL_PROFOND
  return undefined
}

/**
 * CETTE TUILE EST-ELLE GELÉE ? Le prédicat, et il n'y en a qu'un : la marche de l'avatar,
 * le pas des PNJ, l'A* et les champs de flux des hordes lisent tous celui-ci (G4).
 *
 * Coordonnées de TUILE (entières) — voir l'en-tête : évaluer ici en flottant et là en entier
 * ferait deux lois d'une seule.
 *
 * ═══ G8 — LE DÉGEL A DE L'HYSTÉRÉSIS, ET ELLE EST DÉRIVÉE, PAS RANGÉE ═══
 *
 * La loi complète est celle d'un thermostat :
 *
 *     gelé  ⟸  T < seuil                       (il fait franchement froid : ça PREND)
 *     gelé  ⟸  T < seuil + HYSTERESIS  ET  c'était gelé un instant plus tôt
 *     dégelé sinon
 *
 * La deuxième ligne est une MÉMOIRE — et rien du gel n'est stocké. Elle se recalcule : la
 * température est une fonction pure du tick, donc « il faisait franchement froid ici il y a
 * `RETARD_TICKS` » se relit par `baselineTemperatureAt`. UNE lecture de plus, et seulement
 * dans la BANDE MORTE `[seuil, seuil + HYSTERESIS)` — partout ailleurs le premier test
 * tranche. C'est ce qui la rend tenable sur un champ de flux.
 *
 * ⚠ CE QUE CETTE HYSTÉRÉSIS N'EST PAS. Une hystérésis EXACTE dépend de tout l'historique
 * depuis le dernier franchissement décisif, dont l'âge n'est pas borné : une glace prise au
 * jour 30 et jamais franchement réchauffée devrait tenir jusqu'au jour 60. Reconstruire ça
 * purement demanderait une récursion sans fond sur le tick — donc, en O(1), un CHAMP D'ÉTAT.
 * On borne donc la mémoire à `RETARD_TICKS` : dans la bande morte, la glace tient au plus ce
 * délai après le dernier froid décisif. C'est un dégel RETARDÉ, pas un dégel conditionnel —
 * et c'est très exactement la conséquence de jeu demandée (« la carte se referme derrière
 * ceux qui l'ont traversée »). Une hystérésis illimitée serait une décision d'Alexis : elle
 * coûterait un champ dans le `SimState` et l'invariant « rien n'est stocké » avec.
 */
export function estGele(state: SimState, tx: number, ty: number): boolean {
  if (!gelPossible(state)) return false
  const seuil = seuilDe(terrainAt(state.map, tx, ty))
  if (seuil === undefined) return false
  const t = baselineTemperature(state, tx, ty)
  if (t < seuil) return true // ça prend
  if (t >= seuil + GEL.HYSTERESIS) return false // ça a franchement dégelé
  // LA BANDE MORTE : la glace garde son état. « Était-elle gelée ? » se relit dans le passé
  // proche — jamais avant le tick 0, où le monde n'a pas d'avant.
  const avant = Math.max(0, state.tick - GEL.RETARD_TICKS)
  return baselineTemperatureAt(state, tx, ty, avant) < seuil
}

/**
 * LE FACTEUR DE VITESSE D'UNE TUILE GELÉE — `VITESSE_GLACE`, ou `undefined` si la tuile
 * n'est pas de la glace (l'appelant garde alors le `speedFactor` du terrain).
 *
 * Le contraste est tout le sel de la règle : le gué passe de 0,5 (on patauge) à 1,1 (on
 * glisse), et le lac de « infranchissable » à 1,1. La vallée ne se contente pas de mordre,
 * elle change de forme.
 */
export function vitesseSurGlace(state: SimState, tx: number, ty: number): number | undefined {
  return estGele(state, tx, ty) ? GEL.VITESSE_GLACE : undefined
}

/**
 * ═══ G9 — LA NEIGE A DEUX HAUTEURS (décision d'Alexis, 2026-08-22) ═══
 *
 * `neigeAuSol` rend une couverture CONTINUE ; le pas et le rendu ont besoin d'un NIVEAU par
 * tuile : 0 nue, 1 poudreuse, 2 jusqu'aux genoux. Le seuil d'une tuile est POSITIONNEL (un
 * bruit à l'échelle des plaques, `GEL.NEIGE_PLAQUES_TUILES`, plus une gigue par tuile — des
 * hachages, jamais le PRNG d'état) : à couverture croissante, les plaques se ferment depuis
 * leurs cœurs ; à couverture décroissante, elles s'ouvrent par les bords. La profonde est le
 * cœur d'une plaque : là où le seuil est bas, la couverture le dépasse de `NEIGE_PROFONDE`.
 *
 * Une seule loi, deux lecteurs : `moveAvatar` (le pas, `vitesseSurNeige`) et le manteau
 * peint (`render/manteau.ts`) — ce qu'on voit sous ses pieds est ce qui ralentit.
 */
export const NEIGE_NUE = 0
export const NEIGE_POUDREUSE = 1
export const NEIGE_GENOUX = 2
export type NiveauDeNeige = 0 | 1 | 2

/** Le seuil de couverture d'une tuile, dans [NEIGE_SEUIL_MIN, NEIGE_SEUIL_MAX] — positionnel. */
export function seuilDeNeige(tx: number, ty: number): number {
  const plaque = fbm2(tx, ty, GEL.NEIGE_PLAQUES_TUILES, 0x5e16e)
  const gigue = (hash2(tx, ty, 0x5e17) - 0.5) * GEL.NEIGE_GIGUE
  const u = Math.max(0, Math.min(1, plaque + gigue))
  return GEL.NEIGE_SEUIL_MIN + u * (GEL.NEIGE_SEUIL_MAX - GEL.NEIGE_SEUIL_MIN)
}

/** Le niveau de neige d'une couverture sur cette tuile — monotone en `couverture`. */
export function niveauPourCouverture(couverture: number, tx: number, ty: number): NiveauDeNeige {
  if (couverture < GEL.NEIGE_SEUIL_MIN) return NEIGE_NUE // O(1) sans neige : pas de bruit à tirer
  const seuil = seuilDeNeige(tx, ty)
  if (couverture < seuil) return NEIGE_NUE
  return couverture < seuil + GEL.NEIGE_PROFONDE ? NEIGE_POUDREUSE : NEIGE_GENOUX
}

/** Le niveau de neige d'une tuile MAINTENANT. L'eau (libre ou gelée) n'en porte jamais : la
 *  glace doit se VOIR (G5), et un flocon qui tombe dans l'eau fond. */
export function niveauDeNeige(state: SimState, tx: number, ty: number): NiveauDeNeige {
  const terrain = terrainAt(state.map, tx, ty)
  if (terrain === TERRAIN_SHALLOW_WATER || terrain === TERRAIN_DEEP_WATER) return NEIGE_NUE
  return niveauPourCouverture(neigeAuSol(state, tx, ty), tx, ty)
}

/**
 * LE FACTEUR DE VITESSE D'UNE TUILE SOUS LA NEIGE — `VITESSE_POUDREUSE`, `VITESSE_GENOUX`,
 * ou `undefined` sans neige (l'appelant garde alors le `speedFactor` du terrain). Il REMPLACE
 * le terrain : une route sous la neige n'est plus une route, un marais gelé sous la poudreuse
 * n'enlise plus — c'est la neige qu'on foule.
 */
export function vitesseSurNeige(state: SimState, tx: number, ty: number): number | undefined {
  const niveau = niveauDeNeige(state, tx, ty)
  if (niveau === NEIGE_GENOUX) return GEL.VITESSE_GENOUX
  if (niveau === NEIGE_POUDREUSE) return GEL.VITESSE_POUDREUSE
  return undefined
}

/** Les terrains à feuilles CADUQUES (G6). `pine` et `larch` n'y sont pas : le conifère tient
 *  — et le mélèze, qui perd ses aiguilles en vrai, est aligné sur eux PAR LISIBILITÉ (la
 *  silhouette du conifère doit dire « il tient »). */
const CADUCS = [TERRAIN_FOREST, TERRAIN_OLD_GROWTH, TERRAIN_WILLOW]

const DEFEUILLAISON_SALT = 0x2f8b7a15

/**
 * G6 — LE JOUR DE SAISON OÙ **CETTE** TUILE PERD SES FEUILLES. Un décalage stable, tiré par
 * `hash2` sur la tuile : la forêt ne se dépouille pas d'un seul matin, elle s'éclaircit sur
 * `DEFEUILLAISON_JOURS`. Pure fonction de la position — aucun tirage sur le PRNG d'état.
 */
export function jourDeDefeuillaison(tx: number, ty: number): number {
  return GEL.JOUR_DEFEUILLAISON + hash2(tx, ty, DEFEUILLAISON_SALT) * GEL.DEFEUILLAISON_JOURS
}

/**
 * G6 — CETTE TUILE BOISÉE EST-ELLE DÉNUDÉE ? Faux sur tout ce qui n'est pas un feuillu :
 * `pine` et `larch` ne changent JAMAIS.
 *
 * ═══ LA FEUILLAISON SUIT LA SAISON, JAMAIS L'INSTANT ═══
 *
 * On l'a d'abord keyée sur une TEMPÉRATURE, et c'était faux — pas approximatif : faux. Sur un
 * terrain boisé (`BIOME_OFFSET` +5), la table donne 95/65 en acte I, 70/40 en acte II, 45/15
 * en acte III (jour/nuit) : **aucune** valeur ne sépare la nuit d'acte II (40) du jour d'acte
 * III (45). Quel que soit le seuil, la forêt entière aurait donc reperdu ses feuilles à
 * chaque crépuscule et les aurait retrouvées à chaque aube. Or une feuille qui tombe ne
 * remonte pas.
 *
 * Le jour de saison, lui, ne redescend jamais : la MONOTONIE est acquise par construction, et
 * pas par une garde qui la surveille (A13). La lisière d'un front qui passe ne peut plus
 * déshabiller un bosquet au vol non plus.
 *
 * **PUREMENT VISUEL au v1** : le `cover` du terrain — qui commande la furtivité et l'abri de
 * la faune — ne bouge pas d'un pouce. Le rendre mécanique changerait la furtivité de toute
 * la carte en acte III : c'est une décision d'équilibrage à part, hors périmètre.
 */
export function feuillageDenude(state: SimState, tx: number, ty: number): boolean {
  if (!CADUCS.includes(terrainAt(state.map, tx, ty))) return false
  return seasonDayAtTick(state.tick, state.calendarScale) >= jourDeDefeuillaison(tx, ty)
}

/**
 * TOUT CE QUI VIT GÈLE-T-IL, PARTOUT, À CE TICK ? (spec `flore-froid.md`) — O(1), aucune
 * lecture de carte. Le pendant OPTIMISTE de `gelPossible` : là où celle-ci surestime le
 * froid pour ne jamais rater une glace, celle-ci l'écarte pour ne jamais déclarer gelé ce
 * qui ne l'est pas. Vrai ⇒ `floreGelee` est vrai partout, on peut sauter le terrain.
 *
 * C'est le court-circuit du cas COÛTEUX, et il tombe pile dessus : l'acte III entier
 * (45 au mieux) et toutes les nuits dès l'acte II (40) — précisément les moments où des
 * milliers de nœuds sont à échéance et gelés en même temps, tick après tick.
 */
export function floreEntierementGelee(state: SimState): boolean {
  return climatMaximal(state, state.tick) < FLORE.SEUIL_GEL
}

/**
 * F2/F3/F4 — LA FLORE DE CETTE TUILE EST-ELLE GELÉE ? Le prédicat unique du froid sur les
 * plantes : la repousse ne s'y achève pas, la cueillette n'y prend rien, la terre ne s'y
 * sème pas.
 *
 * Au COIN de la tuile, en entiers, comme toutes les lois de gel (voir l'en-tête) : le client
 * la recalcule par la même façade, et deux échantillonnages différents feraient diverger ce
 * qu'il peint de ce que la sim applique.
 *
 * Ne dit RIEN de ce qui est vivant : c'est l'appelant qui lit `NodeDef.vivant` (F7). Un
 * filon de fer sur une tuile gelée est « gelé » au sens de cette fonction, et s'en moque.
 */
export function floreGelee(state: SimState, tx: number, ty: number): boolean {
  if (floreEntierementGelee(state)) return true
  return climatFlore(state, tx, ty, state.tick) < FLORE.SEUIL_GEL
}

/**
 * F5 — LE GEL EST-IL MORTEL SUR CETTE TUILE ? Le seul endroit où le froid DÉTRUIT au lieu
 * de suspendre : sous ce seuil, une culture à ciel ouvert est perdue (`agriculture.ts`).
 * Pas de court-circuit : elle n'est interrogée que sur les rares parcelles SEMÉES.
 */
export function gelMortel(state: SimState, tx: number, ty: number): boolean {
  return climatFlore(state, tx, ty, state.tick) < FLORE.SEUIL_MORTEL
}

/** Les fronts qui PEUVENT déposer de la neige : ceux qui précipitent (R11). Qu'ils en
 *  déposent ICI se décide tranche par tranche, par `neigeA` sur le froid du monde — le
 *  brouillard et le vent de cendre ne déposent rien. */
const PRECIPITANTS = ['pluie', 'orage']

/**
 * G7 — LA COUVERTURE DE NEIGE AU SOL en (tx, ty), dans [0, 1]. PURE, SANS UN OCTET D'ÉTAT.
 *
 * ═══ LE PROBLÈME : LA NEIGE A UNE MÉMOIRE, LA TEMPÉRATURE N'EN A PAS ═══
 *
 * « La neige tient après le front, puis fond » demande de savoir QUAND un front est passé —
 * or `state.meteo` ne porte que le front COURANT, et les précédents sont purgés. Semer des
 * points de neige au sol à chaque tick sous une bande mobile serait une inondation d'état
 * (le raisonnement qui a déjà écarté les points `faunaQuiet` pour `meteoQuiet`).
 *
 * La sortie est la même que pour le front de cendre : **l'élection est une fonction pure du
 * cycle, donc le passé se recalcule.** On rembobine les `MEMOIRE_CYCLES` derniers cycles par
 * `frontDuCycle` (l'écrivain unique de l'élection, dans `meteo.ts`), on garde les fronts
 * neigeux, et on demande à chacun QUAND sa bande a balayé ce point.
 *
 * ═══ « OÙ » NE DISCRIMINE RIEN, « QUAND » DISCRIMINE TOUT ═══
 *
 * Une bande cardinale traverse la carte de bord à bord : elle finit par couvrir CHAQUE point.
 * Demander « ce front a-t-il couvert ce point ? » rendrait donc vrai partout, et la couverture
 * serait uniforme. Ce qui varie dans l'espace, c'est l'HEURE de passage — on la résout
 * analytiquement en inversant `frontMeteoPos` : la bande couvre la coordonnée `c` de l'axe
 * de traversée quand son avancée est dans `(c, c + largeur)`, ce qui donne directement le
 * tick d'entrée et le tick de sortie. D'où un dégradé naturel : la neige tient plus longtemps
 * du côté par où le front est SORTI.
 *
 * ═══ LA FONTE PAIE LE TEMPS **ET** LA TEMPÉRATURE ═══
 *
 * Sous la bande : la couverture MONTE, de 0 à l'entrée à 1 à la sortie — **sur les seules
 * tranches où il NEIGE ici** (R11 : `neigeA` sur le froid du monde sans le front, à l'instant
 * de la tranche — la même loi que l'aspect dessiné). Un front de pluie d'acte I ne laisse rien
 * en plaine et couvre le Névé ; une bande qui traverse la plaine d'acte II au crépuscule y
 * dépose la part nocturne de son passage. Chaque tranche se juge à un instant FIXE (son
 * milieu sur la grille, borné à la sortie), jamais au tick courant : la couverture est
 * monotone croissante en `tick` tant que la bande couvre — elle ne peut pas redescendre
 * parce que le soleil s'est levé au milieu de la dernière tranche.
 * Après : elle décroît linéairement sur `FONTE_CYCLES` cycles par grand froid, jusqu'à
 * `FONTE_CYCLES_CHAUD` au redoux — la même neige tient un jour sur le Névé et une heure au
 * bord de l'eau. On garde le MAXIMUM sur les cycles rembobinés : deux fronts rapprochés ne
 * s'annulent pas.
 *
 * **PUREMENT VISUEL au v1** : aucun malus de vitesse (le froid ralentit déjà par
 * `coldSpeedFactor`, et l'accumulation mécanique est hors périmètre). NULLE sans météo
 * armée : sans `meteoActive`, aucun front n'a jamais eu lieu (A10).
 */
export function neigeAuSol(state: SimState, tx: number, ty: number): number {
  if (!state.meteoActive) return 0
  const cycle = Math.floor(state.tick / TICKS_PER_CYCLE)
  const { width, height } = state.map
  let best = 0
  for (let k = 0; k < GEL.MEMOIRE_CYCLES; k++) {
    const c = cycle - k
    if (c < 0) break
    const front = frontDuCycle(c, state.calendarScale)
    if (!front || !PRECIPITANTS.includes(front.type)) continue

    // L'ENTRÉE et la SORTIE de la bande sur ce point — l'inverse analytique de
    // `frontMeteoPos`, donc la MÊME géométrie, jamais une seconde (et la même largeur :
    // `largeurDe`, R13 — l'orage s'élargit avec la saison).
    const axis = front.edge <= 1 ? 'x' : 'y'
    const span = axis === 'x' ? width : height
    const largeur = largeurDe(front)
    const brut = axis === 'x' ? tx : ty
    // Ouest (0) et nord (2) traversent vers +axe ; est (1) et sud (3) vers −axe — dans ce
    // second cas le point vu par la bande est son miroir (`frontMeteoPos` : lo = span − avance).
    const coord = front.edge === 0 || front.edge === 2 ? brut : span - brut
    const fenetre = front.endTick - front.startTick
    const entree = front.startTick + (coord / (span + largeur)) * fenetre
    const sortie = front.startTick + ((coord + largeur) / (span + largeur)) * fenetre

    let couverture: number
    if (state.tick <= entree) continue // la bande n'est pas encore arrivée ici
    // CE QUI EST TOMBÉ EN NEIGE, tranche par tranche, jusqu'au tick courant ou à la sortie.
    const PAS_NEIGE = TICKS_PER_CYCLE / GEL.FONTE_TRANCHES_PAR_CYCLE
    const finChute = Math.min(state.tick, sortie)
    let tombe = 0
    for (let t0 = entree; t0 < finChute; t0 += PAS_NEIGE) {
      const t1 = Math.min(finChute, t0 + PAS_NEIGE)
      const instant = Math.min(sortie, t0 + PAS_NEIGE / 2) // FIXE par tranche : monotone en `tick`
      if (neigeA(dehorsSansMeteo(state, tx, ty, instant))) tombe += (t1 - t0) / (sortie - entree)
    }
    if (tombe <= 0) continue // il a plu ici, pas neigé : rien au sol
    if (state.tick < sortie) {
      couverture = tombe // il neige : ça monte
    } else {
      // ═══ LA FONTE S'INTÈGRE, ELLE NE SE RÉAPPLIQUE PAS ═══
      //
      // La vitesse de fonte dépend de la température, qui varie d'heure en heure : appliquer
      // la vitesse DE L'INSTANT à tout le temps écoulé fait REMONTER la neige au crépuscule
      // (« il fait plus froid maintenant, donc il a moins fondu hier »). MESURÉ avant
      // correction, tick figé, en ne balayant que l'heure : 0,709 le jour contre 0,842 la
      // nuit — un saut de 0,133 quand 1 200 ticks de temps réel n'en déplacent que 0,007,
      // dix-neuf fois plus. C'est l'erreur que `feuillageDenude` documente avoir refusée.
      //
      // On SOMME donc la fonte par TRANCHES, chacune évaluée à SON propre instant
      // (`baselineTemperatureAt`, la même loi prise à un autre tick). Chaque tranche n'ajoute
      // qu'une quantité positive : la couverture est MONOTONE décroissante en `tick` par
      // construction — la neige ne peut plus remonter, quoi que fasse le thermomètre.
      // Le compte de tranches est borné par `MEMOIRE_CYCLES` (au-delà, la neige a fondu de
      // toute façon), donc aucune boucle sans fond.
      const PAS = TICKS_PER_CYCLE / GEL.FONTE_TRANCHES_PAR_CYCLE
      let fondu = 0
      for (let t0 = sortie; t0 < state.tick; t0 += PAS) {
        const t1 = Math.min(state.tick, t0 + PAS)
        // La température AU MILIEU DE LA TRANCHE PLEINE — `t0 + PAS/2`, un point FIXE de la
        // grille, et non `(t0 + t1)/2`, qui BOUGE avec `state.tick` sur la dernière tranche.
        //
        // ⚠ C'EST CE QUI REND LA COUVERTURE MONOTONE, et le défaut était MESURÉ : avec le
        // milieu mobile, la dernière tranche changeait de température d'un relevé à l'autre,
        // si bien que la neige oscillait (0,5474 → 0,5377 → 0,5490 sur trois pas de 900 ticks,
        // relevé au cycle 634). Sur la grille fixe, chaque tranche n'ajoute qu'une quantité
        // positive dont le coefficient ne dépend plus du tick : la somme est croissante par
        // CONSTRUCTION — la neige ne peut plus remonter, quoi que fasse le thermomètre.
        const t = baselineTemperatureAt(state, tx, ty, t0 + PAS / 2)
        // Du gel du lac (−10 °C : la fonte est la plus lente) à l'air doux (+6 °C : elle est
        // la plus rapide) — `AMBIANT_DOUX` a remplacé l'ex-`COMFORT`, qui est devenu un seuil
        // du CORPS quand l'échelle est passée en degrés (2026-08-22).
        const u = Math.max(0, Math.min(1, (t - GEL.SEUIL_PROFOND) / (TEMPERATURE.AMBIANT_DOUX - GEL.SEUIL_PROFOND)))
        const cycles = GEL.FONTE_CYCLES + (GEL.FONTE_CYCLES_CHAUD - GEL.FONTE_CYCLES) * u
        fondu += (t1 - t0) / (cycles * TICKS_PER_CYCLE)
        if (fondu >= 1) break // tout est fondu : inutile de continuer à sommer
      }
      couverture = tombe - fondu
    }
    if (couverture > best) best = couverture
  }
  return Math.max(0, Math.min(1, best))
}

/**
 * LA BANDE D'UN FRONT PASSÉ, pour les bancs et les gardes — `frontMeteoPos` appliquée au
 * front rembobiné du cycle. Elle n'existe que pour rendre `neigeAuSol` VÉRIFIABLE : une
 * garde qui recopierait la géométrie de la bande pour se juger ne garderait rien.
 */
export function bandeDuCycle(state: SimState, cycle: number, tick: number): BandeMeteo | null {
  const front = frontDuCycle(cycle, state.calendarScale)
  if (!front) return null
  return frontMeteoPos(front, tick, state.map.width, state.map.height)
}

/** Le jour de saison d'un cycle — le raccourci que les gardes et les bancs redemandent. */
export function jourDuCycle(cycle: number, calendarScale: number): number {
  return seasonDayAtTick(cycle * TICKS_PER_CYCLE, calendarScale)
}

/**
 * ═══ G8bis — PERSONNE NE RESTE EMMURÉ ═══
 *
 * Le gel est la première règle du jeu qui RETIRE de la marchabilité à une tuile occupée. La
 * glace ne cède pas (immersion et noyade écartées à la décision) — mais elle DISPARAÎT, et
 * c'est le même piège vu de l'autre côté : quiconque se tient au milieu d'un lac quand il
 * dégèle se retrouve dans une tuile non marchable. Or `moveAxis` ne teste que les sous-tuiles
 * NOUVELLEMENT abordées : entouré d'eau, on ne peut plus bouger DU TOUT — le bug maison du
 * feu qui emmure l'acteur centré dessus, en version météo.
 *
 * On replie donc, chaque tick, quiconque se tient sur de l'eau profonde NON gelée, sur la
 * tuile marchable la plus proche — patron du repli des traînards de la Brume. Deux bornes
 * rendent la passe honnête :
 *
 *  · ELLE NE VOIT QUE L'EAU PROFONDE. Un acteur coincé pour une autre raison (un mur bâti
 *    autour de lui, un bug de spawn) n'est PAS de son ressort : élargir la porte ferait de
 *    cette passe un désembourbeur universel, qui masquerait les défauts au lieu de les dire.
 *    Et comme personne ne peut se tenir sur de l'eau profonde SANS le gel, la passe est
 *    strictement inerte dans un monde qui ne gèle pas.
 *  · ELLE CHERCHE PAR ANNEAUX, dans un ordre fixe, et renonce au-delà de `REPLI_RAYON`
 *    tuiles. Déterministe, bornée : aucun A*, aucune allocation, aucun tirage.
 *
 * Elle n'émet PAS d'événement : « la glace a fondu sous mes pieds » est un fait de rendu, pas
 * un fait de chronique — et haute fréquence n'est pas domaine.
 */
const REPLI_RAYON = 12

export function advanceDegel(state: SimState): void {
  for (const entity of state.entities) {
    const tx = Math.floor(entity.x)
    const ty = Math.floor(entity.y)
    if (terrainAt(state.map, tx, ty) !== TERRAIN_DEEP_WATER) continue
    if (estGele(state, tx, ty)) continue // la glace tient : il est chez lui
    const berge = bergeLaPlusProche(state, tx, ty)
    if (!berge) continue // aucune issue dans le rayon : on ne téléporte pas au hasard
    entity.x = berge.tx + 0.5
    entity.y = berge.ty + 0.5
  }
}

/**
 * LA TUILE MARCHABLE LA PLUS PROCHE — par anneaux de Chebyshev croissants, ordre de balayage
 * fixe. On accepte la GLACE aussi bien que la terre ferme : recracher quelqu'un sur un lac
 * encore pris est un repli parfaitement valide, et c'est même le plus court.
 */
function bergeLaPlusProche(state: SimState, tx: number, ty: number): { tx: number; ty: number } | null {
  for (let r = 1; r <= REPLI_RAYON; r++) {
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue // le bord de l'anneau
        const nx = tx + ox
        const ny = ty + oy
        if (nx < 0 || ny < 0 || nx >= state.map.width || ny >= state.map.height) continue
        const t = terrainAt(state.map, nx, ny)
        if (TERRAINS[t]?.walkable === true) return { tx: nx, ty: ny }
        if (t === TERRAIN_DEEP_WATER && estGele(state, nx, ny)) return { tx: nx, ty: ny }
      }
    }
  }
  return null
}
