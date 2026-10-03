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
import { CARACTERES_DE_FOYER, CENDRE, froidDeCendre, tuileCendree } from './cendre'
import { FUMEROLLE } from './fumerolle'
import { TERRASSES } from './terrasses' // `PALIERS` : le pire palier, pour que la borne reste sound
import { terrainAt } from './map'
import { coldMaximal, frontDuCycle, frontMeteoPos, largeurDe, partDeNeige, type BandeMeteo } from './meteo'
import { effetsDuJour } from './modificateur'
import { fbm2, hash2 } from './noise'
import { palierDuSol } from './etages'
import type { SimState } from './sim'
import {
  baselineTemperature,
  baselineTemperatureAt,
  abriDeTuile,
  froidDeFumerolleDeTuile,
  type ConstantesDeTuile,
  climatFlore,
  climatMaximal,
  clampTemp,
  dehorsSansMeteo,
  socleDuJour,
} from './temperature'
import { dayTicksAt, jourDeLAnnee, jourDeSaison, partDeNuit, TICKS_PER_CYCLE, tourForDay } from './time'

/**
 * LE PIRE SOUFFLE DE FUMEROLLE QUE `plancherDuPalier` NE SAIT PAS SITUER — DÉRIVÉ.
 *
 * `froidDeFumerolle` plafonne à `FUMEROLLE.FROID × cadranDeFoyer(…, 'froid')`, le facteur de
 * distance étant dans `[0, 1[`. Le pire cadran se LIT DANS LA TABLE au lieu d'être recopié : le
 * jour où un caractère souffle plus froid que la Muette, cette constante suit — un 1,4 en dur ne
 * suivrait pas.
 *
 * ⚠ **LE FROID DE CENDRE EST UNE CONSTANTE SÉPARÉE, ET LA SÉPARATION EST MESURÉE.** Les deux
 * froids n'ont pas la même condition d'existence : le souffle exige un `cendreAge` non vide
 * (`avanceesDepuisAges([], 0)` rend un tableau vide, donc `fumerollesAutour` n'éveille personne),
 * mais `froidDeCendre` passe par `profondeurNueDeCendre`, qui lit `cendreAge?.[k] ?? 0` et
 * **calcule quand même** — il ne rend `−1` que sans `map.cendreCout`. Les gater ensemble était
 * donc faux en droit, même si c'était juste en fait sur cette carte (MESURÉ le 2026-10-02 :
 * `froidDeCendre` est nul sur les **321 649** tuiles d'eau, aux deux régimes de cendre — l'eau
 * n'est pas dans la bande de vieille cendre. Une borne ne doit pas reposer là-dessus.)
 */
const FROID_DE_FUMEROLLE_MAX = FUMEROLLE.FROID
  * Math.max(1, ...Object.values(CARACTERES_DE_FOYER).map((e) => e.froid ?? 1))

/**
 * LE PIRE SOUFFLE DE FUMEROLLE SUR L'EAU DE **CE** PALIER — précalculé à l'amorce, global en repli.
 *
 * ⚠ **POURQUOI UN CHAMP DE CARTE PLUTÔT QUE LA CONSTANTE, ET C'EST UN CHIFFRE QUI L'A DÉCIDÉ**
 * (Alexis, 2026-10-02 : *« on suit ta reco »*). Le majorant GLOBAL vaut 12,6 °C — le pire souffle
 * de la carte entière, retranché partout. Il élargit donc la fenêtre du plancher de douze degrés
 * *aux paliers où aucune fumerolle ne touche l'eau*, et la porte « ici rien ne gèle » cesse de
 * couper au fond de la vallée. MESURÉ sur le pire écran du palier 0 (13 098 tuiles d'eau, 88
 * chunks cuits d'un coup) : **7,5 ms avec la porte, 62 ms sans — et 285 ms sur une base de 800
 * structures**, soit 34 images à 120 fps de gel sur une téléportation.
 *
 * ⚠ **ET LE GAIN EST PARTIEL, IL FAUT LE DIRE AVEC SON CHIFFRE.** Situé, le terme tombe à 8,09 °C
 * au palier 0 — exact, c'est le pire souffle qu'une tuile d'eau de ce palier prend vraiment. La
 * porte y recoupe **126 points de l'année sur 480** contre 74 avant, et sa fenêtre de midi passe de
 * **31 à 47 jours** sur 120. Mais l'instant mesuré (Pluies, jour 75) reste ouvert : aucun majorant
 * PAR PALIER ne peut le fermer, puisque 8 °C est la vérité de ce palier. Fermer les 73 jours
 * restants demanderait un index PAR TUILE des 416 tuiles d'eau qui prennent un souffle (plafond
 * mesuré : 260/480) — il n'est pas écrit, et c'est une décision qui n'est pas prise.
 *
 * ⚠ **LE REPLI N'EST PAS DE LA PRUDENCE, C'EST LA MIGRATION DE SAUVEGARDE** (mémoire : un champ
 * neuf requis jette au premier tick). Une carte d'avant le 2026-10-02, un faux `SimState` de
 * façade côté client, une carte de banc : `souffleMax` y est `undefined`, et l'on retombe sur le
 * majorant global — plus lent, **jamais faux**. C'est le seul sens dans lequel on peut dégrader :
 * un repli par zéro rendrait la borne fausse, donc le gel incohérent.
 */
function souffleMaxDuPalier(map: SimState['map'], palier: number): number {
  return map.souffleMax?.[palier] ?? FROID_DE_FUMEROLLE_MAX
}

/**
 * LE PLANCHER DE TEMPÉRATURE DE LA VALLÉE à ce tick — une borne INFÉRIEURE prouvée du
 * `baselineTemperature` de n'importe quelle tuile d'EAU, calculée en O(1).
 *
 * La formule complète est `clamp(SOCLE(jour, tour) + abri × (biome − nuit − brume − météo))`.
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
/**
 * ⚠ **EXPORTÉE POUR UNE SEULE RAISON : SA MONOTONIE EST UN CONTRAT QUE RIEN D'AUTRE NE PEUT
 * TENIR.** `gelPossible` ne lit que le plus HAUT palier en supposant qu'il a le plancher le plus
 * BAS ; or depuis le 2026-10-02 cette décroissance n'est plus structurelle (voir `souffleMaxDuPalier`,
 * qui CROÎT avec le palier), et elle est INOBSERVABLE par la porte : `gelPossibleAuPalier` est un
 * SEUIL, et aux paliers ≥ 1 il est franchi à toute saison — une implication entre portes y est donc
 * vraie quoi qu'il arrive. C'est la valeur qu'il faut lire, pas son verdict. (Sa jumelle
 * `plafondDuPalier` était publique depuis le premier jour, pour la même sorte de garde.)
 */
export function plancherDuPalier(state: SimState, palier: number): number {
  // On refait le calcul de `getGameTime` au lieu de l'appeler, et pour UNE raison MESURÉE :
  // il ALLOUE son résultat (un objet de cinq champs). Cette borne est interrogée une fois
  // par tuile bloquante — des centaines de milliers de fois par champ de flux —, or on n'a
  // besoin que de deux de ses cinq champs. Mêmes expressions, même ordre, zéro allocation.
  const jour = jourDeSaison(state)
  const cycleTick = (state.tick + state.cycleOffset) % TICKS_PER_CYCLE
  let t = socleDuJour(jour, tourForDay(jour))
  // La nuit est une PENTE (`partDeNuit`) : on la lit ICI plutôt que via `GameTime`, pour la
  // même raison MESURÉE qui fait recalculer `cycleTick` à la main — zéro allocation. Sa
  // LONGUEUR est saisonnière (S6) et se lit sur le jour du début de cycle, comme partout.
  t -= TEMPERATURE.ECART_NUIT(jour) * partDeNuit(cycleTick, dayTicksAt(state, state.tick))
  if (state.brume) t -= BRUME.COLD_MALUS
  if (state.meteo) t -= coldMaximal(state.meteo.type)
  // ⚠ ═══ LE FROID D'ALTITUDE, AU PIRE PALIER : SANS LUI CETTE BORNE EST **FAUSSE** ═══
  //   (2026-09-30, `braise.md` § 3.1 — `TEMPERATURE.FROID_PAR_ETAGE`.)
  //
  // Cette fonction n'a PAS DE POSITION : c'est une borne inférieure sur TOUTE la vallée. Depuis que
  // le froid monte avec le palier, le point le plus froid n'est plus au fond mais au sommet — et
  // une borne qui l'ignorerait rendrait `gelPossible` faux pendant que le haut est à −86 °C. Ce
  // serait exactement le défaut que l'en-tête de `gelPossible` interdit : « une tuile franchissable
  // pour l'avatar et bloquante pour l'A* ».
  //
  // ⚠ ═══ LE FROID D'ALTITUDE DU PALIER DEMANDÉ ═══
  //   (2026-09-30 pour le terme, 2026-10-02 pour le fait qu'il soit LOCAL — `braise.md` § 3.2.)
  //
  // C'est ce terme qui rend la borne JUSTE en altitude : sans lui elle affirmerait que rien ne
  // gèle pendant que le sommet est à −86 °C, et ce serait « une tuile franchissable pour l'avatar
  // et bloquante pour l'A* » — le défaut que l'en-tête de `gelPossible` interdit.
  //
  // ⚠ **ET C'EST POURQUOI LE PALIER EST UN PARAMÈTRE.** Du 30/09 au 02/10 cette fonction
  //   retranchait le PIRE palier (`PALIERS − 1`) parce qu'elle devait valoir pour toute la vallée.
  //   La borne restait juste, mais son raccourci « rien ne gèle nulle part » ne coupait plus
  //   JAMAIS : MESURÉ 120/240 points de l'année avant, **0/240** après. Rendue locale, elle coupe
  //   à nouveau là où elle le doit — au fond de la vallée, aux saisons douces.
  t -= TEMPERATURE.FROID_PAR_ETAGE * palier
  // ⚠ ═══ LES DEUX FROIDS LOCAUX QUE CETTE BORNE OMETTAIT, ET QUI LA RENDAIENT FAUSSE ═══
  //   (trouvé et REPRODUIT le 2026-10-02 : 1 540 divergences sur la graine 2026.)
  //
  // `expositionSansMeteo` retranche CINQ termes, pas trois : `biome − nuit − brume − FUMEROLLE −
  // CENDRE`. Les deux derniers manquaient ici, et ce sont des froids ≥ 0 : la borne pouvait donc
  // être AU-DESSUS du vrai, et la porte affirmer « rien ne gèle » sur un gué à −3,6 °C. MESURÉ sur
  // le monde joué (cendre vieillie) : **416 tuiles d'eau** portent un souffle de fumerolle, jusqu'à
  // **8,09 °C**, aux paliers 0, 1 et 2 — et `estGele` les déclarait libres 1 540 fois dans l'année.
  //
  // ⚠ **LE DÉFAUT EST PLUS VIEUX QUE L'ÉTAPE 2, ET CELLE-CI LE RÉVEILLE.** Avant le 2026-09-30 la
  //   porte coupait 120/240 points de l'année et le trou était donc VIVANT ; le froid d'étage l'a
  //   MASQUÉ (0/240 — une porte qui ne coupe jamais ne peut pas se tromper) ; la rendre locale la
  //   fait couper à nouveau, donc rouvre le trou. Il ne suffisait pas de le trouver dans la borne
  //   neuve : il fallait le chercher dans l'ANCIENNE.
  //
  // Les deux majorants sont DÉRIVÉS, jamais posés, et ils ont CHACUN leur condition — elles ne
  // sont pas les mêmes, et les confondre était ma première version (voir la docstring ci-dessus).
  if (state.map.cendreCout !== undefined) {
    t -= CENDRE.FROID_COEUR // la vieille cendre : il suffit que la carte porte un champ de coût
    // LE SOUFFLE, lui, exige en plus des fosses éveillées : sans `cendreAge`, zéro bouche.
    // …et il se lit AU PALIER (2026-10-02) : le majorant global élargissait la fenêtre de 12,6 °C
    // partout, y compris là où aucune bouche ne touche l'eau — voir `souffleMaxDuPalier`.
    if ((state.cendreAge?.length ?? 0) > 0) t -= souffleMaxDuPalier(state.map, palier)
  }
  return t
}

/**
 * ═══ LE PLAFOND D'UN PALIER — l'AUTRE borne, et la mesure a dit qu'elle était indispensable ═══
 *
 * Une borne **SUPÉRIEURE** prouvée du `baselineTemperature` de n'importe quelle tuile d'**EAU** de
 * ce palier, en O(1). Si ce plafond est déjà sous le seuil de gel, **tout gèle ici** et l'on rend
 * vrai *sans lire une seule température*.
 *
 * ⚠ **POURQUOI DEUX BORNES ET PAS UNE** (MESURÉ le 2026-10-01, `tools/profil-porte-gel.mts`) : la
 * borne basse seule récupère **100 %** du fond de la vallée et **0 %** de l'altitude — un écran
 * d'altitude porte 5 513 tuiles d'eau gelées aux quatre cardinaux (13,1-13,4 ms CPU par cuisson),
 * et elles le sont *légitimement*. Seul ce plafond-là les récupère.
 *
 * ⚠ **LA PREUVE QUE C'EST BIEN UN MAJORANT**, et elle tient à une propriété de l'EAU :
 *   `froidDuMonde = clampTemp(socle + froidDEtage + abri × (exposition − météo))`
 *   · `abri ∈ [SHELTER_FACTOR, 1]`, donc positif — il ne peut que RÉDUIRE un terme négatif ;
 *   · `météo ≥ 0` (c'est un froid), donc `− météo ≤ 0` ;
 *   · `exposition ≤ 0` **sur de l'eau** : elle est SIGNÉE (le biome peut réchauffer, +2 en forêt)
 *     mais `BIOME_OFFSET` **n'a aucune entrée pour 4 ni 6** — ni le gué ni le lac — tandis que la
 *     nuit, la Brume et les fumerolles sont toutes des termes ≤ 0. ⚠ **C'EST L'HYPOTHÈSE DE
 *     SOUDURE DE CETTE BORNE** : le jour où une eau prend un offset de biome POSITIF, elle devient
 *     fausse. La garde `gel.test.ts` « le plafond est un vrai majorant » balaie les deux terrains
 *     et le dirait.
 * Le supremum est donc atteint quand tous ces termes valent zéro : `clampTemp(socle + froidDEtage)`.
 *
 * ⚠ **ET CETTE BORNE REPOSE SUR UNE DÉCISION DE DESIGN, PAS SEULEMENT SUR DE L'ARITHMÉTIQUE** :
 * elle ne fait gagner quelque chose que parce que l'eau d'altitude est gelée *en permanence*, ce
 * qu'Alexis a choisi d'assumer le 2026-10-01 (`braise.md` § 5.0, branche ⓐ — « les lacs d'altitude
 * sont des ponts »). Revenir sur ⓐ ne la rendrait pas FAUSSE, mais la rendrait inerte.
 */
export function plafondDuPalier(state: SimState, palier: number): number {
  const jour = jourDeSaison(state)
  return clampTemp(socleDuJour(jour, tourForDay(jour)) - TEMPERATURE.FROID_PAR_ETAGE * palier)
}

/**
 * QUELQUE CHOSE PEUT-IL GELER DANS CETTE VALLÉE, à ce tick ? O(1), aucune lecture de carte.
 * Faux ⇒ `estGele` est faux PARTOUT — c'est le cas de tout l'acte I, et de la plupart des
 * journées d'acte II. Exposée : le client (tranche de rendu) et les bancs veulent la même
 * porte d'entrée bon marché avant de balayer un écran de tuiles.
 */
export function gelPossible(state: SimState): boolean {
  // ⚠ LA VALLÉE ENTIÈRE, C'EST LE PIRE PALIER — et depuis le 2026-10-02 c'est écrit comme tel :
  //   cette porte DÉLÈGUE à la porte locale au plus haut palier. Les deux ne peuvent plus diverger,
  //   et l'ancienne sémantique est préservée au bit près pour ses appelants (le client lit cette
  //   porte une fois par image, `collision.ts` l'interroge pour le facteur du pas).
  return gelPossibleAuPalier(state, TERRASSES.PALIERS - 1)
}

/**
 * ═══ QUELQUE CHOSE PEUT-IL GELER À CE PALIER-LÀ ? — la porte LOCALE (étape 2, `braise.md` § 3.2) ═══
 *
 * Faux ⇒ **aucune** tuile de ce palier n'est gelée, et `estGele` le rend sans lire une température.
 * C'est la borne basse des deux ; le plafond (`plafondDuPalier`) est l'autre.
 *
 * ⚠ **CE QU'ELLE RÉCUPÈRE, MESURÉ** (`tools/profil-porte-gel.mts`, 2026-10-01) : au fond de la
 * vallée un écran porte 2 998 tuiles d'eau, **toutes au palier 0**, dont **0 gelée aux trois
 * cardinaux doux** — 6,7 à 6,9 ms CPU de cuisson que cette porte-là rend entièrement.
 */
export function gelPossibleAuPalier(state: SimState, palier: number): boolean {
  // `+ HYSTERESIS` : une glace posée peut SURVIVRE jusqu'au seuil relevé (G8). Une borne qui
  // s'arrêterait au seuil nu écarterait des tuiles encore gelées — et une borne fausse, c'est
  // une tuile franchissable pour l'avatar et bloquante pour l'A*.
  //
  // ⚠ LES DEUX COMPARAISONS SONT STRICTES, ET ELLES LE SONT ENSEMBLE : un plancher PILE au
  // seuil relevé ne gèle nulle part (`estGele` compare par `<`), et cette porte rend faux au
  // même point exactement. Relâcher l'une des deux en `<=` sans l'autre rendrait la borne
  // UNSOUND — en silence. (La justification chiffrée d'origine — « le point le plus froid de
  // l'acte I vaut 50, et le seuil relevé vaut 50, la borne est exactement tendue » — datait
  // de la jauge 0-100 et des actes-paliers ; en °C sous la courbe saisonnière, la borne n'est
  // plus tendue, elle est simplement CONSERVATRICE : elle inclut tout ce qui peut geler ou
  // survivre gelé, et écarte l'acte I entier comme avant.)
  // (La rampe de nuit ne la touche pas : `partDeNuit` vaut 1 sur toute la nuit, donc le point
  //  le plus froid de chaque saison est CELUI D'AVANT, au bit près. Vérifié le 2026-08-23.)
  return plancherDuPalier(state, palier) < GEL.SEUIL_GUE + GEL.HYSTERESIS
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
  // ⚠ LE SEUIL D'ABORD, LA PORTE ENSUITE — inversé le 2026-10-02, et c'est sans effet sur le
  //   résultat (une tuile qui n'est pas de l'eau rendait déjà faux par les deux chemins) : la
  //   lecture du terrain est plus bon marché que la borne, et surtout le seuil est ce dont le
  //   PLAFOND a besoin pour trancher (le gué prend à 0, le lac à −10 — deux promesses, G2).
  const seuil = seuilDe(terrainAt(state.map, tx, ty))
  if (seuil === undefined) return false
  // ═══ LES DEUX BORNES DU PALIER, et c'est tout l'objet de l'étape 2 ═══
  //   Le palier lu ici est EXACTEMENT celui que la température emploie : `froidDEtage` dérive de
  //   `palierDuSol(map, floor(x), floor(y))` et les coordonnées sont déjà entières. Deux
  //   dérivations différentes du même étage auraient fait deux lois d'une seule.
  const palier = palierDuSol(state.map, tx, ty)
  if (!gelPossibleAuPalier(state, palier)) return false // ICI RIEN NE GÈLE
  if (plafondDuPalier(state, palier) < seuil) return true // ICI TOUT GÈLE — sans lire l'air
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

/** G6bis (S14) — LE JOUR DE L'ANNÉE OÙ **CETTE** TUILE REVERDIT. Même décalage par `hash2`,
 *  même sel : l'arbre qui s'est dépouillé le premier reverdit le premier. */
export function jourDeRefeuillaison(tx: number, ty: number): number {
  return GEL.JOUR_REFEUILLAISON + hash2(tx, ty, DEFEUILLAISON_SALT) * GEL.DEFEUILLAISON_JOURS
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
  // L'INTERVALLE NU ENJAMBE LE TOUR DE L'AN : de la fin des Pluies (~j83) au printemps
  // suivant (~j17). Fonction du seul JOUR DE L'ANNÉE, donc monotone à l'intérieur d'une
  // saison et sans clignotement possible — et la forêt reverdit, chaque année (S14).
  const j = jourDeLAnnee(jourDeSaison(state))
  return j >= jourDeDefeuillaison(tx, ty) || j < jourDeRefeuillaison(tx, ty)
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
 *  déposent ICI se décide tranche par tranche, par `partDeNeige` sur le froid du monde — le
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
 * tranches où il NEIGE ici, AU PRORATA** (R11 puis R14 : `partDeNeige` sur le froid du monde
 * sans le front, à l'instant de la tranche — la même loi que ce qui tombe à l'écran ; une
 * tranche de grésil dépose la moitié d'une tranche de neige). Un front de pluie d'acte I ne laisse rien
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
  // ═══ G7bis — LA CENDRE BOIT LA NEIGE (Alexis, 2026-08-29) ═══
  //
  // Une tuile cendrée n'en porte JAMAIS : ce qui tombe y est bu en permanence. Le prédicat est
  // `tuileCendree` — le MÊME que celui qui peint le sol cendré (WorldScene le donne aux couches),
  // donc la neige s'arrête exactement à la lisière dessinée, grain compris — et par l'écrivain
  // unique tout en découle : le manteau ne s'y peint pas, le pas y redevient celui du sol cendré
  // (`solFoule`), les cimes ne s'y coiffent pas. La neige TOMBE toujours à l'écran (l'aspect du
  // ciel est une autre loi) : elle est bue au sol, pas déviée du ciel.
  if (tuileCendree(state, tx, ty)) return 0
  const cycle = Math.floor(state.tick / TICKS_PER_CYCLE)
  const { width, height } = state.map
  // ═══ CE QUI NE DÉPEND PAS DU TICK SORT DES DEUX BOUCLES (perf, 2026-08-26) ═══
  //
  // Les deux intégrations ci-dessous — la CHUTE (`dehorsSansMeteo`) et la FONTE
  // (`baselineTemperatureAt`) — rejouent la même tuile à des dizaines d'instants. Or l'ABRI et
  // le souffle des FUMEROLLES ne bougent pas avec l'horloge : les relire à chaque tranche, ce
  // sont **quarante-huit fois la même réponse**. Et ce ne sont pas des broutilles : mesurés sur
  // le monde joué, `isSheltered` (qui BALAIE `state.structures`, 772 sur une carte bâtie) et
  // `froidDeFumerolle` pèsent à eux deux les DEUX TIERS de `baselineTemperatureAt`.
  //
  // La recuisson du gel du client, qui appelle cette fonction sur 6 144 tuiles, mangeait **121 %
  // d'une image de 16,7 ms**. Les valeurs, elles, ne bougent pas d'un bit : c'est le même appel,
  // avec les mêmes arguments, simplement sorti de la boucle.
  //
  // ⚠ RELEVÉ PARESSEUSEMENT, ET C'EST LE CŒUR DU CORRECTIF. Posé en tête de fonction, il
  //   COÛTAIT PLUS QU'IL NE RAPPORTAIT — MESURÉ : 20,2 ms → 58,8 ms sur la fenêtre de recuisson.
  //   Cette fonction sort par cinq chemins AVANT d'intégrer quoi que ce soit (pas de météo,
  //   aucun front précipitant en mémoire, la bande pas encore arrivée…), et l'immense majorité
  //   des tuiles sortent par l'un d'eux. On paierait alors l'abri et les fumerolles sur toute
  //   la carte pour ne rien intégrer du tout. Le `??=` ne le relève qu'au premier instant
  //   vraiment demandé, et une seule fois ensuite.
  //
  // ⚠ ET LES DEUX TERMES SE RELÈVENT SÉPARÉMENT : la chute ne lit QUE les fumerolles, la fonte
  //   lit les deux. Les lier faisait payer `isSheltered` (le plus cher) à la boucle de chute
  //   pour rien — MESURÉ, la passe en devenait plus lente qu'avant le correctif.
  // ⚠ LES DEUX FROIDS LOCAUX TIENNENT DANS UN SEUL OBJET, ET C'EST LA SENTINELLE QUI L'EXIGE.
  //   Le froid de la cendre (R22) vaut LÉGITIMEMENT 0 hors cendre et sur la frange : un `??=`
  //   sur ce nombre-là n'est pas une sentinelle, il recalculerait à chaque tranche — la
  //   régression de 216 ms du souffle, rebâtie là où rien ne l'aurait signalée. L'`undefined`
  //   d'un OBJET, lui, ne peut pas être confondu avec une valeur.
  let locaux: { fumerolle: number; cendre: number } | undefined
  let abri: number | undefined
  let best = 0
  for (let k = 0; k < GEL.MEMOIRE_CYCLES; k++) {
    const c = cycle - k
    if (c < 0) break
    const front = frontDuCycle(c, state.calendarScale, state.jourDeDepart)
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
    // La première tranche les paie, seule (voir la sentinelle plus haut).
    locaux ??= { fumerolle: froidDeFumerolleDeTuile(state, tx, ty), cendre: froidDeCendre(state, tx, ty) }
    const cstChute: ConstantesDeTuile = locaux
    for (let t0 = entree; t0 < finChute; t0 += PAS_NEIGE) {
      const t1 = Math.min(finChute, t0 + PAS_NEIGE)
      const instant = Math.min(sortie, t0 + PAS_NEIGE / 2) // FIXE par tranche : monotone en `tick`
      // R14 — AU PRORATA DE LA PART DE NEIGE, plus par oui/non : sur la lisière il grésille,
      // et le grésil couvre le sol moitié moins vite qu'une vraie neige. `partDeNeige` vaut
      // encore 0 et 1 franchement dès qu'on s'écarte d'une demi-rampe de la limite : la plaine
      // d'acte I ne reçoit toujours RIEN et le Névé reçoit toujours TOUT.
      tombe += partDeNeige(dehorsSansMeteo(state, tx, ty, instant, cstChute)) * (t1 - t0) / (sortie - entree)
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
      // La fonte, elle, lit AUSSI l'abri — et lui seul balaie `state.structures`. On ne le
      // relève donc qu'ici, c'est-à-dire seulement sur les tuiles qui ont VRAIMENT reçu de la
      // neige : celles où il a plu et non neigé sortent plus haut sans l'avoir payé.
      abri ??= abriDeTuile(state, tx, ty)
      const cstFonte: ConstantesDeTuile = { abri, ...locaux }
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
        const t = baselineTemperatureAt(state, tx, ty, t0 + PAS / 2, cstFonte)
        // Du gel du lac (−10 °C : la fonte est la plus lente) à l'air doux (+6 °C : elle est
        // la plus rapide) — `AMBIANT_DOUX` a remplacé l'ex-`COMFORT`, qui est devenu un seuil
        // du CORPS quand l'échelle est passée en degrés (2026-08-22).
        const u = Math.max(0, Math.min(1, (t - GEL.SEUIL_PROFOND) / (TEMPERATURE.AMBIANT_DOUX - GEL.SEUIL_PROFOND)))
        // LES GRANDES NEIGES (S18) triplent la durée de fonte : le manteau tient, on marche
        // au ralenti, et la chasse devient du pistage. Le modificateur se relève AU JOUR DE LA
        // TRANCHE, jamais au jour courant : lu à l'instant du relevé, il s'appliquait
        // rétroactivement à toute la mémoire rembobinée, et la couverture SAUTAIT au bord du
        // caractère (jusqu'à ×3 d'un relevé à l'autre) — le milieu de tranche est un point
        // FIXE, donc chaque contribution est figée pour toujours et la monotonie tient AUSSI
        // en travers des bords de caractère. (`effetsDuJour` est mémoïsé : O(1) par tranche.)
        const fonteMod = effetsDuJour(jourDeSaison(state, t0 + PAS / 2)).fonte ?? 1
        const cycles = (GEL.FONTE_CYCLES + (GEL.FONTE_CYCLES_CHAUD - GEL.FONTE_CYCLES) * u) * fonteMod
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
  const front = frontDuCycle(cycle, state.calendarScale, state.jourDeDepart)
  if (!front) return null
  return frontMeteoPos(front, tick, state.map.width, state.map.height)
}

/** Le jour de saison d'un cycle — le raccourci que les gardes et les bancs redemandent. */
export function jourDuCycle(state: SimState, cycle: number): number {
  return jourDeSaison(state, cycle * TICKS_PER_CYCLE)
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
    delete entity.etage // une berge est au SOL (spec `etages.md`) — comme le respawn et le TP
  }
}

/**
 * LA TUILE MARCHABLE LA PLUS PROCHE — par anneaux de Chebyshev croissants, ordre de balayage
 * fixe. On accepte la GLACE aussi bien que la terre ferme : recracher quelqu'un sur un lac
 * encore pris est un repli parfaitement valide, et c'est même le plus court.
 */
function bergeLaPlusProche(state: SimState, tx: number, ty: number): { tx: number; ty: number } | null {
  for (let r = 1; r <= GEL.REPLI_RAYON; r++) {
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
