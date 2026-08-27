/**
 * LES CINQ CIELS — le front météo, peint (spec `meteo.md` R1-R7, tranche de rendu).
 *
 * La sim fait traverser la vallée par une BANDE (`frontMeteoPos`) dont l'intensité monte en
 * rampe du bord vers le cœur (`meteoIntensityAt`). Sept tranches l'ont rendue mordante — le
 * froid, la faim du feu, le silence du gibier, le pas alourdi, les yeux voilés, la foudre —
 * et RIEN ne se voyait. Voici ce qui se voit.
 *
 * ═══ LE PARTAGE : LES PARTICULES PORTENT LE GRAIN, LE SHADER PORTE LE VOILE ═══
 *
 * Deux choses tombent sous les yeux d'un joueur, et elles n'ont pas la même nature :
 *
 *   • LE VOILE — la teinte atmosphérique, la matière en suspension. C'est un CHAMP : il
 *     couvre tout le cadre, il porte le gradient spatial de la bande et la lecture du type.
 *     Un `Shader` plein-monde le rend en une passe pour un coût quasi nul, et il reste ici.
 *   • LE GRAIN — les gouttes et les flocons. Ce sont des OBJETS : ils ont une masse, une
 *     vitesse limite, une phase propre, et ils touchent le sol. Ils vivent désormais dans
 *     `meteo-particules.ts` (physique pure, testée headless) et se peignent ici.
 *
 * ═══ POURQUOI ON EST REVENU SUR « PAS DE SPRITES » ═══
 *
 * La première recette évitait les sprites, et pour une raison SÉRIEUSE : cette machine n'a
 * pas de GPU (swiftshader, rendu logiciel). Le grain était donc un motif de shader — un hash
 * par cellule de 4 px, une grille translatée. Ça tombait droit, tout à la même vitesse, sans
 * masse et sans air, et la longueur du trait venait d'un REGROUPEMENT de cellules, pas d'une
 * vitesse.
 *
 * CE QUI EST **MESURÉ** (2026-08-19) — deux instruments, et il en fallait deux :
 *
 *   • CE QUE LA COUCHE PREND SUR LE FIL PRINCIPAL (`smoke --scenario meteocout`, chronomètre
 *     interne `sonde.msPhysique` / `.msPeinture`). Au budget livré (650, marge 1,5 tuile) :
 *     **la pluie tient 609 particules pour 1,2 ms/image** (0,6 de physique + 0,6 de peinture,
 *     1 827 rectangles), et elle n'est PAS plafonnée. Au budget d'avant (900, marge 3 tuiles),
 *     la même pluie coûtait **2,2 ms/image** — le plafond que la demande fixait — et trois
 *     types sur quatre TAPAIENT le budget, donc peignaient un rideau que le budget décidait
 *     au lieu du front. C'est ce relevé qui a fait baisser les deux constantes.
 *     (Neige 488 → 0,625 ms ; orage 518 → 0,7 ms pour 3 323 rectangles ; blizzard 585 →
 *     0,2 ms — relevés du 2026-08-19, au budget courant.)
 *
 *     ⚠ **CE QUE LA PLUIE FINE A COÛTÉ, EN CLAIR : +0,43 ms/image** (0,775 → 1,2). La goutte
 *     est passée d'une cellule de 4 px à un pixel d'art : sa traînée fait maintenant 23
 *     cellules au lieu de 4, et l'escalier de la pente en rend **3 rectangles par goutte au
 *     lieu d'un** (MESURÉ : 1 827 pour 609). Trois rectangles fins coûtent plus qu'un gros —
 *     c'est le prix de la finesse, il est nommé, et il reste très en dessous des 2,2 ms
 *     rejetées. L'orage paie plus cher encore (6,4 rectangles par goutte, sa pente vaut
 *     0,305 contre 0,089) : c'est pour ça que sa traînée est plus courte et sa densité plus
 *     basse que celles de la pluie.
 *
 *   • CE QUE ÇA DONNE À L'ÉCRAN (`smoke --scenario meteo`, TROIS étalons au même endroit et
 *     à la même heure — ciel nu / voile seul / voile + particules ; deux n'auraient pas
 *     suffi, voir le scénario). Sous la pluie FINE, au cœur, à midi : **µ 114,9 contre 135,3
 *     au ciel nu (Δ −20,3), σ/µ 0,294 contre 0,251** — le ciel assombrit ET contraste.
 *     Contre le VOILE SEUL, le grain pèse **Δµ +1,1** et **σ/µ 0,294 contre 0,284** : il
 *     éclaircit à peine et il CONTRASTE toujours. C'est ce troisième étalon qui le prouve —
 *     contre le sol nu seul, les deux effets se seraient partiellement annulés, exactement
 *     le piège que la recette d'avant les particules avait payé (Δµ = −0,4, « une pluie
 *     invisible aux nombres »). La LISIÈRE se voit : marche de luminance −18,2 (−22,5
 *     dedans, −4,3 dehors).
 *
 *     LA COMPARAISON QUI DIT LA FINESSE (mêmes étalons, gouttes de 4 px avant / 1 px après) :
 *       Δµ contre le ciel nu       −17,6  →  −20,3   (elle DÉLAVE cinq fois moins)
 *       Δµ contre le voile seul     +5,4  →   +1,1   (le grain ne blanchit presque plus)
 *       σ/µ contre le voile seul   +0,014 →  +0,010  (il contraste toujours — c'est la garde)
 *       marche de lisière          −11,9  →  −18,2   (le bord du front se lit MIEUX)
 *     Et sur les pixels de la planche `meteoplanche`, à la même scène et au même témoin :
 *     **largeur médiane d'une goutte 9 px d'écran → 2** (4 px monde → 1, au zoom 2,25), et
 *     la part du cadre plus CLAIRE que l'herbe nue tombe de **7,11 % à 0,55 %**. La longueur,
 *     elle, se DÉRIVE et se corrobore : `|v| × trainee × TILE_PX` = 23 px monde (52 d'écran)
 *     contre 16 (36) — et le test « couvre EXACTEMENT L cellules » plus le relevé
 *     `rects/vivantes` = 3,00 la pinnent, faute d'un seuil optique qui tienne sur les deux
 *     (la goutte fine passe SOUS la luminance de l'herbe nue : voir plus bas).
 *
 * CE QU'ON N'A PAS PU MESURER ICI, et il faut le dire : le COÛT EN IMAGES PAR SECONDE. Sur
 * ce poste, pendant que d'autres sessions compilaient, un ciel NU a été relevé à **937 ms
 * par image** — un surcoût de deux millisecondes s'y noie, et le relevé a rendu « voile
 * 1 041 contre plein 1 011 », c'est-à-dire des particules au coût NÉGATIF. D'où le
 * chronomètre interne, qui mesure la couche et non la machine.
 *
 * CE QUI N'EST QUE **SUSPECTÉ**, et qu'il faut dire : que retirer la branche de grain du
 * fragment ait RENDU du temps. L'interrupteur de mesure (`grainActif`) éteint les
 * PARTICULES, pas l'ancien fragment — celui-ci n'existe plus, et personne n'a remesuré la
 * branche de `main`. Le raisonnement (le fragment shadait ~920 000 fragments par image avec
 * un hash de permutation ET un `vnoise` par pixel, quand le rideau de particules en couvre
 * deux ordres de grandeur de moins) est de l'ARITHMÉTIQUE, pas un relevé. Le budget
 * (`BUDGET_PARTICULES`) reste la constante qu'on baisse si le chiffre mesuré remonte.
 *
 * ═══ L'ÉCLABOUSSURE A ÉTÉ RETIRÉE (2026-08-23) — ET ELLE NE DÉPLACE AUCUN CHIFFRE ═══
 *
 * Une goutte qui touchait rendait deux pixels de 4 px à alpha 0,34 : Alexis l'a jugée « trop
 * prononcée » et le mécanisme est supprimé (raison et détail dans l'en-tête de
 * `meteo-particules.ts`). LES RELEVÉS CI-DESSUS TIENNENT TELS QUELS, et ce n'est pas une
 * commodité — c'est MESURÉ : la gerbe pesait **3,0 % des rectangles sous la pluie et 1,8 %
 * sous l'orage** (2 011 contre 1 950 par image au cœur, 60 Hz, headless). Mieux : le relevé
 * du smoke (« 1 827 pour 609 », soit 3,00) est DÉJÀ celui de la traînée seule — sous
 * swiftshader une image dure ~900 ms quand une gerbe vit 90, si bien que l'obturateur n'en
 * attrapait presque jamais. C'est le même fait qui avait obligé à compter les gerbes plutôt
 * qu'à les photographier ; il rend ici le retrait gratuit.
 *
 * ═══ CE QUI RESTE DE LA RECETTE DE LA MAISON ═══
 *
 *   • pas de post-FX (il rendrait blanc sous swiftshader, et coûterait le seul juge visuel
 *     du projet) — ni pour le voile ni pour le grain ;
 *   • TOUT est quantifié sur UNE GRILLE DE PIXELS D'ART — mais elle n'est plus la même pour
 *     tous. Le voile et le vent de cendre restent sur les 4 px des FX de lumière ; **le
 *     flocon et le blizzard sont descendus à 2 px** (`GRAIN_FLOCON`, Alexis 2026-08-26 : « la
 *     taille des flocons divisée par 2 ») et **la goutte à 1 px monde**, la grille de l'art
 *     (`ProfilChute.grainPx`), et c'est ce qui fait sa finesse. Dans les deux cas ce sont des
 *     CARRÉS DURS, jamais un dégradé lissé, jamais un rectangle tourné (qui baverait en bords
 *     lissés : la traînée inclinée se peint en ESCALIER, voir `traineeEnRuns`). CE QUE ÇA
 *     COÛTE est le nombre qui décide du budget : la pluie rend **3** rectangles par goutte
 *     (MESURÉ : 1 827 pour 609) et l'orage **6,4** (3 323 pour 518), parce que l'escalier a
 *     autant de marches que la pente en fait sur la longueur — et la longueur en CELLULES a
 *     quadruplé en passant à 1 px. Monter `vent` ou `trainee` casserait ça en silence : le
 *     test `meteo-particules.test.ts` porte un plafond PAR PROFIL, c'est là que ça se verra ;
 *   • l'opacité va par CRANS — deux, lointain et proche — jamais en rampe : le patron de la
 *     brume, qui postérise pour la même raison ;
 *   • le hash du voile est le polynôme de permutation de la brume (34x²+x mod 289), jamais un
 *     `fract(sin·43758)` : c'est le seul risque réel de divergence swiftshader/GPU ;
 *   • le souffle du voile est REPLIÉ côté CPU et INTÉGRÉ (`off += vitesse·dt`) — un `uT`
 *     multiplié par un vent variable accélère sans borne (bug MESURÉ de la brume, ×15 à
 *     10 min d'uptime) ;
 *   • sortie PRÉMULTIPLIÉE : `vec4(teinte·a, a)` — le contrat du pipeline Phaser 4 (blend
 *     NORMAL = ONE, ONE_MINUS_SRC_ALPHA, du fixed-function). Non prémultiplié = le mur blanc ;
 *   • blend NORMAL et pas MULTIPLY, DÉLIBÉRÉMENT : la doctrine du voile de nuit partage la
 *     lumière (qui multiplie) de la MATIÈRE en suspension (qui se mêle et a le droit de
 *     relever les noirs). La pluie, la neige et le brouillard sont de la matière entre l'œil
 *     et le monde — exactement l'air d'une zone. C'est la nuit qui les assombrit, par `uDay`,
 *     comme la brume s'assombrit elle-même ; le grain, lui, est assombri ICI par la MÊME
 *     formule, écrite une seconde fois en connaissance de cause (`teinteDeNuit`) parce qu'il
 *     est au-dessus du voile d'ambiance et que rien d'autre ne l'éteindrait.
 *
 * ═══ UNE LIMITE, MESURÉE, QU'IL FAUT DIRE ═══
 *
 * La rampe vaut `RAMPE × LARGEUR` : 9 tuiles pour la pluie (la lisière traverse l'écran en
 * un quart de sa largeur — elle se VOIT venir), mais 240 pour le blizzard, dont la bande fait
 * la carte entière. L'écran en montre ~35 EN LARGEUR (et 20 en hauteur — MESURÉ le 2026-08-25 :
 * 1280 × 720 à zoom 2,25 ; le « ~35 » d'ici a été lu comme une HAUTEUR et a fait poser un rayon
 * de brouillard hors cadre) : le blizzard n'a donc PAS de lisière lisible, par
 * construction et non par défaut de rendu — c'est le « carte entière par calibrage » de R1, et
 * R9 le compense en l'annonçant la veille au crépuscule. Les autres types, eux, tiennent le
 * contrat géométriquement.
 *
 * ═══ LE BROUILLARD EST LE SEUL CIEL À DEUX ÉTAGES (2026-08-25) ═══
 *
 * Les quatre autres ciels sont UN aplat plein cadre. Le brouillard, lui, était le même aplat —
 * uniforme à ~0,44 d'opacité partout — et c'était son défaut : *« pas assez occultant »*. Un
 * aplat ne peut pas être à la fois assez dense pour fermer l'horizon et assez mince pour qu'on
 * voie où l'on met les pieds. Il faut donc deux choses à la fois, et c'est le patron de Project
 * Zomboid (référence d'Alexis) :
 *
 *   1. **ÇA S'OUVRE AUTOUR DE L'ŒIL.** L'opacité suit le RAYON depuis l'avatar : mince dans
 *      `r0` tuiles, plein à `r1`. La géométrie est CONTINUE sur tout le rayon (bornes exactes),
 *      et la sortie reste CONTINUE — on a essayé de la postériser en crans comme la brume, et
 *      c'est justement ce qui fabriquait le vignettage qu'on fuyait : postériser un RAYON ne
 *      peut rendre que des anneaux (détail sur `ReglageBrouillard.crans`). Le voile est déjà
 *      planché sur la grille de 4 px de l'art, il est donc pixellisé là où ça compte. Et le
 *      rayon est OURLÉ par la houle : sans ça le cercle EST un cercle, c'est-à-dire une aide
 *      d'interface.
 *
 *   2. **ÇA COLLE AU SOL, ET LES OBJETS HAUTS EN DÉPASSENT.** Le voile se dédouble : une NAPPE
 *      au sol qui mange le sol au loin, et le VOILE D'AIR d'origine (`METEO_DEPTH`, au-dessus
 *      de tout) devenu mince. Un arbre lointain est peint APRÈS la nappe et ne reçoit que
 *      l'air : au loin le sol part à ~0,92 d'opacité et une cime émergée à ~0,37. **C'est cet ÉCART,
 *      et rien d'autre, qui fait le « ça dépasse »** — la nappe seule donnerait des arbres
 *      posés sur du blanc, l'air seul l'aplat d'avant. Les deux étages sont UNE passe, deux
 *      familles d'instances (`uNappe`) : un second fragment aurait fait deux brouillards qui
 *      respirent différemment.
 *
 *   3. **ET LA NAPPE A UNE ÉPAISSEUR.** Posée sous les sprites, elle les laissait ENTIERS :
 *      l'arbre était debout *sur* le brouillard, pas *dedans*. Alexis, le même jour : « on ne
 *      doit voir que ce qui dépasse du tiers le plus haut du houppier des bouleaux ». La nappe
 *      est donc une PILE DE BANDES horizontales à profondeurs échelonnées, **dans la bande des
 *      houppiers** — un brouillard d'épaisseur `HAUTEUR_NAPPE_PX` au pixel près. Doctrine
 *      complète plus bas, au-dessus de `TIE_NAPPE`, avec ce que ça emporte (les toits).
 *
 * PORTÉE ASSUMÉE : le brouillard SEUL. Le blizzard tient son identité de « le blanc qui efface »
 * (COLD 55, le type le plus létal) — lui creuser un cercle lisible affaiblirait une conséquence
 * de JEU, pas un défaut de rendu. C'est une décision à prendre, pas un effet de bord à subir.
 *
 * ═══ CINQ CIELS QUI SE NOMMENT SANS HUD ═══
 *
 * Deux joueurs doivent pouvoir se dire « c'est de la neige ». On sépare donc sur TROIS axes à
 * la fois, jamais sur la seule teinte : la FORME du grain (traits étirés dans le sens de la
 * vitesse / carrés qui tanguent / rien), sa PHYSIQUE (la goutte file à 9 tuiles/s quasi
 * verticale, le flocon flâne à 1,2 en flottant, le blizzard RASE — son vent dépasse sa
 * chute), et le VOILE de fond (sombre bleuté pour la pluie et l'orage, gris pâle pour le
 * brouillard, blanc pour la neige, blanc opaque pour le blizzard).
 */
import Phaser from 'phaser'
import { frontMeteoPos, meteoIntensityAt, type MeteoAspect, type MeteoFront } from '@ashes/sim'
import { TILE_PX, crownDepth } from '../../render/framing'
import { hauteurPx, VARIANTES } from '../../render/arbre-art'
import { ChampNeige } from './meteo-melange'
import {
  BUDGET_PARTICULES,
  ChampParticules,
  PROFILS,
  rampeDe,
  traineeEnRuns,
  type ProfilChute,
  type Run,
} from './meteo-particules'

/**
 * ENTRE L'ŒIL ET TOUT LE RESTE. Au-dessus du voile d'ambiance dans ses DEUX modes (8 en
 * éclairé, 1 100 000 sinon) : la pluie tombe devant le monde, pas dans une strate du monde.
 * Elle s'assombrit donc elle-même la nuit (`uDay`), comme la brume — sous le voile, elle aurait
 * été éteinte par le multiply au lieu d'être une matière qu'on regarde à travers.
 * Sous les lucioles (1 250 000) et loin sous l'overlay du HUD.
 */
export const METEO_DEPTH = 1_120_000

/**
 * LE CIEL D'UN FRONT, TEL QUE LA COUCHE LE REÇOIT (R14) — deux aspects et un champ, jamais un
 * aspect seul. `WorldScene` le bâtit une fois par image sur la façade du gel ; la couche en
 * fait un troupeau mélangé (les particules) et un voile mélangé (le shader).
 */
export interface CielDuFront {
  /** L'aspect DOUX du front — sa classe élue : `pluie`, `orage`, `brouillard`, `vent_de_cendre`. */
  readonly doux: MeteoAspect
  /** Son aspect FROID (`neige`, `blizzard`) — `null` pour un ciel qui ne peut pas neiger. */
  readonly froid: MeteoAspect | null
  /** La part de froid BRUTE en (x, y), tuiles monde — `partDeNeige(T₀)` de `/sim`. La couche
   *  l'échantillonne et la lisse : l'appelant n'a qu'à savoir la lire en un point. */
  readonly mesure: (x: number, y: number) => number
}

/** La constante de temps du lissage TEMPOREL du voile, en secondes. Le voile est un aplat :
 *  il ne peut pas montrer une lisière, alors il la traverse lentement. */
const MIX_TAU_S = 0.55

/** LE GRAIN EST DEVANT LE VOILE — il tombe *dans* la matière, pas derrière elle. Un cran
 *  au-dessus, et toujours sous les lucioles. */
export const METEO_GRAIN_DEPTH = METEO_DEPTH + 500

/**
 * ═══ LA NAPPE EST UNE PILE DE BANDES, ET C'EST ÇA QUI LUI DONNE UNE HAUTEUR ═══
 *
 * Une nappe d'UN SEUL quad, posée sous tous les sprites, ne peut que les laisser ENTIERS : un
 * arbre y est debout **sur** le brouillard, pas **dedans**. Alexis (2026-08-25) : *« on ne doit
 * voir que ce qui dépasse du tiers le plus haut du houppier des bouleaux ; le reste plus bas ne
 * doit pas être visible dans un brouillard à 100 % loin du joueur »*. Il faut donc COUPER les
 * silhouettes à une hauteur, pas les épargner en bloc.
 *
 * LE TRI Y SAIT DÉJÀ LE FAIRE, et c'est exact — pas une approximation :
 *
 *   Un sprite dont les pieds sont à la ligne monde `F` peint les lignes `[F − haut, F]`, et son
 *   pixel de la ligne `r` se trouve donc à la HAUTEUR `F − r` au-dessus du sol. Une bande de
 *   brouillard qui couvre la ligne `r`, dessinée à la profondeur `ySortDepth(r + H)`, recouvre
 *   exactement les sprites dont les pieds vérifient `F ≤ r + H` — c'est-à-dire exactement les
 *   pixels dont la hauteur ne dépasse pas `H`. Empiler ces bandes sur la vue, c'est un
 *   brouillard d'épaisseur `H`, au pixel près.
 *
 * LE PRIX, ET IL EST NOMMÉ : une bande porte UNE profondeur, donc UNE hauteur de coupe pour
 * toutes les lignes qu'elle couvre. La coupe d'un arbre tombe au `bandePx / 2` près de `H`.
 * C'est le seul réglage qui achète de la précision contre des objets à dessiner
 * (`ReglageBrouillard.bandePx`), et le scénario `brouillardsol` MESURE cette erreur sur de
 * vrais bouleaux au lieu de la raisonner.
 *
 * ⚠ SEULE LA NAPPE EST EN BANDES. Le voile d'AIR reste un quad unique au-dessus de tout
 * (`METEO_DEPTH`) : c'est lui qui voile les cimes qui dépassent. Le bander aussi ferait
 * recouvrir les cimes par la bande d'au-dessus, et le « ça dépasse » s'effondrerait.
 */

/**
 * ═══ LA PILE VIT DANS LA BANDE DES HOUPPIERS, ET IL A FALLU LA MESURE POUR LE VOIR ═══
 *
 * Premier jet : la pile était dans la bande de tri Y (`ySortDepth`). Elle marchait — et elle
 * ne coupait QUE LES FÛTS. Relevé par le scénario : **coupe médiane 20 px pour 51,3 attendus**,
 * c'est-à-dire pile la hauteur où le fût cède la place au houppier.
 *
 * La cause est dans l'architecture des profondeurs (`framing.ts`) : un arbre est peint en DEUX
 * sprites, le fût dans la bande de tri Y (~1 000) et le HOUPPIER dans une bande à lui
 * (`CROWN_BASE` = 900 000, au-dessus de TOUS les acteurs). Une nappe glissée sous les acteurs
 * ne peut donc jamais mordre une cime : elle passe dessous.
 *
 * On pose donc la pile dans la bande des houppiers, et le calcul est le même au mot près —
 * `crownDepth` est `CROWN_BASE + feetY × tilePx`, une profondeur proportionnelle aux pieds
 * exactement comme `ySortDepth`. Une bande à `crownDepth(r + H)` recouvre les houppiers dont
 * les pieds vérifient `F ≤ r + H` : exactement les pixels de cime sous la hauteur `H`.
 *
 * ⚠ CE QUE ÇA EMPORTE AVEC, ET IL FAUT LE DIRE. Une bande recouvre TOUT ce qui est sous elle,
 * pas seulement les cimes : fûts, acteurs, murs, et **les TOITS** (`ROOF_DEPTH` = 800 000, sous
 * les houppiers). Au loin, un toit est donc avalé entier, quelle que soit sa hauteur.
 *
 * CE N'EST PAS UN OUBLI, C'EST UNE EXCLUSION MUTUELLE. Avec un algorithme du peintre, un voile
 * inséré à une profondeur cache TOUT ce qui est en dessous : on ne peut donc donner une hauteur
 * qu'à UNE bande de profondeur à la fois. Les toits étant SOUS les houppiers, « la cime dépasse »
 * et « le toit dépasse » ne peuvent pas être vrais ensemble sans rouvrir l'ordre toit/houppier
 * (or un toit au-dessus des cimes cacherait l'arbre planté devant la maison). Alexis a nommé le
 * HOUPPIER DU BOULEAU : c'est lui qu'on sert. Le toit est un chantier à part — il demanderait
 * une couche de toit consciente de sa hauteur, pas un réglage.
 *
 * Et parce que la pile est au-dessus de tout le tri Y, **une seule pile suffit** : la nappe
 * qu'on avait sous les sprites était redondante avec celle-ci. On n'en paie qu'une.
 */

/** Départage de la bande contre un houppier de MÊMES pieds : la bande passe après, donc elle
 *  l'avale. Les houppiers, eux, n'ont pas de `TIE_*` — ils ne se trient que sur leurs pieds. */
const TIE_NAPPE = 0.5

/** Plafond du nombre de bandes vivantes. Il borne la mémoire ET le coût : sous ce plafond, un
 *  `bandePx` trop fin ÉLARGIT les bandes au lieu d'en créer mille (voir `posterLesBandes`). */
const BANDES_MAX = 48

/** La profondeur d'une bande AVANT sa première pose. Elle ne sert qu'à naître : `posterLesBandes`
 *  la recalcule à chaque image, et une bande jamais posée est invisible. */
const NAPPE_DEPTH_INITIALE = 900_000

/**
 * CE QUE PÈSE LE BROUILLARD, ÉTAGE PAR ÉTAGE. Les seuls nombres du dispositif.
 *
 * `nappe` et `air` se lisent pareil : `[base, part de houle, facteur au PRÈS]`. L'opacité vaut
 * `(base + houle × part) × intensité × mix(près, 1, rayon)` — donc `près` est ce qui reste du
 * voile DANS le cercle lisible, et 1 ce qu'il pèse au loin.
 */
export interface ReglageBrouillard {
  /** Rayon du cercle lisible, en tuiles : dedans, on voit où l'on met les pieds. Trois, soit
   *  près de deux fois la portée d'un bras — de quoi lire le sol qu'on foule et ce qu'on va
   *  ramasser, pas de quoi choisir sa route. */
  r0: number
  /**
   * Rayon de l'occultation pleine, en tuiles.
   *
   * MESURÉ, et le premier jet s'est trompé dessus : à zoom 2,25 sur une toile de 1280 × 720,
   * **le cadre fait 35,6 tuiles de large et 20,0 de haut** — donc 17,8 de l'œil au bord
   * latéral, 10,0 au bord haut, 20,4 au coin. (L'en-tête de cette couche disait « ~35 tuiles
   * de haut » : c'est la LARGEUR, et s'y fier avait posé `r1` à 19, c'est-à-dire une densité
   * pleine qui n'existait NULLE PART à l'écran. Le scénario `brouillardsol` a rougi sur sa
   * propre prémisse — « les coins sont à 16,9 tuiles, r1 = 19 » — avant de rien conclure.)
   *
   * 11 : le plein est atteint au-delà du bord HAUT (10,0) et bien avant les coins, mais loin
   * après le pas. Le brouillard ferme l'horizon sans jamais fermer le pied.
   */
  r1: number
  /** De combien la houle déforme ce rayon, en tuiles. SANS LUI LE CERCLE EST UN CERCLE, et
   *  une pastille géométrique collée à l'avatar se lit comme une aide d'interface. */
  ourlet: number
  /**
   * Crans d'opacité du rayon — 0 = rampe continue.
   *
   * **LIVRÉ À 0, ET C'EST UN RENVERSEMENT MESURÉ.** La maison postérise ses voiles (la brume
   * et ses trois crans), et le premier jet a suivi la doctrine : rayon en 5 crans. REGARDÉ,
   * ça rend un ARC CONCENTRIQUE net autour de l'avatar — une cuvette, exactement le
   * vignettage d'interface qu'on voulait éviter (planches `brouillardsol-2/3` du 2026-08-25,
   * contre `-4-continu`).
   *
   * La raison est que les crans de la brume ne postérisent pas un RAYON : ils postérisent un
   * champ de BRUIT, dont les paliers sont des taches, pas des anneaux. Un champ radial
   * quantifié ne peut donner que des cercles. La DA n'y perd rien : le voile est déjà planché
   * sur la grille de 4 px de l'art (`flatPx`), donc pixellisé dans l'ESPACE — on ne lui
   * ajoute pas des marches dans l'OPACITÉ.
   */
  crans: number
  /** LA NAPPE : ce qui mange le sol au loin. */
  nappe: [number, number, number]
  /** LE VOILE D'AIR : ce qui voile les silhouettes qui dépassent. Mince, DÉLIBÉRÉMENT — c'est
   *  son rapport à la nappe qui fait tout le dispositif. Au loin, le sol part à ~0,77 d'opacité
   *  et un tronc à ~0,37 : l'écart EST le « ça dépasse ». */
  air: [number, number, number]
  /**
   * L'ÉPAISSEUR DE LA NAPPE, en pixels monde — la hauteur au-dessus du sol jusqu'à laquelle
   * le brouillard mange les silhouettes. **DÉRIVÉE, JAMAIS POSÉE** : voir `HAUTEUR_NAPPE_PX`.
   */
  hauteur: number
  /**
   * Le PAS de la pile, en pixels monde — et depuis l'écume, il porte DEUX choses à la fois :
   *
   *   • **l'épaisseur du fondu** au bas d'une cime émergée. Le dégradé court de
   *     `hauteur − bandePx / 2` à `hauteur + bandePx / 2` : monter ce nombre adoucit le bord.
   *   • **la précision de la coupe** : elle tombe au `bandePx / 2` près. Les deux tirent en
   *     sens contraire, mais moins qu'il n'y paraît — un bord FONDU pardonne une imprécision
   *     qu'un bord franc exhibait.
   *
   * Les quads font `2 × bandePx` (chevauchement de moitié), donc le coût en fragments vaut
   * deux plein-cadres ; leur NOMBRE, lui, reste la hauteur de vue divisée par le pas.
   */
  bandePx: number
}

/**
 * L'ÉPAISSEUR DU BROUILLARD — **DÉRIVÉE DU BOULEAU**, parce que c'est le bouleau qu'Alexis a
 * nommé : *« on ne doit voir que ce qui dépasse du tiers le plus haut du houppier des
 * bouleaux »*. Elle vaut donc le sommet du bouleau moins le tiers de son houppier — et si un
 * jour on redessine le bouleau, elle suit toute seule (`arbre-art.ts` est la source, ici on ne
 * recopie aucun nombre).
 *
 * CE QUE ÇA DONNE SUR LES AUTRES ESSENCES, calculé sur la table de `arbre-art` — Alexis
 * demandait la COHÉRENCE, la voici, et c'est une hiérarchie lisible :
 *
 *     bouleau      64 px de haut  →  13 px émergent  =  33 % du houppier
 *     tree         64             →  13              =  30 %
 *     chêne du pré 64             →  13              =  25 %
 *     saule        64             →  13              =  24 %   (cime basse et large)
 *     pin          80             →  29              =  45 %
 *     vieux pin    80             →  29              =  65 %   (le parasol)
 *     old_tree     96             →  45              =  70 %   (le gros bois domine)
 *     baliveau     48             →   0              =   0 %   ← ENGLOUTI, et c'est juste
 *
 * LE BALIVEAU DISPARAÎT ENTIÈREMENT (48 px < 51,3) et on ne corrige pas : une jeune tige noyée
 * dans un brouillard épais est exactement ce que la règle dit. Ça se DIT, ça ne s'amollit pas.
 */
const BOULEAU = VARIANTES.bouleau!.mesures
export const HAUTEUR_NAPPE_PX = hauteurPx(BOULEAU) - BOULEAU.houppierS / 3

const BROUILLARD: ReglageBrouillard = {
  r0: 3,
  r1: 11,
  ourlet: 4,
  crans: 0,
  // LA NAPPE VA JUSQU'À LA NOYADE, et ce n'est pas un excès de zèle : Alexis a écrit « le reste
  // plus bas NE DOIT PAS ÊTRE VISIBLE dans un brouillard à 100 % loin du joueur ». À 0,5–0,76
  // (le premier jet), la partie noyée d'un houppier restait un FANTÔME PÂLE, et la coupe se
  // lisait alors comme un TRAIT en travers de ce fantôme — l'arbre avait l'air tranché, pas
  // immergé (planche `brouillardsol-2-livre` du 2026-08-25, avant/après). Une nappe opaque
  // rend le trait invisible : on ne voit plus une ligne sur une cime, on voit une cime qui sort
  // d'une mer. C'est l'opacité, et non le tracé de la coupe, qui fait lire le brouillard.
  nappe: [0.86, 0.12, 0.14],
  air: [0.3, 0.14, 0.1],
  hauteur: HAUTEUR_NAPPE_PX,
  // 12 ET NON 8 : depuis l'écume, ce nombre est d'abord l'ÉPAISSEUR DU FONDU. À 8 le bord
  // restait sec ; à 12, le fondu court sur 12 px, soit près d'un tiers du houppier d'un
  // bouleau (38 px) — assez pour que la cime sorte de la brume au lieu d'y être posée.
  bandePx: 12,
}

/** L'ordre des ASPECTS dans l'uniforme `uType` — le fragment branche dessus. L'aspect, pas
 *  le type élu : depuis R11 la neige et le blizzard se dérivent au point (`aspectAuPoint`),
 *  et c'est `WorldScene` qui le lit à l'œil du joueur et le passe ici. */
const TYPE_INDEX: Record<MeteoAspect, number> = { pluie: 0, brouillard: 1, neige: 2, orage: 3, blizzard: 4, vent_de_cendre: 5 }

const FRAGMENT = /* glsl */ `
#pragma phaserTemplate(shaderName)

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 outTexCoord;

uniform vec4 uQuad;     // le RECT MONDE de ce quad : origine xy, taille zw, en px
uniform float uTilePx;
uniform float uAxis;    // 0 = la bande traverse en X · 1 = en Y
uniform float uLo;      // bord bas de la bande sur cet axe, en TUILES
uniform float uHi;      // bord haut
uniform float uRampe;   // RAMPE x LARGEUR, en tuiles — la pente bord vers coeur
uniform float uType;    // 0 pluie · 1 brouillard · 2 neige · 3 orage · 4 blizzard · 5 vent de cendre
uniform float uType2;   // l'aspect FROID du meme front (neige/blizzard) — = uType s'il n'en a pas
uniform float uMix;     // 0..1 — la part de uType2 dans le voile, au point de l'oeil (R14)
uniform vec2 uSouffle;  // derive LENTE du voile, integree et repliee cote CPU
uniform float uDay;     // 0 nuit · 1 plein jour
uniform float uFlash;   // 0..1 — l'embrasement de l'eclair (l'orage seul)
// ── LE BROUILLARD A DEUX ETAGES (voir l'en-tete) : la MEME passe, deux instances. ──
uniform float uNappe;   // 0 = le voile d'AIR (au-dessus de tout) · 1 = la NAPPE (sous les sprites)
uniform vec2 uOeil;     // l'oeil du joueur, en TUILES monde — le centre du cercle lisible
uniform float uR0;      // rayon du cercle lisible, en tuiles
uniform float uR1;      // rayon de l'occultation pleine, en tuiles
uniform float uOurlet;  // de combien la houle deforme ce rayon, en tuiles (0 = un cercle net)
uniform float uCrans;   // crans d'opacite du rayon (0 = rampe continue, sans posterisation)
uniform vec3 uNap;      // la NAPPE : base, part de houle, facteur au PRES
uniform vec3 uAir;      // le VOILE D'AIR : base, part de houle, facteur au PRES

const float GRAIN = 4.0;

float permute(float x) { return mod((x * 34.0 + 1.0) * x, 289.0); }
float cellHash(vec2 c) {
  vec2 p = mod(c, 289.0);
  return fract(permute(permute(permute(p.x) + p.y) + p.x) / 289.0);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = cellHash(i);
  float b = cellHash(i + vec2(1.0, 0.0));
  float c = cellHash(i + vec2(0.0, 1.0));
  float d = cellHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/**
 * LE VOILE D'UN CIEL — sa teinte et son opacite, pour l'aspect t. Extraite de main()
 * (PAS D'ACCENT GRAVE ICI : ce commentaire vit DANS le template literal du fragment — un
 *  backtick le fermerait, et le build casse chez vite, pas chez tsc. Piege paye deux fois.)
 * (R14) parce qu'on l'appelle DEUX FOIS : sous du gresil, le ciel est une proportion de deux
 * aspects, et le voile se mele comme le troupeau de particules se mele.
 */
void cielDe(in float t, in float houle, in float I, in float rad, in float ecume, out vec3 teinte, out float a) {
  bool brouillard = t > 0.5 && t < 1.5;
  bool neige = t > 1.5 && t < 2.5;
  bool orage = t > 2.5 && t < 3.5;
  bool blizzard = t > 3.5 && t < 4.5;
  bool cendre = t > 4.5;

  // ── LE VOILE, ET RIEN QUE LUI : la matiere en suspension, propre a chaque ciel.
  //
  // LE GRAIN N'EST PLUS ICI. Gouttes et flocons sont de VRAIES PARTICULES (module
  // meteo-particules.ts) : une branche de grain dans ce fragment les dessinerait une
  // SECONDE fois, et les deux motifs se battraient — l'un physique, l'autre translate.
  // (Pas d'accent grave dans ce commentaire : le fragment EST un template literal, et un
  //  backtick le fermerait — le build casse chez vite, pas chez tsc. Piege deja paye.)
  //
  // Il RESPIRE par grandes plaques (la houle, calculee UNE fois dans main et passee ici :
  // les deux voiles d'un gresil doivent respirer ENSEMBLE, sans quoi le melange bat).
  // ── LA NAPPE N'APPARTIENT QU'AU BROUILLARD. Tout autre ciel n'a pas d'etage bas : on rend
  // un alpha nul, la passe se jette au discard de main(), et le rendu des quatre autres ciels
  // reste EXACTEMENT celui d'avant — ni calcul, ni arrondi de plus. (En pratique l'instance
  // basse est meme rendue invisible cote CPU des que le ciel n'est pas du brouillard : cette
  // garde est la ceinture, pas les bretelles.)
  if (uNappe > 0.5 && !brouillard) {
    teinte = vec3(0.0);
    a = 0.0;
    return;
  }

  if (brouillard) {
    // LE BROUILLARD : dense, PALE, sans grain qui tombe — c'est son signalement, et c'est
    // pour ca qu'il n'a AUCUNE particule. Il mange la distance, il n'assombrit pas
    // (COLD.brouillard = 0 : le ciel dit la meme chose).
    //
    // IL A DEUX ETAGES, ET C'EST TOUT SON SUJET (voir l'en-tete) :
    //   • la NAPPE, sous les sprites — c'est elle qui MANGE LE SOL au loin, et c'est parce
    //     qu'elle passe SOUS eux que les arbres, les murs et les acteurs en DEPASSENT ;
    //   • le VOILE D'AIR, au-dessus de tout — mince, il ne fait que voiler ces silhouettes.
    // Leur RAPPORT est le seul nombre qui compte : nappe seule = des arbres poses sur du
    // blanc ; air seul = l'aplat uniforme d'avant.
    //
    // Les deux se creusent du MEME rayon (rad) : plein au loin, mince autour de l'oeil.
    teinte = vec3(0.78, 0.80, 0.82);
    vec3 g = uNappe > 0.5 ? uNap : uAir;
    a = (g.x + g.y * houle) * I * mix(g.z, 1.0, rad);
    // LA RAMPE DE L'ECUME, EN TRANSMITTANCE (voir plus haut). ecume vaut 1 pour le voile
    // d'air, qui n'est pas une bande : il repasse alors par l'identite, au bit pres.
    if (ecume < 0.999) a = 1.0 - pow(1.0 - clamp(a, 0.0, 1.0), ecume);
  } else if (blizzard) {
    // LE BLIZZARD : le blanc qui efface. Le voile le plus lourd des cinq — on ne voit plus
    // ou l'on va, et c'est la CONSEQUENCE DE JEU du type le plus letal (COLD 55).
    teinte = vec3(0.88, 0.90, 0.94);
    a = (0.40 + 0.18 * houle) * I;
  } else if (neige) {
    teinte = vec3(0.80, 0.84, 0.90);
    a = (0.16 + 0.09 * houle) * I;
  } else if (cendre) {
    // LE VENT DE CENDRE : ni blanc ni bleu — un ocre gris, la couleur de ce qui a brule.
    // C'est le seul ciel CHAUD de la table, et c'est tout son signalement : on le reconnait
    // a ce qu'il ne ressemble a aucun des autres. Voile epais (il vient du sud en soufflant
    // la poussiere du brule) mais moins que le blizzard : il aveugle, il ne tue pas.
    teinte = vec3(0.42, 0.36, 0.30);
    a = (0.36 + 0.16 * houle) * I;
  } else if (orage) {
    // L'ORAGE : le plus SOMBRE des cinq — l'ardoise sous laquelle la foudre se lit.
    teinte = vec3(0.11, 0.13, 0.19);
    a = (0.40 + 0.12 * houle) * I;
  } else {
    // LA PLUIE : une ardoise bleutee, plus claire que l'orage.
    teinte = vec3(0.18, 0.21, 0.29);
    a = (0.30 + 0.10 * houle) * I;
  }
}

void main() {
  // Le monde a l'endroit (V texture monte, ty descend), PLANCHE au grain de l'art.
  // LE QUAD N'EST PLUS FORCEMENT LE MONDE ENTIER : la nappe est une PILE DE BANDES qui suit
  // la camera, chacune avec son propre rect. On repasse donc par l'origine du quad — a
  // uQuad = (0, 0, mondeW, mondeH), c'est mot pour mot le calcul d'avant.
  vec2 worldPx = uQuad.xy + vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uQuad.zw;
  vec2 flatPx = floor(worldPx / GRAIN) * GRAIN;
  vec2 tile = flatPx / uTilePx;
  vec2 cell = flatPx / GRAIN;

  // ── L'INTENSITE : la loi de meteoIntensityAt, au mot pres (0 dehors, 1 au coeur). ──
  float c = uAxis < 0.5 ? tile.x : tile.y;
  float d = min(c - uLo, uHi - c);
  if (d <= 0.0) discard;
  float I = uRampe <= 0.0 ? 1.0 : min(1.0, d / uRampe);
  if (I <= 0.004) discard;

  // ── LE MELANGE DES DEUX VOILES (R14) : uType est l'aspect DOUX du front, uType2 son
  // aspect FROID, uMix la part de froid au point de l'oeil (deja lissee cote CPU). A uMix
  // nul on repasse EXACTEMENT par la branche unique d'avant — un ciel franc ne paie rien,
  // ni en calcul ni en arrondi. ──
  // LA HOULE — le bruit lent qui fait respirer le voile, PARTAGE par les deux aspects.
  float houle = vnoise(cell / 26.0 + uSouffle);

  // ── LE RAYON DE L'OEIL — 0 dans le cercle lisible, 1 la ou le brouillard occulte plein.
  //
  // LA GEOMETRIE EST CONTINUE sur tout le rayon (bornes exactes : uR0 lisible, uR1 plein) ;
  // c'est la SORTIE qu'on posterise, comme la brume posterise ses crans — un degrade lisse
  // sur un jeu quantifie se lirait comme un vignettage de moteur 3D. uCrans = 0 rend la
  // rampe nue, pour comparer les deux a l'oeil.
  //
  // LE RAYON EST OURLE PAR LA HOULE (uOurlet, en tuiles) : sans elle, le cercle EST un
  // cercle — une pastille geometrique collee sur l'avatar, qui se lit comme une aide d'UI et
  // non comme de l'air. La houle etant le meme bruit lent qui fait respirer le voile, la
  // frange du cercle respire avec lui.
  float dTuiles = distance(tile, uOeil);
  float dOurle = dTuiles + (houle - 0.5) * uOurlet;
  float k = clamp((dOurle - uR0) / max(0.001, uR1 - uR0), 0.0, 1.0);
  float rad = uCrans < 0.5 ? k : floor(k * uCrans + 0.5) / uCrans;

  // ── L'ECUME : LE BAS D'UNE CIME QUI DEPASSE SE FOND, IL NE SE COUPE PAS ──
  //
  // Une bande peignant la MEME opacite sur toute sa hauteur, la cime emergee reposait sur un
  // bord RIGOUREUSEMENT DROIT (« c'est trop droit en l'etat actuel »). On veut que le bas du
  // morceau qui depasse se fonde dans le blanc.
  //
  // LA RECETTE : les bandes se CHEVAUCHENT DE MOITIE et chacune porte une rampe TRIANGULAIRE
  // (nulle a ses deux bords, pleine au milieu). Deux triangles decales d'une demi-longueur
  // SOMMENT A UNE CONSTANTE — la propriete de recouvrement de la fenetre de Bartlett — donc :
  //
  //   • le SOL, couvert par DEUX bandes en tout point, garde une opacite rigoureusement
  //     uniforme : le chevauchement ne se voit NULLE PART ;
  //   • le haut d'une cime, couvert par UNE SEULE bande (la plus haute qui l'atteigne), recoit
  //     la rampe NUE — il s'eteint en degrade continu sur bandePx pixels.
  //
  // On compose en TRANSMITTANCE (produit : 1 moins (1−a) puissance tri), jamais en alpha :
  // c'est la seule composition ou deux couches empilees rendent EXACTEMENT a. Additionner
  // les alphas rendrait le sol plus opaque au milieu d'une bande qu'a sa jointure, et le
  // chevauchement se lirait en RAYURES — le defaut meme qu'on corrige.
  float ecume = 1.0;
  if (uNappe > 0.5) {
    float pv = clamp((worldPx.y - uQuad.y) / max(1.0, uQuad.w), 0.0, 1.0);
    ecume = 1.0 - abs(2.0 * pv - 1.0);
  }

  vec3 c1;
  float a1;
  cielDe(uType, houle, I, rad, ecume, c1, a1);
  vec3 teinte;
  float a;
  if (uMix <= 0.002) {
    teinte = c1;
    a = a1;
  } else {
    vec3 c2;
    float a2;
    cielDe(uType2, houle, I, rad, ecume, c2, a2);
    // ON MELE EN PREMULTIPLIE puis on redivise : meler des couleurs DROITES ferait passer
    // l'ardoise de la pluie (0.18 a alpha 0.30) et le blanc de la neige (0.80 a alpha 0.16)
    // par un gris que ni l'un ni l'autre ne contient — le fondu virerait au sale.
    a = mix(a1, a2, uMix);
    teinte = a <= 0.0001 ? c1 : mix(c1 * a1, c2 * a2, uMix) / a;
  }
  // ── LA NUIT ASSOMBRIT LE CIEL LUI-MEME (patron de la brume, meme raison) : la couche est
  // AU-DESSUS du voile d'ambiance, donc rien d'autre ne l'eteindrait. La racine du jour, pas
  // le jour : la pluie de l'aube s'allume avant le sol, comme la brume. ──
  float eclat = sqrt(clamp(uDay, 0.0, 1.0));
  teinte *= mix(vec3(0.30, 0.34, 0.46), vec3(1.0), eclat);

  // ── L'EMBRASEMENT DE L'ECLAIR : un CADRAGE, pas un FX de lumiere — il n'est donc pas
  // quantifie (un embrasement au grain baverait en bandes, exception assumee de la DA).
  // Il ne joue QUE sous l'orage, et il porte le ciel entier d'un coup. ──
  if (uFlash > 0.001) {
    float f = uFlash * (0.30 + 0.70 * I);
    teinte = mix(teinte, vec3(0.86, 0.89, 1.0), min(1.0, f * 1.6));
    a = a + (1.0 - a) * min(0.62, f * 0.72);
  }

  if (a <= 0.004) discard;
  gl_FragColor = vec4(teinte * a, a); // PREMULTIPLIE — le contrat du pipeline
}
`

/** Période de repli de la dérive, en CELLULES : le bruit est périodique 289 cellules par
 *  axe — replier là-dessus est sans couture, et borne les coordonnées pour l'éternité. */
const PERIODE = 289

/**
 * Le cadre d'émission est élargi de cette marge, en tuiles : une traînée dépasse par le haut,
 * et une particule qu'on ferait naître pile sur le bord y clignoterait.
 *
 * ELLE A ÉTÉ RÉDUITE DE 3 À 1,5 (MESURÉ) : à 3 tuiles, le cadre d'émission faisait 1 082
 * tuiles² pour 712 tuiles² VISIBLES — un tiers des particules tombait hors champ, payé plein
 * tarif en physique et en rectangles pour n'être jamais vu. 1,5 tuile couvre la plus longue
 * traînée (5 cellules de 4 px, soit 1,25 tuile) avec de quoi ne pas clignoter, et rien de plus.
 */
const MARGE_TUILES = 1.5

/** La fenêtre du chronomètre de la couche, en ms : assez longue pour lisser une image
 *  malheureuse, assez courte pour qu'un relevé du smoke n'attende pas. */
const CHRONO_FENETRE_MS = 1000

/**
 * LA NUIT SUR LE GRAIN — la MÊME formule que le fragment (`mix(nuit, blanc, sqrt(day))`),
 * écrite une seconde fois en connaissance de cause : le grain est peint par le CPU, il ne
 * traverse pas le shader, et il est au-dessus du voile d'ambiance qui aurait pu l'éteindre.
 * Deux écrivains pour une formule est une dette : elle est ici, nommée, et le test la garde.
 */
export function teinteDeNuit(teinte: readonly [number, number, number], day: number): number {
  const eclat = Math.sqrt(Math.max(0, Math.min(1, day)))
  const nuit = [0.3, 0.34, 0.46] as const
  let couleur = 0
  for (let i = 0; i < 3; i++) {
    const f = nuit[i]! + (1 - nuit[i]!) * eclat
    couleur = (couleur << 8) | Math.max(0, Math.min(255, Math.round(teinte[i]! * f)))
  }
  return couleur
}

export class MeteoLayer {
  private shader: Phaser.GameObjects.Shader | null = null
  /** LA PILE DE BANDES de la nappe — la même passe que le voile d'air, découpée en tranches
   *  horizontales qui suivent la caméra, chacune à SA profondeur de tri Y (voir la doctrine
   *  plus haut). Rendues visibles pour le SEUL brouillard : les quatre autres ciels n'en
   *  paient aucune. */
  private nappes: Phaser.GameObjects.Shader[] = []
  /** Le rect MONDE de chaque bande, muté en place image après image — une fermeture neuve par
   *  bande et par image serait du déchet pur (patron `melange`). L'index 0 est le voile d'AIR. */
  private readonly quads: { x: number; y: number; w: number; h: number }[] = []
  /** Combien de bandes sont vivantes cette image. Le reste de la pile est éteint. */
  private bandesVives = 0
  /** L'œil du joueur, en TUILES — le centre du cercle lisible. */
  private oeil = { x: 0, y: 0 }
  /**
   * LE RÉGLAGE DU BROUILLARD, relu à chaque image — donc modifiable en session (console,
   * smoke) sans rebâtir. C'est le patron `crans` de `MistLayer`, et pour la même raison :
   * ce sont des nombres qui se calibrent EN REGARDANT, pas en jouant.
   */
  reglage: ReglageBrouillard = { ...BROUILLARD }
  /** Le grain, peint en rectangles durs : un seul objet, deux crans d'opacité par ciel —
   *  donc deux `fillStyle` par image, pas neuf cents. */
  private grain: Phaser.GameObjects.Graphics
  private readonly champ = new ChampParticules()
  private readonly runs: Run[] = []
  private souffle = { x: 0, y: 0 }
  private lastMs: number | null = null
  private axis = 0
  private lo = 0
  private hi = 0
  private rampe = 1
  private type = 0
  private type2 = 0
  private mix = 0
  private day = 1
  private flash = 0
  /** LE CHAMP DE NEIGE — la part de flocons, relevée sur une grille grossière ancrée au monde
   *  et relue en bilinéaire (voir `meteo-melange.ts`). Il porte tout le lissage SPATIAL. */
  private readonly champNeige = new ChampNeige()
  /** La part de froid du VOILE, lissée dans le temps — `null` tant qu'aucun front n'est peint
   *  (le premier relevé saisit au lieu de ramper depuis zéro). */
  private mixLisse: number | null = null
  /**
   * LE MÉLANGE PASSÉ AU TROUPEAU — un seul objet, muté en place image après image (patron
   * `ventFacade` de `WorldScene`) : une fermeture neuve par image serait du déchet pur.
   */
  private readonly melange: { froid: ProfilChute | null; doux: ProfilChute | null; part: (x: number, y: number) => number } = {
    froid: null,
    doux: null,
    part: (x: number, y: number) => this.champNeige.part(x, y),
  }
  /** La dernière intensité calculée au point du joueur — la sonde du smoke, et rien d'autre
   *  ne la lit : le rendu se juge sur des pixels, pas sur une variable. */
  intensiteAuJoueur = 0
  /** LA BANDE EFFECTIVEMENT DESSINÉE ce frame, en tuiles — relue par le smoke pour aller SE
   *  PLACER dedans (au cœur) ou dessus (sur la lisière). C'est la couche qui rend compte de
   *  ce qu'elle peint : le harnais n'a pas à recalculer une géométrie qu'il ne dessine pas. */
  bande: { axis: 'x' | 'y'; lo: number; hi: number } | null = null
  /**
   * LA SONDE DU GRAIN — lue par le smoke, par rien d'autre. `budget` est rappelé pour qu'un
   * relevé dise contre quoi il se juge, et `plafonne` dit si la cible a tapé le plafond
   * (auquel cas le rideau n'est plus proportionnel à l'intensité : c'est le budget qui parle).
   */
  readonly sonde = {
    vivantes: 0, cible: 0, rects: 0,
    budget: BUDGET_PARTICULES, plafonne: false,
    /** ═══ LE MÉLANGE (R14), LU PAR LE SMOKE ═══
     *  `flocons` + `gouttes` = `vivantes` : le rideau rend compte des DEUX troupeaux qu'il peint.
     *  `partIci` est la part de froid BRUTE au point de l'œil (ce que le champ dit) et `mixVoile`
     *  la même après le lissage temporel du voile — les deux, parce que leur ÉCART est le retard
     *  du voile, et qu'un scénario qui les confondrait ne pourrait pas le voir.
     *
     *  ⚠ LA MOYENNE DU CADRE N'EST PAS ICI, ET C'EST DÉLIBÉRÉ. Elle vit dans `champ.partFroid`,
     *  qui n'est calculé que par `champ.update` — donc PAS quand le grain est éteint, c'est-à-dire
     *  dans le montage même qui mesure le voile seul. La remonter d'ici l'aurait rendue fausse à
     *  l'endroit où on la lit : mieux vaut un nombre de moins qu'un nombre qui ment. */
    flocons: 0, gouttes: 0, partIci: 0, mixVoile: 0,
    /** Le champ de neige : combien de nœuds au dernier rebâti, et ce que les rebâtis coûtent
     *  par image en moyenne (même fenêtre que `msPhysique`). */
    noeuds: 0, msChamp: 0,
    /**
     * CE QUE LA COUCHE PREND SUR LE FIL PRINCIPAL, en ms par image — moyenne glissante sur
     * `FENETRE_MS` de physique (`champ.update`) et de peinture (les `fillRect`).
     *
     * POURQUOI SE CHRONOMÉTRER SOI-MÊME PLUTÔT QUE COMPTER LES IMAGES. Le relevé d'intervalles
     * d'images (`cadence`) mesure la MACHINE autant que la couche : sur ce poste, un ciel NU
     * a été relevé à 883 ms/image pendant que deux autres sessions compilaient — un surcoût de
     * 50 ms s'y noie, et un surcoût de 1 100 ms n'y veut rien dire. Le temps passé DANS la
     * couche, lui, reste lisible sous charge : c'est le nombre qui commande `BUDGET_PARTICULES`.
     * (Il ne couvre pas la rastérisation, qui vit chez swiftshader — d'où les deux instruments.)
     */
    msPhysique: 0,
    msPeinture: 0,
    images: 0,
  }
  /**
   * L'INTERRUPTEUR DU GRAIN — toujours vrai en jeu, BAISSÉ PAR LE SMOKE et par rien d'autre.
   *
   * Sans lui, on ne saurait pas ce que les particules coûtent : comparer « pas de ciel » à
   * « ciel complet » crédite les particules du temps que le VOILE prend (et du temps que la
   * branche de grain retirée du fragment a RENDU). Il faut trois étalons, pas deux — ciel nu,
   * voile seul, voile + grain — et c'est ce bouton qui donne le deuxième. Il sert aussi de
   * témoin optique : à même endroit et même heure, σ/µ doit MONTER quand on le relève.
   */
  grainActif = true

  constructor(
    scene: Phaser.Scene,
    private readonly mapWidth: number,
    private readonly mapHeight: number,
  ) {
    // L'INDEX 0 EST LE VOILE D'AIR, et son quad est le monde ENTIER — il ne bouge jamais.
    this.quads.push({ x: 0, y: 0, w: mapWidth * TILE_PX, h: mapHeight * TILE_PX })
    this.shader = this.creerVoile(scene, 0, 0, METEO_DEPTH)
    // LA PILE EST ALLOUÉE UNE FOIS POUR TOUTES. Créer et détruire des `Shader` par image
    // (la vue change de hauteur, donc le nombre de bandes aussi) recompilerait et rebâtirait
    // des objets soixante fois par seconde ; on en garde `BANDES_MAX` sous la main et on
    // éteint celles qui ne servent pas.
    for (let i = 0; i < BANDES_MAX; i++) {
      this.quads.push({ x: 0, y: 0, w: 1, h: 1 })
      this.nappes.push(this.creerVoile(scene, i + 1, 1, NAPPE_DEPTH_INITIALE))
    }
    this.grain = scene.add.graphics().setDepth(METEO_GRAIN_DEPTH).setVisible(false)
  }

  /**
   * POSER LA PILE DE BANDES SUR LA VUE — une fois par image, quand le ciel est du brouillard.
   *
   * Les bandes sont ANCRÉES À LA GRILLE DU MONDE (`floor(y / bandePx) * bandePx`) et non au
   * bord de la caméra : ancrées à la caméra, elles glisseraient d'un pixel à chaque pas et la
   * hauteur de coupe de chaque arbre TREMBLERAIT pendant qu'on marche. Ancrées au monde, un
   * arbre garde sa bande — donc sa coupe — tant qu'on ne le quitte pas des yeux.
   */
  private posterLesBandes(camera: Phaser.Cameras.Scene2D.Camera): void {
    const vue = camera.worldView
    // Le `bandePx` demandé peut être plus fin que ce que le plafond permet : on l'ÉLARGIT
    // alors, au lieu de tronquer la pile et de laisser le bas de l'écran sans brouillard.
    const bande = Math.max(this.reglage.bandePx, Math.ceil(vue.height / (BANDES_MAX - 3)))
    const y0 = Math.floor(vue.y / bande) * bande
    // TROIS BANDES DE MARGE depuis que les bandes SE CHEVAUCHENT DE MOITIÉ : chaque ligne doit
    // être couverte par DEUX bandes pour que la somme des triangles soit constante (voir
    // l'écume, dans le fragment). Une ligne couverte par une seule serait à MOITIÉ de son
    // opacité — une bande claire en travers de l'écran. Les bandes de rang 0 et n−1 ont
    // justement leur moitié non appariée HORS CADRE.
    const n = Math.min(BANDES_MAX, Math.ceil(vue.height / bande) + 3)
    // MARGE HORIZONTALE : le quad doit déborder la vue, sinon un pixel de bord reste nu
    // pendant l'interpolation de la caméra.
    const marge = TILE_PX * 2
    for (let i = 0; i < n; i++) {
      const haut = y0 + (i - 1) * bande
      const q = this.quads[i + 1]!
      q.x = vue.x - marge
      q.y = haut
      q.w = vue.width + marge * 2
      // LA HAUTEUR DU QUAD EST LE DOUBLE DU PAS : c'est ce qui fait le chevauchement de moitié.
      q.h = bande * 2
      const nappe = this.nappes[i]!
      nappe.setPosition(q.x, q.y).setDisplaySize(q.w, q.h)
      // LA PROFONDEUR EST TOUT LE DISPOSITIF : la bande couvre la ligne médiane `milieu`, et
      // se dessine à la profondeur d'un sprite dont les pieds seraient `hauteur` plus bas.
      // Elle avale donc exactement les sprites dont le pixel, ICI, est sous `hauteur`.
      // LA COUPE EST CENTRÉE SUR `hauteur`, PAS POSÉE À SON PIED. Le seuil de profondeur se
      // réfère au QUART haut du quad (`haut + bande / 2`), si bien que le dégradé de l'écume
      // court de `hauteur − bandePx / 2` (opaque) à `hauteur + bandePx / 2` (clair) : sa
      // MÉDIANE reste `hauteur`, donc le tiers haut du houppier du bouleau reste la promesse.
      // Le référer au milieu du quad décalerait tout le fondu d'une demi-bande vers le haut.
      const milieu = haut + bande / 2
      nappe.setDepth(crownDepth((milieu + this.reglage.hauteur) / TILE_PX, TILE_PX) + TIE_NAPPE)
      nappe.setVisible(true)
    }
    for (let i = n; i < this.bandesVives; i++) this.nappes[i]!.setVisible(false)
    this.bandesVives = n
  }

  /** Éteint toute la pile — hors brouillard, et hors front. */
  private eteindreLesBandes(): void {
    for (let i = 0; i < this.bandesVives; i++) this.nappes[i]!.setVisible(false)
    this.bandesVives = 0
  }

  /**
   * UNE PASSE, DEUX INSTANCES — le voile d'air et la nappe au sol partagent le MÊME fragment
   * et ne se distinguent que par `uNappe` et leur profondeur. Deux shaders séparés auraient
   * dupliqué le hash, la houle, la nuit et le contrat prémultiplié : quatre endroits où deux
   * brouillards auraient pu se mettre à respirer différemment.
   */
  private creerVoile(
    scene: Phaser.Scene,
    /** L'index de son rect dans `quads` — 0 = le voile d'air, 1.. = les bandes. */
    quad: number,
    nappe: number,
    depth: number,
  ): Phaser.GameObjects.Shader {
    const q = this.quads[quad]!
    return scene.add
      .shader(
        {
          name: nappe > 0.5 ? 'braises-meteo-nappe' : 'braises-meteo',
          fragmentSource: FRAGMENT,
          setupUniforms: (setUniform: (name: string, value: unknown) => void) => {
            setUniform('uQuad', [q.x, q.y, q.w, q.h])
            setUniform('uTilePx', TILE_PX)
            setUniform('uAxis', this.axis)
            setUniform('uLo', this.lo)
            setUniform('uHi', this.hi)
            setUniform('uRampe', this.rampe)
            setUniform('uType', this.type)
            setUniform('uType2', this.type2)
            setUniform('uMix', this.mix)
            setUniform('uSouffle', [this.souffle.x, this.souffle.y])
            setUniform('uDay', this.day)
            setUniform('uFlash', this.flash)
            // ── LE BROUILLARD À DEUX ÉTAGES — relus À CHAQUE IMAGE (patron `crans` de la
            // brume) : le réglage est un objet public, donc calibrable à l'œil en session
            // sans rebâtir, et lisible par le smoke.
            setUniform('uNappe', nappe)
            setUniform('uOeil', [this.oeil.x, this.oeil.y])
            setUniform('uR0', this.reglage.r0)
            setUniform('uR1', this.reglage.r1)
            setUniform('uOurlet', this.reglage.ourlet)
            setUniform('uCrans', this.reglage.crans)
            setUniform('uNap', this.reglage.nappe)
            setUniform('uAir', this.reglage.air)
          },
        },
        q.x,
        q.y,
        q.w,
        q.h,
      )
      .setOrigin(0, 0)
      .setDepth(depth)
      .setVisible(false)
  }

  /**
   * Chaque frame. `front` est le RECORD D'ÉLECTION du snapshot (ou rien) ; la bande, elle,
   * se RECALCULE du tick par `frontMeteoPos` — la même fonction que la sim interroge pour
   * décider qui a froid. `flash` vient de la foudre (voir `foudre-fx`), `joueur` sert la
   * sonde d'intensité, `camera` borne l'émission au cadre visible.
   */
  update(
    nowMs: number,
    front: MeteoFront | null,
    /** LE CIEL DE CE FRONT — ses DEUX aspects et la part de froid au point (R14), `null` sans
     *  front. Ce n'est plus UN aspect : un même front est pluie en plaine, neige sur les hauts
     *  et grésil entre les deux, dans la MÊME image. */
    ciel: CielDuFront | null,
    tick: number,
    day: number,
    flash: number,
    joueur: { x: number; y: number },
    camera: Phaser.Cameras.Scene2D.Camera,
    /** Ce que d'AUTRES particules occupent déjà du budget (la gerbe de la foudre). Le rideau
     *  se serre d'autant : les 650 sont un budget de MACHINE, partagé, jamais un par-système
     *  qu'on empilerait. Conséquence nommée : sous une frappe le rideau perd au plus 48
     *  gouttes (~7 %) pendant trois dixièmes de seconde. */
    reservees = 0,
    /** LE CAP DU VENT — le rideau penche désormais DANS SON SENS (`souffleDuCiel`), au lieu
     *  de pencher vers l'est quel que soit le front. Par défaut l'est : le rideau d'avant. */
    cap: { x: number; y: number } = { x: 1, y: 0 },
  ): void {
    const dtMs = this.lastMs === null ? 0 : Math.min(250, Math.max(0, nowMs - this.lastMs))
    const dt = dtMs / 1000
    this.lastMs = nowMs

    const bande = front ? frontMeteoPos(front, tick, this.mapWidth, this.mapHeight) : null
    if (!front || !bande || !ciel) {
      this.intensiteAuJoueur = 0
      this.bande = null
      this.mixLisse = null
      this.mix = 0
      this.sonde.mixVoile = 0
      this.sonde.partIci = 0
      this.champNeige.vider()
      this.shader?.setVisible(false)
      this.eteindreLesBandes()
      this.eteindreLeGrain()
      return
    }
    this.bande = bande

    this.axis = bande.axis === 'x' ? 0 : 1
    this.lo = bande.lo
    this.hi = bande.hi
    this.rampe = rampeDe(front)
    this.day = day
    this.flash = flash

    // ── LE CADRE, ET LE CHAMP DE NEIGE QUI LE COUVRE ──
    const vue = camera.worldView
    const cadre = {
      x0: vue.x / TILE_PX - MARGE_TUILES,
      y0: vue.y / TILE_PX - MARGE_TUILES,
      x1: (vue.x + vue.width) / TILE_PX + MARGE_TUILES,
      y1: (vue.y + vue.height) / TILE_PX + MARGE_TUILES,
    }
    // LE RELEVÉ SE CHRONOMÈTRE : il vit hors des deux fenêtres de `chronometrer` (physique et
    // peinture), et un coût qu'aucun instrument ne voit est un coût qui dérive.
    const tChamp = performance.now()
    if (ciel.froid) this.champNeige.maj(ciel.mesure, cadre, nowMs)
    else this.champNeige.vider()
    this.msChampBrut += performance.now() - tChamp

    this.melange.doux = PROFILS[ciel.doux]
    this.melange.froid = ciel.froid ? PROFILS[ciel.froid] : null
    this.type = TYPE_INDEX[ciel.doux]
    this.type2 = ciel.froid ? TYPE_INDEX[ciel.froid] : this.type

    // ── LA PART DE FROID DU VOILE — au point de l'œil, et LISSÉE DEUX FOIS ──
    //
    // Dans l'ESPACE par le champ (bilinéaire sur sa maille), et dans le TEMPS par cette
    // approche exponentielle. Le voile est la seule pièce du dispositif qui reste UNIFORME
    // plein cadre — un aplat ne peut pas montrer une lisière —, alors on lui interdit
    // l'à-coup : ce qu'il ne peut pas dire dans l'espace, il le dit lentement. Les particules,
    // elles, portent la vraie géographie du mélange.
    //
    // Le premier relevé d'un front SAISIT (pas de rampe depuis zéro) : sans ça, entrer sous
    // une averse de neige commencerait par une demi-seconde de pluie — et le smoke, qui se
    // téléporte, jugerait un ciel en train de se faire.
    const cible = ciel.froid ? this.champNeige.part(joueur.x, joueur.y) : 0
    if (this.mixLisse === null) this.mixLisse = cible
    else this.mixLisse += (cible - this.mixLisse) * Math.min(1, dt / MIX_TAU_S)
    this.mix = this.mixLisse
    // LA SONDE SE POSE ICI, ET PAS AVEC LE GRAIN — c'est une propriété du CIEL, pas du troupeau.
    // Posée dans `peindre`, elle tombait à zéro dès qu'on éteint le grain… c'est-à-dire dans le
    // montage même qui mesure le voile SEUL : le relevé accusait le mélange de ne pas tourner
    // alors qu'il tournait. Une sonde éteinte par le geste qui l'interroge ne prouve rien.
    this.sonde.mixVoile = this.mix
    this.sonde.partIci = ciel.froid ? cible : 0

    // Le voile dérive lentement, replié sur la période exacte du bruit (289 cellules) :
    // sans couture, et borné pour une session illimitée. Un repli sur une valeur arbitraire
    // (« modulo 1 s ») ferait sauter le champ à chaque tour — le bruit n'est périodique QUE
    // sur 289. La dérive INTÉGRÉE, jamais `vitesse × uptime` (voir l'en-tête).
    const plie = (u: number): number => ((u % PERIODE) + PERIODE) % PERIODE
    this.souffle.x = plie(this.souffle.x + 0.55 * dt)
    this.souffle.y = plie(this.souffle.y + 0.31 * dt)

    // La sonde : LA fonction de la sim, pas une copie — c'est le même nombre qui décide
    // du froid qu'il prend et du rideau qu'il voit. Une fois par image, pas par particule.
    this.intensiteAuJoueur = meteoIntensityAt(front, tick, this.mapWidth, this.mapHeight, joueur.x, joueur.y)

    // L'ŒIL — le centre du cercle lisible du brouillard. C'est la position PRÉDITE, la même
    // que la sonde d'intensité : le trou suit l'avatar image par image, sans le retard d'un
    // tick que prendrait la position interpolée du snapshot.
    this.oeil.x = joueur.x
    this.oeil.y = joueur.y

    this.shader?.setVisible(true)
    // LA NAPPE NE SE PAIE QUE SOUS LE BROUILLARD. Ailleurs la pile est ÉTEINTE, pas seulement
    // transparente : les bandes couvrent ensemble un plein cadre, c'est une passe de fragment
    // de plus par image — invisible dans le profil d'un GPU, pas dans celui de swiftshader,
    // qui est le seul juge optique du projet. Le brouillard n'est jamais l'aspect FROID d'un
    // front (`froid` ∈ {neige, blizzard}) : interroger l'aspect doux suffit.
    if (ciel.doux === 'brouillard') this.posterLesBandes(camera)
    else this.eteindreLesBandes()

    // ── LE GRAIN : de vraies particules, émises DANS LE CADRE seulement. ──
    if ((!this.melange.doux && !this.melange.froid) || !this.grainActif) { this.eteindreLeGrain(); return }
    const t0 = performance.now()
    this.champ.update(dt, this.melange, cadre, bande, this.rampe, reservees, cap)
    const t1 = performance.now()
    this.peindre(day)
    this.chronometrer(t1 - t0, performance.now() - t1, dtMs)
  }

  /** La moyenne glissante des deux temps, sur une fenêtre de `CHRONO_FENETRE_MS`. */
  private chronoPhysique = 0
  private chronoPeinture = 0
  /** Le temps passé dans `champNeige.maj` depuis le dernier relevé de la fenêtre. */
  private msChampBrut = 0
  private chronoImages = 0
  private chronoAge = 0
  private chronometrer(msPhysique: number, msPeinture: number, dtMs: number): void {
    this.chronoPhysique += msPhysique
    this.chronoPeinture += msPeinture
    this.chronoImages += 1
    this.chronoAge += dtMs
    if (this.chronoAge < CHRONO_FENETRE_MS) return
    const n = Math.max(1, this.chronoImages)
    this.sonde.msPhysique = this.chronoPhysique / n
    this.sonde.msPeinture = this.chronoPeinture / n
    this.sonde.msChamp = this.msChampBrut / n
    this.sonde.noeuds = this.champNeige.releves
    this.msChampBrut = 0
    this.sonde.images = this.chronoImages
    this.chronoPhysique = 0
    this.chronoPeinture = 0
    this.chronoImages = 0
    this.chronoAge = 0
  }

  private eteindreLeGrain(): void {
    if (this.sonde.vivantes === 0 && !this.grain.visible) return
    this.champ.vider()
    this.grain.clear().setVisible(false)
    this.sonde.vivantes = 0
    this.sonde.cible = 0
    this.sonde.rects = 0
    this.sonde.plafonne = false
    this.sonde.flocons = 0
    this.sonde.gouttes = 0
    this.sonde.msPhysique = 0
    this.sonde.msPeinture = 0
    this.sonde.msChamp = 0
    this.sonde.noeuds = 0
    this.msChampBrut = 0
    this.chronoPhysique = 0
    this.chronoPeinture = 0
    this.chronoImages = 0
    this.chronoAge = 0
  }

  /**
   * PEINDRE — des rectangles à bords francs alignés sur la grille de 4 px MONDE, groupés
   * par cran d'opacité (deux `fillStyle` par ciel, pas un par particule : chaque changement
   * de style rompt le lot).
   */
  private peindre(day: number): void {
    const g = this.grain.clear().setVisible(true)
    let rects = 0
    let flocons = 0
    const crans: readonly (0 | 1)[] = [0, 1]
    // QUATRE GROUPES AU LIEU DE DEUX (R14) : deux natures × deux crans. Chaque groupe est un
    // `fillStyle` et un seul — c'est le lot du rasteriseur qu'on protège, et il ne se rompt
    // pas plus qu'avant : sous un ciel franc, deux des quatre groupes sont vides.
    for (const nature of [false, true]) {
      const profil = nature ? this.melange.froid : this.melange.doux
      if (!profil) continue
      const couleur = teinteDeNuit(profil.teinte, day)
      // LA GRILLE DE CE CIEL, pas une constante globale : la goutte tombe sur 1 px monde (la
      // grille de l'ART), le flocon sur 2 (`GRAIN_FLOCON`), le vent de cendre sur les 4 px des
      // FX de lumière. Voir `ProfilChute.grainPx`.
      const grain = profil.grainPx
      const parTuile = TILE_PX / grain
      for (const cran of crans) {
      g.fillStyle(couleur, profil.alpha[cran]!)
      const epaisseur = profil.taille[cran]!
      for (const p of this.champ.particules) {
        if (!p.vive || p.cran !== cran || p.froid !== nature) continue
        if (nature) flocons++
        // La QUANTIFICATION : la tête tombe sur la grille de l'art, en cellules de 4 px.
        const cx = Math.floor(p.x * parTuile)
        const cy = Math.floor(p.y * parTuile)
        // LA TRAÎNÉE EST PROPORTIONNELLE À LA VITESSE — `trainee` secondes de mouvement.
        // Le flocon (trainee = 0) reste un carré : le même nombre fait les deux.
        const L = profil.trainee === 0
          ? 1
          : Math.max(1, Math.round(Math.sqrt(p.vx * p.vx + p.vy * p.vy) * profil.trainee * parTuile))
        const n = traineeEnRuns(cx, cy, p.vx, p.vy, L, epaisseur, this.runs, 0)
        for (let i = 0; i < n; i++) {
          const r = this.runs[i]!
          g.fillRect(r.cx * grain, r.cy * grain, r.w * grain, r.h * grain)
        }
        rects += n
      }
      }
    }

    this.sonde.vivantes = this.champ.vivantes
    this.sonde.flocons = flocons
    this.sonde.gouttes = this.champ.vivantes - flocons
    this.sonde.cible = this.champ.cible
    this.sonde.rects = rects
    this.sonde.plafonne = this.champ.cible >= BUDGET_PARTICULES
  }

  destroy(): void {
    this.shader?.destroy()
    this.shader = null
    for (const b of this.nappes) b.destroy()
    this.nappes = []
    this.bandesVives = 0
    this.grain.destroy()
  }
}
