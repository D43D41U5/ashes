/**
 * ═══ LA CENDRE — elle sourd des fosses, et elle COULE (spec `cendre.md`) ═══
 *
 * *Décisions d'Alexis du 2026-08-24, prises une à une.* Remplace le FRONT retiré le même jour : il
 * n'y a plus de ligne qui traverse la vallée du sud au nord, il y a **un foyer par charnier**. La
 * cendre en sort, très lentement, dans toutes les directions, en **cheminant à travers le terrain**
 * — l'eau la détourne, la roche la freine — et la case atteinte prend la version cendrée de sa
 * famille de sol.
 *
 * ═══ TOUT EST DÉRIVÉ, ET C'EST CE QUI LE REND BON MARCHÉ ═══
 *
 *     map.cendreCout[i]     coût de CHEMINEMENT de la tuile à sa fosse — STATIQUE, posé au worldgen
 *     map.cendreFoyer[i]    quelle fosse la revendique (son index)     — STATIQUE
 *     avancee(jour, gel)    une fonction PURE du jour de saison        — R8/R9
 *     une tuile est cendrée ⟺ cendreCout[i] ≤ avancee(...) · (1 + grain(i))
 *
 * Zéro octet dans le `SimState` : les replays retrouvent l'état exact sans qu'on ait rien
 * sérialisé, le client repeint en recalculant, et `carte-immuable` reste verte. C'est le meilleur
 * du modèle de l'ancien front, et la seule chose qu'on lui garde.
 *
 * ═══ LA LOI : ELLE DIFFUSE, ELLE NE MARCHE PAS (R9) ═══
 *
 *     avancee(t) = min( R0 + A·√t ,  avancee(t−1) + PLAFOND_JOUR )
 *
 * Une RACINE, parce qu'un front qui diffuse avance en √t — et `Math.sqrt` est dans les opérations
 * autorisées à /sim (l'invariant n°2 interdit `pow`, `exp` et `log`, pas `sqrt`). La décroissance
 * n'est pas un ornement : sous une loi linéaire, la vallée était ENTIÈREMENT prise à l'an 5, l'an 1
 * était muet (3,7 %) et tenir des foyers ne changeait plus rien passé l'an 3. La racine règle les
 * trois d'un coup.
 *
 * Pur et déterministe : `+ - * /`, `min`, `sqrt`, `floor` (invariant n°2).
 */
import { fbm2, hash2 } from './noise'
import {
  BALANCE, TERRAINS,
  TERRAIN_BOULDERS, TERRAIN_BURNT_FOREST, TERRAIN_CENDRE_BOIS, TERRAIN_CENDRE_MIN,
  TERRAIN_CENDRE_PRE, TERRAIN_CLIFF, TERRAIN_ROCK, TERRAIN_SCREE,
  TERRAIN_DEEP_WATER, TERRAIN_LARCH, TERRAIN_OLD_GROWTH, TERRAIN_FOREST, TERRAIN_PINE,
  TERRAIN_SHALLOW_WATER, TERRAIN_VOID, TERRAIN_WILLOW,
} from './balance'
import { terrainAt, type WorldMap } from './map'
import type { ResourceNode } from './economy'

/**
 * ═══ LE RÉGLAGE (spec `cendre.md`) ═══
 *
 * Il vit ICI et non dans `balance.ts` : c'est du réglage de GÉNÉRATION et de géographie — il se
 * calibre en REGARDANT une carte, pas en jouant (règle de partage, en-tête de `balance.ts`). Les
 * deux exceptions sont déjà ailleurs : la durée du gel d'un foyer est `MORTS.BRULE_DUREE_JOURS`
 * (le verbe existait), et le caractère de la saison le module depuis `modificateur.ts`.
 */
export const CENDRE = {
  /**
   * LA TACHE INITIALE, en unités de coût. Chaque fosse porte sa cendre DÈS LE PREMIER JOUR — c'est
   * elle qui apprend la mécanique au joueur (*« que le joueur comprenne rapidement ce qu'il se
   * passe »*). Taille fixée par comparaison, *« relativement petite, taille biome minéral »* :
   * **229 tuiles mesurées**, contre 320 pour une tache minérale de la Racine.
   */
  R0: 10,

  /**
   * LE JOUR OÙ ELLE S'ÉBRANLE — l'ouverture du premier Grand Froid, trente jours après l'ouverture
   * du monde. Ce n'est pas une date arbitraire : le jeu fait DÉJÀ lever les morts avec le froid
   * (`CENDREUX.TORPEUR`). La cendre qui sort des fosses quand l'hiver mord est LA MÊME LOI.
   * Dérivé de la phase, jamais écrit en dur — il suivrait un changement de `ACT_DAYS`.
   */
  ACTE_DEPART: 4,

  /**
   * LE COEFFICIENT DE LA RACINE — **DÉRIVÉ D'UNE CONTRAINTE, PAS CHOISI.** Alexis : *« il faudrait
   * que la cendre commence à appliquer une pression réelle à la fin du second hiver »*, traduit en
   * mesurable : **la moitié des sites de village pris**, ce qui vaut un coût de ~178 sur la carte
   * de production. La fin du 2ᵉ hiver est le jour 240, le réveil le jour 91 : `A·√149 = 178 − 10`.
   *
   * ⚠ IL A DÉJÀ ÉTÉ REDÉRIVÉ UNE FOIS (16,479 → 13,769), quand le champ est passé en 8-connexe et
   * a reçu son grain : la même contrainte sur une échelle de coûts qui avait changé. **C'est la
   * contrainte qui est stable, jamais le nombre** — si la géométrie du champ bouge, on refait la
   * dichotomie, on ne garde pas le chiffre.
   *
   * ⚠⚠ **ET LA CONTRAINTE A ÉTÉ LEVÉE LE 2026-08-25** (Alexis : « divise la propagation de la
   * cendre par 2 »). 13,769 → 6,8845, avec `PLAFOND_JOUR` divisé d'autant : l'avancée au-dessus
   * de `R0` vaut désormais EXACTEMENT la moitié de ce qu'elle valait, à toutes les dates.
   *
   * **La conséquence n'est pas « deux fois plus lent », elle est PLUS FORTE — la loi est une
   * RACINE.** Atteindre un coût donné demande `(A/A')² = 4` fois plus de jours. MESURÉ sur la
   * carte de production (seed 2026, 50 sites) : la moitié des sites de village étaient pris au
   * **jour 255**, ils le sont maintenant au **jour 747** — la fin du 6ᵉ hiver au lieu du 2ᵉ. La
   * contrainte de design d'origine (*« une pression réelle à la fin du second hiver »*) n'est
   * donc plus tenue : c'est un choix assumé, pas une dérive.
   * *(Si l'intention était « deux fois plus de temps » et non « deux fois moins loin », le
   * nombre serait `A/√2 ≈ 9,736` — la moitié des sites au jour 419.)*
   */
  A: 6.8845,

  /**
   * LE PLAFOND D'AVANCÉE PAR JOUR, et il est GRATUIT. Sans lui le réveil serait une BOUFFÉE : la
   * tache initiale plus que doublée en un jour. Avec lui il s'étale sur trois semaines — et la
   * droite `P·t` REJOINT exactement la courbe `A·√t` en `t = (A/P)² ≈ 21`. Passé ce point il ne
   * mord plus jamais : il ne déplace pas la courbe, il lisse son entrée.
   *
   * ⚠ IL SUIT `A` (2026-08-25, 3 → 1,5). Le laisser à 3 en divisant `A` par deux aurait rendu
   * les cinq premiers jours IDENTIQUES à avant (le `min` ne fait que rabaisser : à `t = 1` la
   * racine passait déjà au-dessus du plafond) — la propagation n'aurait pas été divisée au
   * début, seulement plus loin. Divisés ensemble, les deux gardent leur rapport : le plafond
   * mord toujours pendant les mêmes ~21 jours, et l'avancée vaut la moitié À CHAQUE date.
   */
  PLAFOND_JOUR: 1.5,

  /** Le coût d'entrée d'une tuile MINÉRALE, en multiples d'une tuile vivante — *le sol nu n'a rien
   *  à brûler*. La roche devient un frein qui se LIT sur la carte (R5). */
  COUT_MINERAL: 3,

  /** Les coûts du champ sont des ENTIERS mis à l'échelle : orthogonale 100, diagonale 141. Le
   *  Dijkstra est donc à seaux (O(N)) et le champ reste JSON-sérialisable sans flottant. */
  ORTHO: 100,
  DIAG: 141,

  /**
   * LE GRAIN, ET IL EST RELATIF — PAS ABSOLU (R6, demande d'Alexis : *« plus organique en terme de
   * progression »*). Une tuile brûle quand `coût ≤ avancée · (1 + WARP_PART · bruit)`.
   *
   * ⚠ UNE AMPLITUDE ABSOLUE NE MARCHE PAS, et ça ne se voit qu'en rendant la carte : à ±26 unités
   * de coût sur une tache de rayon 10, **certains foyers n'avaient aucune cendre visible au jour
   * 1** — le bruit avalait la tache. En part de l'avancée, la tache naît irrégulière mais ENTIÈRE,
   * et la déformation CROÎT avec le front (±3 tuiles au départ, ±130 à l'an 5) : ce n'est pas
   * seulement la forme qui est organique, c'est la PROGRESSION.
   */
  WARP_PART: 0.35,
  WARP_ECHELLE: 44,

  /**
   * ═══ LE BLOC SE DÉPLACE (décision d'Alexis, 2026-08-25, sur planche rendue) ═══
   *
   * De combien on tord la coordonnée AVANT de la quantifier au motif, en tuiles — et à quelle
   * échelle cette torsion ondule. `BLOC_AMPLITUDE: 0` rend exactement le grain d'avant.
   *
   * ⚠ **LE DÉFAUT QU'IL CORRIGE EST UNE COÏNCIDENCE DE DEUX GRILLES, et il faut les nommer toutes
   * les deux.** ① Le grain est décidé au CENTRE d'un bloc de `MOTIF` tuiles : soixante-quatre
   * cases partagent un seuil, et les bords de ces blocs sont *par construction* horizontaux et
   * verticaux. ② Le champ de coût est un Dijkstra **8-connexe** (100 / 141), dont les isolignes
   * sont des **OCTOGONES** — leurs côtés sont eux aussi horizontaux, verticaux ou à 45°. Quand une
   * isoligne longe un bord de bloc, tout le bord bascule d'un coup : la lisière sort en MUR.
   * MESURÉ avant (seed 2026, vallée entière, l'eau et le vide exclus — un bord de lac n'est pas
   * un front) : **la plus longue arête parfaitement droite fait 40 tuiles**, et la vallée en porte
   * **502 de 8 tuiles ou plus** au jour 391. La seconde octave de `grainDeCendre`, posée pour ça,
   * ne les avait pas tuées.
   *
   * ⚠ **ET C'EST LA GRILLE QU'ON TORD, PAS LA VALEUR** — c'est ce qui distingue ce réglage de
   * `WARP_PART`. `noise.ts` porte déjà l'idiome sous le nom de `fbmWarp2` (« il tord toute
   * frontière qu'il touche sans changer la quantité échantillonnée ») ; ici on le tourne d'un
   * cran, en amont de la quantification. **Les marches d'escalier restent** — c'est la grammaire
   * de tout le terrain du jeu, et la raison pour laquelle on ne lit pas le bruit tuile par tuile
   * (une frange grésillante). Seuls leurs bords cessent de suivre les axes.
   *
   * MESURÉ après, aux valeurs ci-dessous : **40 → 14 tuiles** de plus longue arête, **502 → 98**
   * arêtes de 8 tuiles ou plus. Et la part cendrée de la vallée bouge de **0,05 point** (28,33 %
   * → 28,28 %) : aucun équilibrage ne se déplace — ni la loi en racine, ni `A`, ni le champ de
   * coût, ni la date où la moitié des sites tombe.
   *
   * ⚠ **CE QUE ÇA COÛTE, ET POURQUOI ON NE PEUT PAS LE MÉMOÏSER** : deux `fbm2` de plus, et ils
   * se paient PAR TUILE, pas par bloc — c'est tout l'objet du déplacement. Le grain lui-même
   * reste lu au bloc.
   */
  BLOC_AMPLITUDE: 6,
  BLOC_ECHELLE: 22,

  /** L'ÉCART MINIMAL entre un point de NAISSANCE et une fosse, en coût (R10). Un site de village,
   *  on le choisit ; son point de naissance, non — naître à neuf jours de la cendre n'est pas une
   *  leçon, c'est une mauvaise main. ~jour 195 sur la carte de production. */
  ECART_SPAWN: 150,

  /**
   * L'AGONIE, en jours de saison (R13, décision d'Alexis : *« le vivant meurt lentement et le
   * minéral reste »* + *« il laisse du bois mort à récolter pendant quelques jours »*).
   *
   * La cendre prend la case ; l'arbre s'y **dessèche** pendant ce temps — houppier dénudé, stock
   * INTACT, encore coupable — puis il tombe et le nœud disparaît. C'est ce qui fait que la cendre
   * TIRE autant qu'elle pousse : la frange qui approche est une échéance à exploiter, pas une
   * perte sèche. Cinq jours, soit deux heures et demie de jeu : le temps d'une expédition, pas
   * celui d'une saison.
   */
  AGONIE_JOURS: 5,

  /**
   * LE NOMBRE DE FOSSES QU'UN CHAMP PEUT PORTER. Le coût et le propriétaire d'une tuile vivent
   * dans le MÊME entier (`coût × FOYERS_MAX + foyer`) : deux tableaux d'un million et demi
   * d'entrées pesaient 10,5 Mo de JSON — la moitié de la carte — pour une information qui tient
   * dans un seul.
   *
   * ⚠ **128, ET PAS 16.** Le monde JOUÉ n'a que 9,3 fosses en moyenne, et j'avais dimensionné
   * là-dessus — mais **le plan complet en porte 51** (mesuré), et les index se seraient écrasés
   * en silence : des tuiles auraient obéi à la mauvaise fosse. Le plafond du registre est 80
   * (`POI_TYPES.charnier.cap`), donc 128 le couvre avec de la marge. La garde A1 confronte les
   * deux plans, pas seulement celui qu'on joue.
   */
  FOYERS_MAX: 128,

  /**
   * LA FRANGE, en tuiles — la bande où la cendre est FRAÎCHE (décision d'Alexis, 2026-08-24 :
   * *« depuis l'extérieur vers le centre de la zone de corruption, sur 2-3 cases tu mets de la
   * cendre, sinon tu utilises les mêmes terrains que la cendrière »*).
   *
   * ⚠ ELLE EST EN COÛT, DONC PLUS COURTE SUR LA ROCHE — trois tuiles de pré, une seule de roche
   * (le minéral coûte trois fois). C'est juste : la cendre ne s'attarde pas où il n'y a rien à
   * brûler. Et c'est GRATUIT : on sait déjà de combien le front a dépassé chaque tuile.
   */
  FRANGE_TUILES: 3,

  /**
   * ═══ LES DEUX AUTRES SEUILS — LA SUCCESSION (R20, décision d'Alexis du 2026-08-27) ═══
   *
   * La frange et le cœur ne suffisaient plus : le cœur est un DÉSERT uniforme, et la demande
   * était *« que la cendre remplace l'écosystème présent par SON écosystème, une zone qui se
   * déploie au fur et à mesure de la partie »*. On coupe donc le cœur en trois.
   *
   * ⚠ **ILS SONT EN TUILES, ET PAS EN JOURS — c'est LA décision, et elle a été mesurée.**
   * `ancienneteDeCendre` semblait l'axe évident (« la cendre a des âges »). Mais la loi est une
   * RACINE : la frange ralentit de 1,5 tuile/jour au réveil à 0,10 à l'an 10, donc un seuil posé
   * en jours désigne une bande de plus en plus MINCE. MESURÉ
   * (`tools/diag-cendre-succession.mts`, seed 2026, largeur au front sur sol vivant) :
   *
   *     bande « 30 jours » :  37,1 t au j.120 · 8,9 au j.240 · 4,6 au j.600 · 3,1 au j.1200
   *     bande «  5 jours » :   3,3 t au j.120 · 1,4 au j.240 · 0,8 au j.600 · 0,5 au j.1200
   *
   * …et **sur la roche il faut diviser par `COUT_MINERAL`** : une bande « 30 jours » vaut UNE
   * TUILE sur un massif à l'an 3, et une bande « 5 jours » passe sous la tuile partout dès le
   * jour 600. Une succession en jours s'éteint donc toute seule à mesure que la partie dure —
   * exactement l'inverse de ce qui était demandé.
   *
   * En PROFONDEUR, la largeur est stable par construction et c'est la zone qui se déploie
   * (MESURÉ, part de la cendre par bande) :
   *
   *     jour   61 :  frange 51,2 %  nue 48,8 %  croûte  0,0 %  vieille  0,0 %
   *     jour  120 :         12,2 %      40,8 %         44,2 %          2,8 %
   *     jour  240 :          6,1 %      22,7 %         36,9 %         34,3 %
   *     jour  600 :          2,5 %       9,6 %         20,8 %         67,1 %
   *     jour 1200 :          1,1 %       4,7 %         10,3 %         84,0 %
   *
   * Deux bandes au jour 1, les quatre dès le jour ~115, et le stade mûr passe de 3 % à 84 %.
   * L'âge médian d'une tuile de la bande VIEILLE suit : 29 jours au j.120, 776 au j.1200 —
   * l'étirement de la racine tombe donc au bon endroit, « mûr » veut vraiment dire mûr.
   *
   * ⚠ **ET L'ÂGE GARDE SON SEUL MÉTIER : LA CHALEUR.** `ancienneteDeCendre` continue de porter la
   * teinte brune qui refroidit sur trente jours (R11quinquies) — c'est une TEMPÉRATURE, elle se
   * compte en temps réel. On ne lui en demande pas plus.
   *
   * *(Âge et profondeur sont d'ailleurs le même ORDRE à ~90 % près : 4,07 % de paires
   * discordantes au j.240 à foyers synchrones. Ce qui les sépare est le verbe du joueur — un
   * foyer GELÉ (R16) continue de vieillir sa cendre pendant que son front est immobile, et la
   * discordance monte alors à 11,54 %. Choisir la profondeur ferme cette ambiguïté.)*
   */
  NUE_TUILES: 15,
  CROUTE_TUILES: 40,

  /**
   * ═══ LE FROID DE LA VIEILLE CENDRE (R22, décision d'Alexis 2026-08-27) ═══
   *
   * Les degrés que la cendre MÛRE retire à la température de base. Zéro dans la frange, montée
   * linéaire jusqu'ici à `CROUTE_TUILES` — la même rampe et le même ancrage que la hantise
   * (`MORTS.PART_CENDRE` → `HANTISE_MAX`) : **le sol se refroidit et se peuple des morts au même
   * rythme**, une seule succession racontée deux fois.
   *
   * ⚠ **LA FRANGE RESTE À ZÉRO, ET C'EST LA MOITIÉ DE LA DÉCISION.** R14 veut qu'on TRAVAILLE la
   * frange (« la cendre tire autant qu'elle pousse : l'échéance est à exploiter »), et
   * R11quinquies dit que ce qui vient de brûler est encore CHAUD — la teinte brune qui refroidit
   * sur trente jours. Un froid posé au front aurait contredit les deux et rendu l'échéance
   * inexploitable.
   *
   * ═══ POURQUOI 2, ET C'EST LA NEIGE QUI L'A DÉCIDÉ (Alexis, 2026-08-27) ═══
   *
   * La valeur d'essai était 4. Trois contraintes la bornent, et la troisième s'est révélée à la
   * mesure :
   *
   *   ① **Sous `FUMEROLLE.FROID` (9), franchement.** Les bouches sont les PICS du cœur ; un fond
   *      aussi froid qu'elles les effacerait. Garde A27 : `2 × FROID_COEUR ≤ FUMEROLLE.FROID`.
   *   ② **Le prix est GLOBAL.** À l'an 3, **80 % des tuiles marchables sont de la cendre**
   *      (mesuré, j.1200) : ce nombre est, à terme, un décalage de la vallée entière.
   *   ③ **LE FROID DÉPLACE LA LIGNE PLUIE/NEIGE, et le manteau est un pavé OPAQUE.** MESURÉ
   *      (`tools/diag-cendre-neige.mts`, part de la bande vieille sous la neige au jour de
   *      saison 10) : **4 °C → 88,1 % · 3 → 79,7 % · 2 → 18,5 % · 1 → 5,5 %** (hors cendre :
   *      1,5 %). À 4, l'art des trois terrains cendrés disparaissait sous du blanc la moitié de
   *      la saison — une décision de DA que personne n'avait prise. La falaise est entre 2 et 3.
   *
   * **À 2, on garde presque toute la morsure et on rend la cendre à l'œil** : sur la nuit la plus
   * froide de la saison, la vieille cendre met encore **81,3 %** de ses tuiles sous la ligne
   * d'hypothermie pour un corps nu (99,2 % à 4 °C ; 5,2 % sans R22), et la vue d'un Cendreux y
   * vaut ×1,21 au lieu de ×1,40. La neige, elle, tombe de 88 % à 18,5 % — la cendre reste le
   * seul endroit où il neige plus qu'ailleurs, et c'est une signature, plus un linceul.
   *
   * ⚠ **La MOITIÉ DANGEREUSE ne dépend pas de ce nombre** : c'est R23 (la hantise) qui fait de la
   * cendre le pire sol de la vallée, et elle est indépendante du froid.
   *
   * ⚠ **IL SE LIT SUR LA PROFONDEUR NUE, SANS LE GRAIN** — voir `profondeurNueDeCendre`.
   */
  FROID_COEUR: 2,

  /**
   * LA PART DES FOSSES QUI PORTENT UN CARACTÈRE (R21). À 0,4 sur dix fosses : **quatre**, et six
   * nues. C'est le précédent littéral de `modificateur.ts` (*« une saison sur trois n'en a pas »*)
   * : si les dix sont spéciales, aucune ne l'est.
   */
  PART_CARACTERE: 0.4,

  /** LE MOTIF de quantification du grain, en tuiles. **Doit valoir `RELIEF.MOTIF`** — il est
   *  recopié ici et non importé pour ne pas créer de cycle avec `zonegen`, et une garde le
   *  confronte à la source (`cendre.test.ts`). */
  MOTIF: 8,
} as const

/** Les sols qui prennent la CENDRE DE BOIS. Tout le reste du vivant prend la cendre de pré. */
const BOISE = [TERRAIN_FOREST, TERRAIN_OLD_GROWTH, TERRAIN_PINE, TERRAIN_LARCH, TERRAIN_WILLOW]

/**
 * LE CAILLOUTEUX QUI SE MARCHE — éboulis, chaos de blocs. ⚠ Il n'est PAS « minéral » au sens de
 * `estMineral`, qui dérive de `walkable` : un chaos de blocs se traverse (0,6). Les deux notions
 * se ressemblent assez pour qu'on les confonde, et la garde du cœur a attrapé exactement ça —
 * `wall` ressortait en `boulders`, donc TRAVERSABLE. On les sépare donc explicitement.
 */
const CAILLOUTEUX = [TERRAIN_SCREE, TERRAIN_BOULDERS]

/**
 * EST-CE DU MINÉRAL ? — **dérivé de `walkable`, jamais d'une liste**, et la garde A8 est là pour
 * l'avoir appris à mes dépens : `wall` et `glacier` sont infranchissables sans être dans aucune
 * liste de roche, et une liste écrite à la main les convertissait en cendre de PRÉ — traversable.
 * **La cendre aurait ouvert les murs et les bords du monde.**
 *
 * La règle dérivée ferme la classe entière : ce qui ne se marche pas n'a rien à brûler (coût ×3)
 * et reste infranchissable une fois cendré. Un terrain ajouté demain y tombera tout seul.
 */
function estMineral(t: number): boolean {
  return TERRAINS[t]?.walkable === false
}

/** L'eau ne brûle pas, et le vide non plus : la cendre les CONTOURNE (R4/R12). */
export function cendrePeutPrendre(t: number): boolean {
  return t !== TERRAIN_DEEP_WATER && t !== TERRAIN_SHALLOW_WATER && t !== TERRAIN_VOID
}

/** Le coût d'ENTRÉE d'une tuile, en unités du champ. Le sol nu n'a rien à brûler (R5). */
export function coutDentree(t: number): number {
  return estMineral(t) ? CENDRE.COUT_MINERAL : 1
}

/**
 * ═══ LE SOL CENDRÉ — DEUX BANDES, ET LA SECONDE RECYCLE LA CENDRIÈRE ═══
 *
 * *Décision d'Alexis, 2026-08-24 : « recycle les terrains de la cendrière… sur 2-3 cases tu mets
 * de la cendre, sinon tu utilises les mêmes terrains que la cendrière en trouvant une
 * correspondance avec le terrain de t0 précédent ».*
 *
 * **LA CORRUPTION EST LA CENDRIÈRE QUI S'ÉTEND** — elle doit donc en avoir la peau, et non trois
 * terrains inventés. La Cendrière n'avait que QUATRE sols (mesuré, seed 2026 : forêt brûlée
 * 52,9 %, roche 23,0 %, chaos de blocs 17,1 %, falaise 7,1 %), et c'est ce qui fixe la table :
 *
 *   FRANGE (`profond = false`, les 2-3 premières tuiles) → les trois cendres, par famille. C'est
 *     là que la lecture « qu'est-ce que je perds ? » compte, puisque c'est là qu'on va couper
 *     avant que ça brûle.
 *   CŒUR (`profond = true`) :
 *     bois          → forêt brûlée  (le sol de la Cendrière)
 *     roche/falaise → inchangés     (la Cendrière a exactement les mêmes)
 *     éboulis/blocs → chaos de blocs
 *     **pré         → cendre**      (décision d'Alexis : la Cendrière n'a aucun sol OUVERT, et
 *                                    lui donner du chaos de blocs aurait été lent et mensonger)
 *
 * Rend `undefined` pour ce qui ne brûle pas : l'appelant garde alors le terrain d'origine — une
 * rivière sous la cendre reste une rivière.
 */
export function terrainCendre(t: number, profond = false): number | undefined {
  if (!cendrePeutPrendre(t)) return undefined
  if (estMineral(t)) {
    // CE QUI NE SE MARCHE PAS. ⚠ `wall` et `glacier` passent ici aussi (voir `estMineral`) : ils
    //   ne doivent JAMAIS ressortir traversables, sinon la cendre ouvre les murs et les bords du
    //   monde. Au cœur, ils prennent donc la ROCHE de la Cendrière — infranchissable comme eux.
    if (!profond) return TERRAIN_CENDRE_MIN
    return t === TERRAIN_CLIFF ? TERRAIN_CLIFF : TERRAIN_ROCK
  }
  // LE CAILLOUTEUX MARCHABLE : au cœur, le chaos de blocs de la Cendrière (elle en avait 17,1 %).
  if (CAILLOUTEUX.includes(t)) return profond ? TERRAIN_BOULDERS : TERRAIN_CENDRE_MIN
  if (BOISE.includes(t)) return profond ? TERRAIN_BURNT_FOREST : TERRAIN_CENDRE_BOIS
  return TERRAIN_CENDRE_PRE // le pré : de la cendre, au cœur comme à la frange
}

/**
 * DE COMBIEN CETTE TUILE EST-ELLE ENFONCÉE DANS LA CENDRE, en tuiles — `-1` si elle ne l'est pas.
 * C'est ce qui sépare la frange du cœur, et ça ne coûte rien : on connaissait déjà le seuil.
 */
export function profondeurDeCendre(
  map: WorldMap,
  tx: number,
  ty: number,
  avancees: readonly number[],
  seed: number,
): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return -1
  const champ = map.cendreCout
  if (!champ) return -1
  const i = ty * map.width + tx
  const c = coutDe(champ, i)
  if (c < 0) return -1
  const a = avancees[foyerDe(champ, i)]
  if (a === undefined) return -1
  const seuil = a * CENDRE.ORTHO * (1 + grainDeCendre(seed, tx, ty))
  if (c > seuil) return -1
  return (seuil - c) / CENDRE.ORTHO
}

/** Au CŒUR de la corruption ? (au-delà de la frange — voir `CENDRE.FRANGE_TUILES`) */
export function auCoeurDeLaCendre(
  map: WorldMap,
  tx: number,
  ty: number,
  avancees: readonly number[],
  seed: number,
): boolean {
  return profondeurDeCendre(map, tx, ty, avancees, seed) > CENDRE.FRANGE_TUILES
}

/**
 * ═══ LA SUCCESSION — QUATRE BANDES, ET ELLES SE COMPTENT EN TUILES (R20) ═══
 *
 * `-1` si la cendre n'a pas pris ici. Sinon, du bord vers la fosse :
 *
 *   0 `BANDE_FRANGE`  (≤ 3 t)      ce qui vient de mourir — le terrain recyclé de R11a, les
 *                                  arbres en agonie (R13), l'ÉCHÉANCE à exploiter de R14.
 *   1 `BANDE_NUE`     (3 → 15 t)   la poudre et le froid. **Elle reste vide EXPRÈS** : c'est le
 *                                  contraste qui fait lire les autres. Sans désert, la richesse
 *                                  ne se voit pas.
 *   2 `BANDE_CROUTE`  (15 → 40 t)  la cendre a pris. Le sol tient.
 *   3 `BANDE_VIEILLE` (> 40 t)     la cendrière mûre — celle qui finit par être la vallée.
 *
 * ⚠ **LA LARGEUR SE COMPTE EN COÛT, DONC PLUS COURTE SUR LA ROCHE** — comme la frange l'a
 * toujours fait (voir `FRANGE_TUILES`). Trois tuiles de pré, une seule de roche : la cendre ne
 * s'attarde pas où il n'y a rien à brûler.
 *
 * ⚠ **ELLE NE REMPLACE PAS `auCoeurDeLaCendre`, qui reste à `profondeur > FRANGE_TUILES`.** Les
 * fumerolles vivent donc toujours dans les bandes 1, 2 et 3 : les remonter en bande 2+ défairait
 * le resserrement ×4 demandé le 2026-08-25 (*« il n'y a pas assez de fumerolles dans les
 * cendres »*). Le caractère d'un foyer module leur PART, jamais leur porte (R21).
 */
export const BANDE_HORS = -1
export const BANDE_FRANGE = 0
export const BANDE_NUE = 1
export const BANDE_CROUTE = 2
export const BANDE_VIEILLE = 3

export function bandeDeCendre(
  map: WorldMap,
  tx: number,
  ty: number,
  avancees: readonly number[],
  seed: number,
): number {
  const p = profondeurDeCendre(map, tx, ty, avancees, seed)
  if (p < 0) return BANDE_HORS
  if (p <= CENDRE.FRANGE_TUILES) return BANDE_FRANGE
  if (p <= CENDRE.NUE_TUILES) return BANDE_NUE
  if (p <= CENDRE.CROUTE_TUILES) return BANDE_CROUTE
  return BANDE_VIEILLE
}

/** Un sol DÉJÀ cendré ? (le rendu et les règles de nœud le demandent souvent) */
export function estSolCendre(t: number): boolean {
  return t === TERRAIN_CENDRE_PRE || t === TERRAIN_CENDRE_BOIS || t === TERRAIN_CENDRE_MIN
}

/**
 * ═══ L'AVANCÉE D'UN FOYER, `t` jours après son réveil (R9) ═══
 *
 *     avancee(t) = min( R0 + A·√t ,  avancee(t−1) + PLAFOND_JOUR )
 *
 * Le plafond impose un CUMUL : on ne peut pas l'écrire en forme fermée. On le calcule donc par
 * somme préfixe MÉMOÏSÉE — et ce cache n'est pas de l'état de simulation, c'est la mémoïsation
 * d'une fonction pure keyée sur son unique argument (même patron que le cache d'un jour de
 * `modificateur.ts`). Le déterminisme n'y perd rien : deux appels de même `t` rendaient déjà le
 * même nombre, dans n'importe quel ordre.
 *
 * ⚠ `t` est TRONQUÉ à l'entier : l'avancée est un fait du JOUR, pas du tick — sinon la frange
 * respirerait vingt fois par seconde et le rendu se recuirait sans cesse.
 */
const CUMUL: number[] = [CENDRE.R0]
export function avanceeDeCendre(t: number): number {
  const j = Math.floor(t)
  if (j <= 0) return CENDRE.R0
  // ⚠ BORNE DE SÉCURITÉ : un `t` absurde (debug, replay tordu) ne doit pas faire boucler la sim
  //   sur des millions d'itérations. Au-delà, la courbe est plate à l'échelle du jeu.
  const cible = j > 100_000 ? 100_000 : j
  for (let k = CUMUL.length; k <= cible; k++) {
    const racine = CENDRE.R0 + CENDRE.A * Math.sqrt(k)
    const plafonne = CUMUL[k - 1]! + CENDRE.PLAFOND_JOUR
    CUMUL[k] = racine < plafonne ? racine : plafonne
  }
  return CUMUL[cible]!
}

/**
 * LE GRAIN D'UNE TUILE (R6) — dans `[−WARP_PART, +WARP_PART]`, décidé au MOTIF de 8 tuiles, sur
 * une grille de blocs DÉPLACÉE (`CENDRE.BLOC_AMPLITUDE`).
 *
 * Positionnel et pur : le même patron que `clairiereForet`, qui échantillonne au CENTRE du bloc.
 * Un bruit lu tuile par tuile ferait une frange grésillante ; lu par bloc, il fait des marches
 * d'escalier — le grain de tout le terrain du jeu. Le déplacement ne touche pas à ces marches, il
 * les décolle des axes (voir `CENDRE.BLOC_AMPLITUDE` : elles s'accordaient avec les isolignes
 * octogonales du champ de coût, et la lisière sortait en mur de 40 tuiles).
 */
export function grainDeCendre(seed: number, tx: number, ty: number): number {
  const M = CENDRE.MOTIF
  // ═══ LE BLOC SE DÉPLACE (voir `CENDRE.BLOC_AMPLITUDE`) ═══
  // On tord la coordonnée AVANT de la quantifier : la grille des blocs cesse d'être alignée sur
  // les axes, donc de s'accorder avec les isolignes octogonales du champ de coût. Le champ de
  // déplacement est BASSE FRÉQUENCE (échelle 22 contre un bloc de 8) : deux tuiles voisines se
  // déplacent presque pareil, donc le bord d'un bloc devient une COURBE et non un confetti.
  const selW = (seed ^ 0x57415250) | 0 /* 'WARP' */
  const sx = tx + CENDRE.BLOC_AMPLITUDE * 2 * (fbm2(tx, ty, CENDRE.BLOC_ECHELLE, selW) - 0.5)
  const sy = ty + CENDRE.BLOC_AMPLITUDE * 2 * (fbm2(tx, ty, CENDRE.BLOC_ECHELLE, (selW ^ 0x2f3b) | 0) - 0.5)
  const bx = Math.floor(sx / M) * M + M / 2
  const by = Math.floor(sy / M) * M + M / 2
  const sel = (seed ^ 0x43454e44) | 0 /* 'CEND' */
  // DEUX OCTAVES, et la seconde n'est pas cosmétique. À une seule (échelle 44), le grain est
  // constant sur des bandes de quarante tuiles : la lisière sortait en ARÊTES DROITES de trente
  // tuiles de long — un mur, pas une frange (constaté au navigateur). L'octave fine (échelle 11,
  // un tiers de l'amplitude) les ronge sans toucher à la forme d'ensemble.
  const large = fbm2(bx, by, CENDRE.WARP_ECHELLE, sel) - 0.5
  const fine = fbm2(bx, by, CENDRE.WARP_ECHELLE / 4, (sel ^ 0x9e37) | 0) - 0.5
  return (large * 0.75 + fine * 0.25) * 2 * CENDRE.WARP_PART
}



/**
 * ═══ LE CHAMP DE CHEMINEMENT (R4/R5) — calculé UNE FOIS, au worldgen ═══
 *
 * Dijkstra multi-source depuis les fosses, **8-CONNEXE** (orthogonale 100, diagonale 141), l'eau
 * infranchissable, le minéral à trois fois le prix. Il rend DEUX champs :
 *
 *   • `cout[i]`  — le coût de cheminement jusqu'à la fosse la plus proche (`-1` = hors d'atteinte)
 *   • `foyer[i]` — l'index de CETTE fosse
 *
 * ⚠ **POURQUOI DEUX CHAMPS ET PAS UN.** Sans `foyer`, on ne peut pas geler un foyer (R16) : il
 * faudrait un champ PAR fosse — dix tableaux d'un million et demi d'entrées, ~500 Mo. Le couple
 * (coût, propriétaire) tient dans deux tableaux et dit tout ce dont la règle a besoin.
 *
 * ⚠ **CE QUE CETTE ÉCONOMIE COÛTE, ET IL FAUT LE DIRE** : geler une fosse protège TOUTE sa cellule,
 * y compris les tuiles qu'un foyer voisin aurait fini par atteindre en la contournant. Le verbe du
 * joueur est donc un peu plus fort que dans la simulation exacte (mesurée sur dix champs séparés).
 * C'est un choix assumé — et le sens du jeu est le bon : *on défend un secteur, celui de la fosse
 * qu'on tient.*
 *
 * ⚠ **8-CONNEXE, ET CE N'EST PAS UN DÉTAIL** : un Dijkstra 4-connexe rend des LOSANGES — sur un
 * terrain uniforme ses isolignes sont des carrés posés sur la pointe, ce qui est PLUS artificiel
 * qu'un cercle. Le défaut est invisible dans le code et saute aux yeux sur une carte rendue.
 *
 * Coûts ENTIERS, donc un Dijkstra à SEAUX : O(N), pas de tas, pas de flottant dans la carte.
 * Pur : aucune horloge, aucun tirage, `+ - *` et des comparaisons.
 */
export function calculeChampDeCendre(
  width: number,
  height: number,
  terrain: readonly number[],
  fosses: readonly { tx: number; ty: number }[],
): number[] {
  const N = width * height
  if (fosses.length === 0) return new Array<number>(N).fill(-1)
  // ⚠ TYPÉS EN INTERNE, `number[]` seulement à la sortie. Sur le plan complet (3,75 M de tuiles)
  // la passe coûtait 2,3 s en tableaux ordinaires et faisait sauter le budget A13 (15 s pour une
  // carte de production). L'état de sim reste JSON-sérialisable : c'est la SORTIE qui compte.
  const cout = new Int32Array(N).fill(-1)
  const foyer = new Int32Array(N).fill(-1)

  // ⚠ Une fosse au-delà du plafond n'aurait pas d'index lisible : on ne la sème pas plutôt que de
  //   la replier sur une autre. Le worldgen n'en pose jamais autant (cap 80), c'est un garde-fou.
  // ⚠ Une fosse au-delà du plafond n'aurait pas d'index lisible : on ne la sème pas plutôt que de
  //   la replier sur une autre. Le worldgen n'en pose jamais autant (cap 80), c'est un garde-fou.
  const combien = fosses.length > CENDRE.FOYERS_MAX ? CENDRE.FOYERS_MAX : fosses.length

  /**
   * ═══ UN ANNEAU DE SEAUX, PAS UN TABLEAU INDEXÉ PAR LE COÛT (algorithme de Dial) ═══
   *
   * Les poids d'arête sont bornés (`DIAG × COUT_MINERAL` = 423), donc toutes les entrées en
   * attente tiennent dans une fenêtre de cette largeur : un anneau de 424 seaux suffit, et on
   * n'alloue jamais plus.
   *
   * ⚠ LA PREMIÈRE ÉCRITURE INDEXAIT LES SEAUX PAR LE COÛT LUI-MÊME. Sur le plan complet, le coût
   * maximal frôle les cinq millions : c'était un tableau creux de cinq millions d'entrées, dont
   * la boucle extérieure parcourait chaque case vide. **Mesuré : 2,3 à 3 s, et le budget A13 de
   * la génération (15 s) sautait.** L'anneau ramène la passe à une fraction de ça, sans changer
   * un seul résultat — le champ sort identique au bit près (garde A2).
   */
  const LARGEUR = CENDRE.DIAG * CENDRE.COUT_MINERAL + 1
  const anneau: number[][] = []
  for (let k = 0; k < LARGEUR; k++) anneau[k] = []
  let enAttente = 0
  const pousser = (i: number, d: number): void => {
    anneau[d % LARGEUR]!.push(i)
    enAttente++
  }

  for (let k = 0; k < combien; k++) {
    const f = fosses[k]!
    if (f.tx < 0 || f.ty < 0 || f.tx >= width || f.ty >= height) continue
    const i = f.ty * width + f.tx
    if (!cendrePeutPrendre(terrain[i]!)) continue
    if (cout[i]! >= 0) continue // deux fosses sur la même tuile : la première gagne, sans tirage
    cout[i] = 0
    foyer[i] = k
    pousser(i, 0)
  }

  let d = 0
  while (enAttente > 0) {
    const b = anneau[d % LARGEUR]!
    if (b.length === 0) { d++; continue }
    const i = b.pop()!
    enAttente--
    if (cout[i] !== d) continue // entrée périmée : une meilleure est passée depuis
    const x = i % width
    const y = (i - x) / width
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const j = ny * width + nx
        const t = terrain[j]!
        if (!cendrePeutPrendre(t)) continue
        const pas = (dx !== 0 && dy !== 0 ? CENDRE.DIAG : CENDRE.ORTHO) * coutDentree(t)
        const nd = d + pas
        const dj = cout[j]!
        if (dj >= 0 && dj <= nd) continue
        cout[j] = nd
        foyer[j] = foyer[i]!
        pousser(j, nd)
      }
    }
  }

  // ON REPLIE LES DEUX EN UN (voir `FOYERS_MAX`) — c'est ce qui sort de la fonction, et le seul
  // tableau que la carte porte.
  const champ = new Array<number>(N)
  for (let i = 0; i < N; i++) {
    const c = cout[i]!
    champ[i] = c < 0 ? -1 : c * CENDRE.FOYERS_MAX + foyer[i]!
  }
  return champ
}

/** Le COÛT d'une tuile, replié dans le champ — `-1` hors d'atteinte. */
export function coutDe(champ: readonly number[] | undefined, i: number): number {
  const v = champ?.[i]
  return v === undefined || v < 0 ? -1 : Math.floor(v / CENDRE.FOYERS_MAX)
}

/** LA FOSSE qui revendique cette tuile — `-1` hors d'atteinte. */
export function foyerDe(champ: readonly number[] | undefined, i: number): number {
  const v = champ?.[i]
  return v === undefined || v < 0 ? -1 : v % CENDRE.FOYERS_MAX
}

/**
 * CETTE TUILE EST-ELLE CENDRÉE ? — une comparaison, et c'est tout l'intérêt du modèle (R4/R6).
 *
 * `avancees` donne, par index de fosse, jusqu'où SON foyer est allé (en unités de coût) — c'est ce
 * que `avanceesDesFoyers` calcule à partir du jour et des fosses gelées. Le grain déforme le SEUIL,
 * pas le coût : `coût ≤ avancée · (1 + grain)`.
 */
export function estCendre(
  map: WorldMap,
  tx: number,
  ty: number,
  avancees: readonly number[],
  seed: number,
): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false
  const champ = map.cendreCout
  if (!champ) return false
  const i = ty * map.width + tx
  const c = coutDe(champ, i)
  if (c < 0) return false
  const a = avancees[foyerDe(champ, i)]
  if (a === undefined) return false
  return c <= a * CENDRE.ORTHO * (1 + grainDeCendre(seed, tx, ty))
}

/**
 * LE CHAMP DE CENDRE DU PLAN COMPLET — la distance de chaque tuile à la frontière de la Cendrière.
 * ⚠ SANS RAPPORT avec la mécanique ci-dessus : le monde JOUÉ n'a plus de Cendrière, et ce champ ne
 * sert plus qu'à DATER la reprise du versant Brûlé sur le plan `'vallee'`, qui dort.
 *
 * Négative DEDANS, positive dehors, en tuiles. C'est de la donnée STATIQUE de carte : calculée une
 * fois, jamais modifiée — et plus rien ne s'y compare depuis que le front est retiré.
 *
 * On le dérive du diagramme de puissance, exactement comme la marge des frontières : la
 * « puissance » d'un site est `distance² − poids`, et l'écart de puissance entre deux sites,
 * divisé par `2 × d(sites)`, EST une distance en tuiles. On mesure donc simplement la puissance
 * de la Cendrière contre celle du propriétaire de la tuile.
 *
 * CONSÉQUENCE HEUREUSE : le front épouse la **forme réelle** de la Cendrière (frontière tordue par
 * le bruit comprise) au lieu d'être un disque. Il avance comme une marée, pas comme une explosion.
 */
export function computeCendreField(
  width: number,
  height: number,
  distanceALaCendriere: (x: number, y: number) => number,
): number[] {
  const out = new Array<number>(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out[y * width + x] = distanceALaCendriere(x, y)
    }
  }
  return out
}

/**
 * LA DIRECTION DE LA CENDRIÈRE depuis un point — 'nord' | 'sud' | 'est' | 'ouest', ou
 * `undefined` sur une carte sans Cendrière ou en terrain plat de cendre.
 *
 * Pour les ANNALES (spec `annales.md` R3) : la Tour de guet regarde VERS la Cendrière (`guet`),
 * la charrette fuit À L'OPPOSÉ (`fuite`). Des MOTS, jamais des degrés — le pays d'avant n'a pas
 * de boussole graduée, et aucun lecteur n'aura à formater un angle.
 *
 * Lecture BRUTE du champ de distance (pas de la marge au front) : c'est une question de
 * GÉNÉRATION — « où est la Cendrière ? » — qui ne dépend d'aucun tick. On échantillonne aux
 * quatre cardinaux à `pas` tuiles (bornés à la carte) ; la pente la plus FORTE vers le bas du
 * champ désigne la Cendrière. Départage : l'ordre fixe est-ouest-sud-nord (déterminisme).
 */
export function directionCendriere(map: WorldMap, tx: number, ty: number, pas = 24): 'nord' | 'sud' | 'est' | 'ouest' | undefined {
  const champ = map.cendre
  if (!champ) return undefined
  const lire = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= map.width ? map.width - 1 : x
    const cy = y < 0 ? 0 : y >= map.height ? map.height - 1 : y
    return champ[cy * map.width + cx]!
  }
  const ici = lire(tx, ty)
  const pentes: ['est' | 'ouest' | 'sud' | 'nord', number][] = [
    ['est', ici - lire(tx + pas, ty)],
    ['ouest', ici - lire(tx - pas, ty)],
    ['sud', ici - lire(tx, ty + pas)],
    ['nord', ici - lire(tx, ty - pas)],
  ]
  let best = pentes[0]!
  for (const q of pentes) if (q[1] > best[1]) best = q
  return best[1] > 0 ? best[0] : undefined
}

/** L'opposé d'une direction — la fuite tourne le dos au guet. */
export function directionOpposee(d: 'nord' | 'sud' | 'est' | 'ouest'): 'nord' | 'sud' | 'est' | 'ouest' {
  return d === 'nord' ? 'sud' : d === 'sud' ? 'nord' : d === 'est' ? 'ouest' : 'est'
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// LES FOYERS, LEUR ÂGE, ET CE QU'ILS ONT MANGÉ
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * LE JOUR OÙ LA CENDRE S'ÉBRANLE, dans l'année de CE monde (R8).
 *
 * Dérivé de la phase (`ACTE_DEPART` = 4, le Grand Froid) et jamais écrit en dur : le jour où
 * `ACT_DAYS` bougera, le réveil suivra. Le monde ouvre au jour `jourDeDepart` ; la cendre dort
 * jusqu'à l'ouverture du premier Grand Froid, quel que soit ce jour de départ.
 */
export function jourDuReveilDeLaCendre(state: { jourDeDepart: number }): number {
  const debut = (CENDRE.ACTE_DEPART - 1) * BALANCE.ACT_DAYS + 1
  return debut > state.jourDeDepart ? debut : state.jourDeDepart
}

/**
 * LES FOSSES DE LA CARTE, dans l'ordre des toponymes — c'est CET ordre qui indexe `cendreFoyer`,
 * `state.cendreAge` et tout ce qui suit. Il est stable par construction (les zones sont posées à
 * la génération et ne bougent jamais), donc aucun tri n'est nécessaire et aucun n'est fait.
 */
export function foyersDeLaCarte(map: WorldMap): { tx: number; ty: number; zone: number }[] {
  const out: { tx: number; ty: number; zone: number }[] = []
  for (let zi = 0; zi < map.zones.length; zi++) {
    const z = map.zones[zi]!
    if (z.kind !== 'charnier') continue
    out.push({ tx: Math.floor(z.x + z.w / 2), ty: Math.floor(z.y + z.h / 2), zone: zi })
  }
  return out
}

/**
 * ═══ LE CARACTÈRE D'UN FOYER — LES DIX FOSSES NE RENDENT PAS LA MÊME CENDRE (R21) ═══
 *
 * *Décision d'Alexis, 2026-08-27.* Les foyers étaient interchangeables : même allure, même
 * cendre, même danger. La variété reposait entièrement sur la géographie (R2), et elle ne
 * suffisait pas — traverser la cendre du sud ou celle du nord donnait la même chose.
 *
 * **C'est le patron EXACT de `modificateur.ts`, doctrine comprise : *« il surcharge des cadrans,
 * il n'invente rien »*.** Aucun mécanisme neuf ; cinq multiplicateurs sur des réglages qui
 * existaient déjà, et quatre caractères qui les tournent.
 *
 * ⚠ **PAS DE CADRAN `vitesse`, ET C'EST DÉLIBÉRÉ.** Ce serait le plus évident, et il contredit
 * **R2**, décision actée : *« ils partent tous au même instant et avancent à la même allure ; la
 * géographie fait toute la variété »*. Le rouvrir serait une décision utilisateur à consigner
 * dans `docs/decisions.md`, pas une ligne de table.
 *
 * ⚠ **UN CARACTÈRE PAR FOSSE, ET CHACUN UNIQUE.** Ce n'est pas un tirage indépendant : les
 * quatre caractères sont attribués aux quatre fosses de plus faible hash. La vallée porte donc
 * **une** Salée, **une** Gueule, **une** Muette, **une** Docile — c'est la doctrine des
 * fumerolles (*« un lieu, pas une texture »*) appliquée aux foyers. Une fosse qu'on apprend.
 *
 * MESURÉ (`tools/diag-cendre-succession.mts`, quatre graines) : aucun foyer n'avale les autres.
 * Le plus gros revendique 11 à 17 % de la cendre, le plus petit 4 à 7 % — un caractère touche
 * donc toujours une part réelle de la carte.
 *
 * Zéro état, zéro tirage : `hash2` est un HACHAGE, il ne consomme pas le flux du PRNG seedé (et
 * ne peut donc pas décaler un test sans rapport).
 */
export type CaractereDeFoyer = 'salee' | 'gueule' | 'muette' | 'docile'

export type EffetsDeFoyer = {
  /** multiplie `FUMEROLLE.PART` — la part des mailles qui portent une bouche (borné à 1). */
  fumerolles?: number
  /** multiplie `FUMEROLLE.SEL_STOCK` — ce qu'une bouche rend avant de s'épuiser. */
  sel?: number
  /** multiplie le champ des morts sur le territoire du foyer (`densiteDesMorts`). */
  morts?: number
  /** multiplie `FUMEROLLE.FROID` — le souffle de ses bouches. */
  froid?: number
  /** multiplie `MORTS.BRULE_DUREE_JOURS` — combien de temps un feu tient CETTE fosse (R16). */
  gel?: number
}

/**
 * LES QUATRE, et chacun se justifie par ce que son nom dit déjà.
 *
 * ⚠ **`fumerolles` NE PEUT PAS TRIPLER, et il ne faut pas faire semblant** : `FUMEROLLE.PART`
 * vaut déjà 0,80, donc ×3 sature à 1 et ne rend que +25 % de bouches. La Salée porte donc sa
 * promesse là où elle a de la place — le SEL (`SEL_STOCK` 4 → 12) — et sa saturation à 1 lui
 * donne ce qu'aucune autre n'a : **aucune maille vide**, on y croise toujours une bouche.
 */
export const CARACTERES_DE_FOYER: Record<CaractereDeFoyer, EffetsDeFoyer> = {
  /** LA SALÉE — toutes ses mailles fument, et ses bouches rendent trois fois plus de sel.
   *  Le foyer qu'on VISITE : la seule raison d'aller dans la cendre devient une adresse. */
  salee: { fumerolles: 1.25, sel: 3 },
  /** LA GUEULE — le sol y est plein de morts et ne fume presque pas : rien à y prendre, tout à
   *  y perdre. Celui qu'on ÉVITE, puis qu'on finit par devoir purger (R16). */
  gueule: { morts: 1.6, fumerolles: 0.3 },
  /** LA MUETTE — deux fois moins de morts, un souffle plus froid. Traversable et glaçante : le
   *  contrepoint qui empêche « cendre = morts-vivants » d'être toute la lecture. */
  muette: { morts: 0.5, froid: 1.4 },
  /** LA DOCILE — un feu la tient trente jours au lieu de quinze. C'est le foyer qu'on peut
   *  réellement TENIR, donc celui qui rend le verbe de R16 gagnant quelque part. */
  docile: { gel: 2 },
}

/** L'ordre d'attribution : le caractère `j` va à la fosse de `j`-ième plus faible hash. */
export const ORDRE_DES_CARACTERES: readonly CaractereDeFoyer[] = ['salee', 'gueule', 'muette', 'docile']

/**
 * LE CARACTÈRE DE CHAQUE FOSSE — une fonction pure de `(seed, combien)`, dans l'ordre de
 * `foyersDeLaCarte`. `undefined` = une fosse nue, et c'est le cas le plus fréquent.
 */
export function caracteresDesFoyers(seed: number, combien: number): (CaractereDeFoyer | undefined)[] {
  const out = new Array<CaractereDeFoyer | undefined>(combien).fill(undefined)
  if (combien <= 0) return out
  const n = Math.min(ORDRE_DES_CARACTERES.length, Math.round(combien * CENDRE.PART_CARACTERE))
  if (n <= 0) return out
  const sel = (seed ^ 0x464f5945) | 0 /* 'FOYE' */
  const rangs = new Array<number>(combien)
  for (let k = 0; k < combien; k++) rangs[k] = k
  // Tri déterministe : le hash, et l'index en départage — jamais l'ordre d'arrivée.
  rangs.sort((a, b) => {
    const ha = hash2(a, 0, sel)
    const hb = hash2(b, 0, sel)
    return ha === hb ? a - b : ha - hb
  })
  for (let j = 0; j < n; j++) out[rangs[j]!] = ORDRE_DES_CARACTERES[j]!
  return out
}

/**
 * LES CARACTÈRES DE CETTE CARTE — MÉMOÏSÉS, parce que les cadrans se lisent par TUILE.
 *
 * `densiteDesMorts` est lu pour chaque tuile de la couronne de réveil, `fumerolleIci` pour chaque
 * tuile rendue : recompter les charniers et retrier dix hashs à chaque appel serait absurde. Le
 * cache tient UNE entrée, clée sur l'identité de la carte et la graine.
 *
 * ⚠ C'est de la **mémoïsation d'une fonction pure**, pas de l'état de simulation — exactement le
 * précédent du cumul de R19 et du cache d'un jour de `modificateur.ts`. Il ne rentre pas dans le
 * `SimState`, et le replay n'y perd rien.
 */
let cacheDesCaracteres: { map: WorldMap; seed: number; out: (CaractereDeFoyer | undefined)[] } | null = null

export function caracteresDeLaCarte(map: WorldMap, seed: number): readonly (CaractereDeFoyer | undefined)[] {
  const c = cacheDesCaracteres
  if (c !== null && c.map === map && c.seed === seed) return c.out
  const out = caracteresDesFoyers(seed, foyersDeLaCarte(map).length)
  cacheDesCaracteres = { map, seed, out }
  return out
}

/** LE CADRAN D'UNE FOSSE — `1` si elle est nue, hors carte, ou si son caractère ne le tourne pas. */
export function cadranDeFoyer(
  caracteres: readonly (CaractereDeFoyer | undefined)[],
  k: number,
  cadran: keyof EffetsDeFoyer,
): number {
  if (k < 0) return 1
  const c = caracteres[k]
  if (c === undefined) return 1
  return CARACTERES_DE_FOYER[c][cadran] ?? 1
}

/**
 * ═══ À QUELLE FOSSE CETTE TUILE APPARTIENT-ELLE ? — STATIQUE, et c'est la question qui compte ═══
 *
 * Son index, ou `-1` si aucune ne peut l'atteindre (l'eau, le vide). **Le territoire ne dépend pas
 * du tick** : `cendreFoyer` est posé au worldgen et ne bouge jamais.
 *
 * ⚠ **ET C'EST POURQUOI LES FUMEROLLES LE LISENT LUI, ET NON « LA CENDRE EST-ELLE ARRIVÉE ».**
 * La première écriture gatait leur part sur le front, et elle FAISAIT CLIGNOTER LES BOUCHES : une
 * tuile de grain positif peut être cendrée (donc porter une bouche ouverte, `auCoeurDeLaCendre`)
 * alors que le seuil NU n'est pas encore franchi. Quelques jours plus tard il l'était, le cadran
 * d'une Gueule tombait à 0,24, et `bouchePotentielle` rendait `null` — la bouche se refermait
 * sous elle-même, tandis que son NŒUD, lui, restait posé. Rendu et froid partaient chacun de leur
 * côté. Un caractère est une propriété du TERRITOIRE, pas de l'avancée.
 */
export function foyerDeLaTuile(map: WorldMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return -1
  const champ = map.cendreCout
  if (!champ) return -1
  return foyerDe(champ, ty * map.width + tx)
}

/**
 * ═══ LA FOSSE DONT LA CENDRE A DÉJÀ PRIS CETTE TUILE — `-1` sinon ═══
 *
 * Contrairement à `foyerDeLaTuile`, celle-ci EXIGE que le front soit passé : c'est ce que veut le
 * champ des morts (R21, cadran `morts`), qui ne doit peser que là où la cendre EST. Aucun
 * clignotement possible : une avancée ne recule jamais, un gel la fige au pire (R16).
 *
 * ⚠ **SANS LE GRAIN, ET C'EST VOULU.** `estCendre` déforme le seuil par quatre `fbm2`
 * (`grainDeCendre`, mesuré ×1,95) parce qu'une LISIÈRE doit être irrégulière. Une DENSITÉ n'a pas
 * de lisière : la déformer coûterait quatre bruits sur un chemin lu par tuile de la couronne de
 * réveil, pour un effet que personne ne peut voir. On lit donc le coût nu.
 *
 * Sans allocation (patron de `tuileCendree`) : elle lit l'âge du foyer propriétaire au lieu de
 * reconstruire le tableau des avancées.
 */
export function foyerDuSol(
  state: { map: WorldMap; cendreAge: readonly number[]; seed: number },
  tx: number,
  ty: number,
): number {
  const map = state.map
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return -1
  const champ = map.cendreCout
  if (!champ) return -1
  const i = ty * map.width + tx
  const c = coutDe(champ, i)
  if (c < 0) return -1
  const k = foyerDe(champ, i)
  return c <= avanceeDeCendre(state.cendreAge[k] ?? 0) * CENDRE.ORTHO ? k : -1
}

/**
 * ═══ LA PROFONDEUR NUE — LA MÊME, SANS LA LISIÈRE (R22/R23) ═══
 *
 * `profondeurDeCendre` déforme son seuil par `grainDeCendre`, soit **quatre `fbm2`**, parce
 * qu'une LISIÈRE doit être irrégulière : c'est ce qu'on VOIT. Deux lois n'ont pas de lisière —
 * une TEMPÉRATURE et une DENSITÉ — et elles se lisent, elles, par tuile et par tick sur des
 * chemins chauds (`baselineTemperature` est appelée par entité et par tick dans toute la sim, et
 * la recuisson du gel du client la boucle par tranches).
 *
 * On lit donc le coût NU. **C'est le précédent exact de `foyerDuSol`** (R21), pour la même
 * raison, et le désaccord entre les deux lectures tient par construction DANS la bande de grain
 * (±`WARP_PART`) : au pire, une tuile de bord est froide un jour trop tôt ou trop tard.
 *
 * Rend `-1` hors cendre — y compris sans champ (`cendreCout` absent : le banc headless, et les
 * FAUX `SimState` que le client fabrique par double cast pour ses façades).
 */
export function profondeurNueDeCendre(
  state: { map: WorldMap; cendreAge?: readonly number[] },
  tx: number,
  ty: number,
): number {
  const map = state.map
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return -1
  const champ = map.cendreCout
  if (!champ) return -1
  const i = ty * map.width + tx
  const c = coutDe(champ, i)
  if (c < 0) return -1
  const seuil = avanceeDeCendre(state.cendreAge?.[foyerDe(champ, i)] ?? 0) * CENDRE.ORTHO
  if (c > seuil) return -1
  return (seuil - c) / CENDRE.ORTHO
}

/**
 * ═══ LA RAMPE DE LA SUCCESSION — de la frange au cœur mûr (R22/R23) ═══
 *
 * `0` sur la frange (ce qui vient de brûler est encore chaud, R11quinquies), montée LINÉAIRE
 * jusqu'à `1` à l'entrée de la bande vieille (`CROUTE_TUILES`), plateau ensuite. Hors cendre :
 * `0`. C'est la forme que partagent le FROID (R22) et la HANTISE (R23) — un seul geste du monde,
 * lu deux fois.
 *
 * ⚠ Elle démarre à `FRANGE_TUILES` et non à 0 : la frange est l'ÉCHÉANCE de R14, l'endroit où
 * l'on travaille. Ce qui la rend dangereuse est la nuit et les morts, pas le sol.
 */
export function rampeDeSuccession(profondeurNue: number): number {
  if (profondeurNue <= CENDRE.FRANGE_TUILES) return 0
  if (profondeurNue >= CENDRE.CROUTE_TUILES) return 1
  return (profondeurNue - CENDRE.FRANGE_TUILES) / (CENDRE.CROUTE_TUILES - CENDRE.FRANGE_TUILES)
}

/**
 * LE FROID QUE LA CENDRE RETIRE ICI, en degrés (R22) — `0` hors cendre et sur la frange.
 *
 * C'est une EXPOSITION de plus, au même titre que la Brume, le front météo et le souffle d'une
 * fumerolle : l'abri l'amortit, le feu et la tenue la PLANCHENT (l'ambiant est un `max`). Et
 * comme le souffle, **elle réveille les morts** : `CENDREUX.TORPEUR` lit ce même froid de base.
 * C'est le but de R22, pas un effet de bord.
 */
export function froidDeCendre(
  state: { map: WorldMap; cendreAge?: readonly number[] },
  tx: number,
  ty: number,
): number {
  const p = profondeurNueDeCendre(state, tx, ty)
  if (p < 0) return 0
  return CENDRE.FROID_COEUR * rampeDeSuccession(p)
}

/**
 * ═══ L'ÂGE D'UN FOYER, ET POURQUOI C'EST LE SEUL ÉTAT DE CETTE MÉCANIQUE ═══
 *
 * Tout le reste se dérive du tick. Pas ça : **le joueur peut geler un foyer** (R16), et un gel est
 * un acte, pas une fonction du temps. On range donc, par fosse, son ÂGE EFFECTIF en jours — ce
 * qu'elle a réellement vécu depuis son réveil.
 *
 * Un tableau de dix nombres. Il porte DEUX choses à la fois, et c'est ce qui le justifie :
 *   • le GEL (R16) — une fosse brûlée ne vieillit pas ce jour-là ;
 *   • le CARACTÈRE DE LA SAISON (R18) — `deluge` la fait vieillir de 0,4 jour, `reveil` de 1,6.
 *
 * Avancé UNE FOIS par bascule de jour de saison, jamais au tick.
 */
export function avancerLaCendre(
  ages: number[],
  foyers: readonly { zone: number }[],
  estGelee: (zone: number) => boolean,
  facteurDuJour: number,
): void {
  for (let k = 0; k < foyers.length; k++) {
    const age = ages[k] ?? 0
    ages[k] = age
    if (estGelee(foyers[k]!.zone)) continue // brûlée aujourd'hui : elle ne vieillit pas
    ages[k] = age + facteurDuJour
  }
}

/** L'avancée de chaque foyer, en unités de coût — ce que `estCendre` compare. */
export function avanceesDepuisAges(ages: readonly number[], combien: number): number[] {
  const out = new Array<number>(combien)
  for (let k = 0; k < combien; k++) out[k] = avanceeDeCendre(ages[k] ?? 0)
  return out
}

/**
 * ═══ DEPUIS COMBIEN DE TEMPS CETTE TUILE EST-ELLE CENDRÉE ? (R13) ═══
 *
 * En jours EFFECTIFS de son foyer, ou `-1` si elle ne l'est pas encore.
 *
 * ⚠ **ET ELLE NE COÛTE AUCUN ÉTAT**, ce qui était l'inquiétude de la spec. On sait à quelle
 * AVANCÉE la tuile tombe (`coût / (1 + grain)`) ; `avanceeDeCendre` est monotone, donc on
 * l'inverse par une recherche dichotomique sur le cumul déjà mémoïsé, ce qui donne l'âge du foyer
 * au moment de la prise. L'ancienneté est la différence avec son âge d'aujourd'hui. Le monde
 * n'a donc pas à se souvenir de ce qu'il a brûlé : il le RECALCULE.
 */
export function ancienneteDeCendre(
  map: WorldMap,
  tx: number,
  ty: number,
  ages: readonly number[],
  seed: number,
): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return -1
  const champ = map.cendreCout
  if (!champ) return -1
  const i = ty * map.width + tx
  const c = coutDe(champ, i)
  if (c < 0) return -1
  const age = ages[foyerDe(champ, i)]
  if (age === undefined) return -1
  const seuil = c / CENDRE.ORTHO / (1 + grainDeCendre(seed, tx, ty))
  if (avanceeDeCendre(age) < seuil) return -1 // pas encore prise
  // L'âge auquel l'avancée a franchi le seuil — dichotomie sur une suite croissante.
  let lo = 0
  let hi = Math.floor(age)
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (avanceeDeCendre(m) < seuil) lo = m + 1
    else hi = m
  }
  return age - lo
}

/**
 * ═══ LA CENDRE FAIT TOMBER CE QU'ELLE A TUÉ (R13) ═══
 *
 * Une fois par bascule de jour : tout nœud VIVANT dont la tuile est cendrée depuis plus de
 * `AGONIE_JOURS` disparaît. Le minéral (pierre, filon, carrière, gravats) n'est jamais touché —
 * *« le vivant meurt lentement, le minéral reste »*.
 *
 * ⚠ **CE N'EST PAS L'ANCIEN `avancerLaCendre`**, et la différence est tout le sujet. Celui-là
 * supprimait TOUT nœud passé derrière le front, au tick même, sans préavis : au jour 285, 69 % des
 * nœuds de la Racine effacés, et rien ne les rendait jamais. Ici l'arbre a été visible, dénudé et
 * RÉCOLTABLE pendant cinq jours avant de tomber — le joueur a eu le temps d'aller le chercher.
 *
 * Émet UN événement par jour, jamais un par nœud : la chronique veut savoir que la vallée a
 * reculé, pas qu'un buisson est tombé.
 */
export function tomberLesMortsDeLaCendre(
  nodes: ResourceNode[],
  map: WorldMap,
  ages: readonly number[],
  seed: number,
  estVivant: (type: string) => boolean,
): { restants: ResourceNode[]; tombes: number } {
  if (!map.cendreCout) return { restants: nodes, tombes: 0 }
  const restants = nodes.filter((n) => {
    if (!estVivant(n.type)) return true
    const age = ancienneteDeCendre(map, n.tx, n.ty, ages, seed)
    return age < 0 || age < CENDRE.AGONIE_JOURS
  })
  return { restants, tombes: nodes.length - restants.length }
}

/** L'arbre est-il EN TRAIN de mourir ici ? (le rendu le dénude, la récolte le laisse passer) */
export function agonise(map: WorldMap, tx: number, ty: number, ages: readonly number[], seed: number): boolean {
  const age = ancienneteDeCendre(map, tx, ty, ages, seed)
  return age >= 0 && age < CENDRE.AGONIE_JOURS
}

/**
 * LA LECTURE DE JEU — « cette tuile est-elle cendrée, MAINTENANT ? »
 *
 * Sans allocation : elle lit directement l'âge du foyer propriétaire au lieu de reconstruire le
 * tableau des avancées. C'est la forme qu'appellent les chemins chauds (dérive, repousse, rendu).
 */
export function tuileCendree(
  state: { map: WorldMap; cendreAge: readonly number[]; seed: number },
  tx: number,
  ty: number,
): boolean {
  const map = state.map
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false
  const champ = map.cendreCout
  if (!champ) return false
  const i = ty * map.width + tx
  const c = coutDe(champ, i)
  if (c < 0) return false
  const a = avanceeDeCendre(state.cendreAge[foyerDe(champ, i)] ?? 0)
  const s = a * CENDRE.ORTHO
  // Le grain vaut ±WARP_PART au plus : hors de cette bande la réponse est acquise sans le payer
  // (quatre `fbm2`). `neigeAuSol` interroge cette fonction sur tout le cadre à chaque recuisson
  // du gel — seule la lisière paie le bruit, et elle rend au bit près la même chose qu'avant.
  if (c > s * (1 + CENDRE.WARP_PART)) return false
  if (c <= s * (1 - CENDRE.WARP_PART)) return true
  return c <= s * (1 + grainDeCendre(state.seed, tx, ty))
}

/**
 * ═══ LE SOL QU'ON FOULE ICI — LA CENDRE REMPLACE CE QU'ELLE COUVRE (Alexis, 2026-08-25) ═══
 *
 * *« La cendre remplace les caractéristiques de la tuile sous-jacente. Si c'est un marais avec de
 * la cendre, pas d'offset pas de slow. »*
 *
 * Le terrain n'est JAMAIS muté (tout se dérive, R11) — donc tout ce qui lisait `map.terrain`
 * lisait le sol d'AVANT : sous vingt centimètres de cendre, un marais gardait son `speedFactor`
 * de 0,6 et sa vase où l'on s'enfonce. On y pataugeait dans une boue qui n'existe plus.
 *
 * Rend le terrain à considérer, ou `undefined` si la cendre n'a pas pris ici (l'appelant garde
 * alors le sien). C'est la MÊME table que le rendu (`terrainCendre`), à la même profondeur —
 * l'un ne peut pas peindre de la cendre là où l'autre fait patauger.
 *
 * ⚠ ELLE NE REND JAMAIS UN SOL MOINS PRATICABLE QUE CELUI QU'ELLE COUVRE, et c'est une garde,
 * pas une politesse. La table de la FRANGE envoie tout le cailloutteux marchable (éboulis,
 * chaos de blocs) sur `cendre_min`, qui est déclaré `walkable: false` — c'est un SOL DE RENDU,
 * pensé pour une couche qui peint, et le rendre au pas transformerait un éboulis praticable en
 * mur le jour où la cendre l'atteint. Une poussière ne ferme pas un passage : si le sol cendré
 * ne se marche pas, on garde celui de dessous.
 */
export function solFoule(
  state: { map: WorldMap; cendreAge: readonly number[]; seed: number },
  tx: number,
  ty: number,
): number | undefined {
  // SORTIE IMMÉDIATE : un monde sans cendre (banc, worldgen, carte d'avant) ne paie rien.
  if (!state.map.cendreCout) return undefined
  const prof = profondeurDeCendre(state.map, tx, ty, avanceesDepuisAges(state.cendreAge, state.cendreAge.length), state.seed)
  if (prof < 0) return undefined
  const t = terrainAt(state.map, tx, ty)
  const cendre = terrainCendre(t, prof > CENDRE.FRANGE_TUILES)
  if (cendre === undefined) return undefined
  return TERRAINS[cendre]?.walkable === true ? cendre : undefined
}

/**
 * CE NŒUD EST-IL TOMBÉ AVEC LA CENDRE ? — la règle R13, sous la forme dont le RENDU a besoin.
 *
 * ⚠ **ELLE EXISTE PARCE QUE LE PROTOCOLE N'ENVOIE JAMAIS LA DISPARITION D'UN NŒUD** : les deltas
 * ne portent que des stocks. Le client APPLIQUE donc la règle au lieu de la recevoir — exactement
 * ce qu'il fait déjà pour le défrichage (`noeudDefriche`), et pour la même raison : sans ça il
 * resterait un arbre FANTÔME sur la cendre, contre lequel la prédiction locale irait se cogner.
 * (Constaté au navigateur avant cette ligne : au jour 240, la futaie morte était encore debout.)
 */
export function noeudTombeParLaCendre(
  map: WorldMap,
  ages: readonly number[],
  seed: number,
  node: { tx: number; ty: number },
  vivant: boolean,
): boolean {
  if (!vivant) return false // le minéral RESTE, toujours
  const age = ancienneteDeCendre(map, node.tx, node.ty, ages, seed)
  return age >= CENDRE.AGONIE_JOURS
}
