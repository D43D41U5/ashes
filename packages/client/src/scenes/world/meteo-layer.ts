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
 *     tous. Les flocons, le blizzard et le voile restent sur les 4 px des FX de lumière ;
 *     **la goutte est descendue à 1 px monde**, la grille de l'art elle-même
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
 * la carte entière. L'écran en montre ~35 : le blizzard n'a donc PAS de lisière lisible, par
 * construction et non par défaut de rendu — c'est le « carte entière par calibrage » de R1, et
 * R9 le compense en l'annonçant la veille au crépuscule. Les autres types, eux, tiennent le
 * contrat géométriquement.
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
import { TILE_PX } from '../../render/framing'
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

uniform vec2 uWorldPx;
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
void cielDe(in float t, in float houle, in float I, out vec3 teinte, out float a) {
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
  if (brouillard) {
    // LE BROUILLARD : dense, PALE, sans grain qui tombe — c'est son signalement, et c'est
    // pour ca qu'il n'a AUCUNE particule. Il mange la distance, il n'assombrit pas
    // (COLD.brouillard = 0 : le ciel dit la meme chose).
    teinte = vec3(0.78, 0.80, 0.82);
    a = (0.34 + 0.20 * houle) * I;
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
  vec2 worldPx = vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uWorldPx;
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
  vec3 c1;
  float a1;
  cielDe(uType, houle, I, c1, a1);
  vec3 teinte;
  float a;
  if (uMix <= 0.002) {
    teinte = c1;
    a = a1;
  } else {
    vec3 c2;
    float a2;
    cielDe(uType2, houle, I, c2, a2);
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
    const worldW = mapWidth * TILE_PX
    const worldH = mapHeight * TILE_PX
    this.shader = scene.add
      .shader(
        {
          name: 'braises-meteo',
          fragmentSource: FRAGMENT,
          setupUniforms: (setUniform: (name: string, value: unknown) => void) => {
            setUniform('uWorldPx', [worldW, worldH])
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
          },
        },
        0,
        0,
        worldW,
        worldH,
      )
      .setOrigin(0, 0)
      .setDepth(METEO_DEPTH)
      .setVisible(false)
    this.grain = scene.add.graphics().setDepth(METEO_GRAIN_DEPTH).setVisible(false)
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

    this.shader?.setVisible(true)

    // ── LE GRAIN : de vraies particules, émises DANS LE CADRE seulement. ──
    if ((!this.melange.doux && !this.melange.froid) || !this.grainActif) { this.eteindreLeGrain(); return }
    const t0 = performance.now()
    this.champ.update(dt, this.melange, cadre, bande, this.rampe, reservees)
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
      // grille de l'ART), le flocon reste sur les 4 px des FX de lumière. Voir `ProfilChute.grainPx`.
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
    this.grain.destroy()
  }
}
